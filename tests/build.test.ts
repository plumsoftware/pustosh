import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadGameData } from '../src/core/data';
import {
  canBuild,
  cellFree,
  disassembleSlot,
  enclosure,
  fullRepairCost,
  lineEdges,
  moveCircle,
  pieceCost,
  placePiece,
  rectCells,
  repairEdge,
  segmentHitsEdge,
  upgradeEdge,
  World,
  WALL_DOOR,
  type BuildPiece,
  type BuildSlot,
  type EdgeWall,
  type WorldObject,
} from '../src/core/world';
import { findPath } from '../src/core/systems/Pathfind';
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
      const r = cellFree(w, x + xx, y + yy, () => false);
      if (r)
        throw new Error(
          `клетка ${x + xx},${y + yy}: ${r} ${JSON.stringify(w.objectsAt(x + xx, y + yy).map((o) => [o.uid, o.kind, o.x, o.y]))}`,
        );
    }
  return { x, y };
}

/** Поставить деталь в место (как BuildController.confirm). */
const put = (w: World, piece: BuildPiece, slot: BuildSlot, mat = WOOD) =>
  w.setBuilt(slot.tx, slot.ty, placePiece(reg, w.builtAt(slot.tx, slot.ty), piece, mat, slot));
const wallOf = (mat: number, hp?: number): EdgeWall => ({
  mat,
  kind: 1,
  hp: hp ?? reg.building.materials[mat]!.hp,
});

