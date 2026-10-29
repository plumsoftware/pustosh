import type { Registry } from '../data/Registry';
import type { EnemyDef } from '../data/schemas';

export interface SpawnRequest {
  def: EnemyDef;
  x: number;
  y: number;
  elite: boolean;
  /** Кровавая ночь: идти к тотему. */
  toBase?: boolean;
}

export interface SpawnCtx {
  now: number;
  dt: number;
  night: boolean;
  hero: { x: number; y: number };
  /** Сколько живых врагов сейчас. */
  alive: number;
  mobile: boolean;
  biomeAt(x: number, y: number): number;
  /** Клетка годится: суша, проходимо, нет стены. */
  free(x: number, y: number): boolean;
  /** Внутри базы (тотем): днём не спавнить. */
  inBase(x: number, y: number): boolean;
  base: { x: number; y: number; r: number } | null;
  rng(): number;
  /** Игровые сутки с начала (дробные): от них плотность врагов (combat.json → spawn.byDay). */
  days?: number;
}

/** combat.json → spawn.byDay: спокойные первые дни, затем рост каждые stepEveryDays. */
interface SpawnByDay {
  calmDays: number;
  startMul: number;
  calmEndMul: number;
  stepEveryDays: number;
  stepMul: number;
  maxMul: number;
}

/**
 * Множитель плотности врагов по прожитым суткам (плавно, без скачков): первые calmDays — от
 * startMul до calmEndMul, дальше +stepMul за каждые stepEveryDays, не выше maxMul.
 */
export function spawnDayMul(reg: Registry, days: number): number {
  const D = reg.combat.spawn['byDay'] as SpawnByDay | undefined;
  if (!D) return 1;
  const d = Math.max(0, days);
  if (d < D.calmDays) return D.startMul + ((D.calmEndMul - D.startMul) * d) / D.calmDays;
  return Math.min(D.maxMul, D.calmEndMul + (D.stepMul * (d - D.calmDays)) / D.stepEveryDays);
}

/** Взвешенный выбор врага биома (combat.json → spawn.weights); звери — только днём. */
export function pickEnemy(reg: Registry, biome: number, night: boolean, roll: number): EnemyDef | null {
  const S = reg.combat.spawn;
  const ids = reg.biomes.get(biome)?.enemies ?? [];
  const pool = ids
    .map((id) => reg.enemies.get(id))
    .filter((d): d is EnemyDef => !!d)
    .filter((d) => !(night && S.dayOnlyFamilies.includes(d.family)));
  const total = pool.reduce((a, d) => a + (S.weights[d.id] ?? 1), 0);
  if (total <= 0) return null;
  let r = roll * total;
  for (const d of pool) {
    r -= S.weights[d.id] ?? 1;
    if (r <= 0) return d;
  }
  return pool[pool.length - 1] ?? null;
}

/** Размер группы: бродяги 2–4, стаи псов/волков, пары рапторов. */
export function groupSize(reg: Registry, def: EnemyDef, roll: number): number {
  const b = reg.combat.behaviors[def.id] ?? {};
  const g = b['group'];
  if (Array.isArray(g)) return g[0]! + Math.floor(roll * (g[1]! - g[0]! + 1));
  const pack = b['pack'];
  return typeof pack === 'number' ? pack : 1;
}

/**
 * Спавн (TZ 8.4): в кольце ringTiles от героя по таблице биома с весами, лимит живых день/ночь
 * (на телефоне свой), днём на базе не спавнит, ночью — у края базы; деспавн дальше despawnTiles.
 */
export class SpawnSystem {
  private acc = 0;

  constructor(private readonly reg: Registry) {}

  limit(night: boolean, mobile: boolean): number {
    const S = this.reg.combat.spawn;
    return mobile ? (night ? S.limitNightMobile : S.limitDayMobile) : night ? S.limitNight : S.limitDay;
  }

