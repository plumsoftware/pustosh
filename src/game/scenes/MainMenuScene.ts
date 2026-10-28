import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import { ctx } from '../GameContext';
import { audio } from '../audio/AudioBus';
import { SceneKeys } from '../SceneKeys';
import { Button } from '../ui/Button';
import { COLORS, FONT, uiScale, TEXT_RES } from '../ui/layout';

/** Главное меню: «Играть» (после межстраничной рекламы menu_to_game) и «Настройки». */
export class MainMenuScene extends Phaser.Scene {
  private starting = false;

  constructor() {
    super(SceneKeys.MainMenu);
  }

  create(): void {
    this.starting = false;
    audio()?.stopLoops();
    audio()?.playMusic('music_menu');
    audio()?.loadInBackground(this, () => {
      if (this.scene.isActive()) audio()?.playMusic('music_menu');
    });
    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this),
    );
  }

  private layout(): void {
    this.children.removeAll(true);
    const { width, height } = this.scale;
    const k = uiScale(this);
    this.cameras.main.setBackgroundColor('#14110e');

    this.add
      .text(width / 2, height * 0.26, t('game.title'), {
        fontFamily: FONT,
        resolution: TEXT_RES,
        fontSize: `${Math.round(84 * k)}px`,
        color: COLORS.text,
        fontStyle: '800',
      })
      .setOrigin(0.5)
      .setShadow(0, 4, '#000', 8, false, true);

    const bw = 300 * k;
    const bh = 68 * k;
    new Button(this, width / 2, height * 0.52, t('ui.play'), () => void this.play(), bw, bh);
    new Button(
      this,
      width / 2,
      height * 0.52 + bh * 1.35,
      t('ui.settings'),
      () => this.scene.launch(SceneKeys.Settings),
      bw,
      bh,
    ).setIcon('ui.icon_settings');

    const c = ctx();
    if (c.debug) {
      const small = 220 * k;
      const sh = 44 * k;
      new Button(
        this,
        width - small / 2 - 16,
        height - sh * 2.4,
        'Stress test',
        () => this.scene.start(SceneKeys.Stress),
        small,
        sh,
      );
      new Button(
        this,
        width - small / 2 - 16,
        height - sh * 1.1,
        'Галерея (F2)',
        () => this.scene.launch(SceneKeys.Gallery),
        small,
        sh,
      );
    }
    this.add
      .text(12, height - 10, `v${c.version} · ${c.platform.id}`, {
        fontFamily: FONT,
        resolution: TEXT_RES,
        fontSize: '12px',
        color: COLORS.textDim,
      })
      .setOrigin(0, 1);
  }

  private async play(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    // Выбор сохранения; реклама menu_to_game — при запуске игры из списка.
    this.scene.start(SceneKeys.Saves);
  }
}
