import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import { audio, type Bus } from '../audio/AudioBus';
import { getAssetInfo } from '../assets/AssetIndex';
import { SceneKeys } from '../SceneKeys';
import { Button } from '../ui/Button';
import { COLORS, FONT, TEXT_RES, uiScale } from '../ui/layout';

/** Настройки (GDD §14): громкость по шинам — музыка, эффекты, интерфейс. */
export class SettingsScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Settings);
  }

  create(): void {
    const k = uiScale(this);
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x000000, 0.65).setOrigin(0).setInteractive();
    const pw = Math.min(width - 20, 560 * k);
    const ph = Math.min(height - 20, 360 * k);
    const px = width / 2;
    const py = height / 2;
    const info = getAssetInfo('ui.panel_9slice')!;
    this.add.nineslice(px, py, info.group, info.frame, pw, ph, 22, 22, 22, 22);
    const text = (x: number, y: number, s: string, size: number, bold = false) =>
      this.add
        .text(x, y, s, {
          fontFamily: FONT,
          resolution: TEXT_RES,
          fontSize: `${Math.round(size * k + 2)}px`,
          color: COLORS.text,
          fontStyle: bold ? '700' : '400',
        })
        .setOrigin(0.5);
    text(px, py - ph / 2 + 30 * k, t('ui.settings'), 22, true);
    const buses: Bus[] = ['music', 'sfx', 'ui'];
    const bh = Math.round(40 * k);
    buses.forEach((b, i) => {
      const y = py - ph / 2 + 90 * k + i * (bh + 14 * k);
      text(px - pw / 2 + 110 * k, y, t(`settings.${b}`), 15);
      const val = text(px + 70 * k, y, '', 16, true);
      const show = () => val.setText(`${Math.round((audio()?.volume[b] ?? 0) * 100)}%`);
      show();
      new Button(
        this,
        px - 10 * k,
        y,
        '−',
        () => {
          audio()?.setVolume(b, (audio()?.volume[b] ?? 0) - 0.1);
          show();
        },
        bh,
        bh,
      );
      new Button(
        this,
        px + 150 * k,
        y,
        '+',
        () => {
          audio()?.setVolume(b, (audio()?.volume[b] ?? 0) + 0.1);
          show();
        },
        bh,
        bh,
      );
    });
    new Button(this, px, py + ph / 2 - 40 * k, t('ui.back'), () => this.scene.stop(), 220 * k, bh);
    this.input.keyboard?.on('keydown-ESC', () => this.scene.stop());
  }
}
