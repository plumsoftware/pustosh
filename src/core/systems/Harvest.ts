import type { Registry } from '../data/Registry';
import type { HarvestDef } from '../data/schemas';
import type { ItemStack } from '../inventory/Inventory';
import { makeStack } from '../inventory/Inventory';
import type { Rng } from '../util/rng';
import type { World } from '../world/World';
import type { WorldObject } from '../world/types';

/** Что добывается с объекта: объект биома или мебель на разбор. */
export function harvestDefOf(reg: Registry, o: WorldObject): HarvestDef | null {
  if (o.ref.type === 'biome') return reg.objects.get(o.ref.biome, o.ref.id)?.harvest ?? null;
  if (o.ref.type === 'furniture') return reg.objects.furniture.get(o.ref.id)?.harvest ?? null;
  return null;
}

/** Объект, с которым можно что-то сделать: добыть (intact + harvest) или открыть (контейнер). */
export type Interactable =
  { obj: WorldObject; kind: 'harvest'; def: HarvestDef } | { obj: WorldObject; kind: 'container' };

/**
 * Ближайший объект перед героем: в радиусе и секторе (TZ 5.2.1), по расстоянию до точки основания.
 * containerInfo — функция, которая говорит, что объект — контейнер (её даёт Loot).
 */
export function findInteractable(
  world: World,
  reg: Registry,
  x: number,
  y: number,
  faceX: number,
  faceY: number,
  isContainer: (o: WorldObject) => boolean,
): Interactable | null {
  const h = reg.harvest;
  const R = Math.max(h.targetRadiusTiles, h.interactRadiusTiles);
  const cos = Math.cos(((h.targetSectorDeg / 2) * Math.PI) / 180);
  const fl = Math.hypot(faceX, faceY) || 1;
  let best: Interactable | null = null;
  let bestD = Infinity;
  const seen = new Set<WorldObject>();
  for (let ty = Math.floor(y - R - 1); ty <= Math.floor(y + R + 1); ty++) {
    for (let tx = Math.floor(x - R - 1); tx <= Math.floor(x + R + 1); tx++) {
      for (const o of world.objectsAt(tx, ty)) {
        if (seen.has(o)) continue;
        seen.add(o);
        // Расстояние до ближайшей точки коллайдера (большие объекты) или основания.
        const px = o.collider?.shape === 'rect' ? Math.max(o.collider.x0, Math.min(x, o.collider.x1)) : o.x;
        const py = o.collider?.shape === 'rect' ? Math.max(o.collider.y0, Math.min(y, o.collider.y1)) : o.y;
        const dx = px - x;
        const dy = py - y;
        const d = Math.hypot(dx, dy);
        // Контейнер можно открыть и после обыска (забрать остатки); он важнее добычи.
        const container = isContainer(o);
        const def = o.state === 'intact' ? harvestDefOf(reg, o) : null;
        if (!container && !def) continue;
        const limit = container ? h.interactRadiusTiles : h.targetRadiusTiles;
        if (d > limit) continue;
        // Вплотную — сектор не важен (объект под ногами).
        if (d > 0.3 && (dx * faceX + dy * faceY) / (d * fl) < cos) continue;
        if (d < bestD) {
          bestD = d;
          best = container ? { obj: o, kind: 'container' } : { obj: o, kind: 'harvest', def: def! };
        }
      }
    }
  }
  return best;
}

export interface HitResult {
  /** Прибавка к прогрессу (удары до hits). */
  progress: number;
  /** Износ инструмента. */
  wear: number;
  stamina: number;
  /** Подходящий инструмент и тир. */
  proper: boolean;
  /** Чего не хватает (для подсказки «Нужен <инструмент> тир N»). */
  need?: { tool: string; tier: number };
}

/**
 * Удар по объекту (TZ 5.2.2): подходящий инструмент нужного тира — прогресс ×gatherMultiplier;
 * иначе ×wrongToolProgressMul и двойной износ. Руки работают для minTier 0. Сломанный — ×brokenEfficiency.
 */
export function hitObject(reg: Registry, def: HarvestDef, tool: ItemStack | null): HitResult {
  const h = reg.harvest;
  const item = tool ? reg.items.get(tool.id) : undefined;
  const broken = tool?.durability === 0 ? h.brokenEfficiency : 1;
  const stamina = (item?.['staminaPerUse'] as number | undefined) ?? h.handsStaminaPerUse;
  const isTool = !!item?.toolType;
  if (def.tool === 'hands' && def.minTier === 0) {
    const mul = isTool ? ((item!['gatherMultiplier'] as number | undefined) ?? 1) : 1;
    return { progress: mul * broken, wear: isTool ? h.wearPerHit : 0, stamina, proper: true };
  }
  const proper = !!item && item.toolType === def.tool && (item.harvestTier ?? 0) >= def.minTier;
  if (proper) {
    const mul = (item['gatherMultiplier'] as number | undefined) ?? 1;
    return { progress: mul * broken, wear: h.wearPerHit, stamina, proper: true };
  }
  return {
    progress: h.wrongToolProgressMul * broken,
    wear: isTool ? h.wearPerHit * h.wrongToolWearMul : 0,
    stamina,
    proper: false,
    need: { tool: def.tool, tier: def.minTier },
  };
}

/** Дроп объекта: диапазоны min..max; добыто не тем инструментом — минимум (GDD §6). */
export function rollDrops(reg: Registry, def: HarvestDef, rng: Rng, minimum: boolean): ItemStack[] {
  const out: ItemStack[] = [];
  for (const [id, [lo, hi]] of Object.entries(def.drops)) {
    const n = minimum ? lo : rng.int(lo, hi);
    if (n > 0) out.push(makeStack(reg, id, n));
  }
  return out;
}

/** Через сколько игровых секунд объект восстановится (кусты — bushRegrowGameDays, остальное — resourceRespawnGameDays). */
export function respawnSec(reg: Registry, o: WorldObject, rng: Rng): number {
  const day = reg.balance.dayNight.fullDaySec;
  if (reg.harvest.regrowKinds.includes(o.kind)) return reg.harvest.bushRegrowGameDays * day;
  const r = reg.balance.world['resourceRespawnGameDays'] as [number, number];
  return (r[0] + rng.next() * (r[1] - r[0])) * day;
}
