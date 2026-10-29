import Phaser from 'phaser';
import { SceneKeys } from '../SceneKeys';
import { ensureBitmapFonts } from '../ui/BitmapFont';

export const LOADING_ART = 'brand-loading';

/** Первая сцена: запускает отладочный оверлей и загрузку. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Boot);
  }

  /** Картина экрана загрузки (npm run brand → public/brand/loading.jpg) — до атласов. */
  preload(): void {
    this.load.image(LOADING_ART, 'brand/loading.jpg');
  }

  create(): void {
    ensureBitmapFonts(this);
    this.scene.launch(SceneKeys.Debug);
    this.scene.start(SceneKeys.Preload);
  }
}
