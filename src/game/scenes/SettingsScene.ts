import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import { audio, type Bus } from '../audio/AudioBus';
import { getAssetInfo } from '../assets/AssetIndex';
import { spawnSprite } from '../assets/spawnSprite';
import { slice9 } from '../ui/Styled';
import { SceneKeys } from '../SceneKeys';
import { panel as stylePanel } from '../ui/Styled';
import { Button } from '../ui/Button';
import { ctx } from '../GameContext';
import { graphicsQuality, QUALITIES, setGraphicsQuality } from '../render/Quality';
import { COLORS, FONT, TEXT_RES, uiScale, TITLE_FONT } from '../ui/layout';

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
    const ph = Math.min(height - 20, 420 * k);
    const px = width / 2;
    const py = height / 2;
    stylePanel(this, px, py, pw, ph);
    const text = (x: number, y: number, s: string, size: number, bold = false) =>
      this.add
        .text(x, y, s, {
          fontFamily: bold ? TITLE_FONT : FONT,
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
      const val = text(px + pw / 2 - 50 * k, y, '', 16, true);
      const show = () => val.setText(`${Math.round((audio()?.volume[b] ?? 0) * 100)}%`);
      show();
      // Ползунок кита (s34): дорожка и ручка; без кита — кнопки «−» и «+».
      const tw = pw - 290 * k;
      const tx = px - pw / 2 + 200 * k;
      if (getAssetInfo('ui.kit.slider_track') && getAssetInfo('ui.kit.slider_knob')) {
        slice9(this, 'ui.kit.slider_track', tx + tw / 2, y, tw, 18 * k, 0.5);
        const knob = spawnSprite(this, 0, y, 'ui.kit.slider_knob', { depth: false });
        knob.setScale((34 * k) / Math.max(knob.frame.width, knob.frame.height));
        const place = () => knob.setX(tx + (audio()?.volume[b] ?? 0) * tw);
        place();
        const hit = this.add
          .zone(tx + tw / 2, y, tw + 34 * k, 40 * k)
          .setInteractive({ useHandCursor: true });
        const set = (p: Phaser.Input.Pointer) => {
          audio()?.setVolume(b, Phaser.Math.Clamp((p.x - tx) / tw, 0, 1));
          place();
          show();
        };
        hit.on('pointerdown', set);
        hit.on('pointermove', (p: Phaser.Input.Pointer) => p.isDown && set(p));
        hit.on('pointerup', () => audio()?.play('ui_click', 'ui'));
      } else {
        new Button(
          this,
          tx,
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
          tx + tw,
          y,
          '+',
          () => {
            audio()?.setVolume(b, (audio()?.volume[b] ?? 0) + 0.1);
            show();
          },
          bh,
          bh,
        );
      }
    });
    // Качество графики: масштаб рендера (render/Quality); меняется сразу, окно пересобирается под новый канвас.
    const desktop = ctx().platform.device === 'desktop';
    const gy = py - ph / 2 + 90 * k + buses.length * (bh + 14 * k);
    text(px - pw / 2 + 110 * k, gy, t('settings.graphics'), 15);
    const cur = graphicsQuality(desktop);
    const qw = (pw - 230 * k) / QUALITIES.length;
    QUALITIES.forEach((q, i) => {
      const b = new Button(
        this,
        px - pw / 2 + 200 * k + qw * (i + 0.5),
        gy,
        t(`settings.gfx.${q}`),
        () => {
          if (q === graphicsQuality(desktop)) return;
          setGraphicsQuality(q, desktop);
          this.scene.restart();
        },
        qw - 6 * k,
        bh,
      );
      if (q !== cur) b.setAlpha(0.55);
    });
    new Button(this, px, py + ph / 2 - 40 * k, t('ui.back'), () => this.scene.stop(), 220 * k, bh);
    this.input.keyboard?.on('keydown-ESC', () => this.scene.stop());
  }
}
