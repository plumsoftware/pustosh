/** Цвет и рамка редкости по тиру (TZ 5.2.5): 0–1 серый, 2 зелёный, 3 синий, 4–5 фиолетовый, 6 оранжевый. */
export function rarityColor(tier: number): number {
  if (tier <= 1) return 0xb8b8b8;
  if (tier === 2) return 0x5ad15a;
  if (tier === 3) return 0x4aa8ff;
  if (tier <= 5) return 0xb066ff;
  return 0xff9a3a;
}

export function raritySlot(tier: number): string {
  if (tier <= 1) return 'ui.slot';
  if (tier === 2) return 'ui.slot_green';
  if (tier === 3) return 'ui.slot_blue';
  if (tier <= 5) return 'ui.slot_purple';
  return 'ui.slot_orange';
}
