import type { Registry } from '../data/Registry';
import type { Rng } from '../util/rng';
import type { MoveState } from './Movement';
import { maxHp, type Vitals } from './Survival';

export type UseResult = 'used' | 'not_usable';

/**
 * Съесть, выпить, применить лекарство (items.json): голод, жажда, здоровье, выносливость,
 * лечение состояний, радиация. Сырое мясо/грязная вода могут отравить (poisonChance).
 * Длительные эффекты (обезболивающее, стимулятор, кофе) — с бафами на шаге 8–9.
 */
export function useItem(
  reg: Registry,
  id: string,
  v: Vitals,
  move: MoveState,
  rng: Rng,
  /** Множитель лечения (навык «Лекарь»). */
  healMul = 1,
): UseResult {
  const it = reg.items.get(id);
  if (!it || (it.category !== 'food' && it.category !== 'medicine')) return 'not_usable';
  const s = reg.survival;
  const num = (k: string) => (typeof it[k] === 'number' ? (it[k] as number) : 0);
  const eff = (it['effect'] ?? {}) as Record<string, unknown>;
  const e = (k: string) => (typeof eff[k] === 'number' ? (eff[k] as number) : 0);
  const base = reg.balance.player.hp;
  v.hunger = clamp(v.hunger + num('hunger'), 0, s.needs.max);
  v.thirst = clamp(v.thirst + num('thirst'), 0, s.needs.max);
  v.radiation = clamp(v.radiation + e('radiation'), 0, s.radiation.max);
  v.hp = clamp(v.hp + (num('health') + e('health')) * healMul, 0, maxHp(base, v));
  move.stamina = clamp(
    move.stamina + num('staminaRestore') + e('staminaRestore'),
    0,
    reg.balance.player.stamina,
  );
  if (eff['stopsBleeding']) v.conditions.bleeding = false;
  if (eff['curesFracture']) v.conditions.fracture = false;
  if (eff['curesPoison']) v.conditions.poison = 0;
  if (eff['curesInfection']) v.conditions.infection = false;
  const pc = num('poisonChance');
  if (pc > 0 && rng.next() < pc) v.conditions.poison = s.conditions.poison.durationSec;
  return 'used';
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Что съесть/применить кнопкой «Аптечка»: при кровотечении — то, что его останавливает; сначала
 * лекарства, потом еда; из них — самое слабое, которого хватает до полного здоровья, иначе самое сильное.
 * have — сколько каждого предмета у героя; null — лечить нечем или не нужно.
 */
export function pickHealItem(
  reg: Registry,
  have: (id: string) => number,
  v: Vitals,
  healMul = 1,
): string | null {
  const missing = maxHp(reg.balance.player.hp, v) - v.hp;
  const heal = (id: string) => {
    const it = reg.items.get(id)!;
    const eff = (it['effect'] ?? {}) as Record<string, unknown>;
    return (
      ((typeof it['health'] === 'number' ? it['health'] : 0) +
        (typeof eff['health'] === 'number' ? eff['health'] : 0)) *
      healMul
    );
  };
  const stops = (id: string) =>
    !!((reg.items.get(id)!['effect'] ?? {}) as Record<string, unknown>)['stopsBleeding'];
  if (missing <= 0.5 && !v.conditions.bleeding) return null;
  const owned = reg.items.all
    .filter(
      (it) => (it.category === 'medicine' || it.category === 'food') && have(it.id) > 0 && heal(it.id) > 0,
    )
    .map((it) => it.id);
  const pool = v.conditions.bleeding && owned.some(stops) ? owned.filter(stops) : owned;
  for (const cat of ['medicine', 'food']) {
    const list = pool.filter((id) => reg.items.get(id)!.category === cat).sort((a, b) => heal(a) - heal(b));
    if (!list.length) continue;
    return list.find((id) => heal(id) >= missing) ?? list[list.length - 1]!;
  }
  return null;
}
