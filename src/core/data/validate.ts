import type { DataIssue } from './loadGameData';
import type { Registry } from './Registry';
import { pathToAssetId } from './schemas';

/** Что известно о спрайтах: id из asset_index.json и (необязательно) id со статусом replaced. */
export interface AssetCatalog {
  ids: ReadonlySet<string>;
  replaced?: ReadonlySet<string>;
}

/** Инструменты добычи, которых нет среди toolType предметов. */
const BUILTIN_TOOLS = ['hands', 'bucket'];
/** Максимальный уровень в ветке навыков для requiresSkill (engineer_2 → ветка engineer, уровень 2). */
const MAX_SKILL_REF_LEVEL = 3;

/**
 * Перекрёстные проверки данных (шаг 2.5): ссылки на предметы, станки, навыки, картинки,
 * боссов и тайлы биомов, инструменты добычи, рецепты сами на себя.
 */
export function validateReferences(
  reg: Registry,
  raw: Readonly<Record<string, unknown>>,
  assets?: AssetCatalog,
): DataIssue[] {
  const out: DataIssue[] = [];
  const err = (where: string, message: string) => out.push({ level: 'error', where, message });
  const warn = (where: string, message: string) => out.push({ level: 'warning', where, message });

  const item = (where: string, id: string) => {
    if (!reg.items.has(id)) err(where, `нет предмета «${id}» в items.json`);
  };
  const itemsIn = (where: string, rec: Readonly<Record<string, unknown>>) => {
    for (const id of Object.keys(rec)) item(`${where}.${id}`, id);
  };
  const station = (where: string, id: string) => {
    if (!reg.stations.has(id)) err(where, `нет станка «${id}» в stations.json`);
  };
  const skillRef = (where: string, ref: string | null | undefined) => {
    if (ref == null) return;
    const m = /^([a-z]+)_(\d+)$/.exec(ref);
    const branch = m ? reg.skills.branches.find((b) => b.id === m[1]) : undefined;
    if (!m || !branch) {
      err(where, `requiresSkill «${ref}»: нет ветки навыков (ожидается <ветка>_<уровень>)`);
      return;
    }
    const lvl = Number(m[2]);
    if (lvl < 1 || lvl > MAX_SKILL_REF_LEVEL)
      err(where, `requiresSkill «${ref}»: уровень должен быть 1–${MAX_SKILL_REF_LEVEL}`);
  };

  // Дубликаты id
  const dupes = (file: string, ids: readonly string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) err(`${file} → ${id}`, 'повторяющийся id');
      seen.add(id);
    }
  };
  dupes(
    'items.json',
    reg.items.all.map((x) => x.id),
  );
  dupes(
    'recipes.json',
    reg.recipes.all.map((x) => x.id),
  );
  dupes(
    'stations.json',
    reg.stations.all.map((x) => x.id),
  );
  dupes(
    'enemies.json',
    reg.enemies.all.map((x) => x.id),
  );
  dupes(
    'bosses.json',
    reg.bosses.all.map((x) => x.id),
  );
  dupes(
    'defense.json',
    reg.defense.all.map((x) => x.id),
  );
  dupes(
    'vehicles.json',
    reg.vehicles.all.map((x) => x.id),
  );

  // Предметы: патроны
  for (const it of reg.items.all) {
    if (it.ammo) item(`items.json → ${it.id}.ammo`, it.ammo);
  }

  // Рецепты
  for (const r of reg.recipes.all) {
    const w = `recipes.json → ${r.id}`;
    if (!reg.items.has(r.output) && !reg.stations.has(r.output) && !reg.defense.has(r.output)) {
      err(`${w}.output`, `«${r.output}» — нет ни предмета, ни станка, ни защиты`);
    }
    itemsIn(`${w}.inputs`, r.inputs);
    station(`${w}.station`, r.station);
    skillRef(`${w}.requiresSkill`, r.requiresSkill);
    if (r.output in r.inputs) err(w, `результат «${r.output}» нужен сам себе`);
  }
  checkRecipeCycles(reg, err);

  // Станки
  for (const s of reg.stations.all) {
    const w = `stations.json → ${s.id}`;
    if (s.fuel) item(`${w}.fuel`, s.fuel);
    skillRef(`${w}.requiresSkill`, s.requiresSkill);
  }
  for (const id of reg.interior) station(`biomes.json → common.interior`, id);

  // Постройки
  for (const m of reg.building.materials) {
    const w = `building.json → materials.${m.id}`;
    itemsIn(`${w}.cost`, m.cost);
    if (!reg.items.has(m.requires) && !reg.stations.has(m.requires)) {
      err(`${w}.requires`, `«${m.requires}» — нет ни предмета, ни станка`);
    }
    for (const piece of reg.building.def.pieces) {
      if (!(piece in m.sprites)) err(`${w}.sprites`, `нет детали «${piece}»`);
    }
  }
  itemsIn('building.json → doorCost', reg.building.def.doorCost);

  // Защита
  for (const d of reg.defense.all) {
    const w = `defense.json → ${d.id}`;
    itemsIn(`${w}.cost`, d.cost);
    station(`${w}.station`, d.station);
    if (d.effect.ammo) item(`${w}.effect.ammo`, d.effect.ammo);
    if (d.effect.fuel) item(`${w}.effect.fuel`, d.effect.fuel);
  }

  // Враги
  const rigNames = new Set(Object.keys(reg.rigs).filter((k) => k !== 'usage'));
  for (const e of reg.enemies.all) {
    const w = `enemies.json → ${e.id}`;
    itemsIn(`${w}.drops`, e.drops);
    if (!rigNames.has(e.rig)) {
      warn(`${w}.rig`, `скелета «${e.rig}» нет в rigs.json (есть: ${[...rigNames].join(', ')})`);
    }
  }

  // Боссы
  for (const b of reg.bosses.all) {
    const w = `bosses.json → ${b.id}`;
    item(`${w}.trophy.item`, b.trophy.item);
    if (!reg.biomes.get(b.biome)) err(`${w}.biome`, `нет биома ${b.biome}`);
  }

  // Инструменты добычи
  const tools = new Set<string>(BUILTIN_TOOLS);
  for (const it of reg.items.all) if (it.toolType) tools.add(it.toolType);
  const harvest = (w: string, h: { tool: string; drops: Readonly<Record<string, unknown>> } | undefined) => {
    if (!h) return;
    if (!tools.has(h.tool)) err(`${w}.harvest.tool`, `инструмент «${h.tool}» — нет такого toolType`);
    itemsIn(`${w}.harvest.drops`, h.drops);
  };

  // Биомы
  for (const bm of reg.biomes.all) {
    const w = `biomes.json → biomes.${bm.id}`;
    const boss = reg.bosses.get(bm.boss);
    if (!boss) err(`${w}.boss`, `нет босса «${bm.boss}»`);
    else if (boss.biome !== bm.id) err(`${w}.boss`, `босс «${bm.boss}» указан для биома ${boss.biome}`);
    if (bm.enemies.length === 0) err(`${w}.enemies`, 'в биоме нет врагов');
    for (const id of bm.enemies) {
      const e = reg.enemies.get(id);
      if (!e) err(`${w}.enemies`, `нет врага «${id}»`);
      else if (!e.biomes.includes(bm.id))
        warn(`${w}.enemies`, `враг «${id}» не указывает биом ${bm.id} в своих biomes`);
    }
    if (assets) {
      for (const tile of bm.tiles) {
        if (!assets.ids.has(`tiles.${tile}`)) err(`${w}.tiles`, `нет тайла «${tile}» (tiles.${tile})`);
      }
    }
    for (const o of bm.objects) harvest(`${w}.objects.${o.id}`, o.harvest);
  }
  for (const f of reg.objects.furniture.all)
    harvest(`biomes.json → common.furniture_salvage.${f.id}`, f.harvest);

  // Генерация мира и префабы (шаг 3)
  checkWorldgen(reg, err, assets);
  // Лут и добыча (шаг 5)
  checkLoot(reg, err);
  checkCraft(reg, err);
  checkCombat(reg, err);
  checkProgression(reg, err);

  // Картинки: каждая ссылка assets/...png в данных есть в индексе и не replaced.
  if (assets) {
    for (const [file, data] of Object.entries(raw)) {
      walkStrings(data, [], (value, path) => {
        if (!/^assets\/.+\.png$/i.test(value)) return;
        const id = pathToAssetId(value);
        const where = `${file}.json → ${path.join('.')}`;
        if (assets.replaced?.has(id))
          err(where, `картинка «${id}» заменена (status: replaced), используйте замену`);
        else if (!assets.ids.has(id)) err(where, `картинки «${id}» нет в asset_index.json`);
      });
    }
  }

  return out;
}

