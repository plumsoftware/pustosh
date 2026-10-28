import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadGameData } from '../src/core/data';
import {
  canBuild,
  disassembleCell,
  enclosure,
  fullRepairCost,
  lineCells,
  pieceCost,
  placePiece,
  repairCell,
  upgradeCell,
  World,
  WALL_DOOR,
  type WorldObject,
} from '../src/core/world';
import {
  damageDefense,
  Dummy,
  explosion,
  initDefense,
  tickDefense,
  type DefenseEnv,
  type DefenseEvent,
} from '../src/core/systems/Defense';
import { readAssetCatalog, readRawData, ROOT } from '../tools/readGameFiles';

const reg = loadGameData(readRawData(), readAssetCatalog()).registry!;
const index = JSON.parse(readFileSync(join(ROOT, 'public/atlases/asset_index.json'), 'utf8')) as Record<
  string,
  { size: [number, number] }
>;
const sizeOf = (id: string) => {
  const s = index[id]?.size;
  return s ? ([s[0] / 64, s[1] / 64] as const) : undefined;
};
const WOOD = 0;
const LOGS = 1;
const BRICK = 2;

/** Свободная клетка у старта: суша, без стен и объектов (у бункера пусто — clearRadius). */
function freeSpot(w: World): { x: number; y: number } {
  // Участок 8×7 южнее бункера; объекты природы на нём убираем (как будто срублены).
  const x = Math.floor(w.start.x) - 3;
  const y = Math.floor(w.start.y) + 4;
  for (let yy = -1; yy < 7; yy++) for (let xx = -1; xx < 8; xx++) w.cell(x + xx, y + yy); // загрузить чанки
  for (let yy = -1; yy < 7; yy++)
    for (let xx = -1; xx < 8; xx++) for (const o of [...w.objectsAt(x + xx, y + yy)]) w.removeObject(o);
  for (let yy = -1; yy < 7; yy++)
    for (let xx = -1; xx < 8; xx++) {
      const r = canBuild(w, 'wall', x + xx, y + yy, () => false);
      if (r)
        throw new Error(
          `клетка ${x + xx},${y + yy}: ${r} ${JSON.stringify(w.objectsAt(x + xx, y + yy).map((o) => [o.uid, o.kind, o.x, o.y]))}`,
        );
    }
  return { x, y };
}

