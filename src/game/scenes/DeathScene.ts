import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import { AdsController } from '../AdsController';
import { ctx, registry } from '../GameContext';
import { SceneKeys } from '../SceneKeys';
import { Button } from '../ui/Button';
import { COLORS, FONT, TEXT_RES, uiScale } from '../ui/layout';
import type { WorldScene } from './WorldScene';

/** Экран «Вы погибли» (ТЗ 4.5): возродиться у кровати/бункера или на месте за рекламу. Пауза DIALOG. */
export class DeathScene extends Phaser.Scene {
  private busy = false;

  constructor() {
    super(SceneKeys.Death);
  }

  create(): void {
    const { clock } = ctx();
    clock.pause('DIALOG');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => clock.resume('DIALOG'));
    this.busy = false;
    const { width, height } = this.scale;
    const k = uiScale(this);
    this.add.rectangle(0, 0, width, height, 0x000000, 0.75).setOrigin(0).setInteractive();
    const title = this.add
      .text(width / 2, height * 0.28, t('death.title'), {
        fontFamily: FONT,
        resolution: TEXT_RES,
        fontSize: `${Math.round(64 * k)}px`,
        color: '#e8553f',
        fontStyle: '800',
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.tweens.add({ targets: title, alpha: 1, duration: 500 });
    const hint = this.add
      .text(width / 2, height * 0.28 + 56 * k, t('death.hint'), {
        fontFamily: FONT,
        resolution: TEXT_RES,
        fontSize: `${Math.round(18 * k + 2)}px`,
        color: COLORS.textDim,
      })
      .setOrigin(0.5);
    const bw = 460 * k;
    const bh = 64 * k;
    new Button(this, width / 2, height * 0.56, t('death.respawn'), () => this.respawn(false), bw, bh);
    new Button(
      this,
      width / 2,
      height * 0.56 + bh * 1.3,
      t('death.revive_ad'),
      () => void this.reviveAd(hint),
      bw,
      bh,
    );
  }

  private respawn(inPlace: boolean): void {
    if (this.busy) return;
    this.busy = true;
    (this.scene.get(SceneKeys.World) as WorldScene).respawnHero(inPlace);
    this.scene.stop();
  }

  private async reviveAd(hint: Phaser.GameObjects.Text): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const r = await AdsController.rewarded(registry().survival.death.rewardedPlacement);
    this.busy = false;
    if (r === 'rewarded') this.respawn(true);
    else hint.setText(t('death.ad_failed')).setColor('#ff7a66');
  }
}
