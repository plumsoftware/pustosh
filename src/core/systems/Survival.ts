import type { SurvivalDef } from '../data/schemas';

export interface Conditions {
  /** Кровотечение — до лечения бинтом. */
  bleeding: boolean;
  /** Отравление — секунд осталось (0 — нет). */
  poison: number;
  /** Инфекция — до антибиотиков. */
  infection: boolean;
  /** Перелом — до шины. */
  fracture: boolean;
}

export interface Vitals {
  hp: number;
  hunger: number;
  thirst: number;
  temperature: number;
  radiation: number;
  conditions: Conditions;
}

/** Окружение героя в этом тике. */
export interface SurvivalEnv {
  biome: number;
  /** Ночь (для температуры) — по фазе суток. */
  night: boolean;
  /** День в пустыне — жажда быстрее. */
  day: boolean;
  /** Рядом горящий костёр (в радиусе campfireRadiusTiles). */
  nearFire: boolean;
  coldRes: number;
  heatRes: number;
  radRes: number;
}

/** Скорости площадки из balance.json → survival.<площадка>. */
export interface SurvivalRates {
  hungerPerMin: number;
  thirstPerMin: number;
  coldDmgPerSec: number;
}

export function createVitals(maxHp: number, def: SurvivalDef): Vitals {
  return {
    hp: maxHp,
    hunger: def.needs.max,
    thirst: def.needs.max,
    temperature: 0,
    radiation: 0,
    conditions: { bleeding: false, poison: 0, infection: false, fracture: false },
  };
}

/** Максимум HP с учётом радиации (GDD §4). */
export function maxHp(baseHp: number, v: Vitals): number {
  return Math.max(1, baseHp - v.radiation);
}

/** Температура, к которой тянется тело: биом и время суток, одежда, костёр (греет до верха комфорта). */
export function targetTemperature(def: SurvivalDef, env: SurvivalEnv): number {
  const b = def.temperature.biomes[String(env.biome)];
  let t = b ? (env.night ? b.night : b.day) : 0;
  if (t < 0) t = Math.min(0, t + env.coldRes);
  else if (t > 0) t = Math.max(0, t - env.heatRes);
  // Костёр греет, но не перегревает: не выше верхней границы комфорта (и не остужает в жару).
  const hi = def.temperature.comfort[1];
  if (env.nearFire && t < hi) t = Math.min(hi, t + def.temperature.campfireBonus);
  return t;
}

export function outOfComfort(def: SurvivalDef, v: Vitals): boolean {
  const [lo, hi] = def.temperature.comfort;
  return v.temperature < lo || v.temperature > hi;
}

/** Множитель скорости от состояния тела (холод/жара, перелом). */
export function survivalSpeedMul(def: SurvivalDef, v: Vitals): number {
  let k = 1;
  if (outOfComfort(def, v)) k *= def.temperature.outOfRangeSpeedMul;
  if (v.conditions.fracture) k *= def.conditions.fracture.speedMul;
  return k;
}

/**
 * Тик выживания: голод и жажда падают со скоростью площадки (жажда ×1.5 в пустыне днём),
 * на нуле — урон; температура плавно тянется к целевой, вне комфорта — урон холода;
 * радиация растёт в зонах и снижает максимум HP; состояния наносят урон.
 * Возвращает true, если герой погиб.
 */
export function stepSurvival(
  v: Vitals,
  def: SurvivalDef,
  rates: SurvivalRates,
  baseHp: number,
  env: SurvivalEnv,
  dt: number,
): boolean {
  if (v.hp <= 0) return true;
  const n = def.needs;
  const thirstMul = env.biome === n.desertBiome && env.day ? n.desertDayThirstMul : 1;
  v.hunger = Math.max(0, v.hunger - (rates.hungerPerMin / 60) * dt);
  v.thirst = Math.max(0, v.thirst - (rates.thirstPerMin / 60) * thirstMul * dt);

  let dmg = 0;
  if (v.hunger <= 0) dmg += n.zeroHpLossPerSec;
  if (v.thirst <= 0) dmg += n.zeroHpLossPerSec;

  const target = targetTemperature(def, env);
  const step = def.temperature.approachPerSec * dt;
  v.temperature += Math.max(-step, Math.min(step, target - v.temperature));
  if (outOfComfort(def, v)) dmg += rates.coldDmgPerSec;

  const radPerSec = def.radiation.zonePerSecByBiome[String(env.biome)] ?? 0;
  if (radPerSec > 0)
    v.radiation = Math.min(def.radiation.max, v.radiation + radPerSec * Math.max(0, 1 - env.radRes) * dt);

  const c = v.conditions;
  if (c.bleeding) dmg += def.conditions.bleeding.hpPerSec;
  if (c.poison > 0) {
    dmg += def.conditions.poison.hpPerSec;
    c.poison = Math.max(0, c.poison - dt);
  }

  v.hp = Math.min(maxHp(baseHp, v), v.hp - dmg * dt);
  if (v.hp <= 0) {
    v.hp = 0;
    return true;
  }
  return false;
}

/** Урон извне (враги, ловушки — шаг 8). */
export function applyDamage(v: Vitals, amount: number): boolean {
  v.hp = Math.max(0, v.hp - amount);
  return v.hp <= 0;
}
