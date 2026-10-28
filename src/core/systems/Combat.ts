import type { Registry } from '../data/Registry';
import type { ItemStack } from '../world/types';

/** Вид оружия (items.json → weaponKind) + кулаки. */
export type WeaponKind =
  | 'fist'
  | 'melee_blunt'
  | 'melee_slash'
  | 'melee_pierce'
  | 'ranged'
  | 'firearm'
  | 'throwable'
  | 'flame'
  | 'energy';

/** Характеристики оружия в руке с учётом модов, поломки и навыков. */
export interface WeaponStats {
  id: string | null;
  kind: WeaponKind;
  damage: number;
  rate: number;
  range: number;
  ammo: string | null;
  /** Специальные эффекты: bleed, stun, knockback, shock_breaks_shield, ignore_armor, pellets_N, fire_area… */
  specials: string[];
  pellets: number;
  spreadDeg: number;
  noiseMul: number;
  magazine: number;
  stamina: number;
  /** Свет фонаря на оружии (мод), клеток. */
  light: number;
  broken: boolean;
}

export const isMelee = (k: WeaponKind) => k === 'fist' || k.startsWith('melee');
export const isGun = (k: WeaponKind) => k === 'firearm' || k === 'energy';

/** Эффекты модов (items.json → effect) на оружии. */
interface ModEffect {
  rangeMul?: number;
  spreadMul?: number;
  noiseMul?: number;
  magazineMul?: number;
  lightRadiusTiles?: number;
  addSpecial?: string;
}

/** Подходит ли мод к предмету (modTarget: firearm / melee / clothing) и есть ли свободный слот. */
export function canAttachMod(reg: Registry, mod: string, target: ItemStack): boolean {
  const m = reg.items.get(mod);
  const t = reg.items.get(target.id);
  if (!m || m.category !== 'mod' || !t) return false;
  const slots = (t['modSlots'] as number | undefined) ?? 0;
  if ((target.mods?.length ?? 0) >= slots) return false;
  const want = m['modTarget'] as string | undefined;
  const kind = t['weaponKind'] as string | undefined;
  if (want === 'clothing') return t.category === 'clothing';
  if (want === 'melee') return !!kind && kind.startsWith('melee');
  if (want === 'firearm') return kind === 'firearm';
  return false;
}

export function weaponStats(
  reg: Registry,
  stack: ItemStack | null,
  skills: Readonly<Record<string, number>> = {},
): WeaponStats {
  const H = reg.combat.hero;
  const def = stack ? reg.items.get(stack.id) : undefined;
  const kind = (def?.category === 'weapon' ? (def['weaponKind'] as WeaponKind) : undefined) ?? 'fist';
  if (kind === 'fist' || !def || !stack) {
    return {
      id: null,
      kind: 'fist',
      damage: H.fistDamage,
      rate: H.fistRate,
      range: H.fistRange,
      ammo: null,
      specials: [],
      pellets: 1,
      spreadDeg: 0,
      noiseMul: 0,
      magazine: 0,
      stamina: H.staminaPerSwing,
      light: 0,
      broken: false,
    };
  }
  const specials: string[] = [];
  const sp = def['special'] as string | null | undefined;
  if (sp) specials.push(sp);
  let range = (def['rangeTiles'] as number) ?? 1;
  let spreadMul = 1;
  let noiseMul = 1;
  let magMul = 1;
  let light = 0;
  for (const m of stack.mods ?? []) {
    const e = (reg.items.get(m)?.['effect'] ?? {}) as ModEffect;
    if (e.rangeMul) range *= e.rangeMul;
    if (e.spreadMul) spreadMul *= e.spreadMul;
    if (e.noiseMul) noiseMul *= e.noiseMul;
    if (e.magazineMul) magMul *= e.magazineMul;
    if (e.lightRadiusTiles) light = Math.max(light, e.lightRadiusTiles);
    if (e.addSpecial && !specials.includes(e.addSpecial)) specials.push(e.addSpecial);
  }
  const pel = specials.map((s) => /^pellets_(\d+)$/.exec(s)).find((m) => m);
  const pellets = pel ? Number(pel[1]) : 1;
  const broken = stack.durability === 0;
  // Навыки бойца: +10% ближнего / огнестрела за уровень (skills.json).
  const melee = kind.startsWith('melee');
  const skillMul = 1 + 0.1 * (skills[melee ? 'fighter_1' : 'fighter_2'] ?? 0);
  const damage = (def['damage'] as number) * skillMul * (broken ? H.brokenMul : 1);
  const spreadBase =
    kind === 'energy'
      ? H.spreadDeg['energy']!
      : pellets > 1
        ? H.spreadDeg['pellets']!
        : H.spreadDeg['firearm']!;
  return {
    id: stack.id,
    kind,
    damage,
    rate: (def['attacksPerSec'] as number) ?? 1,
    range,
    ammo: (def['ammo'] as string | null | undefined) ?? null,
    specials,
    pellets,
    spreadDeg: isGun(kind) || kind === 'ranged' ? spreadBase * spreadMul : 0,
    noiseMul: kind === 'firearm' ? noiseMul : kind === 'energy' ? 0.5 * noiseMul : 0,
    magazine: Math.max(1, Math.round((reg.combat.magazine[stack.id] ?? 1) * magMul)),
    stamina: melee
      ? (def['damage'] as number) >= H.heavyDamageFrom
        ? H.staminaHeavy
        : H.staminaPerSwing
      : 0,
    light,
    broken,
  };
}

