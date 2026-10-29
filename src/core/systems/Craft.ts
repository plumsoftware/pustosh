import type { Registry } from '../data/Registry';
import type { RecipeDef } from '../data/schemas';
import { makeStack, maxStack, type ItemSet } from '../inventory/Inventory';
import type { ItemStack, WorldObject } from '../world/types';
import { branchPoints } from './Progress';

/** Станок «Руки» — меню крафта без станка. */
export const HANDS = 'hands';

/** Откуда списываются ресурсы: инвентарь игрока и сундуки рядом со станком (TZ 6.1.1). */
export interface CraftSource {
  count(id: string): number;
  /** Забрать до n штук, вернуть, сколько забрано. */
  remove(id: string, n: number): number;
  /** Вызывается после списания (сундук записывает содержимое в мир). */
  commit?(): void;
}

/** Уровни навыков игрока (навыки — шаг 9; пока пусто). */
export type SkillLevels = Readonly<Record<string, number>>;

export type RecipeStatus = 'unknown' | 'skill' | 'missing' | 'ready';

export interface CraftJob {
  recipe: string;
  /** Сколько игровых секунд осталось. */
  left: number;
  /** Полное время задания (с учётом навыка). */
  total: number;
}

/** Состояние станка: очередь, выход, топливо, грядка. Хранится в сохранении по uid объекта. */
export interface StationState {
  uid: string;
  id: string;
  x: number;
  y: number;
  queue: CraftJob[];
  output: ItemStack[];
  fuel: ItemStack | null;
  /** Сколько секунд ещё горит текущая порция топлива. */
  burnLeft: number;
  /** До какого игрового момента посчитан прогресс. */
  at: number;
  /** Грядка: когда посажено (игровые секунды). */
  plantedAt?: number;
  /** Горит без топлива (костёр бункера из префаба, state «on»). */
  eternal?: boolean;
  /** Уровень тотема базы (1–3). */
  level?: number;
}

export interface StationsSave {
  list: StationState[];
  hands: CraftJob[];
}

// ------------------------------------------------------------------ ресурсы

export function totalCount(sources: readonly CraftSource[], id: string): number {
  return sources.reduce((n, s) => n + s.count(id), 0);
}

/** Набор входов рецепта × n. */
export function inputsOf(recipe: RecipeDef, n = 1): ItemSet {
  const out: Record<string, number> = {};
  for (const [id, k] of Object.entries(recipe.inputs)) out[id] = k * n;
  return out;
}

/** Чего не хватает: id → сколько ещё нужно. Пусто — хватает. */
export function missingFor(sources: readonly CraftSource[], set: ItemSet): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, n] of Object.entries(set)) {
    const have = totalCount(sources, id);
    if (have < n) out[id] = n - have;
  }
  return out;
}

/** Сколько раз можно сделать рецепт из того, что есть. */
export function maxCraftable(sources: readonly CraftSource[], recipe: RecipeDef): number {
  let n = Infinity;
  for (const [id, k] of Object.entries(recipe.inputs))
    n = Math.min(n, Math.floor(totalCount(sources, id) / k));
  return Number.isFinite(n) ? n : 0;
}

/** Атомарно списать набор: сначала у игрока (первый источник), потом из сундуков. */
export function consumeFrom(sources: readonly CraftSource[], set: ItemSet): boolean {
  if (Object.keys(missingFor(sources, set)).length > 0) return false;
  const touched = new Set<CraftSource>();
  for (const [id, n] of Object.entries(set)) {
    let left = n;
    for (const s of sources) {
      if (left <= 0) break;
      const k = s.remove(id, left);
      if (k > 0) touched.add(s);
      left -= k;
    }
  }
  for (const s of touched) s.commit?.();
  return true;
}

// ------------------------------------------------------------------ открытие рецептов

/** Нужный уровень навыка (craft.json → skillLevelRequired, иначе 1). */
export function skillLevelNeeded(reg: Registry, skill: string): number {
  return reg.craft.skillLevelRequired[skill] ?? 1;
}

/**
 * Требование навыка (skills.json → note): «engineer_2» = 2 очка в ветке Инженер. Если имя не в формате
 * «ветка_N» — уровень самого навыка не ниже skillLevelNeeded.
 */
export function hasSkill(reg: Registry, skills: SkillLevels, skill: string | null | undefined): boolean {
  if (!skill) return true;
  const m = /^([a-z]+)_(\d+)$/.exec(skill);
  if (m && reg.skills.branches.some((b) => b.id === m[1]))
    return branchPoints(reg, skills, m[1]!) >= Number(m[2]);
  return (skills[skill] ?? 0) >= skillLevelNeeded(reg, skill);
}

