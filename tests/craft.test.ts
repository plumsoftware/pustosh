import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/core/data';
import { Inventory, makeStack, PlayerInventory } from '../src/core/inventory';
import {
  consumeFrom,
  disassembleReturn,
  inputsOf,
  isKnown,
  maxCraftable,
  missingFor,
  noticeRecipes,
  recipeStatus,
  Stations,
  whereToGet,
  type CraftSource,
} from '../src/core/systems/Craft';
import type { WorldObject } from '../src/core/world';
import { readAssetCatalog, readRawData } from '../tools/readGameFiles';

const reg = loadGameData(readRawData(), readAssetCatalog()).registry!;
const recipe = (out: string) => reg.recipes.byOutput(out)[0]!;

const station = (id: string, x = 0, y = 0, uid = id): WorldObject => ({
  uid,
  ref: { type: 'station', id },
  kind: 'station',
  sprite: '',
  x,
  y,
  biome: 1,
  collider: null,
  state: 'intact',
});

function playerWith(items: Record<string, number>): PlayerInventory {
  const p = new PlayerInventory(reg);
  for (const [id, n] of Object.entries(items)) p.add(makeStack(reg, id, n));
  return p;
}

const asSource = (inv: PlayerInventory | Inventory, onCommit?: () => void): CraftSource => ({
  count: (id) => inv.count(id),
  remove: (id, n) => {
    if (inv instanceof Inventory) return inv.remove(id, n);
    const k = inv.main.remove(id, n);
    return k + inv.hotbar.remove(id, n - k);
  },
  commit: onCommit,
});

describe('Крафт: ресурсы', () => {
  it('списание атомарно: не хватает — ничего не списано', () => {
    const p = playerWith({ sticks: 3, stone: 3, fiber: 1 });
    const src = [asSource(p)];
    const r = recipe('axe_stone');
    expect(missingFor(src, inputsOf(r))).toEqual({ fiber: 1 });
    expect(consumeFrom(src, inputsOf(r))).toBe(false);
    expect(p.count('sticks')).toBe(3);
    p.add(makeStack(reg, 'fiber', 1));
    expect(consumeFrom(src, inputsOf(r))).toBe(true);
    expect(p.count('sticks') + p.count('stone') + p.count('fiber')).toBe(0);
  });

  it('ресурсы добираются из сундука рядом; сундук записывает изменения', () => {
    const p = playerWith({ wood: 5 });
    const chest = new Inventory(reg, 24, [makeStack(reg, 'wood', 10), makeStack(reg, 'stone', 4)]);
    let commits = 0;
    const src = [asSource(p), asSource(chest, () => commits++)];
    const r = recipe('workbench_1'); // wood 8, stone 4
    expect(maxCraftable(src, r)).toBe(1);
    expect(consumeFrom(src, inputsOf(r))).toBe(true);
    expect(p.count('wood')).toBe(0); // сначала у игрока
    expect(chest.count('wood')).toBe(7);
    expect(chest.count('stone')).toBe(0);
    expect(commits).toBe(1);
  });
});

