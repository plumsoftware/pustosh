import Phaser from 'phaser';
import { audio } from '../audio/AudioBus';
import { getAssetInfo } from '../assets/AssetIndex';
import { spawnSprite } from '../assets/spawnSprite';
import { kit, plate, uiText } from './Styled';

/** Вид кнопки: обычная — металл, главная — ржавая оранжевая, опасная — красная. */
export type ButtonVariant = 'normal' | 'primary' | 'danger';
/** Кадры UI-кита (s34) по виду; у обычной — свои кадры наведения и нажатия. */
const KIT: Record<ButtonVariant, string> = {
  normal: 'btn_normal',
  primary: 'btn_primary',
  danger: 'btn_danger',
};
/** Без кита — оттенок старой плашки. */
const TINT: Record<ButtonVariant, number> = { normal: 0xeeeeee, primary: 0xffd9a8, danger: 0xffb0a0 };

/**
 * Кнопка интерфейса: металлическая плашка с заклёпками из UI-кита (обычная / наведение / нажата /
 * неактивна / главная / опасная) и подпись шрифтом интерфейса с обводкой.
 */
export class Button extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.NineSlice;
  private readonly label: Phaser.GameObjects.Text;
  private variant: ButtonVariant = 'normal';
  private state_ = '';

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    text: string,
    onClick: () => void,
    private readonly bw = 280,
    private readonly bh = 64,
  ) {
    super(scene, x, y);
    this.bg = plate(scene, 0, 0, bw, bh);
    // «… (реклама)» — без приписки, но со значком «смотреть рекламу» из кита.
    const ad = /\s*\(реклама\)\s*$/.exec(text);
    this.label = uiText(scene, 0, -1, ad ? text.slice(0, ad.index) : text, Math.round(bh * 0.4)).setOrigin(
      0.5,
    );
    this.add([this.bg, this.label]);
    if (ad) this.setIcon('ui.kit.btn_round_ad');
    this.draw(false);
    this.setSize(bw, bh);
    this.setInteractive({ useHandCursor: true });
    this.on('pointerover', () => this.draw(true));
    // Срабатывает, только если нажатие началось на этой кнопке: иначе отпускание пальца, открывшего окно,
    // нажимает кнопку, оказавшуюся под ним в новом окне (инвентарь → «Крафт»).
    let pressed = false;
    this.on('pointerout', () => {
      pressed = false;
      this.setScale(1);
      this.draw(false);
    });
    this.on('pointerdown', () => {
      pressed = true;
      this.setScale(0.96);
      if (this.variant === 'normal') this.setPlate('btn_pressed');
    });
    this.on('pointerup', () => {
      this.setScale(1);
      this.draw(true);
      if (!pressed) return;
      pressed = false;
      audio()?.play('ui_click', 'ui');
      onClick();
    });
    scene.add.existing(this);
  }

  /** Вид плашки (главное действие, опасное). */
  setVariant(v: ButtonVariant): this {
    this.variant = v;
    this.draw(false);
    return this;
  }

  /** Неактивная кнопка — серый металл кита, без нажатий. */
  setEnabled(on: boolean): this {
    if (on) {
      this.setInteractive({ useHandCursor: true });
      this.draw(false);
    } else {
      this.disableInteractive();
      if (!this.setPlate('btn_disabled')) this.setAlpha(0.45);
    }
    this.label.setAlpha(on ? 1 : 0.6);
    return this;
  }

  /** Значок из атласа слева от подписи (без подписи — по центру). Нет спрайта — кнопка без значка. */
  setIcon(assetId: string): this {
    if (!getAssetInfo(assetId)) return this;
    const s = this.bh * 0.7;
    const hasText = this.label.text.length > 0;
    const icon = spawnSprite(this.scene, 0, 0, assetId, { depth: false });
    icon.setScale(s / Math.max(icon.frame.width, icon.frame.height));
    if (hasText) {
      const total = s + 8 + this.label.width;
      icon.setX(-total / 2 + s / 2);
      this.label.setX(-total / 2 + s + 8 + this.label.width / 2);
    }
    this.add(icon);
    return this;
  }

  setText(text: string): this {
    this.label.setText(text);
    return this;
  }

  /** Сменить кадр плашки кита; false — кита нет. */
  private setPlate(state: string): boolean {
    if (!kit(state, '')) return false;
    if (this.state_ === state) return true;
    this.state_ = state;
    const old = this.bg;
    this.bg = plate(this.scene, 0, 0, this.bw, this.bh, state);
    this.addAt(this.bg, 0);
    old.destroy();
    return true;
  }

  private draw(hover: boolean): void {
    const st = hover && this.variant === 'normal' ? 'btn_hover' : KIT[this.variant];
    if (this.setPlate(st)) {
      // У главной и опасной нет кадра наведения — светлее тинтом.
      this.bg.setTint(hover && this.variant !== 'normal' ? 0xfff0e0 : 0xffffff);
      return;
    }
    this.bg.setTint(hover ? 0xffffff : TINT[this.variant]);
  }
}