describe('Строительство: стоимость и правила', () => {
  it('стоимость: стена — cost, пол ×0.5, дверь — doorCost', () => {
    const m = reg.building.materials[WOOD]!;
    expect(pieceCost(reg, 'wall', WOOD)).toEqual(m.cost);
    expect(pieceCost(reg, 'floor', WOOD)).toEqual({ planks: 2, nails_bolts: 1 });
    expect(pieceCost(reg, 'door', WOOD)).toEqual(reg.building.def.doorCost);
  });

  it('допустимость: пол — в клетку суши; стена — на ребро у пола; дверь — только в проём', () => {
    const w = new World(reg, { sizeOf });
    const p = freeSpot(w);
    const n: BuildSlot = { tx: p.x, ty: p.y, side: 'n' };
    expect(canBuild(w, 'wall', { tx: p.x, ty: p.y, side: 'c' }, () => false)).toBe('wrong_slot');
    expect(canBuild(w, 'floor', n, () => false)).toBe('wrong_slot');
    // Без фундамента стену не поставить (как в LDOE); забор — можно.
    expect(canBuild(w, 'wall', n, () => false)).toBe('no_floor');
    expect(canBuild(w, 'fence', n, () => false)).toBeNull();
    expect(canBuild(w, 'floor', { ...n, side: 'c' }, () => false)).toBeNull();
    put(w, 'floor', { ...n, side: 'c' });
    expect(canBuild(w, 'floor', { ...n, side: 'c' }, () => false)).toBe('occupied');
    // Все четыре ребра пола доступны: северное и западное своей клетки, южное и восточное — соседей.
    for (const s of [
      n,
      { ...n, side: 'w' },
      { tx: p.x, ty: p.y + 1, side: 'n' },
      { tx: p.x + 1, ty: p.y, side: 'w' },
    ] as BuildSlot[])
      expect(canBuild(w, 'wall', s, () => false)).toBeNull();
    expect(canBuild(w, 'wall', { tx: p.x + 2, ty: p.y, side: 'w' }, () => false)).toBe('no_floor');
    expect(canBuild(w, 'wall', n, () => true)).toBe('creature');
    expect(canBuild(w, 'door', n, () => false)).toBe('no_opening');
    put(w, 'door_opening', n);
    expect(w.edgeBits(p.x, p.y, 'n')).toBe(WALL_DOOR);
    expect(canBuild(w, 'wall', n, () => false)).toBe('occupied');
    expect(canBuild(w, 'door', n, () => false)).toBeNull();
    put(w, 'door', n);
    expect(w.edgeAt(n as never)!.leaf).toBe(true);
    expect(canBuild(w, 'door', n, () => false)).toBe('no_opening');
    // Вода
    let water: [number, number] | null = null;
    for (let y = 0; y < w.size && !water; y += 7)
      for (let x = 0; x < w.size && !water; x += 7)
        if (w.cell(x, y).layer === 1 && w.cell(x, y).biome > 0) water = [x, y];
    if (water)
      expect(canBuild(w, 'floor', { tx: water[0], ty: water[1], side: 'c' }, () => false)).toBe('water');
  });

  it('улучшение: доски → брёвна → кирпич, HP пропорционально, цена — полная новая', () => {
    const u1 = upgradeEdge(reg, wallOf(WOOD, reg.building.materials[WOOD]!.hp / 2))!;
    expect(u1.wall.mat).toBe(LOGS);
    expect(u1.wall.hp).toBe(reg.building.materials[LOGS]!.hp / 2);
    expect(u1.cost).toEqual(reg.building.materials[LOGS]!.cost);
    const u2 = upgradeEdge(reg, u1.wall)!;
    expect(u2.wall.mat).toBe(BRICK);
    expect(upgradeEdge(reg, wallOf(reg.building.materials.length - 1, 1))).toBeNull();
  });

  it('починка: +25% за удар, 10% материала; полный ремонт', () => {
    const max = reg.building.materials[WOOD]!.hp;
    const b = wallOf(WOOD, max * 0.3);
    const r = repairEdge(reg, b)!;
    expect(r.wall.hp).toBeCloseTo(max * 0.55);
    expect(r.cost).toEqual({ planks: 1, nails_bolts: 1 });
    expect(repairEdge(reg, { ...b, hp: max })).toBeNull();
    expect(fullRepairCost(reg, b)).toEqual({ planks: 3, nails_bolts: 3 }); // 3 удара: 30→55→80→100
  });

  it('разбор: дверь, потом проём (50%); пол со стеной не разбирается', () => {
    const w = new World(reg, { sizeOf });
    const p = freeSpot(w);
    const cell: BuildSlot = { tx: p.x, ty: p.y, side: 'c' };
    const n: BuildSlot = { tx: p.x, ty: p.y, side: 'n' };
    put(w, 'floor', cell);
    put(w, 'door_opening', n);
    put(w, 'door', n);
    expect(disassembleSlot(reg, w, cell)).toBeNull(); // держит стену
    const d1 = disassembleSlot(reg, w, n)!;
    expect(d1.piece).toBe('door');
    expect(d1.refund).toEqual({ planks: 1, nails_bolts: 1 });
    w.setBuilt(p.x, p.y, d1.cell);
    const d2 = disassembleSlot(reg, w, n)!;
    expect(d2.piece).toBe('door_opening');
    expect(d2.refund).toEqual({ planks: 2 });
    w.setBuilt(p.x, p.y, d2.cell);
    // Стена с полом по обе стороны держится на любом из них.
    put(w, 'floor', { tx: p.x, ty: p.y - 1, side: 'c' });
    put(w, 'wall', n);
    const d3 = disassembleSlot(reg, w, cell)!;
    expect(d3.piece).toBe('floor');
    expect(d3.cell).toEqual({ n: expect.objectContaining({ mat: WOOD }) as unknown });
  });

  it('протяжка: стены вдоль ребра, пол прямоугольником, не длиннее лимита', () => {
    expect(lineEdges({ tx: 0, ty: 0, side: 'n' }, 3, 7, 12)).toEqual([
      { tx: 0, ty: 0, side: 'n' },
      { tx: 1, ty: 0, side: 'n' },
      { tx: 2, ty: 0, side: 'n' },
      { tx: 3, ty: 0, side: 'n' },
    ]);
    expect(lineEdges({ tx: 5, ty: 5, side: 'w' }, 9, -20, 4).every((e) => e.tx === 5 && e.side === 'w')).toBe(
      true,
    );
    expect(lineEdges({ tx: 5, ty: 5, side: 'w' }, 9, -20, 4).length).toBe(4);
    expect(rectCells(0, 0, -2, 1, 12).length).toBe(6);
  });

  it('дом 4×3 на полу: комната, южная стена, коллизии, путь врага, пули; урон и сохранение', () => {
    const w = new World(reg, { sizeOf });
    const p = freeSpot(w);
    const W = 4;
    const H = 3;
    for (let x = 0; x < W; x++)
      for (let y = 0; y < H; y++) put(w, 'floor', { tx: p.x + x, ty: p.y + y, side: 'c' });
    for (let x = 0; x < W; x++) {
      put(w, 'wall', { tx: p.x + x, ty: p.y, side: 'n' });
      put(w, x === 1 ? 'door_opening' : 'wall', { tx: p.x + x, ty: p.y + H, side: 'n' });
    }
    for (let y = 0; y < H; y++) {
      put(w, 'wall', { tx: p.x, ty: p.y + y, side: 'w' });
      put(w, 'window', { tx: p.x + W, ty: p.y + y, side: 'w' });
    }
    const room = enclosure(w, p.x + 1, p.y + 1, reg.build.roomFillLimit)!;
    expect(room.cells.size).toBe(W * H);
    expect(room.southEdges.size).toBe(W);
    expect(room.southEdges.has(`${p.x + 1},${p.y + H},n`)).toBe(true);
    expect(room.southEdges.has(`${p.x + 1},${p.y},n`)).toBe(false);
    expect(enclosure(w, p.x - 3, p.y - 3, 50)).toBeNull();
    // Стена тонкая: у стены можно стоять в той же клетке, сквозь — нет.
    const inside = moveCircle(w, p.x + 2.5, p.y + 0.6, 0.22, 0, -1, 0.75);
    expect(inside.y).toBeGreaterThan(p.y + 0.2);
    expect(inside.y).toBeLessThan(p.y + 0.4);
    // Пустой проём проходим для всех; дверь — для героя, не для врагов.
    const door = { tx: p.x + 1, ty: p.y + H, side: 'n' as const };
    expect(moveCircle(w, p.x + 1.5, p.y + H - 0.5, 0.22, 0, 1, 0.75, true).y).toBeGreaterThan(p.y + H);
    put(w, 'door', door);
    expect(moveCircle(w, p.x + 1.5, p.y + H - 0.5, 0.22, 0, 1, 0.75, true).y).toBeLessThan(p.y + H);
    expect(moveCircle(w, p.x + 1.5, p.y + H - 0.5, 0.22, 0, 1, 0.75, false).y).toBeGreaterThan(p.y + H);
    // A*: из закрытого дома наружу пути нет.
    const wallBetween = (ax: number, ay: number, bx: number, by: number) =>
      w.edgeBetween(ax, ay, bx, by) !== 0;
    expect(findPath(p.x + 1, p.y + 1, p.x + 1, p.y + H + 2, 8, () => true, 1500, wallBetween)).toBeNull();
    expect(findPath(p.x + 1, p.y + 1, p.x + 2, p.y + 2, 8, () => true, 1500, wallBetween)).not.toBeNull();
    // Пуля: окно и стена держат, дверь со створкой — тоже.
    expect(segmentHitsEdge(w, p.x + W - 0.5, p.y + 1.5, p.x + W + 0.5, p.y + 1.5)).toBe(true);
    expect(segmentHitsEdge(w, p.x + 1.5, p.y + 1.5, p.x + 2.5, p.y + 1.5)).toBe(false);
    // Урон и снос
    const e = { tx: p.x, ty: p.y + 1, side: 'w' as const };
    expect(w.damageEdge(e, 100)).toBe('damaged');
    expect(w.edgeAt(e)!.hp).toBe(200);
    expect(w.damageEdge(e, 500)).toBe('destroyed');
    expect(w.edgeBits(e.tx, e.ty, 'w')).toBe(0);
    expect(w.builtAt(e.tx, e.ty)!.floor).toBe(WOOD);
    // Сохранение: постройки в дельте
    const copy = new World(reg, { sizeOf });
    copy.importDelta(JSON.parse(JSON.stringify(w.exportDelta())));
    expect(copy.edgeBits(p.x + 1, p.y, 'n')).toBe(1);
    expect(copy.cell(p.x + 2, p.y + 2).floor).toBe(WOOD + 1);
  });

  it('старые стены в клетках при загрузке сносятся, пол остаётся', () => {
    const w = new World(reg, { sizeOf });
    const p = freeSpot(w);
    put(w, 'floor', { tx: p.x, ty: p.y, side: 'c' });
    const d = w.exportDelta();
    const ch = Object.values(d.chunks).find((c) => c.build)!;
    const [k] = Object.keys(ch.build!);
    (ch.build as Record<string, unknown>)[k!] = { wall: 0, kind: 1, hp: 300, floor: 0 };
    (ch.build as Record<string, unknown>)['0'] = { wall: 0, kind: 1, hp: 300 };
    const copy = new World(reg, { sizeOf });
    copy.importDelta(JSON.parse(JSON.stringify(d)));
    expect(copy.builtAt(p.x, p.y)).toEqual({ floor: 0 });
    expect(copy.cell(p.x, p.y).wall).toBe(0);
    expect(
      Object.keys(copy.exportDelta().chunks[Object.keys(d.chunks).find((c) => d.chunks[c] === ch)!]!.build!),
    ).not.toContain('0');
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
    put(w, 'floor', { tx: p.x + 1, ty: p.y, side: 'c' });
    put(w, 'wall', { tx: p.x + 1, ty: p.y, side: 'w' });
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