/** Навык, без которого рецепт закрыт: свой у рецепта или у станка (оружейный стол — engineer_2). */
export function requiredSkill(reg: Registry, recipe: RecipeDef): string | null {
  return recipe.requiresSkill ?? reg.stations.get(recipe.station)?.requiresSkill ?? null;
}

/**
 * Известен ли рецепт (TZ 6.2): known — сразу, если среди входов нет ресурса тира ≥ noticeTier
 * (такой рецепт «замечается» при первом подборе ресурса); tutorial и blueprint_or_boss — только из known.
 */
export function isKnown(reg: Registry, recipe: RecipeDef, known: ReadonlySet<string>): boolean {
  if (known.has(recipe.id)) return true;
  if (recipe.unlock !== 'known') return false;
  return noticeItems(reg, recipe).length === 0;
}

/** Ресурсы рецепта тира ≥ noticeTier: первый подбор любого из них открывает рецепт. */
export function noticeItems(reg: Registry, recipe: RecipeDef): string[] {
  return Object.keys(recipe.inputs).filter((id) => (reg.items.get(id)?.tier ?? 0) >= reg.craft.noticeTier);
}

/** Рецепты, которые открывает первый подбор предмета id (возвращает только новые). */
export function noticeRecipes(reg: Registry, id: string, known: Set<string>): string[] {
  if ((reg.items.get(id)?.tier ?? 0) < reg.craft.noticeTier) return [];
  const out: string[] = [];
  for (const r of reg.recipes.all) {
    if (r.unlock !== 'known' || known.has(r.id) || !(id in r.inputs)) continue;
    known.add(r.id);
    out.push(r.id);
  }
  return out;
}

/** Чертёж открывает случайный закрытый рецепт из craft.json → locked со значением «blueprint». */
export function blueprintRecipe(reg: Registry, known: ReadonlySet<string>, roll: number): string | null {
  const pool = Object.entries(reg.craft.locked)
    .filter(([id, src]) => src === 'blueprint' && !known.has(id))
    .map(([id]) => id);
  return pool.length ? pool[Math.min(pool.length - 1, Math.floor(roll * pool.length))]! : null;
}

/** Трофей босса открывает свои рецепты. */
export function trophyRecipes(reg: Registry, trophy: string): string[] {
  return Object.entries(reg.craft.locked)
    .filter(([, src]) => src === trophy)
    .map(([id]) => id);
}

export function recipeStatus(
  reg: Registry,
  recipe: RecipeDef,
  known: ReadonlySet<string>,
  skills: SkillLevels,
  sources: readonly CraftSource[],
): RecipeStatus {
  if (!isKnown(reg, recipe, known)) return 'unknown';
  if (!hasSkill(reg, skills, requiredSkill(reg, recipe))) return 'skill';
  return maxCraftable(sources, recipe) > 0 ? 'ready' : 'missing';
}

// ------------------------------------------------------------------ станки

/** Время задания с бонусом «Конвейер». */
export function jobTime(reg: Registry, recipe: RecipeDef, skills: SkillLevels): number {
  const sk = reg.craft.speedSkill;
  return recipe.timeSec / (1 + (skills[sk.id] ?? 0) * sk.perLevel);
}

/** Сколько секунд работы даёт одна единица топлива на станке (null — не топливо для него). */
export function fuelValue(reg: Registry, station: string, item: string): number | null {
  return reg.craft.fuel[station]?.items[item] ?? null;
}

export function needsFuel(reg: Registry, station: string): boolean {
  return station in reg.craft.fuel;
}

/** Станки без рецептов, с которыми можно взаимодействовать: база, кровати, бочка (шаг 7). */
export const BASE_STATIONS = [
  'base_core',
  'outpost_beacon',
  'bed_pallets',
  'sleeping_bag',
  'rain_barrel',
] as const;

/** Станок открывается из мира: объект-станок с рецептами, топливом, грядка, база, кровать, бочка. */
export function isCraftStation(reg: Registry, o: WorldObject): boolean {
  if (o.ref.type !== 'station') return false;
  const id = o.ref.id;
  return (
    reg.recipes.byStation(id).length > 0 ||
    needsFuel(reg, id) ||
    id === 'garden' ||
    (BASE_STATIONS as readonly string[]).includes(id)
  );
}

export type Deliver = (stack: ItemStack) => number;