describe('Крафт: станки', () => {
  it('очередь до queueMax, выход по готовности', () => {
    const st = new Stations(reg);
    const s = st.of(station('workbench_1'), 0);
    const r = recipe('wrench');
    for (let i = 0; i < reg.craft.queueMax; i++) expect(st.enqueue(s, r, {})).toBe(true);
    expect(st.enqueue(s, r, {})).toBe(false);
    st.advance(s, r.timeSec * 2 + 0.01, {});
    expect(s.queue.length).toBe(reg.craft.queueMax - 2);
    expect(s.output.map((o) => o.id)).toEqual(['wrench', 'wrench']);
  });

  it('догон: за любой промежуток результат тот же, что по тикам', () => {
    const a = new Stations(reg);
    const b = new Stations(reg);
    const sa = a.of(station('forge'), 0);
    const sb = b.of(station('forge'), 0);
    const r = recipe('steel_ingot');
    for (const [st, s] of [
      [a, sa],
      [b, sb],
    ] as const) {
      st.addFuel(s, makeStack(reg, 'coal', 2));
      for (let i = 0; i < 5; i++) st.enqueue(s, r, {});
    }
    for (let t = 0.05; t <= 200; t += 0.05) a.advance(sa, t, {});
    b.advance(sb, 200, {});
    expect(sa.output).toEqual(sb.output);
    expect(sa.queue.length).toBe(sb.queue.length);
    expect(sa.fuel?.count ?? 0).toBe(sb.fuel?.count ?? 0);
  });

  it('сохранение: прогресс переживает выгрузку и загрузку', () => {
    const st = new Stations(reg);
    const s = st.of(station('workbench_1', 10, 10, 'wb'), 0);
    st.enqueue(s, recipe('wrench'), {});
    st.advance(s, 1, {});
    const copy = new Stations(reg, JSON.parse(JSON.stringify(st.toJSON())));
    const s2 = copy.get('wb')!;
    expect(s2.queue[0]!.left).toBeCloseTo(recipe('wrench').timeSec - 1);
    copy.advance(s2, 100, {});
    expect(s2.output[0]?.id).toBe('wrench');
  });

  it('топливо: без него горн стоит, уголь горит дольше дров', () => {
    const st = new Stations(reg);
    const s = st.of(station('forge'), 0);
    const r = recipe('steel_ingot'); // 20 с
    st.enqueue(s, r, {});
    st.advance(s, 100, {});
    expect(s.output.length).toBe(0);
    expect(st.blockedBy(s)).toBe('fuel');
    expect(st.addFuel(s, makeStack(reg, 'stone', 1))).toBe(1); // не топливо
    st.addFuel(s, makeStack(reg, 'wood', 1)); // 30 с работы
    for (let i = 0; i < 4; i++) st.enqueue(s, r, {});
    st.advance(s, 200, {});
    expect(s.output[0]?.count).toBe(1); // 30 с дров — один слиток и половина второго
    expect(s.fuel).toBeNull();
    st.addFuel(s, makeStack(reg, 'coal', 1)); // 90 с
    st.advance(s, 400, {});
    expect(s.output[0]?.count).toBe(5);
  });

  it('костёр горит и без задания; электростол — только у генератора с топливом', () => {
    const st = new Stations(reg);
    const fire = st.of(station('campfire'), 0);
    st.addFuel(fire, makeStack(reg, 'wood', 1));
    st.advance(fire, 10, {});
    expect(st.burning(fire)).toBe(true);
    st.advance(fire, 1000, {});
    expect(st.burning(fire)).toBe(false);

    const bench = st.of(station('electric_bench', 50, 50), 0);
    expect(st.blockedBy(bench)).toBe('power');
    const gen = st.of(station('generator', 55, 50), 0);
    st.addFuel(gen, makeStack(reg, 'crude_oil', 1));
    expect(st.blockedBy(bench)).toBeNull();
    const far = st.of(station('electric_bench', 200, 200, 'far'), 0);
    expect(st.blockedBy(far)).toBe('power');
  });

  it('костёр бункера (state on) горит без топлива и готовит', () => {
    const st = new Stations(reg);
    const o = { ...station('campfire'), ref: { type: 'station' as const, id: 'campfire', state: 'on' } };
    const s = st.of(o, 0);
    const r = reg.recipes.byStation('campfire')[0]!;
    st.enqueue(s, r, {});
    st.advance(s, 10000, {});
    expect(st.burning(s)).toBe(true);
    expect(s.output.length).toBe(1);
  });

  it('выход полон — станок ждёт', () => {
    const st = new Stations(reg);
    const s = st.of(station('workbench_1'), 0);
    const r = recipe('wrench'); // с прочностью — каждая в свой стак
    for (let i = 0; i < reg.craft.outputMaxStacks; i++) s.output.push(makeStack(reg, 'wrench', 1));
    st.enqueue(s, r, {});
    st.advance(s, 100, {});
    expect(s.queue.length).toBe(1);
    expect(st.blockedBy(s)).toBe('output');
  });

  it('instant_craft — только для задания дольше instantCraftMinSec', () => {
    const st = new Stations(reg);
    const s = st.of(station('forge'), 0);
    st.enqueue(s, recipe('steel_ingot'), {}); // 20 с
    expect(st.canFinishNow(s)).toBe(false);
    for (let i = 0; i < 2; i++) st.enqueue(s, recipe('steel_ingot'), {});
    s.queue[0]!.left = reg.craft.instantCraftMinSec + 5;
    expect(st.canFinishNow(s)).toBe(true);
    expect(st.finishNow(s)).toBe(true);
    expect(s.output[0]?.id).toBe('steel_ingot');
  });

  it('руками — не дольше handsMaxSec, готовое сразу в инвентарь', () => {
    const st = new Stations(reg);
    st.enqueueHands(recipe('axe_stone'), {});
    const got: string[] = [];
    st.tickHands(reg.craft.handsMaxSec + 0.01, (s) => got.push(s.id));
    expect(got).toEqual(['axe_stone']);
  });

  it('разборка возвращает половину ресурсов', () => {
    expect(disassembleReturn(reg, 'workbench_1')).toEqual([
      { id: 'wood', count: 4 },
      { id: 'stone', count: 2 },
    ]);
  });
});

