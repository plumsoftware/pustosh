import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadGameData } from '../src/core/data';
import { makeStack } from '../src/core/inventory';
import { harvestDefOf, hitObject, respawnSec, rollDrops } from '../src/core/systems/Harvest';
import { containerInfo, rollLoot } from '../src/core/systems/Loot';
import { Rng } from '../src/core/util/rng';
import { World, type WorldObject } from '../src/core/world';
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
const obj = (biome: number, id: string): WorldObject => {
  const d = reg.objects.get(biome, id)!;
  return {
    uid: id,
    ref: { type: 'biome', biome, id },
    kind: d.kind,
    sprite: d.sprite,
    spriteAfter: d.afterHarvest,
    x: 0,
    y: 0,
    biome,
    collider: null,
    state: 'intact',
  };
};

/** Бьём, пока прогресс не дойдёт до hits; возвращает число ударов и износ. */
function chop(o: WorldObject, toolId: string | null) {
  const def = harvestDefOf(reg, o)!;
  const tool = toolId ? makeStack(reg, toolId, 1) : null;
  let progress = 0;
  let hits = 0;
  let wear = 0;
  let proper = true;
  while (progress < def.hits - 1e-9) {
    const r = hitObject(reg, def, tool);
    progress += r.progress;
    wear += r.wear;
    proper &&= r.proper;
    hits++;
  }
  return { hits, wear, proper, def };
}

describe('Добыча', () => {
  it('руками: ветки, волокно, камни с земли', () => {
    for (const id of ['bush_berries', 'tall_grass', 'rock_remains'])
      expect(chop(obj(1, id), null).proper).toBe(true);
  });

  it('каменный топор: сосна за 5 ударов, 4–6 древесины, остаётся пень', () => {
    const pine = obj(1, 'pine');
    const r = chop(pine, 'axe_stone');
    expect(r.hits).toBe(5);
    expect(r.proper).toBe(true);
    for (let s = 1; s < 30; s++) {
      const wood = rollDrops(reg, r.def, new Rng(s), false).find((d) => d.id === 'wood')!.count;
      expect(wood).toBeGreaterThanOrEqual(4);
      expect(wood).toBeLessThanOrEqual(6);
    }
    expect(pine.spriteAfter).toBe('world.biome1_suburb.pine_stump');
  });

  it('каменной киркой медную руду не добыть: нужен тир, двойной износ, минимум дропа', () => {
    const def = harvestDefOf(reg, obj(2, 'copper_rock'))!;
    const r = hitObject(reg, def, makeStack(reg, 'pickaxe_stone', 1));
    expect(r.proper).toBe(false);
    expect(r.need).toEqual({ tool: 'pickaxe', tier: def.minTier });
    expect(r.wear).toBe(reg.harvest.wearPerHit * reg.harvest.wrongToolWearMul);
    expect(r.progress).toBe(reg.harvest.wrongToolProgressMul);
    const drops = rollDrops(reg, def, new Rng(1), true);
    for (const d of drops) expect(d.count).toBe(def.drops[d.id]![0]);
  });

  it('машина разбирается ключом и превращается в остов', () => {
    const car = obj(1, 'car_hatchback');
    expect(chop(car, 'wrench').proper).toBe(true);
    expect(car.spriteAfter).toBe('world.biome1_suburb.car_frame');
  });

  it('сломанный инструмент — 50% эффективности', () => {
    const def = harvestDefOf(reg, obj(1, 'pine'))!;
    const axe = makeStack(reg, 'axe_stone', 1);
    axe.durability = 0;
    expect(hitObject(reg, def, axe).progress).toBe(reg.harvest.brokenEfficiency);
  });

  it('добытое восстанавливается; трава после добычи не мешает ходить', () => {
    const w = new World(reg, { sizeOf });
    const c = w.getChunk(7, 15);
    const o = c.objects.find((x) => x.kind === 'tree') ?? c.objects[0]!;
    const at = respawnSec(reg, o, new Rng(1));
    const range = reg.balance.world['resourceRespawnGameDays'] as [number, number];
    expect(at).toBeGreaterThanOrEqual(range[0] * 720);
    w.markHarvested(o, 100 + at);
    expect(w.update(100 + at - 1).respawned).toEqual([]);
    expect(w.update(100 + at).respawned.map((r) => r.uid)).toEqual([o.uid]);
    expect(o.state).toBe('intact');
  });
});

describe('Лут', () => {
  it('ящик — контейнер с таблицей; лут только из таблицы и по тиру биома', () => {
    const crate: WorldObject = {
      uid: 'c',
      ref: { type: 'container', id: 'crate_wood_closed' },
      kind: 'container',
      sprite: 'x',
      x: 0,
      y: 0,
      biome: 1,
      collider: null,
      state: 'intact',
    };
    const info = containerInfo(reg, crate)!;
    expect(info).toMatchObject({ type: 'loot', table: 'general', slots: 6 });
    const allowed = new Set(reg.loot.tables['general']!.map((e) => e.item));
    for (let s = 1; s < 50; s++) {
      const items = rollLoot(reg, 'general', 1, info.slots, new Rng(s));
      const [lo, hi] = reg.loot.rolls['general']!;
      expect(items.length).toBeGreaterThanOrEqual(Math.min(lo, info.slots));
      expect(items.length).toBeLessThanOrEqual(hi);
      for (const it of items) {
        expect(allowed.has(it.id)).toBe(true);
        expect(reg.items.require(it.id).tier).toBeLessThanOrEqual(1 + reg.loot.maxTierOverBiome);
      }
    }
  });

  it('в пригороде военный ящик не даёт оружие выше тира 2', () => {
    for (let s = 1; s < 80; s++) {
      for (const it of rollLoot(reg, 'military', 1, 6, new Rng(s)))
        expect(reg.items.require(it.id).tier).toBeLessThanOrEqual(2);
    }
  });

  it('сундук — хранилище без таблицы', () => {
    const chest: WorldObject = {
      uid: 's',
      ref: { type: 'station', id: 'chest_wood' },
      kind: 'station',
      sprite: 'x',
      x: 0,
      y: 0,
      biome: 1,
      collider: null,
      state: 'intact',
    };
    expect(containerInfo(reg, chest)).toEqual({
      type: 'storage',
      slots: reg.harvest.storageSlots['chest_wood'],
    });
  });
});