/** Броня снижает физический урон: dmg × 100 / (100 + armor). */
export function armorReduce(dmg: number, armor: number): number {
  return (dmg * 100) / (100 + Math.max(0, armor));
}

/** Угол (градусы) от a к b. */
export function angleOf(ax: number, ay: number, bx: number, by: number): number {
  return (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
}

export function angleDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

export interface Hittable {
  id: string;
  x: number;
  y: number;
  r: number;
  hp: number;
}

/** Цели в секторе sectorDeg и радиусе range (до края цели). */
export function inSector<T extends Hittable>(
  x: number,
  y: number,
  faceDeg: number,
  range: number,
  sectorDeg: number,
  targets: readonly T[],
): T[] {
  return targets.filter((t) => {
    if (t.hp <= 0) return false;
    const d = Math.hypot(t.x - x, t.y - y);
    if (d > range + t.r) return false;
    if (d < t.r + 0.2) return true;
    return Math.abs(angleDelta(faceDeg, angleOf(x, y, t.x, t.y))) <= sectorDeg / 2;
  });
}

/** Автонаведение: ближайшая цель в секторе перед героем (или null). */
export function autoAim<T extends Hittable>(
  x: number,
  y: number,
  faceDeg: number,
  range: number,
  sectorDeg: number,
  targets: readonly T[],
): T | null {
  let best: T | null = null;
  let bd = Infinity;
  for (const t of inSector(x, y, faceDeg, range, sectorDeg, targets)) {
    const d = Math.hypot(t.x - x, t.y - y);
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}

/**
 * Луч выстрела: цели вдоль луча по расстоянию (первая — для обычных пуль, все — pierce_all).
 * blocked(x, y) — стена/твёрдое на пути: луч обрывается.
 */
export function rayTargets<T extends Hittable>(
  x: number,
  y: number,
  angleDeg: number,
  range: number,
  targets: readonly T[],
  blocked: (x: number, y: number) => boolean,
): { hits: T[]; endX: number; endY: number } {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  let len = range;
  for (let s = 0.25; s <= range; s += 0.25) {
    if (blocked(x + dx * s, y + dy * s)) {
      len = s;
      break;
    }
  }
  const hits: { t: T; d: number }[] = [];
  for (const t of targets) {
    if (t.hp <= 0) continue;
    const px = t.x - x;
    const py = t.y - y;
    const along = px * dx + py * dy;
    if (along < 0 || along > len) continue;
    const perp = Math.abs(px * dy - py * dx);
    if (perp <= t.r + 0.1) hits.push({ t, d: along });
  }
  hits.sort((p, q) => p.d - q.d);
  return { hits: hits.map((h) => h.t), endX: x + dx * len, endY: y + dy * len };
}

/** Удар в спину: цель смотрит в сторону от атакующего (угол > 100°). */
export function isBackstab(targetFaceDeg: number, tx: number, ty: number, ax: number, ay: number): boolean {
  return Math.abs(angleDelta(targetFaceDeg, angleOf(tx, ty, ax, ay))) > 100;
}

/** Шум выстрела: радиус в клетках с учётом глушителя. */
export function noiseRadius(reg: Registry, w: WeaponStats): number {
  return reg.combat.hero.noiseRadiusTiles * w.noiseMul;
}
