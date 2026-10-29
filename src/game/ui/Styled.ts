import Phaser from 'phaser';
import { getAssetInfo } from '../assets/AssetIndex';
import { ctx } from '../GameContext';
import { COLORS, FONT, TEXT_RES, TITLE_FONT } from './layout';

/**
 * Стилизованные элементы интерфейса (ржавый металл с заклёпками): плашка кнопки и вкладки, панель,
 * рамка строки, плашка уведомления, заголовок. Основной источник — UI-кит (`ui/kit/*`, лист s34);
 * без него — детали старого листа ui. 9-slice строится в увеличенном размере и уменьшается: углы
 * с заклёпками остаются аккуратными на маленьких кнопках.
 */

/** Срез углов в пикселях кадра атласа. */
const SLICE: Record<string, [number, number, number, number]> = {
  // UI-кит (s34): кадры в исходном размере.
  'ui.kit.btn_normal': [24, 24, 20, 20],
  'ui.kit.btn_hover': [24, 24, 20, 20],
  'ui.kit.btn_pressed': [24, 24, 20, 20],
  'ui.kit.btn_disabled': [24, 24, 20, 20],
  'ui.kit.btn_primary': [24, 24, 20, 20],
  'ui.kit.btn_danger': [24, 24, 20, 20],
  'ui.kit.panel_large': [36, 36, 36, 36],
  'ui.kit.panel_popup': [30, 30, 30, 30],
  'ui.kit.tooltip_frame': [22, 22, 22, 22],
  'ui.kit.row_frame': [22, 22, 14, 14],
  'ui.kit.notify_plaque': [52, 24, 16, 16],
  'ui.kit.tab_active': [34, 34, 30, 12],
  'ui.kit.tab_inactive': [34, 34, 30, 12],
  'ui.kit.title_banner': [26, 26, 18, 18],
  // Старый лист ui (атлас 2x).
  'ui.button_plate_9slice': [26, 26, 22, 22],
  'ui.panel_9slice': [30, 30, 30, 30],
  'ui.slot': [22, 22, 22, 22],
  'ui.slot_selected': [22, 22, 22, 22],
};

/** Деталь кита, если она есть в атласе, иначе — запасная. */
export function kit(id: string, fallback: string): string {
  return getAssetInfo(`ui.kit.${id}`) ? `ui.kit.${id}` : fallback;
}

/** 9-slice из атласа ui размером w×h (экранные px); corner — множитель размера углов. */
export function slice9(
  scene: Phaser.Scene,
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  corner = 0.5,
): Phaser.GameObjects.NineSlice {
  const info = getAssetInfo(id)!;
  const [l, r, t, b] = SLICE[id] ?? [20, 20, 20, 20];
  const k = corner;
  // Углы не больше половины стороны, иначе 9-slice ломается.
  const sw = Math.max(w / k, l + r + 2);
  const sh = Math.max(h / k, t + b + 2);
  return scene.add.nineslice(x, y, info.group, info.frame, sw, sh, l, r, t, b).setScale(w / sw, h / sh);
}

/** Плашка кнопки (state — кадр кита: btn_normal, btn_hover, btn_pressed, btn_primary…). */
export function plate(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  state = 'btn_normal',
): Phaser.GameObjects.NineSlice {
  return slice9(scene, kit(state, 'ui.button_plate_9slice'), x, y, w, h, Math.min(0.5, h / 80));
}

/** Панель окна (popup — меньше и шире). */
export function panel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  popup = false,
): Phaser.GameObjects.NineSlice {
  return slice9(scene, kit(popup ? 'panel_popup' : 'panel_large', 'ui.panel_9slice'), x, y, w, h, 0.6);
}

/** Рамка строки списка (задание, навык, рецепт); выбранная — тёплый оттенок. */
export function rowFrame(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  selected = false,
): Phaser.GameObjects.NineSlice {
  const id = kit('row_frame', selected ? 'ui.slot_selected' : 'ui.slot');
  const f = slice9(scene, id, x, y, w, h, Math.min(0.6, h / 46));
  if (selected && id === 'ui.kit.row_frame') f.setTint(0xffc890);
  return f;
}

/** Плашка уведомления с лампочкой слева (кит) или панель. */
export function notifyPlaque(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
): Phaser.GameObjects.NineSlice {
  const id = kit('notify_plaque', '');
  return id ? slice9(scene, id, x, y, w, h, Math.min(0.7, h / 51)) : panel(scene, x, y, w, h, true);
}

