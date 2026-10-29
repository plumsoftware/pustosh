import type Phaser from 'phaser';
import { ctx } from '../GameContext';

/** Логическое разрешение: интерфейс рассчитан на 1280×720 и масштабируется под экран. */
export const LOGICAL_W = 1280;
export const LOGICAL_H = 720;

/**
 * Нижняя граница масштаба на сенсорных экранах: кнопка 56 px × 0.75 ≈ 42 CSS px — удобна для пальца
 * (на телефоне 825×360 масштаб по макету был бы 0.5, кнопки ~24 px).
 */
const MIN_TOUCH_SCALE = 0.75;
const MIN_SCALE = 0.5;
/** Интерфейс крупнее макета на 15% (решение владельца: кнопки и текст читаются лучше). */
const UI_BOOST = 1.15;

export function uiScale(scene: Phaser.Scene): number {
  const { width, height } = scene.scale;
  const touch = scene.sys.game.device.input.touch && !scene.sys.game.device.os.desktop;
  // Нижние границы — в CSS-пикселях: на канвасе с масштабом рендера rs они в rs раз больше.
  const rs = ctx().renderScale;
  const fit = Math.min(width / LOGICAL_W, height / LOGICAL_H);
  return Math.max((touch ? MIN_TOUCH_SCALE : MIN_SCALE) * rs, fit) * UI_BOOST;
}

/**
 * Шрифты интерфейса (public/fonts, лицензия OFL): Russo One — весь текст, Rubik Dirt — крупные
 * заголовки. Грузятся до старта игры (loadFonts в main.ts), запасной — системный.
 */
export const FONT = '"Russo One", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const TITLE_FONT = '"Rubik Dirt", "Russo One", system-ui, sans-serif';

/** Загрузить шрифты интерфейса; не дождались за timeoutMs — игра стартует с системным. */
export async function loadFonts(timeoutMs = 4000): Promise<void> {
  if (typeof FontFace === 'undefined') return;
  const faces = [
    new FontFace('Russo One', 'url(fonts/RussoOne.woff2) format("woff2")'),
    new FontFace('Rubik Dirt', 'url(fonts/RubikDirt.woff2) format("woff2")'),
  ];
  const all = Promise.all(
    faces.map(async (f) => {
      document.fonts.add(await f.load());
    }),
  ).catch(() => undefined);
  await Promise.race([all, new Promise((r) => setTimeout(r, timeoutMs))]);
}
export const COLORS = {
  text: '#f2e6c9',
  textDim: '#d6c7a4',
  accent: 0xc9772b,
  accentHover: 0xe08a37,
  panel: 0x1d1a16,
  panelBorder: 0x5a4a35,
};

/** Разрешение текстур текста: чёткий текст на экранах с высокой плотностью при рендере в 1x. */
export let TEXT_RES = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 3);

/** Разрешение текста при масштабе рендера rs: канвас уже в rs раз крупнее CSS, добираем до экрана. */
export function setTextRes(rs: number): void {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  TEXT_RES = Math.max(1, Math.min(dpr / rs, 3));
}
