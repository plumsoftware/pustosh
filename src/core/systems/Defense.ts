import type { Registry } from '../data/Registry';
import type { DefenseDef } from '../data/schemas';
import type { EdgeRef, WorldObject } from '../world/types';
import type { World } from '../world/World';

/** Цель защиты: враг (шаг 8), манекен, герой (только для мин и взрывов). */
export interface Target {
  id: string;
  x: number;
  y: number;
  r: number;
  hp: number;
  maxHp: number;
  /** До какого момента (игровые секунды) стоит на месте — капкан, яма, электрошок. */
  rootedUntil: number;
  slowUntil: number;
  slowMul: number;
  hero?: boolean;
}

export type DefenseEvent =
  | { type: 'hit'; o: WorldObject; target: Target; damage: number }
  | { type: 'trap'; o: WorldObject; target: Target }
  | { type: 'shot'; o: WorldObject; target: Target; angle: number }
  | { type: 'explode'; o: WorldObject; x: number; y: number; radius: number; damage: number }
  | { type: 'alert'; o: WorldObject; radius: number }
  | { type: 'fire'; o: WorldObject; angle: number }
  | { type: 'zap'; o: WorldObject; target: Target };

export interface DefenseEnv {
  now: number;
  dt: number;
  /** Есть ли питание у точки (генератор с топливом рядом). */
  powered(x: number, y: number): boolean;
  /** Перезарядка контактного урона по паре защита–цель (не сохраняется). */
  contactCd: Map<string, number>;
}

/** Эффект защиты из defense.json (поля разные у разных типов). */
export interface DefenseEffect {
  contactDamage?: number;
  slowMul?: number;
  bleed?: boolean;
  rootSec?: number;
  damage?: number;
  closedSprite?: string;
  alertRadiusTiles?: number;
  explosionDamage?: number;
  radiusTiles?: number;
  stun?: boolean;
  needsPower?: boolean;
  postSprite?: string;
  blocksBullets?: boolean;
  visionBonusTiles?: number;
  lightConeTiles?: number;
  fireConeTiles?: number;
  fuel?: string;
  head?: string;
  rate?: number;
  rangeTiles?: number;
  ammo?: string;
}

export function effectOf(def: DefenseDef): DefenseEffect {
  return def.effect as DefenseEffect;
}

/** Ловушки с ручной перезарядкой: капкан, яма, растяжка, мина. */
export function isOneShot(def: DefenseDef): boolean {
  const e = effectOf(def);
  return e.rootSec !== undefined || def.id === 'tripwire' || def.id === 'landmine';
}

/** Стрелковая защита: турели и самострел. */
export function isShooter(def: DefenseDef): boolean {
  const e = effectOf(def);
  return e.rate !== undefined && e.rangeTiles !== undefined;
}

/** С защитой можно взаимодействовать: перезарядить ловушку, зарядить патроны/топливо. */
export function isDefenseInteractable(reg: Registry, o: WorldObject): boolean {
  if (o.ref.type !== 'defense') return false;
  const def = reg.defense.get(o.ref.id);
  return !!def && (isOneShot(def) || loadItemOf(def) !== null) && (o.hp ?? 1) > 0;
}

/** Начальное состояние защиты при установке. */
export function initDefense(def: DefenseDef): { hp: number; data: Record<string, number | boolean> } {
  const data: Record<string, number | boolean> = { cd: 0, angle: 90 };
  if (isOneShot(def)) data['armed'] = true;
  const e = effectOf(def);
  if (e.ammo) data['ammo'] = 0;
  if (e.fuel) data['fuel'] = 0;
  return { hp: def.hp, data };
}

/** Чем заряжается: патроны турели, топливо огненной ловушки. */
export function loadItemOf(def: DefenseDef): string | null {
  const e = effectOf(def);
  return e.ammo ?? e.fuel ?? null;
}

function dist(o: { x: number; y: number }, t: { x: number; y: number }): number {
  return Math.hypot(o.x - t.x, o.y - t.y);
}

function angleTo(o: { x: number; y: number }, t: { x: number; y: number }): number {
  return (Math.atan2(t.y - o.y, t.x - o.x) * 180) / Math.PI;
}

