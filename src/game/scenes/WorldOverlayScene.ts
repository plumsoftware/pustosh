import Phaser from 'phaser';
import { Lighting } from '../render/Lighting';
import { SceneKeys } from '../SceneKeys';
import { UI_FONT } from '../ui/BitmapFont';
import type { WorldScene } from './WorldScene';

/**
 * Экранный слой над миром (камера без зума): маска освещения и отладочный текст мира.
 * Свет рассчитывается по камере WorldScene.
 */
export class WorldOverlayScene extends Phaser.Scene {
  lighting: Lighting | null = null;
  private debugText!: Phaser.GameObjects.BitmapText;
  private debugBg!: Phaser.GameObjects.Rectangle;

  constructor() {
    super(SceneKeys.WorldOverlay);
  }

  create(): void {
    const world = this.scene.get(SceneKeys.World) as WorldScene;
    this.lighting = new Lighting(this, world.cameras.main);
    this.debugBg = this.add
      .rectangle(4, 4, 10, 10, 0x000000, 0.65)
      .setOrigin(0)
      .setDepth(9)
      .setVisible(false);
    this.debugText = this.add
      .bitmapText(8, 8, UI_FONT, '', 13)
      .setTint(0xf2e6c9)
      .setDepth(10)
      .setVisible(false);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.lighting?.destroy();
      this.lighting = null;
    });
  }

  setDebugText(text: string): void {
    if (!this.debugText) return;
    this.debugText.setText(text).setVisible(text.length > 0);
    this.debugBg.setVisible(text.length > 0).setSize(this.debugText.width + 8, this.debugText.height + 8);
  }
}