/**
 * Все станки мира. Прогресс считается по игровому времени для всех станков сразу,
 * поэтому они работают, даже когда игрок далеко; после загрузки сохранения — догоняют (advance).
 */
export class Stations {
  private readonly map = new Map<string, StationState>();
  /** Крафт руками: короткая очередь, готовое уходит прямо в инвентарь. */
  hands: CraftJob[] = [];

  constructor(
    private readonly reg: Registry,
    save?: StationsSave,
  ) {
    for (const s of save?.list ?? []) this.map.set(s.uid, structuredCloneState(s));
    this.hands = (save?.hands ?? []).map((j) => ({ ...j }));
  }

  /** Состояние станка-объекта (создаётся при первом обращении). */
  of(o: WorldObject, nowSec: number): StationState {
    let s = this.map.get(o.uid);
    if (!s) {
      s = {
        uid: o.uid,
        id: o.ref.id,
        x: o.x,
        y: o.y,
        queue: [],
        output: [],
        fuel: null,
        burnLeft: 0,
        at: nowSec,
      };
      if (o.ref.id === 'garden') s.plantedAt = nowSec;
      // Готовый костёр в префабе (state on) горит без топлива — тёплое место у бункера.
      if (o.ref.type === 'station' && o.ref.state === 'on') s.eternal = true;
      this.map.set(o.uid, s);
    }
    return s;
  }

  get(uid: string): StationState | undefined {
    return this.map.get(uid);
  }

  get all(): readonly StationState[] {
    return [...this.map.values()];
  }

  /** Станок разобран: состояние забыто, возвращается всё, что в нём лежало. */
  remove(uid: string): ItemStack[] {
    const s = this.map.get(uid);
    this.map.delete(uid);
    if (!s) return [];
    const out = s.output.map((x) => ({ ...x }));
    if (s.fuel) out.push({ ...s.fuel });
    // Незаконченные задания возвращают ресурсы целиком.
    for (const j of s.queue) {
      const r = this.reg.recipes.get(j.recipe);
      if (r) for (const [id, n] of Object.entries(r.inputs)) out.push(makeStack(this.reg, id, n));
    }
    return out;
  }

  /** Поставить задание в очередь станка (ресурсы уже списаны). */
  enqueue(s: StationState, recipe: RecipeDef, skills: SkillLevels): boolean {
    if (s.queue.length >= this.reg.craft.queueMax) return false;
    const t = jobTime(this.reg, recipe, skills);
    s.queue.push({ recipe: recipe.id, left: t, total: t });
    return true;
  }

  /** Крафт руками: время не больше handsMaxSec. */
  enqueueHands(recipe: RecipeDef, skills: SkillLevels): void {
    const t = Math.min(this.reg.craft.handsMaxSec, jobTime(this.reg, recipe, skills));
    this.hands.push({ recipe: recipe.id, left: t, total: t });
  }

  /**
   * Отменить задание в очереди (рук или станка): убирается из очереди, возвращается рецепт — вызывающий
   * отдаёт игроку его ингредиенты.
   */
  cancelJob(queue: CraftJob[], index: number): RecipeDef | null {
    const j = queue[index];
    if (!j) return null;
    queue.splice(index, 1);
    return this.reg.recipes.get(j.recipe) ?? null;
  }

  /** Тик крафта руками: готовое — в deliver (остаток вернуть нельзя — кладётся на землю вызывающим). */
  tickHands(dt: number, deliver: (stack: ItemStack) => void): void {
    let left = dt;
    while (left > 0 && this.hands.length > 0) {
      const j = this.hands[0]!;
      const step = Math.min(left, j.left);
      j.left -= step;
      left -= step;
      if (j.left > 1e-9) break;
      this.hands.shift();
      const r = this.reg.recipes.get(j.recipe);
      if (r) deliver(makeStack(this.reg, r.output, r.count));
    }
  }

  /** Положить топливо. Возвращает, сколько не поместилось. */
  addFuel(s: StationState, stack: ItemStack): number {
    if (fuelValue(this.reg, s.id, stack.id) === null) return stack.count;
    const max = this.reg.craft.fuelSlotMax;
    if (s.fuel && s.fuel.id !== stack.id) return stack.count;
    const have = s.fuel?.count ?? 0;
    const k = Math.min(stack.count, max - have);
    if (k <= 0) return stack.count;
    s.fuel = { id: stack.id, count: have + k };
    return stack.count - k;
  }

  /** Горит ли станок сейчас (есть порция или топливо в слоте). */
  burning(s: StationState): boolean {
    return !!s.eternal || s.burnLeft > 0;
  }

