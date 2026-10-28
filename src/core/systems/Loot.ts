import type { Registry } from '../data/Registry';
import { makeStack, type ItemStack } from '../inventory/Inventory';
import type { Rng } from '../util/rng';
import type { WorldObject } from '../world/types';

export interface ContainerInfo {
  /** loot — наполняется по таблице и обновляется; storage — сундук игрока. */
  type: 'loot' | 'storage';
  slots: number;
  table?: string;
  /** Записка/чертёж — синяя подсветка. */
  note?: boolean;
}

/** Контейнер ли объект и какой (ящики, мебель лута, объекты лута биомов, сундуки). */
export function containerInfo(reg: Registry, o: WorldObject): ContainerInfo | null {
  if (o.ref.type === 'container') {
    const c = reg.objects.containers.get(o.ref.id);
    return c ? { type: 'loot', slots: c.slots, table: c.table } : null;
  }
  if (o.ref.type === 'biome' && o.kind === 'loot') {
    const l = reg.loot.objects[o.ref.id];
    return l
      ? { type: 'loot', slots: l.slots, table: l.table, note: reg.harvest.noteObjects.includes(o.ref.id) }
      : null;
  }
  if (o.ref.type === 'station') {
    const slots = reg.harvest.storageSlots[o.ref.id];
    return slots ? { type: 'storage', slots } : null;
  }
  return null;
}

/**
 * Лут контейнера (TZ 5.3): rolls[table] разных позиций по весам, только предметы с тиром ≤ биом + maxTierOverBiome,
 * количество — из диапазона; не больше слотов контейнера.
 */
export function rollLoot(reg: Registry, table: string, biome: number, slots: number, rng: Rng): ItemStack[] {
  const L = reg.loot;
  const maxTier = Math.max(1, biome) + L.maxTierOverBiome;
  let pool = (L.tables[table] ?? []).filter((e) => (reg.items.get(e.item)?.tier ?? 99) <= maxTier);
  const [lo, hi] = L.rolls[table] ?? [1, 2];
  const n = Math.min(slots, rng.int(lo, hi), pool.length);
  const out: ItemStack[] = [];
  for (let i = 0; i < n; i++) {
    const total = pool.reduce((s, e) => s + e.w, 0);
    let r = rng.next() * total;
    const pick = pool.find((e) => (r -= e.w) < 0) ?? pool[pool.length - 1]!;
    pool = pool.filter((e) => e !== pick);
    out.push(makeStack(reg, pick.item, rng.int(pick.count[0], pick.count[1])));
  }
  return out;
}
