import Phaser from 'phaser';
import { COLORS, FONT, TEXT_RES } from './layout';
import { audio } from '../audio/AudioBus';
import { getAssetInfo } from '../assets/AssetIndex';
import { spawnSprite } from '../assets/spawnSprite';

/** Простая кнопка (прямоугольник + текст). Спрайтовый UI — на следующих шагах. */
export class Button extends Phaser.GameObjects.Container {
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;

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
    this.bg = scene.add.graphics();
    this.label = scene.add
      .text(0, 0, text, {
        fontFamily: FONT,
        resolution: TEXT_RES,
        fontSize: `${Math.round(bh * 0.42)}px`,
        color: COLORS.text,
        fontStyle: '600',
      })
      .setOrigin(0.5);
    this.add([this.bg, this.label]);
    this.draw(false);
    this.setSize(bw, bh);
    this.setInteractive({ useHandCursor: true });
    this.on('pointerover', () => this.draw(true));
    this.on('pointerout', () => this.draw(false));
    this.on('pointerup', () => {
      audio()?.play('ui_click', 'ui');
      onClick();
    });
    scene.add.existing(this);
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

  private draw(hover: boolean): void {
    const w = this.bw;
    const h = this.bh;
    this.bg.clear();
    this.bg.fillStyle(hover ? COLORS.accentHover : COLORS.accent, 1);
    this.bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
    this.bg.lineStyle(2, 0x000000, 0.35);
    this.bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
  }
}
