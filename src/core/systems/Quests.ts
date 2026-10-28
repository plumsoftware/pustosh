import type { Registry } from '../data/Registry';
import type { NoteDef } from '../data/schemas';
import { hashSeed, Rng } from '../util/rng';

export interface DailyTask {
  id: string;
  type: 'gather' | 'kill_night' | 'craft' | 'kill';
  /** Цель: предмет (добыть/скрафтить) или враг (убить). */
  target: string;
  n: number;
  done: number;
  reward: { id: string; count: number };
  claimed: boolean;
}

export interface QuestState {
  /** Номер реальных суток (даёт игра), для которых выданы задания. */
  day: number;
  daily: DailyTask[];
  /** Дополнительное задание за рекламу extra_daily уже взято сегодня. */
  extraTaken: boolean;
  notesRead: string[];
}

export function emptyQuests(): QuestState {
  return { day: -1, daily: [], extraTaken: false, notesRead: [] };
}

type Pools = Record<string, string[] | Record<string, string[]>>;

/** Врагов, добычу и награды выбираем из открытых биомов (до maxBiome). */
function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[rng.int(0, list.length - 1)]!;
}

/**
 * Задание по шаблону (progression.json → daily.templates): «добудь N ресурса биома», «убей N врагов
 * ночью», «скрафти предмет», «убей N врагов». Детерминировано по сиду, дню и номеру.
 */
export function makeTask(reg: Registry, seed: number, day: number, k: number, maxBiome: number): DailyTask {
  const D = reg.prog.daily;
  const rng = new Rng(hashSeed(seed, day, k, 31));
  const tpl = pick(rng, D.templates) as {
    type: DailyTask['type'];
    n: [number, number];
    reward: { pool: string; count: [number, number] };
  };
  const pools = D.pools as Pools;
  const biome = 1 + rng.int(0, Math.max(0, maxBiome - 1));
  const biomePool = (pools['biome'] as Record<string, string[]>)[String(biome)] ?? ['wood'];
  let target: string;
  if (tpl.type === 'gather') target = pick(rng, biomePool);
  else if (tpl.type === 'craft') {
    const known = reg.recipes.all.filter(
      (r) =>
        r.station !== 'repair_pit' &&
        r.unlock === 'known' &&
        (reg.items.get(r.output)?.tier ?? 9) <= Math.max(1, maxBiome),
    );
    target = pick(rng, known).output;
  } else {
    const ids = (reg.biomes.get(biome)?.enemies ?? ['walker']).filter(
      (id) => reg.enemies.get(id)?.family !== 'animal',
    );
    target = pick(rng, ids.length ? ids : ['walker']);
  }
  const n = rng.int(tpl.n[0], tpl.n[1]);
  const rp =
    tpl.reward.pool === 'biome' ? biomePool : ((pools[tpl.reward.pool] as string[] | undefined) ?? biomePool);
  return {
    id: `d${day}_${k}`,
    type: tpl.type,
    target,
    n: tpl.type === 'craft' ? Math.min(n, 3) : n,
    done: 0,
    reward: { id: pick(rng, rp), count: rng.int(tpl.reward.count[0], tpl.reward.count[1]) },
    claimed: false,
  };
}

/** Новые сутки (реального времени) — новые 3 задания. */
export function refreshDaily(
  reg: Registry,
  q: QuestState,
  seed: number,
  day: number,
  maxBiome: number,
): boolean {
  if (q.day === day) return false;
  q.day = day;
  q.extraTaken = false;
  q.daily = [];
  for (let k = 0; k < reg.prog.daily.count; k++) q.daily.push(makeTask(reg, seed, day, k, maxBiome));
  return true;
}

/** Задание за рекламу extra_daily (одно в сутки). */
export function addExtraTask(reg: Registry, q: QuestState, seed: number, maxBiome: number): DailyTask | null {
  if (q.extraTaken) return null;
  q.extraTaken = true;
  const t = makeTask(reg, seed, q.day, 100 + q.daily.length, maxBiome);
  q.daily.push(t);
  return t;
}

export type QuestEvent =
  | { type: 'gather'; item: string; n: number }
  | { type: 'craft'; item: string; n: number }
  | { type: 'kill'; enemy: string; night: boolean };

/** Событие игры → прогресс заданий. Возвращает задания, выполненные этим событием. */
export function onQuestEvent(q: QuestState, ev: QuestEvent): DailyTask[] {
  const done: DailyTask[] = [];
  for (const t of q.daily) {
    if (t.done >= t.n) continue;
    let add = 0;
    if (ev.type === 'gather' && t.type === 'gather' && ev.item === t.target) add = ev.n;
    if (ev.type === 'craft' && t.type === 'craft' && ev.item === t.target) add = ev.n;
    if (
      ev.type === 'kill' &&
      (t.type === 'kill' || (t.type === 'kill_night' && ev.night)) &&
      ev.enemy === t.target
    )
      add = 1;
    if (!add) continue;
    t.done = Math.min(t.n, t.done + add);
    if (t.done >= t.n) done.push(t);
  }
  return done;
}

/** Следующая непрочитанная записка: стартовая, затем по биомам до maxBiome (главная линия). */
export function nextNote(reg: Registry, q: QuestState, biome: number): NoteDef | null {
  const read = new Set(q.notesRead);
  return (
    reg.prog.notes.find((n) => !read.has(n.id) && (n.at === 'start' || (n.biome ?? 99) <= biome)) ?? null
  );
}

/** Боссы, на которых указывают прочитанные записки (метки арен на карте). */
export function revealedBosses(reg: Registry, q: QuestState): Set<string> {
  const read = new Set(q.notesRead);
  return new Set(reg.prog.notes.filter((n) => read.has(n.id) && n.boss).map((n) => n.boss!));
}
