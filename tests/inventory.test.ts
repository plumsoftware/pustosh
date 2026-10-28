import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/core/data';
import { Inventory, makeStack, PlayerInventory } from '../src/core/inventory';
import { readAssetCatalog, readRawData } from '../tools/readGameFiles';

const reg = loadGameData(readRawData(), readAssetCatalog()).registry!;
const stackOf = (id: string) => reg.items.require(id).stack;

describe('Инвентарь', () => {
  it('автостак: дополняет стопки, потом занимает пустые слоты, остаток не влезает', () => {
    const inv = new Inventory(reg, 3);
    const max = stackOf('wood');
    expect(inv.add({ id: 'wood', count: 10 })).toBe(0);
    expect(inv.add({ id: 'wood', count: max })).toBe(0);
    expect(inv.slots[0]!.count).toBe(max);
    expect(inv.slots[1]!.count).toBe(10);
    expect(inv.add({ id: 'stone', count: 5 })).toBe(0);
    // Места больше нет: wood дополнит вторую стопку до max, остальное — остаток.
    const left = inv.add({ id: 'wood', count: max });
    expect(left).toBe(10);
    expect(inv.count('wood')).toBe(max * 2);
  });

  it('инструменты не складываются и получают полную прочность', () => {
    const inv = new Inventory(reg, 3);
    inv.add(makeStack(reg, 'axe_stone', 1));
    inv.add(makeStack(reg, 'axe_stone', 1));
    expect(inv.slots[0]).toEqual({
      id: 'axe_stone',
      count: 1,
      durability: reg.items.require('axe_stone').durability,
    });
    expect(inv.slots[1]?.id).toBe('axe_stone');
  });

  it('атомарное списание набора: всё или ничего', () => {
    const inv = new Inventory(reg, 5);
    inv.add({ id: 'sticks', count: 3 });
    inv.add({ id: 'stone', count: 2 });
    expect(inv.consume({ sticks: 3, stone: 3 })).toBe(false);
    expect(inv.count('sticks')).toBe(3);
    expect(inv.count('stone')).toBe(2);
    expect(inv.consume({ sticks: 2, stone: 2 })).toBe(true);
    expect(inv.count('sticks')).toBe(1);
    expect(inv.count('stone')).toBe(0);
    expect(inv.slots.filter(Boolean)).toHaveLength(1);
  });

  it('разделение стопки и перенос между инвентарями', () => {
    const a = new Inventory(reg, 3);
    const b = new Inventory(reg, 3);
    a.add({ id: 'rags', count: 9 });
    expect(a.split(0)).toBe(true);
    expect(a.slots[0]!.count + a.slots[1]!.count).toBe(9);
    expect(a.slots[1]!.count).toBe(4);
    a.move(1, b, 2);
    expect(b.slots[2]).toEqual({ id: 'rags', count: 4 });
    expect(a.slots[1]).toBeNull();
    // Перенос на такую же стопку — сливает, на другую — меняет местами.
    b.add({ id: 'stone', count: 1 });
    a.move(0, b, 2);
    expect(b.slots[2]!.count).toBe(9);
    expect(a.slots[0]).toBeNull();
    b.move(2, b, 0);
    expect(b.slots[0]!.id).toBe('rags');
    expect(b.slots[2]!.id).toBe('stone');
  });

  it('«сложить похожее» переносит только то, что уже есть в сундуке', () => {
    const player = new Inventory(reg, 5);
    const chest = new Inventory(reg, 5);
    player.add({ id: 'wood', count: 20 });
    player.add({ id: 'stone', count: 7 });
    player.add({ id: 'berries', count: 3 });
    chest.add({ id: 'wood', count: 1 });
    chest.add({ id: 'stone', count: 1 });
    expect(player.transferSimilar(chest)).toBe(27);
    expect(chest.count('wood')).toBe(21);
    expect(chest.count('stone')).toBe(8);
    expect(player.count('berries')).toBe(3);
    expect(player.count('wood')).toBe(0);
  });
});

describe('Инвентарь игрока', () => {
  it('20 слотов, пояс 6; рюкзак добавляет extraSlots; меньший рюкзак не снять при занятых слотах', () => {
    const pi = new PlayerInventory(reg);
    expect(pi.main.size).toBe(reg.balance.player.inventorySlots);
    expect(pi.hotbar.size).toBe(reg.balance.player.hotbarSlots);
    pi.main.add(makeStack(reg, 'backpack_hiking', 1));
    const slot = pi.main.slots.findIndex((s) => s?.id === 'backpack_hiking');
    expect(pi.equipFrom(pi.main, slot)).toBe(true);
    expect(pi.main.size).toBe(reg.balance.player.inventorySlots + 20);
    pi.main.slots[pi.main.size - 1] = { id: 'stone', count: 1 };
    expect(pi.unequip('backpack')).toBe(false);
    pi.main.slots[pi.main.size - 1] = null;
    expect(pi.unequip('backpack')).toBe(true);
    expect(pi.main.size).toBe(reg.balance.player.inventorySlots);
  });

  it('одежда: защита от холода суммируется, сломанная не греет', () => {
    const pi = new PlayerInventory(reg);
    pi.main.add(makeStack(reg, 'jacket_winter', 1));
    pi.equipFrom(pi.main, 0);
    const res = reg.items.require('jacket_winter')['coldRes'] as number;
    expect(pi.stat('coldRes')).toBe(res);
    pi.equip.body!.durability = 0;
    expect(pi.stat('coldRes')).toBe(0);
  });

  it('предмет в руке — выбранный слот пояса; при смерти всё, кроме экипировки, уходит в рюкзак', () => {
    const pi = new PlayerInventory(reg);
    pi.hotbar.slots[2] = makeStack(reg, 'axe_stone', 1);
    pi.selected = 2;
    expect(pi.held?.id).toBe('axe_stone');
    pi.add({ id: 'wood', count: 5 });
    pi.main.add(makeStack(reg, 'helmet', 1));
    pi.equipFrom(
      pi.main,
      pi.main.slots.findIndex((s) => s?.id === 'helmet'),
    );
    const lost = pi.takeAllForDeath();
    expect(lost.map((s) => s.id).sort()).toEqual(['axe_stone', 'wood']);
    expect(pi.equip.head?.id).toBe('helmet');
  });

  it('сохранение и загрузка', () => {
    const pi = new PlayerInventory(reg);
    pi.add({ id: 'stone', count: 4 });
    pi.selected = 3;
    const pi2 = new PlayerInventory(reg, JSON.parse(JSON.stringify(pi.toJSON())));
    expect(pi2.count('stone')).toBe(4);
    expect(pi2.selected).toBe(3);
  });
});