/** Циклы рецептов на одном станке: A нужен для B, B — для A. */
function checkRecipeCycles(reg: Registry, err: (where: string, message: string) => void): void {
  const byStation = new Map<string, Map<string, string[]>>();
  for (const r of reg.recipes.all) {
    let g = byStation.get(r.station);
    if (!g) byStation.set(r.station, (g = new Map()));
    const deps = g.get(r.output) ?? [];
    deps.push(...Object.keys(r.inputs).filter((i) => i !== r.output));
    g.set(r.output, deps);
  }
  for (const [st, g] of byStation) {
    const state = new Map<string, 1 | 2>();
    const visit = (n: string, stack: string[]): void => {
      if (state.get(n) === 2) return;
      if (state.get(n) === 1) {
        const cyc = stack.slice(stack.indexOf(n)).concat(n);
        err(`recipes.json → станок ${st}`, `рецепты замкнуты в цикл: ${cyc.join(' → ')}`);
        return;
      }
      state.set(n, 1);
      for (const d of g.get(n) ?? []) if (g.has(d)) visit(d, [...stack, n]);
      state.set(n, 2);
    };
    for (const n of g.keys()) visit(n, []);
  }
}

/** Обход всех строк JSON с путём; индекс массива заменяется id элемента. */
function walkStrings(node: unknown, path: string[], fn: (value: string, path: string[]) => void): void {
  if (typeof node === 'string') fn(node, path);
  else if (Array.isArray(node)) {
    node.forEach((el: unknown, i) => {
      const id = el && typeof el === 'object' && 'id' in el ? String((el as { id: unknown }).id) : `[${i}]`;
      walkStrings(el, [...path, id], fn);
    });
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) walkStrings(v, [...path, k], fn);
  }
}

