import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import { ctx } from '../GameContext';
import { SceneKeys } from '../SceneKeys';
import { UI_FONT_MONO } from '../ui/BitmapFont';

const CORNER_PX = 72;
const TRIPLE_TAP_MS = 700;

/**
 * Отладочный оверлей поверх всех сцен: FPS, тики, площадка, причины паузы, версия.
 * F1 на ПК, тройной тап в левом верхнем углу на телефоне. F2 — галерея ассетов.
 */
export class DebugOverlayScene extends Phaser.Scene {
  /** BitmapText + подложка: текст меняется каждый кадр, обычный Text перезаливал бы текстуру. */
  private text!: Phaser.GameObjects.BitmapText;
  private bg!: Phaser.GameObjects.Rectangle;
  private taps: number[] = [];

  constructor() {
    super(SceneKeys.Debug);
  }

  create(): void {
    const c = ctx();
    const visible = c.debug && c.params.has('debug');
    this.bg = this.add
      .rectangle(0, 0, 10, 10, 0x000000, 0.7)
      .setOrigin(1, 1)
      .setDepth(1e9 - 1)
      .setVisible(visible);
    this.text = this.add
      .bitmapText(0, 0, UI_FONT_MONO, '', 13)
      .setTint(0xc8ffb0)
      .setOrigin(1, 1)
      .setDepth(1e9)
      .setVisible(visible);

    this.input.keyboard?.on('keydown-F1', (e: KeyboardEvent) => {
      e.preventDefault();
      this.toggle();
    });
    this.input.keyboard?.on('keydown-F2', (e: KeyboardEvent) => {
      e.preventDefault();
      this.toggleGallery();
    });
    this.input.keyboard?.on('keydown-F6', (e: KeyboardEvent) => {
      e.preventDefault();
      if (this.scene.isActive(SceneKeys.RigEditor)) return; // закрывает сам редактор
      if (ctx().registry) this.scene.launch(SceneKeys.RigEditor);
    });
    this.input.keyboard?.on('keydown-F7', (e: KeyboardEvent) => {
      e.preventDefault();
      if (this.scene.isActive(SceneKeys.AnimGallery)) this.scene.stop(SceneKeys.AnimGallery);
      else if (ctx().registry) this.scene.launch(SceneKeys.AnimGallery);
    });
    // Тройной тап в углу. Слушаем глобально (сцена оверлея не перехватывает ввод других сцен).
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      if (p.x > CORNER_PX || p.y > CORNER_PX) return;
      const now = p.downTime;
      this.taps = [...this.taps.filter((x) => now - x < TRIPLE_TAP_MS), now];
      if (this.taps.length >= 3) {
        this.taps = [];
        this.toggle();
      }
    });
    this.input.topOnly = false;
  }

  toggle(): void {
    this.text.setVisible(!this.text.visible);
    this.bg.setVisible(this.text.visible);
  }

  private toggleGallery(): void {
    if (this.scene.isActive(SceneKeys.Gallery)) this.scene.stop(SceneKeys.Gallery);
    else if (ctx().registry) this.scene.launch(SceneKeys.Gallery);
  }

  override update(): void {
    // Оверлей всегда сверху.
    if (this.scene.manager.getIndex(SceneKeys.Debug) !== this.scene.manager.getScenes(false).length - 1) {
      this.scene.bringToTop();
    }
    if (!this.text.visible) return;
    this.text.setPosition(this.scale.width - 12, this.scale.height - 12);
    const { clock, platform, version } = ctx();
    const renderer = this.game.renderer.type === Phaser.WEBGL ? 'WebGL' : 'Canvas';
    const reasons = clock.isPaused ? [...clock.pauseReasons].join(', ') : '—';
    this.text.setText(
      [
        t('debug.fps', { fps: this.game.loop.actualFps.toFixed(0) }),
        t('debug.ticks', { ticks: clock.ticks, time: clock.gameTimeSec.toFixed(1) }),
        t('debug.platform', { platform: platform.id, device: platform.device, lang: platform.language }),
        t('debug.pause', { reasons }),
        t('debug.renderer', { renderer }),
        t('debug.version', { version }),
      ].join('\n'),
    );
    this.bg
      .setPosition(this.scale.width - 6, this.scale.height - 6)
      .setSize(this.text.width + 12, this.text.height + 12);
  }
}