/** Разница углов в [-180, 180]. */
export function angleDiff(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

/**
 * Тик одной защиты (TZ 7.5): контактный урон и замедление, капкан/яма, мина и бочка, растяжка и колокол,
 * турели (поворот головы turretTurnDegPerSec, выстрел при наведении, патроны или питание), самострел,
 * огненная ловушка (топливо). Ловушки не бьют героя, кроме мин и взрывов.
 */
export function tickDefense(
  reg: Registry,
  o: WorldObject,
  targets: readonly Target[],
  env: DefenseEnv,
  events: DefenseEvent[],
): void {
  if (o.ref.type !== 'defense' || !o.data) return;
  const def = reg.defense.get(o.ref.id);
  if (!def) return;
  const D = reg.build.defense;
  const e = effectOf(def);
  const data = o.data;
  if ((o.hp ?? 1) <= 0) {
    // Взрывная бочка взрывается, когда её разбили.
    if (e.explosionDamage && !data['exploded']) {
      data['exploded'] = true;
      events.push({
        type: 'explode',
        o,
        x: o.x,
        y: o.y,
        radius: e.radiusTiles ?? 1,
        damage: e.explosionDamage,
      });
    }
    return;
  }
  const powered = !e.needsPower || env.powered(o.x, o.y);
  if (!powered) return;
  const enemies = targets.filter((t) => !t.hero && t.hp > 0);
  const touch = (t: Target) => dist(o, t) <= D.triggerRadiusTiles + t.r;

  // Мина: наступил кто угодно (в том числе герой).
  if (def.id === 'landmine') {
    if (data['armed'] && targets.some((t) => t.hp > 0 && touch(t))) {
      data['armed'] = false;
      o.hp = 0;
      data['exploded'] = true;
      events.push({
        type: 'explode',
        o,
        x: o.x,
        y: o.y,
        radius: e.radiusTiles ?? 1,
        damage: e.explosionDamage ?? 0,
      });
    }
    return;
  }
  // Капкан, яма: захлопывается на враге, урон и удержание; перезарядка — вручную.
  if (e.rootSec !== undefined) {
    if (!data['armed']) return;
    const t = enemies.find(touch);
    if (!t) return;
    data['armed'] = false;
    t.rootedUntil = env.now + e.rootSec;
    events.push({ type: 'trap', o, target: t });
    if (e.damage) events.push({ type: 'hit', o, target: t, damage: e.damage });
    return;
  }
  // Растяжка: враг задел — тревога; колокол — враг рядом, не чаще раза в 10 с.
  if (e.alertRadiusTiles !== undefined) {
    const cd = (data['cd'] as number) - env.dt;
    data['cd'] = Math.max(0, cd);
    if (def.id === 'tripwire') {
      if (data['armed'] && enemies.some(touch)) {
        data['armed'] = false;
        events.push({ type: 'alert', o, radius: e.alertRadiusTiles });
      }
    } else if (cd <= 0 && enemies.some((t) => dist(o, t) <= D.alarmTriggerRadiusTiles)) {
      data['cd'] = 10;
      events.push({ type: 'alert', o, radius: e.alertRadiusTiles });
    }
    return;
  }
  // Турели и самострел.
  if (isShooter(def)) {
    shooter(reg, o, def, e, enemies, env, events);
    return;
  }
  // Огненная ловушка: конус перед собой, тратит топливо, пока есть цель.
  if (e.fireConeTiles !== undefined) {
    const fuel = (data['fuel'] as number | undefined) ?? 0;
    if (fuel <= 0) return;
    const F = D.fireTrap;
    const facing = data['angle'] as number;
    const inCone = enemies.filter(
      (t) => dist(o, t) <= e.fireConeTiles! && Math.abs(angleDiff(facing, angleTo(o, t))) <= F.coneDeg / 2,
    );
    if (inCone.length === 0) return;
    data['fuel'] = Math.max(0, fuel - F.fuelPerSec * env.dt);
    for (const t of inCone) events.push({ type: 'hit', o, target: t, damage: F.dps * env.dt });
    events.push({ type: 'fire', o, angle: facing });
    return;
  }
  // Контактный урон: колья, шипы, колючка, ворота, пила, электрозабор.
  if (e.contactDamage !== undefined) {
    for (const t of enemies) {
      if (!touch(t)) continue;
      if (e.slowMul !== undefined) {
        t.slowMul = Math.min(t.slowMul, e.slowMul);
        t.slowUntil = env.now + 0.5;
      }
      const key = `${o.uid}:${t.id}`;
      if ((env.contactCd.get(key) ?? 0) > env.now) continue;
      env.contactCd.set(key, env.now + D.contactTickSec);
      events.push({ type: 'hit', o, target: t, damage: e.contactDamage });
      if (e.stun) {
        t.rootedUntil = Math.max(t.rootedUntil, env.now + 0.5);
        events.push({ type: 'zap', o, target: t });
      }
    }
  }
}

function shooter(
  reg: Registry,
  o: WorldObject,
  def: DefenseDef,
  e: DefenseEffect,
  enemies: Target[],
  env: DefenseEnv,
  events: DefenseEvent[],
): void {
  const D = reg.build.defense;
  const data = o.data!;
  data['cd'] = Math.max(0, (data['cd'] as number) - env.dt);
  if (e.ammo && ((data['ammo'] as number) ?? 0) <= 0) return;
  let best: Target | null = null;
  let bd = Infinity;
  for (const t of enemies) {
    const d = dist(o, t);
    if (d <= e.rangeTiles! && d < bd) {
      bd = d;
      best = t;
    }
  }
  if (!best) return;
  const want = angleTo(o, best);
  const hasHead = !!e.head;
  let angle = data['angle'] as number;
  if (hasHead) {
    const diff = angleDiff(angle, want);
    const step = D.turretTurnDegPerSec * env.dt;
    angle += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
    data['angle'] = ((angle % 360) + 360) % 360;
  } else angle = want;
  if (hasHead && Math.abs(angleDiff(angle, want)) > D.turretAimTolDeg) return;
  if ((data['cd'] as number) > 0) return;
  data['cd'] = 1 / e.rate!;
  if (e.ammo) data['ammo'] = (data['ammo'] as number) - 1;
  events.push({ type: 'shot', o, target: best, angle });
  events.push({ type: 'hit', o, target: best, damage: e.damage ?? 0 });
  void def;
}

/** Урон защите: 'destroyed' — разрушена (турель остаётся обломком, остальное убирает вызывающий). */
export function damageDefense(o: WorldObject, amount: number): 'destroyed' | 'damaged' | null {
  if (o.hp === undefined || o.hp <= 0) return null;
  o.hp = Math.max(0, o.hp - amount);
  return o.hp <= 0 ? 'destroyed' : 'damaged';
}

/**
 * Взрыв: урон всем целям (и герою) с затуханием к краю, стенам игрока и другой защите в радиусе
 * (бочки рядом детонируют цепочкой — их hp падает до 0, взрыв на следующем тике).
 */
export function explosion(
  world: World,
  x: number,
  y: number,
  radius: number,
  damage: number,
  targets: readonly Target[],
  defenses: readonly WorldObject[],
): {
  targets: { t: Target; damage: number }[];
  walls: { e: EdgeRef; result: 'destroyed' | 'damaged' }[];
} {
  const fall = (d: number) => damage * Math.max(0.25, 1 - d / Math.max(0.01, radius));
  const hitTargets: { t: Target; damage: number }[] = [];
  for (const t of targets) {
    const d = Math.hypot(t.x - x, t.y - y);
    if (d <= radius + t.r && t.hp > 0) hitTargets.push({ t, damage: fall(d) });
  }
  for (const o of defenses) {
    const d = Math.hypot(o.x - x, o.y - y);
    if (d > 0.01 && d <= radius) damageDefense(o, fall(d));
  }
  const walls: { e: EdgeRef; result: 'destroyed' | 'damaged' }[] = [];
  for (let ty = Math.floor(y - radius); ty <= Math.floor(y + radius) + 1; ty++) {
    for (let tx = Math.floor(x - radius); tx <= Math.floor(x + radius) + 1; tx++) {
      for (const side of ['n', 'w'] as const) {
        // Середина ребра: северное — (tx+0.5, ty), западное — (tx, ty+0.5).
        const d = side === 'n' ? Math.hypot(tx + 0.5 - x, ty - y) : Math.hypot(tx - x, ty + 0.5 - y);
        if (d > radius) continue;
        const e = { tx, ty, side };
        const r = world.damageEdge(e, fall(d));
        if (r) walls.push({ e, result: r });
      }
    }
  }
  return { targets: hitTargets, walls };
}

/** Манекен-мишень (отладка и проверка защиты до врагов шага 8): ходит туда-обратно по X. */
export class Dummy implements Target {
  hp: number;
  readonly maxHp: number;
  readonly r: number;
  rootedUntil = 0;
  slowUntil = 0;
  slowMul = 1;
  private dir = 1;

  constructor(
    reg: Registry,
    readonly id: string,
    public x: number,
    public y: number,
    private readonly x0 = x,
  ) {
    const d = reg.build.dummy;
    this.hp = d.hp;
    this.maxHp = d.hp;
    this.r = d.radiusTiles;
    this.patrol = d.patrolTiles;
    this.speed = d.speedTilesPerSec;
  }

  private readonly patrol: number;
  private readonly speed: number;

  tick(dt: number, now: number): void {
    if (this.hp <= 0 || now < this.rootedUntil) return;
    const mul = now < this.slowUntil ? this.slowMul : 1;
    if (now >= this.slowUntil) this.slowMul = 1;
    this.x += this.dir * this.speed * mul * dt;
    if (this.x > this.x0 + this.patrol) this.dir = -1;
    if (this.x < this.x0) this.dir = 1;
  }
}