/** Текст интерфейса: светлый с тёмной обводкой (читается на металле и на мире). */
export function uiText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  sizePx: number,
  o: { color?: string; title?: boolean; wrap?: number; align?: 'left' | 'center' | 'right' } = {},
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, {
    fontFamily: o.title ? TITLE_FONT : FONT,
    resolution: TEXT_RES,
    fontSize: `${Math.round(sizePx)}px`,
    color: o.color ?? COLORS.text,
    stroke: '#14100b',
    strokeThickness: Math.max(2, Math.round(sizePx / 7)),
    wordWrap: o.wrap ? { width: o.wrap } : undefined,
    align: o.align ?? 'left',
  });
}

/** Заголовок окна шрифтом Rubik Dirt. */
export function titleText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  sizePx: number,
): Phaser.GameObjects.Text {
  return uiText(scene, x, y, text, sizePx, { title: true, color: '#f0d9a8' });
}

/**
 * Вкладка (фильтр, раздел): включённая — янтарная, выключенная — тёмный металл.
 * Возвращает объекты (для контейнера) и ширину.
 */
export function chip(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  on: boolean,
  h: number,
  fn: () => void,
): { objs: Phaser.GameObjects.GameObject[]; width: number } {
  const txt = uiText(scene, 0, 0, label, h * 0.46, { color: on ? '#fff3d6' : '#c9b893' });
  const w = txt.width + h * 1.1;
  const tabs = !!getAssetInfo('ui.kit.tab_active');
  const bg = (
    tabs
      ? slice9(
          scene,
          on ? 'ui.kit.tab_active' : 'ui.kit.tab_inactive',
          x + w / 2,
          y + h / 2,
          w,
          h,
          Math.min(0.5, h / 77),
        )
      : plate(scene, x + w / 2, y + h / 2, w, h).setTint(on ? 0xffc890 : 0x8c8c84)
  ).setInteractive({ useHandCursor: true });
  bg.on('pointerup', fn);
  txt.setPosition(x + w / 2, y + h / 2 + (tabs ? h * 0.06 : -1)).setOrigin(0.5);
  // Подпись поверх плашки, даже если вызывающий поднимет обоим одну глубину.
  txt.setDepth(bg.depth + 0.5);
  return { objs: [bg, txt], width: w };
}

/**
 * Круглая кнопка-значок из кита (плюс, минус, назад, дом, реклама) или любой спрайт ui:
 * нажатие — вдавливается, щелчок звуком делает вызывающий.
 */
export function iconButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  id: string,
  size: number,
  fn: () => void,
): Phaser.GameObjects.Image | null {
  const info = getAssetInfo(id);
  if (!info) return null;
  const img = scene.add.image(x, y, info.group, info.frame);
  const k = size / Math.max(img.frame.width, img.frame.height);
  img.setScale(k).setInteractive({ useHandCursor: true });
  // Только нажатие, начатое на иконке (как у Button): отпускание пальца, открывшего окно, не жмёт её.
  let pressed = false;
  img.on('pointerdown', () => {
    pressed = true;
    img.setScale(k * 0.92);
  });
  img.on('pointerout', () => {
    pressed = false;
    img.setScale(k);
  });
  img.on('pointerup', () => {
    img.setScale(k);
    if (!pressed) return;
    pressed = false;
    fn();
  });
  return img;
}

/** Минимальный кегль текста интерфейса, px (мельче на телефоне не читается). */
const MIN_FONT_PX = 15;

/**
 * Читаемый текст по умолчанию: всем надписям шрифтом интерфейса без своей обводки — тёмная обводка
 * (на металле, мешковине и мире), кегль не меньше MIN_FONT_PX. Вызывается один раз до старта игры.
 */
export function installReadableText(): void {
  const proto = Phaser.GameObjects.GameObjectFactory.prototype as unknown as {
    text: (
      x: number,
      y: number,
      t: string | string[],
      s?: Phaser.Types.GameObjects.Text.TextStyle,
    ) => Phaser.GameObjects.Text;
  };
  const orig = proto.text;
  proto.text = function (this: unknown, x, y, t, style) {
    const st = { ...(style ?? {}) };
    const fam = String(st.fontFamily ?? '');
    if (fam.includes('Russo One') || fam.includes('Rubik Dirt')) {
      const px = parseFloat(String(st.fontSize ?? '16')) || 16;
      const size = Math.max(MIN_FONT_PX * ctx().renderScale, px);
      st.fontSize = `${Math.round(size)}px`;
      if (!st.stroke) {
        st.stroke = '#120d08';
        st.strokeThickness = Math.max(2, Math.round(size / 6));
      }
    }
    return orig.call(this, x, y, t, st);
  };
}
