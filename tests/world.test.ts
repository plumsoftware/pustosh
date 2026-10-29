import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadGameData } from '../src/core/data';
import { dayNightAt } from '../src/core/systems/DayNight';
import { EDGE_GEN, EDGE_KIND, EDGE_T, moveCircle, World, WALL_DOOR } from '../src/core/world';
import { readAssetCatalog, readRawData, ROOT } from '../tools/readGameFiles';

const reg = loadGameData(readRawData(), readAssetCatalog()).registry!;
const index = JSON.parse(readFileSync(join(ROOT, 'public/atlases/asset_index.json'), 'utf8')) as Record<
  string,
  { size: [number, number] }
>;
const tilePx = reg.balance.world.tilePx;
const sizeOf = (id: string) => {
  const s = index[id]?.size;
  return s ? ([s[0] / tilePx, s[1] / tilePx] as const) : undefined;
};
const FACE = 0.75;

describe('World: генерация по сиду', () => {
  it('один сид — одинаковые чанки (0,0), (5,5), (8,8)', () => {
    const a = new World(reg, { sizeOf });
    const b = new World(reg, { sizeOf });
    for (const [cx, cy] of [
      [0, 0],
      [5, 5],
      [8, 8],
    ] as const) {
      expect(a.chunkHash(cx, cy)).toBe(b.chunkHash(cx, cy));
    }
  });

  it('чанк одинаков независимо от порядка генерации соседей', () => {
    const a = new World(reg, { sizeOf });
    const h = a.chunkHash(7, 3);
    const b = new World(reg, { sizeOf });
    b.getChunk(6, 3);
    b.getChunk(8, 4);
    expect(b.chunkHash(7, 3)).toBe(h);
  });

  it('другой сид — другой мир', () => {
    const a = new World(reg, { sizeOf });
    const b = new World(reg, { sizeOf, seed: 12345 });
    expect(a.chunkHash(5, 5)).not.toBe(b.chunkHash(5, 5));
  });

  it('кольца: центр — биом 6, старт — биом 1, угол карты — море', () => {
    const w = new World(reg, { sizeOf });
    const L = w.layout;
    const C = w.size / 2;
    expect(L.biomeAt(C, C)).toBe(6);
    expect(L.biomeAt(w.start.x, w.start.y)).toBe(1);
    expect(L.biomeAt(2, 2)).toBe(0);
    // Граница не идеальный круг: на одном радиусе встречаются разные биомы.
    const r = reg.balance.world.biomeRingsRadiusTiles[1]!;
    const seen = new Set<number>();
    for (let a = 0; a < 360; a += 3) {
      const t = (a * Math.PI) / 180;
      seen.add(L.biomeAt(C + Math.cos(t) * r, C + Math.sin(t) * r));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('дороги идут от края к центру', () => {
    const w = new World(reg, { sizeOf });
    expect(w.layout.roadLines).toHaveLength(reg.worldgen.roads.count);
    for (const line of w.layout.roadLines) {
      const last = line[line.length - 1]!;
      expect(Math.hypot(last.x - w.size / 2, last.y - w.size / 2)).toBeLessThan(
        reg.worldgen.roads.endRadiusTiles + reg.worldgen.roads.segmentTiles,
      );
      expect(w.layout.biomeAt(line[0]!.x, line[0]!.y)).toBeLessThanOrEqual(1);
    }
  });

  it('префабы: стоянка, 6 арен, руины на каждый биом; ворот нет (мягкая граница)', () => {
    const w = new World(reg, { sizeOf });
    const p = w.layout.prefabs;
    expect(p.filter((x) => x.kind === 'bunker')).toHaveLength(1);
    expect(p.filter((x) => x.kind === 'arena')).toHaveLength(6);
    const [lo, hi] = reg.worldgen.ruins.perBiome;
    for (let b = 1; b <= 6; b++) {
      const n = p.filter((x) => x.kind === 'ruin' && x.biome === b).length;
      expect(n, `руины биома ${b}`).toBeGreaterThanOrEqual(lo);
      expect(n).toBeLessThanOrEqual(hi);
    }
    expect(p.filter((x) => x.kind === 'gate')).toHaveLength(0);
  });

  it('у бункера есть горящий костёр со светом', () => {
    const w = new World(reg, { sizeOf });
    const n = reg.balance.world.chunkTiles;
    const cx = Math.floor(w.start.x / n);
    const cy = Math.floor(w.start.y / n);
    const objs = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].flatMap((dy) => w.getChunk(cx + dx, cy + dy).objects));
    const fire = objs.find(
      (o) =>
        o.ref.type === 'station' &&
        o.ref.id === 'campfire' &&
        Math.hypot(o.x - w.start.x, o.y - w.start.y) < 6,
    );
    expect(fire?.light).toBeGreaterThan(0);
  });
});

describe('World: дельта', () => {
  it('сохраняются только изменения; после загрузки они применяются', () => {
    const w = new World(reg, { sizeOf });
    expect(w.exportDelta().chunks).toEqual({});
    const c = w.getChunk(4, 4);
    const [a, b] = c.objects;
    w.setObjectState(a!, 'harvested');
    w.removeObject(b!);
    const delta = w.exportDelta();
    expect(Object.keys(delta.chunks)).toEqual(['4,4']);

    const w2 = new World(reg, { sizeOf });
    w2.importDelta(JSON.parse(JSON.stringify(delta)));
    const c2 = w2.getChunk(4, 4);
    expect(c2.objects.find((o) => o.uid === a!.uid)?.state).toBe('harvested');
    expect(c2.objects.find((o) => o.uid === b!.uid)).toBeUndefined();
  });

  it('выгруженный чанк возвращается с изменениями', () => {
    const w = new World(reg, { sizeOf });
    const o = w.getChunk(2, 6).objects[0]!;
    w.setObjectState(o, 'harvested');
    w.unloadChunk(2, 6);
    expect(w.isLoaded(2, 6)).toBe(false);
    expect(w.getChunk(2, 6).objects.find((x) => x.uid === o.uid)?.state).toBe('harvested');
  });
});

describe('Коллизии', () => {
  it('стена дома мира тонкая (на ребре), не пропускает, вдоль неё — скольжение', () => {
    const w = new World(reg, { sizeOf });
    const n = reg.balance.world.chunkTiles;
    w.getChunk(Math.floor(w.start.x / n), Math.floor(w.start.y / n));
    // Северная стена комнаты — на ребре между кольцом стен плана (земля) и полом.
    const room = w.rooms[0]!;
    const tx = room.x0 + 1;
    const ty = room.y0 + 1;
    w.cell(tx, ty);
    expect(w.cell(tx, room.y0).wall).toBe(0);
    expect(w.edgeBits(tx, ty, 'n') & EDGE_GEN).toBe(EDGE_GEN);
    expect(w.edgeBits(tx, ty, 'n') & EDGE_KIND).not.toBe(WALL_DOOR);
    const r = 0.22;
    const from = { x: tx + 0.5, y: ty - 1.5 };
    const p = moveCircle(w, from.x, from.y, r, 0.3, 3, FACE);
    expect(p.y).toBeLessThanOrEqual(ty - EDGE_T / 2 - r + 1e-6);
    expect(p.y).toBeGreaterThan(ty - 1);
    expect(p.x).toBeGreaterThan(from.x + 0.2);
    // Внутри комнаты пол, у стены можно стоять.
    expect(w.cell(tx, ty).floor).toBeGreaterThan(0);
  });

  it('объект с коллайдером выталкивает', () => {
    const w = new World(reg, { sizeOf });
    const c = w.getChunk(6, 6);
    const o = c.objects.find((x) => x.collider?.shape === 'circle')!;
    const col = o.collider as { x: number; y: number; r: number };
    const p = moveCircle(w, col.x - col.r - 1, col.y, 0.22, 1, 0, FACE);
    expect(Math.hypot(p.x - col.x, p.y - col.y)).toBeGreaterThanOrEqual(col.r + 0.22 - 1e-6);
  });
});

describe('День и ночь', () => {
  const cfg = { ...reg.balance.dayNight, transitionSec: reg.worldgen.dayNight.transitionSec } as never;
  it('фазы и темнота', () => {
    expect(dayNightAt(0, cfg)).toMatchObject({ phase: 'DAWN', day: 1, darkness: 1 });
    expect(dayNightAt(100, cfg)).toMatchObject({ phase: 'DAY', darkness: 0 });
    expect(dayNightAt(465, cfg).phase).toBe('DUSK');
    expect(dayNightAt(600, cfg)).toMatchObject({ phase: 'NIGHT', darkness: 1 });
    expect(dayNightAt(720, cfg).day).toBe(2);
    const dusk = dayNightAt(465, cfg);
    expect(dusk.darkness).toBeGreaterThan(0);
    expect(dusk.darkness).toBeLessThan(1);
    expect(dusk.warm).toBeGreaterThan(0.9);
  });

  it('кровавая ночь — каждая 7-я', () => {
    const night = (d: number) => (d - 1) * 720 + 600;
    expect(dayNightAt(night(7), cfg).bloodNight).toBe(true);
    expect(dayNightAt(night(6), cfg).bloodNight).toBe(false);
    expect(dayNightAt(night(14), cfg).bloodNight).toBe(true);
    expect(dayNightAt((7 - 1) * 720 + 100, cfg).bloodNight).toBe(false);
  });
});

describe('Скорость генерации', () => {
  it('чанк генерируется быстрее 20 мс в среднем', () => {
    const w = new World(reg, { sizeOf });
    const t = performance.now();
    for (let i = 0; i < 16; i++) w.getChunk(i % 16, Math.floor(i / 4) + 3);
    const per = (performance.now() - t) / 16;
    console.log(`чанк: ${per.toFixed(2)} мс`);
    expect(per).toBeLessThan(20);
  });
});

describe('Граница между кольцами', () => {
  it('мягкая: забора нет, из кольца 1 можно дойти до кольца 2', () => {
    const w = new World(reg, { sizeOf });
    expect(w.layout.fenceCells).toBe(0);
    const N = w.size;
    // Клетки, закрытые коллайдерами ворот.
    const gate = new Uint8Array(N * N);
    for (let cy = 0; cy < w.chunksPerSide; cy++)
      for (let cx = 0; cx < w.chunksPerSide; cx++)
        for (const o of w.getChunk(cx, cy).objects) {
          if (o.kind !== 'gate' || o.collider?.shape !== 'rect') continue;
          const c = o.collider;
          for (let y = Math.floor(c.y0) - 1; y <= Math.floor(c.y1) + 1; y++)
            for (let x = Math.floor(c.x0) - 1; x <= Math.floor(c.x1) + 1; x++)
              if (x >= 0 && y >= 0 && x < N && y < N) gate[y * N + x] = 1;
        }
    const blocked = (x: number, y: number) => {
      const c = w.cell(x, y);
      return !c.passable || gate[y * N + x] === 1;
    };
    // Заливка от старта по 4 соседям.
    const seen = new Uint8Array(N * N);
    const q = [Math.floor(w.start.y) * N + Math.floor(w.start.x)];
    seen[q[0]!] = 1;
    let reachedRing2 = false;
    let leak: [number, number] | null = null;
    while (q.length) {
      const i = q.pop()!;
      const x = i % N;
      const y = (i - x) / N;
      if (w.cell(x, y).biome >= 2) {
        reachedRing2 = true;
        leak = [x, y];
        break;
      }
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const j = ny * N + nx;
        if (seen[j] || blocked(nx, ny)) continue;
        seen[j] = 1;
        q.push(j);
      }
    }
    expect(reachedRing2, `не дошли: ${leak}`).toBe(true);
  });
});