describe('Крафт: открытие рецептов', () => {
  it('рецепт с ресурсом тира ≥ 2 открывается первым подбором', () => {
    const known = new Set<string>();
    const wb2 = recipe('workbench_2'); // nails_bolts — тир 2
    expect(isKnown(reg, wb2, known)).toBe(false);
    expect(isKnown(reg, recipe('axe_stone'), known)).toBe(true);
    expect(noticeRecipes(reg, 'nails_bolts', known)).toContain('r_workbench_2');
    expect(isKnown(reg, wb2, known)).toBe(true);
  });

  it('оружейный стол и его рецепты закрыты без engineer_2', () => {
    const known = new Set(reg.recipes.all.map((r) => r.id));
    const p = playerWith({ steel_plates: 10, steel_ingot: 10, planks: 20, nails_bolts: 20, scrap_metal: 20 });
    const src = [asSource(p)];
    expect(recipeStatus(reg, recipe('gun_bench'), known, {}, src)).toBe('skill');
    expect(recipeStatus(reg, recipe('gun_bench'), known, { engineer_2: 2 }, src)).toBe('ready');
    expect(recipeStatus(reg, recipe('pistol'), known, {}, src)).toBe('skill');
  });

  it('чертёжные рецепты неизвестны, где добыть — по биомам и рецептам', () => {
    expect(recipeStatus(reg, recipe('railgun'), new Set(), {}, [])).toBe('unknown');
    const w = whereToGet(reg, 'copper_ore', 3);
    expect(w.objects.some((o) => o.biome === 2 && o.tool === 'pickaxe' && o.minTier === 2)).toBe(true);
    expect(whereToGet(reg, 'steel_ingot').recipes).toEqual([{ station: 'forge' }]);
  });
});

describe('Цепочка пригород → болото (GDD §7, критерий шага 6)', () => {
  it('каждый шаг собирается из ресурсов биомов 1–2, лута и предыдущих шагов', () => {
    const chain = [
      'axe_stone',
      'pickaxe_stone',
      'hammer_builder',
      'workbench_1',
      'wrench',
      'axe_scrap',
      'pickaxe_scrap',
      'shovel_wooden',
      'planks',
      'workbench_2',
      'forge',
      'coal',
      'steel_ingot',
      'smelter',
      'copper_ingot',
    ];
    const have = new Set<string>();
    // Добыча биомов 1–2 (руками и инструментами, которые к этому моменту уже есть).
    for (const b of [1, 2])
      for (const o of reg.objects.byBiome(b))
        for (const [id, [, hi]] of Object.entries(o.harvest?.drops ?? {})) if (hi > 0) have.add(id);
    for (const f of reg.objects.furniture.all) for (const id of Object.keys(f.harvest.drops)) have.add(id);
    // Лут обычных ящиков (тиры 1–2).
    for (const t of ['general', 'tools_clothes', 'junk'])
      for (const e of reg.loot.tables[t]!) have.add(e.item);
    const stations = new Set(['hands']);
    for (const out of chain) {
      const r = recipe(out);
      expect(stations.has(r.station), `${out}: нет станка ${r.station}`).toBe(true);
      for (const id of Object.keys(r.inputs)) expect(have.has(id), `${out}: не добыть ${id}`).toBe(true);
      have.add(out);
      if (reg.stations.has(out)) stations.add(out);
    }
  });
});