describe('Строительство: стоимость и правила', () => {
  it('стоимость: стена — cost, пол ×0.5, дверь — doorCost', () => {
    const m = reg.building.materials[WOOD]!;
    expect(pieceCost(reg, 'wall', WOOD)).toEqual(m.cost);
    expect(pieceCost(reg, 'floor', WOOD)).toEqual({ planks: 2, nails_bolts: 1 });
    expect(pieceCost(reg, 'door', WOOD)).toEqual(reg.building.def.doorCost);
  });

  it('допустимость: не на воду, не на объект, не на героя; дверь — только в проём', () => {
    const w = new World(reg, { sizeOf });
    const p = freeSpot(w);
    w.getChunk(Math.floor(p.x / 32), Math.floor(p.y / 32));
    expect(canBuild(w, 'wall', p.x, p.y, () => false)).toBeNull();
    expect(canBuild(w, 'wall', p.x, p.y, () => true)).toBe('creature');
    expect(canBuild(w, 'door', p.x, p.y, () => false)).toBe('no_opening');
    w.setBuilt(p.x, p.y, placePiece(reg, null, 'door_opening', WOOD));
    expect(w.cell(p.x, p.y).wallKind).toBe(WALL_DOOR);
    expect(canBuild(w, 'wall', p.x, p.y, () => false)).toBe('occupied');
    expect(canBuild(w, 'door', p.x, p.y, () => false)).toBeNull();
    expect(canBuild(w, 'floor', p.x, p.y, () => false)).toBeNull(); // пол под стеной можно
    // Вода
    let water: [number, number] | null = null;
    for (let y = 0; y < w.size && !water; y += 7)
      for (let x = 0; x < w.size && !water; x += 7)
        if (w.cell(x, y).layer === 1 && w.cell(x, y).biome > 0) water = [x, y];
    if (water) expect(canBuild(w, 'wall', water[0], water[1], () => false)).toBe('water');
  });

  it('улучшение: доски → брёвна → кирпич, HP пропорционально, цена — полная новая', () => {
    let b = placePiece(reg, null, 'wall', WOOD);
    b = { ...b, hp: reg.building.materials[WOOD]!.hp / 2 };
    const u1 = upgradeCell(reg, b)!;
    expect(u1.cell.wall).toBe(LOGS);
    expect(u1.cell.hp).toBe(reg.building.materials[LOGS]!.hp / 2);
    expect(u1.cost).toEqual(reg.building.materials[LOGS]!.cost);
    const u2 = upgradeCell(reg, u1.cell)!;
    expect(u2.cell.wall).toBe(BRICK);
    const last = upgradeCell(reg, { wall: reg.building.materials.length - 1, kind: 1, hp: 1 });
    expect(last).toBeNull();
  });

  it('починка: +25% за удар, 10% материала; полный ремонт', () => {
    const max = reg.building.materials[WOOD]!.hp;
    const b = { ...placePiece(reg, null, 'wall', WOOD), hp: max * 0.3 };
    const r = repairCell(reg, b)!;
    expect(r.cell.hp).toBeCloseTo(max * 0.55);
    expect(r.cost).toEqual({ planks: 1, nails_bolts: 1 });
    expect(repairCell(reg, { ...b, hp: max })).toBeNull();
    expect(fullRepairCost(reg, b)).toEqual({ planks: 3, nails_bolts: 3 }); // 3 удара: 30→55→80→100
  });

  it('разбор: дверь, потом стена (50%), потом пол', () => {
    const b = { ...placePiece(reg, placePiece(reg, null, 'floor', WOOD), 'door_opening', WOOD), leaf: true };
    const d1 = disassembleCell(reg, b)!;
    expect(d1.piece).toBe('door');
    expect(d1.refund).toEqual({ planks: 1, nails_bolts: 1 });
    const d2 = disassembleCell(reg, d1.cell!)!;
    expect(d2.piece).toBe('door_opening');
    expect(d2.refund).toEqual({ planks: 2 });
    const d3 = disassembleCell(reg, d2.cell!)!;
    expect(d3.piece).toBe('floor');
    expect(d3.cell).toBeNull();
  });

  it('линия протяжки — по большей оси, не длиннее лимита', () => {
    expect(lineCells(0, 0, 3, 1, 12)).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    expect(lineCells(5, 5, 5, -20, 4).length).toBe(4);
  });

  it('дом 6×5: комната найдена, южная стена — в южном ряду; урон и снос стены', () => {
    const w = new World(reg, { sizeOf });
    const p = freeSpot(w);
    for (let x = 0; x < 6; x++)
      for (let y = 0; y < 5; y++) {
        const edge = x === 0 || y === 0 || x === 5 || y === 4;
        if (edge)
          w.setBuilt(
            p.x + x,
            p.y + y,
            placePiece(reg, null, x === 2 && y === 4 ? 'door_opening' : 'wall', WOOD),
          );
        else w.setBuilt(p.x + x, p.y + y, placePiece(reg, null, 'floor', WOOD));
      }
    const room = enclosure(w, p.x + 2, p.y + 2, reg.build.roomFillLimit)!;
    expect(room.cells.size).toBe(12);
    expect(room.southWalls.has(`${p.x + 1},${p.y + 4}`)).toBe(true);
    expect(room.southWalls.has(`${p.x + 1},${p.y}`)).toBe(false);
    expect(room.southWalls.has(`${p.x},${p.y + 2}`)).toBe(false); // боковая стена
    expect(room.southWalls.size).toBe(6);
    expect(enclosure(w, p.x - 3, p.y - 3, 50)).toBeNull();
    // Урон и снос
    expect(w.damageWall(p.x, p.y + 1, 100)).toBe('damaged');
    expect(w.builtAt(p.x, p.y + 1)!.hp).toBe(200);
    expect(w.damageWall(p.x, p.y + 1, 500)).toBe('destroyed');
    expect(w.cell(p.x, p.y + 1).wall).toBe(0);
    // Сохранение: постройки в дельте
    const copy = new World(reg, { sizeOf });
    copy.importDelta(JSON.parse(JSON.stringify(w.exportDelta())));
    expect(copy.cell(p.x + 1, p.y).wall).toBe(WOOD + 1);
    expect(copy.cell(p.x + 2, p.y + 2).floor).toBe(WOOD + 1);
  });
});