/** worldgen.json и world/prefabs/*.json: тайлы, виды объектов, материалы, ссылки на станки, контейнеры и мебель. */
function checkWorldgen(
  reg: Registry,
  err: (where: string, message: string) => void,
  assets?: AssetCatalog,
): void {
  const w = reg.worldgen;
  const W = 'worldgen.json';
  const tile = (where: string, name: string) => {
    if (assets && !assets.ids.has(`tiles.${name}`)) err(where, `нет тайла «${name}» (tiles.${name})`);
  };
  const biomeIds = reg.biomes.all.map((b) => String(b.id));
  const allKinds = new Set(reg.biomes.all.flatMap((b) => b.objects.map((o) => o.kind)));
  const allObjectIds = new Set(reg.biomes.all.flatMap((b) => b.objects.map((o) => o.id)));
  const material = (where: string, id: string) => {
    if (!reg.building.material(id)) err(where, `нет материала стен «${id}» в building.json`);
  };

  tile(`${W} → sea.tile`, w.sea.tile);
  for (const t of [...w.waterTiles, ...w.blendPriority]) tile(`${W} → тайлы`, t);
  for (const b of biomeIds) {
    const mix = w.tileMix[b];
    if (!mix) err(`${W} → tileMix`, `нет смеси тайлов для биома ${b}`);
    else for (const t of Object.keys(mix)) tile(`${W} → tileMix.${b}`, t);
    for (const sec of ['centerTile', 'sideTile'] as const) {
      const t = w.roads[sec][b];
      if (!t) err(`${W} → roads.${sec}`, `нет тайла дороги для биома ${b}`);
      else tile(`${W} → roads.${sec}.${b}`, t);
    }
    const mats = w.ruins.materials[b];
    if (!mats) err(`${W} → ruins.materials`, `нет материалов руин для биома ${b}`);
    else for (const m of mats) material(`${W} → ruins.materials.${b}`, m);
  }
  for (const [k, m] of Object.entries(w.ringFences.materials))
    material(`${W} → ringFences.materials.${k}`, m);
  if (w.atlasStreaming.unloadRadiusTiles <= w.atlasStreaming.preloadRadiusTiles) {
    err(`${W} → atlasStreaming`, 'unloadRadiusTiles должен быть больше preloadRadiusTiles');
  }
  const allTiles = new Set([...w.blendPriority]);
  for (const b of biomeIds)
    for (const t of Object.keys(w.tileMix[b] ?? {})) {
      if (!allTiles.has(t)) err(`${W} → blendPriority`, `тайл «${t}» не указан в порядке смешивания`);
    }
  for (const k of [
    ...Object.keys(w.objects.kindChance),
    ...w.objects.roadside.kinds,
    ...w.objects.settlements.kinds,
  ]) {
    if (!allKinds.has(k)) err(`${W} → objects`, `вида объектов «${k}» нет в biomes.json`);
  }
  for (const k of allKinds) {
    if (!w.objects.skipKinds.includes(k) && !(k in w.colliders))
      err(`${W} → colliders`, `нет правила коллайдера для вида «${k}»`);
  }
  for (const id of [...Object.keys(w.glow), ...w.lights.lampObjects]) {
    if (!allObjectIds.has(id)) err(`${W} → glow/lights`, `объекта «${id}» нет ни в одном биоме`);
  }

  for (const [id, p] of Object.entries(reg.prefabs)) {
    const where = `world/prefabs/${id}.json`;
    if (p.material) material(`${where} → material`, p.material);
    if ((p.kind === 'ruin' || p.kind === 'bunker') && !p.plan)
      err(where, 'у руины и бункера должен быть plan');
    if (p.anchor && p.plan) {
      const [ax, ay] = p.anchor;
      if (ay >= p.plan.length || ax >= (p.plan[0]?.length ?? 0))
        err(`${where} → anchor`, 'точка привязки вне плана');
    }
    if (p.ring && !allKinds.has(p.ring.kind))
      err(`${where} → ring.kind`, `вида «${p.ring.kind}» нет в biomes.json`);
    if (p.kind === 'gate' && !p.sprite) err(where, 'у ворот нет sprite');
    p.objects.forEach((o, i) => {
      const ow = `${where} → objects[${i}]`;
      if (o.station) {
        const st = reg.stations.get(o.station);
        if (!st) err(ow, `нет станка «${o.station}»`);
        else if (o.state && !st.stateSprites?.[o.state])
          err(ow, `у станка «${o.station}» нет состояния «${o.state}»`);
      } else if (o.container) {
        if (o.container !== 'random' && !reg.objects.containers.has(o.container))
          err(ow, `нет контейнера «${o.container}»`);
      } else if (o.furniture) {
        if (o.furniture !== 'random' && !reg.objects.furniture.has(o.furniture))
          err(ow, `нет мебели «${o.furniture}»`);
      } else if (o.object) {
        const m = /^random:(\w+)$/.exec(o.object);
        if (m ? !allKinds.has(m[1]!) : !allObjectIds.has(o.object)) err(ow, `нет объекта «${o.object}»`);
      } else if (!o.sprite)
        err(ow, 'не указано, что ставить (station / container / furniture / object / sprite)');
    });
  }
}

