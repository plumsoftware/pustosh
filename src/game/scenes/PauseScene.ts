import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import { ctx } from '../GameContext';
import { SceneKeys } from '../SceneKeys';
import { Button } from '../ui/Button';
import { COLORS, FONT, uiScale, TEXT_RES } from '../ui/layout';

/** Меню паузы поверх мира: пока открыто — пауза MENU. */
export class PauseScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Pause);
  }

  create(): void {
    const { clock } = ctx();
    clock.pause('MENU');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => clock.resume('MENU'));

    const { width, height } = this.scale;
    const k = uiScale(this);
    this.add.rectangle(0, 0, width, height, 0x000000, 0.6).setOrigin(0).setInteractive();
    this.add
      .text(width / 2, height * 0.2, t('ui.pause'), {
        fontFamily: FONT,
        resolution: TEXT_RES,
        fontSize: `${Math.round(56 * k)}px`,
        color: COLORS.text,
        fontStyle: '700',
      })
      .setOrigin(0.5);
    const bw = 260 * k;
    const bh = 56 * k;
    // Меню (GDD §14): навыки, журнал заданий и записок, карта, настройки.
    const items: [string, () => void, string?][] = [
      [t('ui.resume'), () => this.scene.stop()],
      [t('menu.skills'), () => this.open(SceneKeys.Skills), 'ui.icon_skills'],
      [t('menu.journal'), () => this.open(SceneKeys.Journal), 'ui.icon_journal'],
      [t('menu.map'), () => this.open(SceneKeys.Map), 'ui.icon_map'],
      [t('ui.settings'), () => this.scene.launch(SceneKeys.Settings), 'ui.icon_settings'],
      [
        t('ui.to_menu'),
        () => {
          this.scene.stop();
          this.scene.stop(SceneKeys.World);
          this.scene.start(SceneKeys.MainMenu);
        },
      ],
    ];
    const top = height * 0.42;
    items.forEach(([label, fn, icon], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const b = new Button(
        this,
        width / 2 + (col ? 1 : -1) * (bw / 2 + 8 * k),
        top + row * (bh + 12 * k),
        label,
        fn,
        bw,
        bh,
      );
      if (icon) b.setIcon(icon);
    });
    this.input.keyboard?.on('keydown-ESC', () => this.scene.stop());
  }

  /** Закрыть паузу и открыть экран мира (навыки, журнал, карта). */
  private open(key: string): void {
    this.scene.stop();
    this.scene.launch(key);
  }
}