describe('Защита', () => {
  const env = (now: number, dt = 0.05, powered = true): DefenseEnv => ({
    now,
    dt,
    powered: () => powered,
    contactCd: new Map(),
  });
  const place = (id: string, x = 10, y = 10): WorldObject => {
    const def = reg.defense.require(id);
    const init = initDefense(def);
    return {
      uid: id,
      ref: { type: 'defense', id },
      kind: 'defense',
      sprite: def.sprite,
      x,
      y,
      biome: 1,
      collider: null,
      state: 'intact',
      hp: init.hp,
      data: init.data,
    };
  };

  it('капкан захлопывается на враге, держит и бьёт; героя не трогает', () => {
    const o = place('bear_trap');
    const hero = { ...new Dummy(reg, 'hero', 10, 10), hero: true };
    const ev: DefenseEvent[] = [];
    tickDefense(reg, o, [hero], env(0), ev);
    expect(ev.length).toBe(0);
    const d = new Dummy(reg, 'd', 10.2, 10);
    tickDefense(reg, o, [d], env(1), ev);
    expect(ev.map((e) => e.type)).toEqual(['trap', 'hit']);
    expect(o.data!['armed']).toBe(false);
    expect(d.rootedUntil).toBe(1 + 4);
    d.tick(1, 2);
    expect(d.x).toBeCloseTo(10.2);
  });

  it('турель поворачивает голову, стреляет при наведении и тратит патроны', () => {
    const o = place('turret_mg');
    const d = new Dummy(reg, 'd', 10, 5); // сверху: угол −90°, голова смотрит на 90°
    const ev: DefenseEvent[] = [];
    tickDefense(reg, o, [d], env(0), ev);
    expect(ev.length).toBe(0); // без патронов молчит
    o.data!['ammo'] = 3;
    let t = 0;
    while (!ev.some((e) => e.type === 'shot') && t < 3) {
      tickDefense(reg, o, [d], env(t), ev);
      t += 0.05;
    }
    expect(t).toBeGreaterThan(0.9); // 180° за 1 с
    expect(o.data!['ammo']).toBe(2);
    for (let i = 0; i < 40; i++) tickDefense(reg, o, [d], env(t + i * 0.05), ev);
    expect(o.data!['ammo']).toBe(0);
    expect(ev.filter((e) => e.type === 'shot').length).toBe(3);
  });

  it('энергетическая турель без питания не работает', () => {
    const o = place('turret_energy');
    const d = new Dummy(reg, 'd', 12, 10);
    const ev: DefenseEvent[] = [];
    for (let i = 0; i < 40; i++) tickDefense(reg, o, [d], env(i * 0.05, 0.05, false), ev);
    expect(ev.length).toBe(0);
    for (let i = 0; i < 40; i++) tickDefense(reg, o, [d], env(i * 0.05, 0.05, true), ev);
    expect(ev.some((e) => e.type === 'shot')).toBe(true);
  });

  it('колья бьют раз в contactTickSec, ёж замедляет', () => {
    const o = place('spike_barricade');
    const d = new Dummy(reg, 'd', 10.3, 10);
    const ev: DefenseEvent[] = [];
    const e = env(0);
    for (let i = 0; i < 30; i++) tickDefense(reg, o, [d], { ...e, now: i * 0.05 }, ev);
    expect(ev.filter((x) => x.type === 'hit').length).toBe(2); // 0 и 1.0 с
    expect(d.slowMul).toBe(0.6);
  });

  it('мина бьёт всех, взрыв ранит героя и рушит стены рядом', () => {
    const w = new World(reg, { sizeOf });
    const p = freeSpot(w);
    w.setBuilt(p.x + 1, p.y, placePiece(reg, null, 'wall', WOOD));
    const mine = place('landmine', p.x + 0.5, p.y + 0.5);
    const hero = { ...new Dummy(reg, 'hero', p.x + 0.5, p.y + 0.5), hero: true };
    const ev: DefenseEvent[] = [];
    tickDefense(reg, mine, [hero], env(0), ev);
    const ex = ev.find((e) => e.type === 'explode');
    expect(ex).toBeTruthy();
    if (ex?.type !== 'explode') return;
    const barrel = place('barrel_explosive', p.x + 1, p.y + 0.5);
    const r = explosion(w, ex.x, ex.y, ex.radius, ex.damage, [hero], [barrel]);
    expect(r.targets[0]!.damage).toBeGreaterThan(100);
    expect(r.walls.length).toBeGreaterThan(0);
    expect(barrel.hp).toBe(0);
    const ev2: DefenseEvent[] = [];
    tickDefense(reg, barrel, [], env(1), ev2); // цепная детонация
    expect(ev2[0]?.type).toBe('explode');
    expect(damageDefense(place('stakes'), 500)).toBe('destroyed');
  });
});
