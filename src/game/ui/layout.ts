import type Phaser from 'phaser';

/** Логическое разрешение: интерфейс рассчитан на 1280×720 и масштабируется под экран. */
export const LOGICAL_W = 1280;
export const LOGICAL_H = 720;

/**
 * Нижняя граница масштаба на сенсорных экранах: кнопка 56 px × 0.75 ≈ 42 CSS px — удобна для пальца
 * (на телефоне 825×360 масштаб по макету был бы 0.5, кнопки ~24 px).
 */
const MIN_TOUCH_SCALE = 0.75;
const MIN_SCALE = 0.5;

export function uiScale(scene: Phaser.Scene): number {
  const { width, height } = scene.scale;
  const touch = scene.sys.game.device.input.touch && !scene.sys.game.device.os.desktop;
  return Math.max(touch ? MIN_TOUCH_SCALE : MIN_SCALE, Math.min(width / LOGICAL_W, height / LOGICAL_H));
}

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const COLORS = {
  text: '#f2e6c9',
  textDim: '#b7a98a',
  accent: 0xc9772b,
  accentHover: 0xe08a37,
  panel: 0x1d1a16,
  panelBorder: 0x5a4a35,
};

/** Разрешение текстур текста: чёткий текст на экранах с высокой плотностью при рендере в 1x. */
export const TEXT_RES = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 3);