/** loot_tables.json и harvest.json: предметы, таблицы контейнеров, объекты, станки. */
function checkLoot(reg: Registry, err: (where: string, message: string) => void): void {
  const L = reg.loot;
  const W = 'loot_tables.json';
  for (const [name, entries] of Object.entries(L.tables)) {
    for (const e of entries)
      if (!reg.items.has(e.item)) err(`${W} → tables.${name}`, `нет предмета «${e.item}»`);
    if (!L.rolls[name]) err(`${W} → rolls`, `нет числа позиций для таблицы «${name}»`);
  }
  for (const c of reg.objects.containers.all) {
    if (!L.tables[c.table])
      err(`biomes.json → common.loot_containers.${c.id}.table`, `нет таблицы лута «${c.table}» в ${W}`);
  }
  const lootObjects = new Set(
    reg.biomes.all.flatMap((b) => b.objects.filter((o) => o.kind === 'loot').map((o) => o.id)),
  );
  for (const id of lootObjects)
    if (!L.objects[id]) err(`${W} → objects`, `нет таблицы для объекта лута «${id}»`);
  for (const [id, o] of Object.entries(L.objects)) {
    if (!lootObjects.has(id)) err(`${W} → objects.${id}`, 'такого объекта лута нет в biomes.json');
    if (!L.tables[o.table]) err(`${W} → objects.${id}.table`, `нет таблицы «${o.table}»`);
  }
  const H = reg.harvest;
  for (const id of [...Object.keys(H.storageSlots), ...H.repair.stations]) {
    if (!reg.stations.has(id)) err(`harvest.json`, `нет станка «${id}»`);
  }
  const allIds = new Set(reg.biomes.all.flatMap((b) => b.objects.map((o) => o.id)));
  for (const id of H.noteObjects)
    if (!allIds.has(id)) err('harvest.json → noteObjects', `объекта «${id}» нет ни в одном биоме`);
}

