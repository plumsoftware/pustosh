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
export function useItem(reg: Registry, id: string, v: Vitals, move: MoveState, rng: Rng): UseResult {
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
  v.hp = clamp(v.hp + num('health') + e('health'), 0, maxHp(base, v));
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