  /** Есть ли питание: генератор с топливом в радиусе powerRadiusTiles. */
  powered(s: StationState): boolean {
    for (const g of this.map.values()) {
      if (g.id !== 'generator' || (g.burnLeft <= 0 && !g.fuel)) continue;
      const r = (this.reg.stations.get('generator')?.['powerRadiusTiles'] as number | undefined) ?? 0;
      if (Math.hypot(g.x - s.x, g.y - s.y) <= r) return true;
    }
    return false;
  }

  /** Есть ли питание в точке (электрозабор, турели, пила, прожектор — шаг 7). */
  poweredAt(x: number, y: number): boolean {
    return this.powered({ x, y } as StationState);
  }

  /** Может ли станок сейчас работать (ждёт выхода / топлива / питания). */
  blockedBy(s: StationState): 'output' | 'fuel' | 'power' | null {
    const head = s.queue[0];
    if (head) {
      const r = this.reg.recipes.get(head.recipe);
      if (r && !this.fits(s, makeStack(this.reg, r.output, r.count))) return 'output';
    }
    if (this.reg.stations.get(s.id)?.needsPower && !this.powered(s)) return 'power';
    if (needsFuel(this.reg, s.id) && !s.eternal && s.burnLeft <= 0 && !s.fuel) return 'fuel';
    return null;
  }

  private fits(s: StationState, stack: ItemStack): boolean {
    const max = maxStack(this.reg, stack.id);
    let left = stack.count;
    for (const o of s.output) if (o.id === stack.id && o.durability === undefined) left -= max - o.count;
    if (left <= 0) return true;
    return s.output.length + Math.ceil(left / max) <= this.reg.craft.outputMaxStacks;
  }

  private putOutput(s: StationState, stack: ItemStack): void {
    const max = maxStack(this.reg, stack.id);
    let left = stack.count;
    for (const o of s.output) {
      if (left <= 0) break;
      if (o.id !== stack.id || o.durability !== undefined || stack.durability !== undefined) continue;
      const k = Math.min(left, max - o.count);
      o.count += k;
      left -= k;
    }
    while (left > 0) {
      const k = Math.min(left, max);
      s.output.push({ ...stack, count: k });
      left -= k;
    }
  }

  /** Взять порцию топлива из слота (с бонусом «Механик» — дольше горит). */
  private refuel(s: StationState, skills: SkillLevels): boolean {
    if (!s.fuel) return false;
    const v = fuelValue(this.reg, s.id, s.fuel.id);
    if (v === null) return false;
    const sk = this.reg.craft.fuelSkill;
    s.burnLeft += v / Math.max(0.1, 1 - (skills[sk.id] ?? 0) * sk.perLevel);
    s.fuel.count--;
    if (s.fuel.count <= 0) s.fuel = null;
    return true;
  }

  /**
   * Довести станок до момента now: задания по очереди, топливо по порциям, выход до outputMaxStacks.
   * Работает для любого промежутка — в том числе догон после загрузки или долгого отсутствия.
   */
  advance(s: StationState, now: number, skills: SkillLevels): void {
    let dt = now - s.at;
    s.at = now;
    if (dt <= 0) return;
    const fuelCfg = s.eternal ? undefined : this.reg.craft.fuel[s.id];
    const needPower = this.reg.stations.get(s.id)?.needsPower ?? false;
    // Защита от бесконечного цикла: каждый шаг тратит время, порцию топлива или задание.
    for (let guard = 0; dt > 1e-9 && guard < 10000; guard++) {
      const head = s.queue[0];
      const recipe = head ? this.reg.recipes.get(head.recipe) : undefined;
      const working = !!recipe && this.fits(s, makeStack(this.reg, recipe.output, recipe.count));
      if (needPower && !this.powered(s)) return;
      if (fuelCfg && (working || fuelCfg.burnAlways)) {
        if (s.burnLeft <= 1e-9) {
          s.burnLeft = 0;
          if (!this.refuel(s, skills)) return;
        }
      }
      if (!working) {
        // Простой: горит только то, что горит всегда (костёр, генератор).
        if (fuelCfg?.burnAlways) {
          const step = Math.min(dt, s.burnLeft);
          s.burnLeft -= step;
          dt -= step;
          continue;
        }
        return;
      }
      const step = Math.min(dt, head!.left, fuelCfg ? s.burnLeft : Infinity);
      head!.left -= step;
      if (fuelCfg) s.burnLeft -= step;
      dt -= step;
      if (head!.left <= 1e-9) {
        s.queue.shift();
        this.putOutput(s, makeStack(this.reg, recipe!.output, recipe!.count));
      }
    }
  }

