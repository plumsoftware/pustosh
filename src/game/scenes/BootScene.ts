import Phaser from 'phaser';
import { SceneKeys } from '../SceneKeys';
import { ensureBitmapFonts } from '../ui/BitmapFont';

/** Первая сцена: запускает отладочный оверлей и загрузку. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Boot);
  }

  create(): void {
    ensureBitmapFonts(this);
    this.scene.launch(SceneKeys.Debug);
    this.scene.start(SceneKeys.Preload);
  }
}
