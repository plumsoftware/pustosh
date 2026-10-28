import type { Registry } from '../data/Registry';
import { Inventory, type ItemStack } from './Inventory';

export type EquipSlot = 'head' | 'body' | 'legs' | 'feet' | 'backpack';
export const EQUIP_SLOTS: readonly EquipSlot[] = ['head', 'body', 'legs', 'feet', 'backpack'];

export interface PlayerInventorySave {
  main: (ItemStack | null)[];
  hotbar: (ItemStack | null)[];
  equip: Partial<Record<EquipSlot, ItemStack | null>>;
  selected: number;
}

/**
 * Инвентарь игрока: основные слоты (+ слоты рюкзака), пояс, экипировка, выбранный слот пояса в руке.
 */
export class PlayerInventory {
  readonly main: Inventory;
  readonly hotbar: Inventory;
  equip: Record<EquipSlot, ItemStack | null> = {
    head: null,
    body: null,
    legs: null,
    feet: null,
    backpack: null,
  };
  selected = 0;

  constructor(
    private readonly reg: Registry,
    save?: PlayerInventorySave,
  ) {
    const p = reg.balance.player;
    this.main = new Inventory(reg, p.inventorySlots, save?.main ?? []);
    this.hotbar = new Inventory(reg, p.hotbarSlots, save?.hotbar ?? []);
    if (save) {
      for (const k of EQUIP_SLOTS) this.equip[k] = save.equip[k] ? { ...save.equip[k]! } : null;
      this.selected = save.selected;
    }
    this.main.resize(p.inventorySlots + this.extraSlots());
  }

  /** Слоты от навыка «Носильщик». */
  private bonusSlots = 0;

  setBonusSlots(n: number): void {
    this.bonusSlots = n;
    this.main.resize(this.reg.balance.player.inventorySlots + this.extraSlots());
  }

  private extraSlots(): number {
    const b = this.equip.backpack;
    return (
      (b ? ((this.reg.items.get(b.id)?.['extraSlots'] as number | undefined) ?? 0) : 0) + this.bonusSlots
    );
  }

  /** Предмет в руке — выбранный слот пояса. */
  get held(): ItemStack | null {
    return this.hotbar.slots[this.selected] ?? null;
  }

  /** Подобрать: сначала в пояс к таким же, потом в основные слоты. Остаток — не поместилось. */
  add(stack: ItemStack): number {
    let left = stack.count;
    // Дополнить стопки на поясе, не занимая новые слоты пояса.
    for (const s of this.hotbar.slots) {
      if (left <= 0) break;
      if (s && s.id === stack.id && s.durability === undefined && stack.durability === undefined) {
        const max = Math.max(1, this.reg.items.require(s.id).stack);
        const k = Math.min(left, max - s.count);
        if (k > 0) {
          s.count += k;
          left -= k;
        }
      }
    }
    if (left > 0) left = this.main.add({ ...stack, count: left });
    if (left > 0) left = this.hotbar.add({ ...stack, count: left });
    return left;
  }

  room(stack: ItemStack): number {
    return this.main.room(stack) + this.hotbar.room(stack);
  }

  count(id: string): number {
    return this.main.count(id) + this.hotbar.count(id);
  }

  has(set: Readonly<Record<string, number>>): boolean {
    return Object.entries(set).every(([id, n]) => this.count(id) >= n);
  }

  /** Атомарно списать набор из основных слотов и пояса. */
  consume(set: Readonly<Record<string, number>>): boolean {
    if (!this.has(set)) return false;
    for (const [id, n] of Object.entries(set)) {
      const k = this.main.remove(id, n);
      if (k < n) this.hotbar.remove(id, n - k);
    }
    return true;
  }

  /** Слот экипировки для предмета (одежда, рюкзаки) или null. */
  slotFor(id: string): EquipSlot | null {
    const s = this.reg.items.get(id)?.['slot'];
    return typeof s === 'string' && (EQUIP_SLOTS as readonly string[]).includes(s) ? (s as EquipSlot) : null;
  }

  /**
   * Надеть из инвентаря (inv, slot). Снятая вещь встаёт на её место.
   * Рюкзак меняет число слотов; меньший рюкзак нельзя надеть, если лишние слоты заняты.
   */
  equipFrom(inv: Inventory, slot: number): boolean {
    const s = inv.slots[slot];
    if (!s) return false;
    const es = this.slotFor(s.id);
    if (!es) return false;
    const prev = this.equip[es];
    if (es === 'backpack') {
      const base = this.reg.balance.player.inventorySlots;
      const extra = (this.reg.items.get(s.id)?.['extraSlots'] as number | undefined) ?? 0;
      inv.slots[slot] = null;
      if (!this.main.resize(base + extra)) {
        inv.slots[slot] = s;
        return false;
      }
      this.equip.backpack = s;
      if (prev) inv.slots[slot] = prev;
      return true;
    }
    this.equip[es] = s;
    inv.slots[slot] = prev;
    return true;
  }

  /** Снять в инвентарь. */
  unequip(es: EquipSlot): boolean {
    const s = this.equip[es];
    if (!s) return false;
    if (es === 'backpack') {
      const base = this.reg.balance.player.inventorySlots;
      if (this.main.slots.slice(base).some((x) => x)) return false;
      this.equip.backpack = null;
      this.main.resize(base);
      if (this.main.add(s) > 0) {
        this.equip.backpack = s;
        this.main.resize(base + this.extraSlots());
        return false;
      }
      return true;
    }
    if (this.main.add(s) > 0) return false;
    this.equip[es] = null;
    return true;
  }

  /** Суммарная защита одежды (coldRes, heatRes, radRes, armor). */
  stat(key: 'coldRes' | 'heatRes' | 'radRes' | 'armor' | 'poisonRes'): number {
    let n = 0;
    for (const k of EQUIP_SLOTS) {
      const s = this.equip[k];
      if (!s || s.durability === 0) continue;
      const v = this.reg.items.get(s.id)?.[key];
      if (typeof v === 'number') n += v;
      // Моды одежды: бронепластина (armorAdd), утеплитель (coldResAdd).
      for (const m of s.mods ?? []) {
        const e = this.reg.items.get(m)?.['effect'] as Record<string, number> | undefined;
        const add = e?.[`${key}Add`];
        if (typeof add === 'number') n += add;
      }
    }
    return n;
  }

  /** Всё, кроме экипировки — в рюкзак погибшего (GDD §4). */
  takeAllForDeath(): ItemStack[] {
    return [...this.main.takeAll(), ...this.hotbar.takeAll()];
  }

  toJSON(): PlayerInventorySave {
    return {
      main: this.main.toJSON(),
      hotbar: this.hotbar.toJSON(),
      equip: structuredClone(this.equip),
      selected: this.selected,
    };
  }
}
