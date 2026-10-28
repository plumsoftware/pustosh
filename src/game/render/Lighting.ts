import Phaser from 'phaser';
import type { DayNightState } from '../../core/systems/DayNight';
import { DEPTH } from './ChunkView';
import { LIGHT_TEX_R, TEX } from './textures';

/** Цвета маски (ANIMATIONS §5): ночь тёмно-синяя 85%, закат тёплый, кровавая ночь красноватая. */
const NIGHT = 0x0a1233;
const NIGHT_ALPHA = 0.85;
const WARM = 0xff7a2e;
const WARM_ALPHA = 0.28;
const BLOOD = 0x3d0710;
/** Пульс в начале кровавой ночи: длительность, с; частота, Гц. */
const BLOOD_PULSE_SEC = 6;
const BLOOD_PULSE_HZ = 1.2;
/** Разрешение маски — доля экрана (ТЗ 3.5.3: 1/2 или 1/4). */
const MASK_SCALE = 0.5;

export interface LightSource {
  /** Мировые координаты, px. */
  x: number;
  y: number;
  /** Радиус, px. */
  r: number;
}

function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const r = Math.round(ar + (((b >> 16) & 255) - ar) * t);
  const g = Math.round(ag + (((b >> 8) & 255) - ag) * t);
  const bl = Math.round(ab + ((b & 255) - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Цвет и альфа маски для состояния суток (используется и галереей анимаций). */
export function maskColor(s: Pick<DayNightState, 'darkness' | 'warm' | 'bloodNight' | 'nightElapsed'>): {
  color: number;
  alpha: number;
} {
  const night = s.bloodNight ? BLOOD : NIGHT;
  const wt = s.warm / Math.max(1e-3, s.warm + s.darkness);
  let alpha = Math.max(NIGHT_ALPHA * s.darkness, WARM_ALPHA * s.warm);
  if (s.bloodNight && s.nightElapsed >= 0 && s.nightElapsed < BLOOD_PULSE_SEC) {
    const fade = 1 - s.nightElapsed / BLOOD_PULSE_SEC;
    alpha = Math.min(
      0.95,
      alpha + 0.1 * fade * (0.5 + 0.5 * Math.sin(s.nightElapsed * BLOOD_PULSE_HZ * Math.PI * 2)),
    );
  }
  return { color: mix(night, WARM, wt), alpha };
}

/**
 * Маска освещения поверх мира: RenderTexture в половинном разрешении, растянутая на экран.
 * Каждый кадр — заливка цветом фазы суток и стирание мягких кругов света.
 */
export class Lighting {
  private rt: Phaser.GameObjects.RenderTexture;
  private readonly stamp: Phaser.GameObjects.Image;
  lastCostMs = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly cam: Phaser.Cameras.Scene2D.Camera,
  ) {
    this.rt = this.makeRt();
    this.stamp = scene.make.image({ key: TEX.light, add: false });
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
  }

  private makeRt(): Phaser.GameObjects.RenderTexture {
    const { width, height } = this.scene.scale;
    return this.scene.add
      .renderTexture(0, 0, Math.ceil(width * MASK_SCALE), Math.ceil(height * MASK_SCALE))
      .setOrigin(0)
      .setScrollFactor(0)
      .setScale(1 / MASK_SCALE)
      .setDepth(DEPTH.lighting);
  }

  private onResize(): void {
    this.rt.destroy();
    this.rt = this.makeRt();
  }

  /** Объект маски — чтобы отдельные камеры могли его игнорировать. */
  get gameObject(): Phaser.GameObjects.RenderTexture {
    return this.rt;
  }

  update(state: DayNightState, lights: readonly LightSource[]): void {
    const t0 = performance.now();
    const { color, alpha } = maskColor(state);
    if (alpha < 0.01) {
      this.rt.setVisible(false);
      this.lastCostMs = 0;
      return;
    }
    this.rt.setVisible(true);
    this.rt.clear();
    this.rt.fill(color, alpha);
    // Свет нужен, только когда темно; на закате круги слабее.
    if (state.darkness > 0.02) {
      const cam = this.cam;
      const view = cam.worldView;
      const k = cam.zoom * MASK_SCALE;
      this.stamp.setAlpha(Math.min(1, state.darkness * 1.2));
      for (const l of lights) {
        const sx = (l.x - view.x) * k;
        const sy = (l.y - view.y) * k;
        const r = l.r * k;
        if (sx + r < 0 || sy + r < 0 || sx - r > this.rt.width || sy - r > this.rt.height) continue;
        this.stamp.setScale(r / LIGHT_TEX_R);
        this.rt.erase(this.stamp, sx, sy);
      }
    }
    this.lastCostMs = performance.now() - t0;
  }

  destroy(): void {
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.rt.destroy();
    this.stamp.destroy();
  }
}
