import type { Registry } from '../data/Registry';
import type { ItemStack } from '../world/types';

export type { ItemStack };

/** Набор ресурсов: id → количество (рецепт, стоимость постройки). */
export type ItemSet = Readonly<Record<string, number>>;

/** Максимум в стопке: предметы с прочностью не складываются. */
export function maxStack(reg: Registry, id: string): number {
  const def = reg.items.require(id);
  return def.durability !== undefined ? 1 : Math.max(1, def.stack);
}

/** Новая стопка: у предмета с прочностью — полная прочность. */
export function makeStack(reg: Registry, id: string, count: number): ItemStack {
  const def = reg.items.require(id);
  return def.durability !== undefined ? { id, count, durability: def.durability } : { id, count };
}

function sameKind(a: ItemStack, b: ItemStack): boolean {
  return (
    a.id === b.id &&
    a.durability === undefined &&
    b.durability === undefined &&
    !a.mods?.length &&
    !b.mods?.length
  );
}

/**
 * Инвентарь из слотов (игрок, сундук, контейнер). Все операции меняют только этот объект
 * и возвращают, сколько не поместилось / получилось ли.
 */
export class Inventory {
  slots: (ItemStack | null)[];

  constructor(
    private readonly reg: Registry,
    size: number,
    items: (ItemStack | null)[] = [],
  ) {
    this.slots = Array.from({ length: size }, (_, i) => (items[i] ? { ...items[i]! } : null));
  }

  get size(): number {
    return this.slots.length;
  }

  /** Изменить размер (рюкзак). Возвращает false, если лишние слоты заняты. */
  resize(size: number): boolean {
    if (size < this.slots.length && this.slots.slice(size).some((s) => s)) return false;
    if (size < this.slots.length) this.slots.length = size;
    else while (this.slots.length < size) this.slots.push(null);
    return true;
  }

  count(id: string): number {
    return this.slots.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0);
  }

  /** Сколько штук такого предмета ещё влезет. */
  room(stack: ItemStack): number {
    const max = maxStack(this.reg, stack.id);
    let room = 0;
    for (const s of this.slots) {
      if (!s) room += max;
      else if (sameKind(s, stack)) room += Math.max(0, max - s.count);
    }
    return room;
  }

  /** Добавить: сначала дополняет такие же стопки, потом — пустые слоты. Возвращает остаток (0 — всё влезло). */
  add(stack: ItemStack): number {
    const max = maxStack(this.reg, stack.id);
    let left = stack.count;
    if (stack.durability === undefined && !stack.mods?.length) {
      for (const s of this.slots) {
        if (left <= 0) break;
        if (s && sameKind(s, stack) && s.count < max) {
          const k = Math.min(left, max - s.count);
          s.count += k;
          left -= k;
        }
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (this.slots[i]) continue;
      const k = Math.min(left, max);
      this.slots[i] = { ...stack, count: k };
      left -= k;
    }
    return left;
  }

  /** Есть ли весь набор. */
  has(set: ItemSet): boolean {
    return Object.entries(set).every(([id, n]) => this.count(id) >= n);
  }

  /** Атомарно списать набор: либо всё, либо ничего. */
  consume(set: ItemSet): boolean {
    if (!this.has(set)) return false;
    for (const [id, n] of Object.entries(set)) this.remove(id, n);
    return true;
  }

  /** Забрать n штук предмета (с последних слотов). Возвращает, сколько забрано. */
  remove(id: string, n: number): number {
    let left = n;
    for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s?.id !== id) continue;
      const k = Math.min(left, s.count);
      s.count -= k;
      left -= k;
      if (s.count === 0) this.slots[i] = null;
    }
    return n - left;
  }

  /** Забрать из слота (всё или n). */
  take(slot: number, n?: number): ItemStack | null {
    const s = this.slots[slot];
    if (!s) return null;
    const k = Math.min(n ?? s.count, s.count);
    if (k === s.count) {
      this.slots[slot] = null;
      return s;
    }
    s.count -= k;
    return { ...s, count: k };
  }

  /** Разделить стопку пополам в свободный слот. */
  split(slot: number): boolean {
    const s = this.slots[slot];
    if (!s || s.count < 2) return false;
    const free = this.slots.indexOf(null);
    if (free < 0) return false;
    const half = Math.floor(s.count / 2);
    s.count -= half;
    this.slots[free] = { ...s, count: half };
    return true;
  }

  /**
   * Переложить из слота в слот (этого или другого инвентаря): в пустой — переносит,
   * в такую же стопку — дополняет, в другую — меняет местами.
   */
  move(from: number, to: Inventory, toSlot: number): void {
    if (to === this && from === toSlot) return;
    const a = this.slots[from];
    if (!a) return;
    const b = to.slots[toSlot];
    if (!b) {
      to.slots[toSlot] = a;
      this.slots[from] = null;
      return;
    }
    if (sameKind(a, b)) {
      const k = Math.min(a.count, maxStack(this.reg, a.id) - b.count);
      b.count += k;
      a.count -= k;
      if (a.count === 0) this.slots[from] = null;
      return;
    }
    to.slots[toSlot] = a;
    this.slots[from] = b;
  }

  /**
   * «Сложить похожее»: переносит в target все стопки предметов, которые там уже есть.
   * Возвращает число перенесённых штук.
   */
  transferSimilar(target: Inventory): number {
    const ids = new Set(target.slots.filter((s): s is ItemStack => !!s).map((s) => s.id));
    let moved = 0;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s || !ids.has(s.id)) continue;
      const left = target.add(s);
      moved += s.count - left;
      if (left === 0) this.slots[i] = null;
      else s.count = left;
    }
    return moved;
  }

  isEmpty(): boolean {
    return this.slots.every((s) => !s);
  }

  /** Все непустые стопки (для рюкзака погибшего). */
  takeAll(): ItemStack[] {
    const out = this.slots.filter((s): s is ItemStack => !!s);
    this.slots.fill(null);
    return out;
  }

  toJSON(): (ItemStack | null)[] {
    return this.slots.map((s) => (s ? { ...s } : null));
  }
}
