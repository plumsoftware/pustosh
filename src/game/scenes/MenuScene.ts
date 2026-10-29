import Phaser from 'phaser';
import { ctx } from '../GameContext';
import { SceneKeys } from '../SceneKeys';
import { panel as stylePanel } from '../ui/Styled';
import { Button } from '../ui/Button';
import { COLORS, FONT, TEXT_RES, uiScale } from '../ui/layout';
import type { WorldScene } from './WorldScene';

export interface MenuItem {
  label: string;
  fn: () => void;
  disabled?: boolean;
  /** Значок из атласа слева от подписи. */
  icon?: string;
}

export interface MenuData {
  title: string;
  subtitle?: string;
  items: MenuItem[];
  /** Закрывается только кнопками (подсказки): тап мимо окна ничего не делает. */
  modal?: boolean;
}

/** Открытие панели (ANIMATIONS §11). */
const PANEL_MS = 180;

/**
 * Короткое меню действий у объекта (кровать, тотем, аванпост, бочка, ловушка) или подсказка: заголовок
 * и кнопки. Ввод героя выключен, пока меню открыто; подсказка (modal) ставит мир на паузу.
 */
export class MenuScene extends Phaser.Scene {
  private data_!: MenuData;

  constructor() {
    super(SceneKeys.Menu);
  }

  private get world(): WorldScene {
    return this.scene.get(SceneKeys.World) as WorldScene;
  }

  init(d: MenuData): void {
    this.data_ = d;
  }

  create(): void {
    const w = this.world;
    w.controls.clear();
    w.controls.enabled = false;
    // Подсказку читают спокойно: мир на паузе, пока её не закроют кнопкой.
    const modal = !!this.data_.modal;
    if (modal) ctx().clock.pause('DIALOG');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (modal) ctx().clock.resume('DIALOG');
      w.controls.clear();
      w.controls.enabled = true;
    });
    const k = uiScale(this);
    const { width, height } = this.scale;
    const shade = this.add.rectangle(0, 0, width, height, 0x000000, 0.45).setOrigin(0).setInteractive();
    // Тап мимо закрывает меню объекта, только если касание началось на затемнении уже после открытия:
    // отпускание стика или кнопки мыши, которыми играли, окно не закрывает. Подсказки (modal) — только кнопкой.
    let pressed = false;
    shade.on('pointerdown', () => (pressed = !this.data_.modal));
    shade.on('pointerup', () => {
      if (pressed) this.close();
      pressed = false;
    });
    const bw = 360 * k;
    const bh = Math.round(44 * k);
    const title = this.add
      .text(0, 0, this.data_.title, {
        fontFamily: FONT,
        resolution: TEXT_RES,
        fontSize: `${Math.round(19 * k + 2)}px`,
        color: COLORS.text,
        fontStyle: '700',
        wordWrap: { width: bw },
      })
      .setOrigin(0.5, 0);
    const sub = this.data_.subtitle
      ? this.add
          .text(0, 0, this.data_.subtitle, {
            fontFamily: FONT,
            resolution: TEXT_RES,
            fontSize: `${Math.round(13 * k + 2)}px`,
            color: COLORS.textDim,
            wordWrap: { width: bw },
            align: 'center',
          })
          .setOrigin(0.5, 0)
      : null;
    const items = this.data_.items;
    const head = title.height + (sub ? sub.height + 6 * k : 0) + 18 * k;
    const ph = Math.min(height - 20, head + items.length * (bh + 8 * k) + 18 * k);
    const pw = bw + 40 * k;
    const px = width / 2;
    const py = (height - ph) / 2;
    const root = this.add.container(0, 0);
    root.add(stylePanel(this, px, py + ph / 2, pw, ph, true));
    title.setPosition(px, py + 14 * k);
    root.add(title);
    if (sub) {
      sub.setPosition(px, py + 14 * k + title.height + 4 * k);
      root.add(sub);
    }
    items.forEach((it, i) => {
      const b = new Button(
        this,
        px,
        py + head + i * (bh + 8 * k) + bh / 2,
        it.label,
        () => {
          this.scene.stop();
          it.fn();
        },
        bw,
        bh,
      );
      if (it.icon) b.setIcon(it.icon);
      if (it.disabled) b.setAlpha(0.45).disableInteractive();
      root.add(b);
    });
    root.setScale(0.9).setAlpha(0);
    root.setPosition(px * 0.1, (py + ph / 2) * 0.1);
    this.tweens.add({ targets: root, scale: 1, alpha: 1, x: 0, y: 0, duration: PANEL_MS, ease: 'Quad.Out' });
    this.input.keyboard?.on('keydown-ESC', () => this.close());
  }

  close(): void {
    this.scene.stop();
  }
}
