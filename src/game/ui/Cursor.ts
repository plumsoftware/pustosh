import type Phaser from 'phaser';

/** Курсоры UI-кита (public/cursors, режет cut-sheets): остриё стрелки — в левом верхнем углу. */
const NORMAL = 'url(cursors/normal.png) 3 2, auto';
const ACTIVE = 'url(cursors/active.png) 3 2, pointer';
const GRAB = 'url(cursors/grab.png) 14 10, grabbing';

/**
 * Стилизованный курсор на ПК: обычный — ржавая стрелка, над кнопкой (useHandCursor) — светящаяся,
 * при нажатии — рука в перчатке. На сенсорных экранах не нужен.
 */
export function installCursor(game: Phaser.Game): void {
  if (!game.device.os.desktop) return;
  const canvas = game.canvas;
  game.input.setDefaultCursor(NORMAL);
  // Phaser ставит canvas.style.cursor = 'pointer' над интерактивными объектами — подменяем на свой.
  const im = game.input as unknown as { setCursor(o: { cursor: string | boolean }): void };
  const orig = im.setCursor.bind(im);
  im.setCursor = (o) => {
    if (o.cursor === 'pointer') o.cursor = ACTIVE;
    orig(o);
  };
  let before = '';
  canvas.addEventListener('pointerdown', () => {
    before = canvas.style.cursor;
    canvas.style.cursor = GRAB;
  });
  window.addEventListener('pointerup', () => {
    if (canvas.style.cursor === GRAB) canvas.style.cursor = before || NORMAL;
  });
}