describe('Дроп и контейнеры', () => {
  const day = reg.balance.dayNight.fullDaySec;
  const life = reg.worldgen.persistence.droppedItemLifetimeSec;
  const respawn = (reg.balance.world['lootRespawnGameDays'] as number) * day;

  it('выброшенный предмет переживает выгрузку чанка и исчезает по сроку', () => {
    const w = new World(reg, { sizeOf });
    const n = reg.balance.world.chunkTiles;
    const { x, y } = w.start;
    const d = w.dropItem({ id: 'wood', count: 5 }, x + 1, y + 1, 100);
    const cx = Math.floor(d.x / n);
    const cy = Math.floor(d.y / n);
    w.unloadChunk(cx, cy);
    expect(w.update(100 + life - 1).expired).toEqual([]);
    const back = w.getChunk(cx, cy).objects.find((o) => o.uid === d.uid);
    expect(back?.item).toEqual({ id: 'wood', count: 5 });
    const ch = w.update(100 + life);
    expect(ch.expired.map((e) => e.uid)).toEqual([d.uid]);
    expect(w.getChunk(cx, cy).objects.find((o) => o.uid === d.uid)).toBeUndefined();
    expect(w.exportDelta().chunks).toEqual({});
  });

  it('подобранный предмет пропадает; дроп сохраняется в дельте', () => {
    const w = new World(reg, { sizeOf });
    const a = w.dropItem({ id: 'stone', count: 2 }, 300, 300, 0);
    const b = w.dropItem({ id: 'sticks', count: 1 }, 300.5, 300, 0);
    expect(w.pickUp(a)).toEqual({ id: 'stone', count: 2 });
    const w2 = new World(reg, { sizeOf });
    w2.importDelta(JSON.parse(JSON.stringify(w.exportDelta())));
    const objs = w2.getChunk(Math.floor(300 / 32), Math.floor(300 / 32)).objects;
    expect(objs.some((o) => o.uid === a.uid)).toBe(false);
    expect(objs.find((o) => o.uid === b.uid)?.item?.id).toBe('sticks');
    // Новые дропы после загрузки не повторяют id.
    expect(w2.dropItem({ id: 'wood', count: 1 }, 301, 301, 0).uid).not.toBe(b.uid);
  });

  it('содержимое ящика хранится до респауна, даже если чанк выгружен', () => {
    const w = new World(reg, { sizeOf });
    let box = null as ReturnType<World['getChunk']>['objects'][number] | null;
    for (let cy = 0; cy < 16 && !box; cy++)
      for (let cx = 0; cx < 16 && !box; cx++)
        box = w.getChunk(cx, cy).objects.find((o) => o.kind === 'container') ?? null;
    expect(box).not.toBeNull();
    const gen = () => [{ id: 'bandage', count: 2 }];
    expect(w.openContainer(box!, 50, gen)).toEqual([{ id: 'bandage', count: 2 }]);
    w.setContainerContents(box!, [{ id: 'bandage', count: 1 }]);
    const cx = Math.floor(box!.x / 32);
    const cy = Math.floor(box!.y / 32);
    w.unloadChunk(cx, cy);
    const again = w.getChunk(cx, cy).objects.find((o) => o.uid === box!.uid)!;
    expect(again.state).toBe('opened');
    expect(w.openContainer(again, 60, () => [{ id: 'medkit', count: 9 }])).toEqual([
      { id: 'bandage', count: 1 },
    ]);
    expect(w.update(50 + respawn - 1).respawned).toEqual([]);
    expect(w.update(50 + respawn).respawned.map((r) => r.uid)).toEqual([box!.uid]);
    expect(again.state).toBe('intact');
    expect(w.containerContents(again)).toBeNull();
  });
});

describe('Рюкзак погибшего', () => {
  it('лежит на месте смерти с содержимым и исчезает через deathBackpackLifetimeSec', () => {
    const w = new World(reg, { sizeOf });
    const life = reg.balance.player.deathBackpackLifetimeSec;
    const pack = w.placeDeathBackpack(260, 480, [{ id: 'wood', count: 7 }], 1000);
    expect(pack.sprite).toBe('world.interior.dead_backpack');
    expect(w.containerContents(pack)).toEqual([{ id: 'wood', count: 7 }]);
    w.unloadChunk(Math.floor(260 / 32), Math.floor(480 / 32));
    expect(w.update(1000 + life - 1).expired).toEqual([]);
    expect(w.update(1000 + life).expired.map((e) => e.uid)).toEqual([pack.uid]);
  });
});