  tick(ctx: SpawnCtx): SpawnRequest[] {
    const S = this.reg.combat.spawn;
    this.acc += ctx.dt;
    // Плотность по дням: реже появляются и меньше живых одновременно в первые дни.
    const mul = ctx.days === undefined ? 1 : spawnDayMul(this.reg, ctx.days);
    const every = (S.everySec * (ctx.night ? S.nightEveryMul : 1)) / mul;
    if (this.acc < every) return [];
    this.acc = 0;
    const cap = Math.min(this.limit(ctx.night, ctx.mobile), ctx.night ? S.limitNight : S.limitDay);
    const room = Math.max(2, Math.round(cap * mul)) - ctx.alive;
    if (room <= 0) return [];
    const p = this.point(ctx);
    if (!p) return [];
    const def = pickEnemy(this.reg, ctx.biomeAt(p.x, p.y), ctx.night, ctx.rng());
    if (!def) return [];
    const n = Math.min(room, groupSize(this.reg, def, ctx.rng()));
    const out: SpawnRequest[] = [];
    for (let i = 0; i < n; i++) {
      const x = p.x + (ctx.rng() - 0.5) * 2;
      const y = p.y + (ctx.rng() - 0.5) * 2;
      if (!ctx.free(x, y)) continue;
      out.push({ def, x, y, elite: ctx.rng() < (def.elite?.chance ?? 0) });
    }
    return out;
  }

  /** Точка в кольце вокруг героя (вне базы днём; ночью у края базы — тоже кольцо, но не внутри). */
  private point(ctx: SpawnCtx): { x: number; y: number } | null {
    const [r0, r1] = this.reg.combat.spawn.ringTiles;
    for (let i = 0; i < 8; i++) {
      const a = ctx.rng() * Math.PI * 2;
      const d = r0 + ctx.rng() * (r1 - r0);
      const x = ctx.hero.x + Math.cos(a) * d;
      const y = ctx.hero.y + Math.sin(a) * d;
      if (!ctx.free(x, y)) continue;
      if (ctx.inBase(x, y)) continue;
      if (ctx.biomeAt(x, y) === 0) continue;
      return { x, y };
    }
    return null;
  }

  /** Далеко от героя и не преследует — убрать. */
  shouldDespawn(x: number, y: number, hero: { x: number; y: number }, chasing: boolean): boolean {
    return !chasing && Math.hypot(x - hero.x, y - hero.y) > this.reg.combat.spawn.despawnTiles;
  }
}

/**
 * Кровавая ночь (TZ 8.4.3): каждая bloodNightEvery-я ночь, waves волн по waveSec; состав растёт с номером
 * ночи и самым дальним биомом; все идут к тотему. start/wave — для HUD; утром — ящик снабжения.
 */
export class BloodNight {
  /** Номер текущей волны (0 — не идёт). */
  wave = 0;
  private spawned = new Set<string>();
  rewardDay = 0;

  constructor(private readonly reg: Registry) {}

  /** Волн уже выпущено в эту ночь; вызывается каждый тик. Возвращает новую волну (номер) или 0. */
  tick(day: number, bloodNight: boolean, nightElapsed: number): number {
    const B = this.reg.combat.bloodNight;
    if (!bloodNight || nightElapsed < 0) {
      this.wave = 0;
      return 0;
    }
    const w = Math.min(B.waves, Math.floor(nightElapsed / B.waveSec) + 1);
    const key = `${day}:${w}`;
    if (this.spawned.has(key)) return 0;
    this.spawned.add(key);
    this.wave = w;
    this.rewardDay = day;
    return w;
  }

  /** Сколько врагов в волне. */
  count(wave: number, nightNumber: number, maxBiome: number): number {
    const B = this.reg.combat.bloodNight;
    return Math.round(
      (B.baseCount + B.perNight * nightNumber + B.perBiome * (maxBiome - 1)) * (0.7 + 0.15 * wave),
    );
  }

  /** Состав волны: заражённые биомов до maxBiome. */
  roster(wave: number, nightNumber: number, maxBiome: number, rng: () => number): EnemyDef[] {
    const n = this.count(wave, nightNumber, maxBiome);
    const out: EnemyDef[] = [];
    for (let i = 0; i < n; i++) {
      const biome = 1 + Math.floor(rng() * maxBiome);
      const d = pickEnemy(this.reg, biome, true, rng());
      if (d && d.family !== 'animal') out.push(d);
    }
    return out;
  }
}