  /** Довести все станки (генераторы первыми — от них зависит питание). */
  update(now: number, skills: SkillLevels): void {
    const list = [...this.map.values()].sort(
      (a, b) => Number(b.id === 'generator') - Number(a.id === 'generator'),
    );
    for (const s of list) this.advance(s, now, skills);
  }

  /** Закончить текущее задание сразу (реклама instant_craft). */
  finishNow(s: StationState): boolean {
    const head = s.queue[0];
    const r = head ? this.reg.recipes.get(head.recipe) : undefined;
    if (!head || !r || !this.fits(s, makeStack(this.reg, r.output, r.count))) return false;
    s.queue.shift();
    this.putOutput(s, makeStack(this.reg, r.output, r.count));
    return true;
  }

  /** Можно ли предложить instant_craft: текущее задание дольше instantCraftMinSec. */
  canFinishNow(s: StationState): boolean {
    const head = s.queue[0];
    return !!head && head.left > this.reg.craft.instantCraftMinSec;
  }

  /** Забрать выход станка: что поместилось — ушло, остальное осталось. */
  collect(s: StationState, deliver: Deliver): number {
    let taken = 0;
    for (const o of s.output) {
      const left = deliver({ ...o });
      taken += o.count - left;
      o.count = left;
    }
    s.output = s.output.filter((o) => o.count > 0);
    return taken;
  }

  /** Стадия грядки: 0 — пусто, 1 — всходы, 2 — созрело. */
  gardenStage(s: StationState, now: number): 0 | 1 | 2 {
    if (s.plantedAt === undefined) return 0;
    const g = this.reg.craft.garden;
    const p = (now - s.plantedAt) / (g.growGameDays * this.reg.balance.dayNight.fullDaySec);
    return p >= 1 ? 2 : p >= g.sproutsAt ? 1 : 0;
  }

  /** Собрать урожай (только созревшее), грядка начинает расти заново. */
  harvestGarden(s: StationState, now: number, roll: (lo: number, hi: number) => number): ItemStack[] {
    if (this.gardenStage(s, now) < 2) return [];
    s.plantedAt = now;
    return Object.entries(this.reg.craft.garden.harvest)
      .map(([id, [lo, hi]]) => makeStack(this.reg, id, roll(lo, hi)))
      .filter((x) => x.count > 0);
  }

  toJSON(): StationsSave {
    return {
      list: [...this.map.values()].map(structuredCloneState),
      hands: this.hands.map((j) => ({ ...j })),
    };
  }
}

function structuredCloneState(s: StationState): StationState {
  return {
    ...s,
    queue: s.queue.map((j) => ({ ...j })),
    output: s.output.map((o) => ({ ...o })),
    fuel: s.fuel ? { ...s.fuel } : null,
  };
}

/** Возврат при разборке станка: disassembleReturn от рецепта, вниз, но хотя бы 1 каждого ресурса. */
export function disassembleReturn(reg: Registry, stationId: string): ItemStack[] {
  const r = reg.recipes.byOutput(stationId)[0];
  if (!r) return [];
  return Object.entries(r.inputs).map(([id, n]) =>
    makeStack(reg, id, Math.max(1, Math.floor(n * reg.craft.disassembleReturn))),
  );
}

/** Где добыть предмет: текст из items.json → source, объекты биомов (вид, инструмент, тир) и рецепты. */
export interface WhereToGet {
  source: string | null;
  objects: { biome: number; kind: string; tool: string; minTier: number }[];
  recipes: { station: string }[];
}

export function whereToGet(reg: Registry, id: string, maxBiome = Infinity): WhereToGet {
  const src = reg.items.get(id)?.['source'];
  const seen = new Set<string>();
  const objects: WhereToGet['objects'] = [];
  for (const b of reg.biomes.all) {
    if (b.id > maxBiome) continue;
    for (const o of reg.objects.byBiome(b.id)) {
      const h = o.harvest;
      if (!h || !(id in h.drops) || h.drops[id]![1] <= 0) continue;
      const key = `${b.id}:${o.kind}:${h.tool}:${h.minTier}`;
      if (seen.has(key)) continue;
      seen.add(key);
      objects.push({ biome: b.id, kind: o.kind, tool: h.tool, minTier: h.minTier });
    }
  }
  const recipes = [...new Set(reg.recipes.byOutput(id).map((r) => r.station))].map((station) => ({
    station,
  }));
  return { source: typeof src === 'string' ? src : null, objects, recipes };
}