/** craft.json: топливо, закрытые рецепты, урожай грядки, навыки. */
function checkCraft(reg: Registry, err: (where: string, message: string) => void): void {
  const C = reg.craft;
  const W = 'craft.json';
  const skillIds = new Set(reg.skills.branches.flatMap((b) => b.skills.map((s) => s.id)));
  for (const [st, f] of Object.entries(C.fuel)) {
    if (!reg.stations.has(st)) err(`${W} → fuel.${st}`, `нет станка «${st}»`);
    for (const id of Object.keys(f.items))
      if (!reg.items.has(id)) err(`${W} → fuel.${st}`, `нет предмета «${id}»`);
  }
  for (const [id, src] of Object.entries(C.locked)) {
    const r = reg.recipes.get(id);
    if (!r) err(`${W} → locked.${id}`, 'нет такого рецепта');
    else if (r.unlock !== 'blueprint_or_boss')
      err(`${W} → locked.${id}`, `рецепт открыт сразу (unlock: ${r.unlock})`);
    if (src !== 'blueprint' && !reg.items.has(src)) err(`${W} → locked.${id}`, `нет трофея «${src}»`);
  }
  for (const r of reg.recipes.all)
    if (r.unlock === 'blueprint_or_boss' && !C.locked[r.id])
      err(`${W} → locked`, `нет подсказки, где открыть «${r.id}»`);
  for (const id of Object.keys(C.garden.harvest))
    if (!reg.items.has(id)) err(`${W} → garden.harvest`, `нет предмета «${id}»`);
  if (!reg.items.has(C.blueprintItem)) err(`${W} → blueprintItem`, `нет предмета «${C.blueprintItem}»`);
  for (const sk of [C.speedSkill.id, C.fuelSkill.id, ...Object.keys(C.skillLevelRequired)])
    if (!skillIds.has(sk)) err(W, `нет навыка «${sk}» в skills.json`);
}

/** combat.json: враги в весах и поведениях, оружие в магазинах, одежда в тинтах, контейнер награды. */
function checkCombat(reg: Registry, err: (where: string, message: string) => void): void {
  const C = reg.combat;
  const W = 'combat.json';
  for (const id of [...Object.keys(C.spawn.weights), ...Object.keys(C.behaviors)])
    if (!reg.enemies.has(id)) err(W, `нет врага «${id}» в enemies.json`);
  for (const e of reg.enemies.all)
    if (!(e.id in C.spawn.weights)) err(`${W} → spawn.weights`, `нет веса для «${e.id}»`);
  for (const id of [...Object.keys(C.magazine), ...Object.keys(C.bodyTint)])
    if (!reg.items.has(id)) err(W, `нет предмета «${id}»`);
  if (!reg.objects.containers.has(C.bloodNight.rewardContainer))
    err(`${W} → bloodNight.rewardContainer`, `нет контейнера «${C.bloodNight.rewardContainer}»`);
}

/** progression.json: эффекты навыков, награды боссов, пулы заданий, обучение, записки. */
function checkProgression(reg: Registry, err: (where: string, message: string) => void): void {
  const P = reg.prog;
  const W = 'progression.json';
  const skillIds = new Set(reg.skills.branches.flatMap((b) => b.skills.map((s) => s.id)));
  for (const id of Object.keys(P.skillEffects))
    if (!skillIds.has(id)) err(`${W} → skillEffects`, `нет навыка «${id}»`);
  for (const [boss, res] of Object.entries(P.bosses.reward)) {
    if (!reg.bosses.has(boss)) err(`${W} → bosses.reward`, `нет босса «${boss}»`);
    for (const id of Object.keys(res))
      if (!reg.items.has(id)) err(`${W} → bosses.reward.${boss}`, `нет предмета «${id}»`);
  }
  const pools = P.daily.pools as Record<string, string[] | Record<string, string[]>>;
  for (const [k, v] of Object.entries(pools))
    for (const id of Array.isArray(v) ? v : Object.values(v).flat())
      if (!reg.items.has(id)) err(`${W} → daily.pools.${k}`, `нет предмета «${id}»`);
  for (const st of P.tutorial.steps)
    for (const id of st.items ?? [])
      if (!reg.items.has(id)) err(`${W} → tutorial.${st.id}`, `нет предмета «${id}»`);
  const ids = new Set<string>();
  for (const n of P.notes) {
    if (ids.has(n.id)) err(`${W} → notes`, `повтор id «${n.id}»`);
    ids.add(n.id);
    if (n.boss && !reg.bosses.has(n.boss)) err(`${W} → notes.${n.id}`, `нет босса «${n.boss}»`);
  }
}
