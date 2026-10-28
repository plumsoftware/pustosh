import { describe, expect, it } from 'vitest';
import { formatIssue, loadGameData, pathToAssetId } from '../src/core/data';
import { readAssetCatalog, readRawData } from '../tools/readGameFiles';

const raw = readRawData();
const assets = readAssetCatalog();

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

describe('данные', () => {
  it('текущие данные — 0 ошибок', () => {
    const res = loadGameData(raw, assets);
    expect(res.errors.map(formatIssue)).toEqual([]);
    expect(res.registry).not.toBeNull();
  });

  it('индекс спрайтов есть (npm run pack-assets)', () => {
    expect(assets, 'нет public/atlases/asset_index.json').toBeDefined();
  });

  it('Registry: выборки', () => {
    const reg = loadGameData(raw, assets).registry!;
    expect(reg.items.get('wood')?.name_ru).toBe('Древесина');
    expect(reg.items.byCategory('trophy')).toHaveLength(6);
    expect(reg.recipes.byStation('hands').length).toBeGreaterThan(0);
    expect(
      reg.recipes
        .byOutput('bandage')
        .map((r) => r.station)
        .sort(),
    ).toEqual(['hands', 'sewing_table']);
    expect(reg.enemies.byBiome(1).map((e) => e.id)).toContain('walker');
    expect(reg.biomes.get(1)?.boss).toBe('butcher');
    expect(reg.objects.get(1, 'pine')?.sprite).toBe('world.biome1_suburb.pine');
    expect(reg.objects.get(1, 'pine')?.afterHarvest).toBe('world.biome1_suburb.pine_stump');
    expect(reg.building.material('wood')?.sprites.face).toBe('building.walls.wood_face');
    expect(reg.defense.get('stakes')?.hp).toBeGreaterThan(0);
    expect(reg.vehicles.get('bicycle')?.body).toBe('vehicles.bicycle_body');
    expect(reg.skills.branches.length).toBe(4);
    expect(reg.balance.world.tilePx).toBe(64);
    expect(reg.rigs.humanoid.bones.length).toBeGreaterThan(0);
  });

  it('пути к картинкам превращаются в assetId', () => {
    expect(pathToAssetId('assets/world/biome1_suburb/pine.png')).toBe('world.biome1_suburb.pine');
  });

  it('несуществующий предмет в рецепте — ошибка с понятным текстом', () => {
    const bad = clone(raw) as { recipes: { id: string; inputs: Record<string, number> }[] };
    bad.recipes[0]!.inputs['unobtainium'] = 2;
    const res = loadGameData(bad, assets);
    const msgs = res.errors.map(formatIssue);
    expect(msgs).toContain(
      `ОШИБКА: recipes.json → ${bad.recipes[0]!.id}.inputs.unobtainium: нет предмета «unobtainium» в items.json`,
    );
  });

  it('неверный тип поля — ошибка схемы с id записи', () => {
    const bad = clone(raw) as { items: { id: string; stack: unknown }[] };
    bad.items[0]!.stack = 'много';
    const res = loadGameData(bad, assets);
    expect(res.registry).toBeNull();
    expect(res.errors[0]!.where).toBe(`items.json → ${bad.items[0]!.id}.stack`);
  });

  it('картинка replaced или несуществующая — ошибка', () => {
    const bad = clone(raw) as { items: { icon: string }[] };
    bad.items[0]!.icon = 'assets/world/defense/bear_trap_closed_OLD.png';
    bad.items[1]!.icon = 'assets/icons/base/nope.png';
    const msgs = loadGameData(bad, assets).errors.map((e) => e.message);
    expect(msgs.some((m) => m.includes('status: replaced'))).toBe(true);
    expect(msgs.some((m) => m.includes('icons.base.nope'))).toBe(true);
  });

  it('рецепт сам себе и неверный инструмент добычи', () => {
    const bad = clone(raw) as {
      recipes: { id: string; output: string; inputs: Record<string, number> }[];
      biomes: { biomes: { objects: { harvest?: { tool: string } }[] }[] };
    };
    const r = bad.recipes[0]!;
    r.inputs[r.output] = 1;
    const obj = bad.biomes.biomes[0]!.objects.find((o) => o.harvest)!;
    obj.harvest!.tool = 'laser';
    const msgs = loadGameData(bad, assets).errors.map((e) => e.message);
    expect(msgs).toContain(`результат «${r.output}» нужен сам себе`);
    expect(msgs.some((m) => m.includes('«laser»'))).toBe(true);
  });

  it('requiresSkill на несуществующую ветку — ошибка', () => {
    const bad = clone(raw) as { recipes: { requiresSkill: string | null }[] };
    bad.recipes[0]!.requiresSkill = 'wizard_2';
    expect(loadGameData(bad, assets).errors.some((e) => e.message.includes('wizard_2'))).toBe(true);
  });
});

describe('worldgen и префабы', () => {
  it('неизвестный тайл, материал и станок — ошибки с местом', () => {
    const bad = clone(raw) as {
      worldgen: {
        tileMix: Record<string, Record<string, number>>;
        ruins: { materials: Record<string, string[]> };
      };
      prefabs: Record<string, { objects: { station?: string }[] }>;
    };
    bad.worldgen.tileMix['1']!['lava'] = 0.1;
    bad.worldgen.ruins.materials['1'] = ['marble'];
    bad.prefabs['bunker_start']!.objects[0]!.station = 'teleporter';
    const msgs = loadGameData(bad, assets).errors.map(formatIssue);
    expect(msgs.some((m) => m.includes('worldgen.json → tileMix.1') && m.includes('lava'))).toBe(true);
    expect(msgs.some((m) => m.includes('marble'))).toBe(true);
    expect(msgs.some((m) => m.includes('bunker_start') && m.includes('teleporter'))).toBe(true);
  });

  it('строки плана разной длины — ошибка схемы', () => {
    const bad = clone(raw) as { prefabs: Record<string, { plan: string[] }> };
    bad.prefabs['ruin_shack']!.plan[1] = '#..';
    const res = loadGameData(bad, assets);
    expect(res.errors.some((e) => e.where.startsWith('world/prefabs/ruin_shack.json'))).toBe(true);
  });
});
