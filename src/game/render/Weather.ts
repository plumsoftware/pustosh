import Phaser from 'phaser';
import type { WeatherEffects } from '../../core/systems/Survival';
import { getAssetInfo } from '../assets/AssetIndex';

/** Описание вида погоды (worldgen.json → weather.types). */
interface WeatherType {
  sprite: string;
  perSec: number;
  sizePx: [number, number];
  speed: [number, number];
  angleDeg: number;
  alpha: number;
  /** Откуда летят частицы: сверху, слева или в любой точке экрана. */
  from: 'top' | 'left' | 'any';
  spin?: boolean;
  splash?: string;
  splashPerSec?: number;
  /** Цвет частиц (#rrggbb). */
  tint?: string;
  /** Затемнение экрана при этой погоде (0–1) и его цвет. */
  dim?: number;
  dimColor?: string;
  /** Влияние на героя и врагов. */
  effects?: WeatherEffects & { speedMul?: number; senseMul?: number };
  /** Видимость, тайлы: дальше — темно (песчаная буря). */
  visionTiles?: number;
  /** Значок у часов. */
  icon?: string;
}

export type WeatherFx = NonNullable<WeatherType['effects']>;

/** Текстура тумана бури: прозрачный круг радиусом FOG_CLEAR, к FOG_DARK — непрозрачно, дальше тоже. */
const FOG_SIZE = 256;
const FOG_CLEAR = 18;
const FOG_DARK = 30;

function fogTexture(scene: Phaser.Scene): string {
  const key = 'fx-weather-fog';
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, FOG_SIZE, FOG_SIZE)!;
  const c = tex.context;
  const h = FOG_SIZE / 2;
  const g = c.createRadialGradient(h, h, FOG_CLEAR, h, h, FOG_DARK);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  c.fillStyle = g;
  c.fillRect(0, 0, FOG_SIZE, FOG_SIZE);
  tex.refresh();
  return key;
}

export interface WeatherDef {
  changeEverySec: number;
  biomes: Record<string, [string, number][]>;
  types: Record<string, WeatherType>;
}

/**
 * Погода (ANIMATIONS §5, лист s32): частицы в экранном слое над миром (WorldOverlay, под маской
 * света — ночью темнеют). Вид выбирается по биому героя раз в changeEverySec игровых секунд;
 * при смене старые частицы долетают, новые плавно набирают плотность.
 */
export class Weather {
  private kind = 'clear';
  private nextAt = -1;
  private biome = 0;
  private emitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private splash: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private shade: Phaser.GameObjects.Rectangle | null = null;
  private fog: Phaser.GameObjects.Image | null = null;
  /** Смена погоды: вид (для значка и уведомления). */
  onChange: ((kind: string, icon: string | null) => void) | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly def: WeatherDef,
    private readonly depth: number,
  ) {}

  get current(): string {
    return this.kind;
  }

  /** Влияние текущей погоды (для ясной — пусто). */
  get effects(): WeatherFx {
    return this.def.types[this.kind]?.effects ?? {};
  }

  get icon(): string | null {
    return this.def.types[this.kind]?.icon ?? null;
  }

  /**
   * Кадр: биом героя, игровое время (с), точка героя на экране и px на тайл — для видимости в буре.
   * В укрытии видимость не ограничивается.
   */
  update(biome: number, nowSec: number, sx = 0, sy = 0, tilePx = 64, sheltered = false): void {
    if (biome !== this.biome || nowSec >= this.nextAt) {
      this.biome = biome;
      this.nextAt = nowSec + this.def.changeEverySec;
      this.set(this.roll(biome));
    }
    const vt = this.def.types[this.kind]?.visionTiles;
    if (this.fog) {
      // Туман прозрачен до FOG_CLEAR/FOG_SIZE размера — это и есть радиус видимости.
      const d = ((vt ?? 4) * tilePx * FOG_SIZE) / FOG_CLEAR;
      this.fog
        .setPosition(sx, sy)
        .setDisplaySize(d, d)
        .setVisible(!!vt && !sheltered);
    }
    // Под крышей погоды не видно (частицы и затемнение — экранные).
    for (const o of [this.emitter, this.splash]) o?.setVisible(!sheltered);
    // Туман уже затемняет экран — второй полноэкранный слой на телефоне стоит ~10 FPS.
    this.shade?.setVisible(!sheltered && !this.fog?.visible);
  }

  /** Принудительно (отладка, галерея). */
  set(kind: string): void {
    if (kind === this.kind && (this.emitter || kind === 'clear')) return;
    this.kind = kind;
    this.stop();
    const t = this.def.types[kind];
    this.fadeShade(t?.dim ?? 0, t?.dimColor);
    this.onChange?.(kind, t?.icon ?? null);
    if (t?.visionTiles && !this.fog) {
      this.fog = this.scene.add
        .image(0, 0, fogTexture(this.scene))
        .setTint(Phaser.Display.Color.HexStringToColor(t.dimColor ?? '#6a4a20').color)
        .setDepth(this.depth - 0.5)
        .setAlpha(0);
      this.scene.tweens.add({ targets: this.fog, alpha: 0.95, duration: 2000 });
    } else if (!t?.visionTiles && this.fog) {
      const f = this.fog;
      this.fog = null;
      this.scene.tweens.add({ targets: f, alpha: 0, duration: 1500, onComplete: () => f.destroy() });
    }
    if (!t) return;
    const info = getAssetInfo(t.sprite);
    if (!info) return;
    const { width, height } = this.scene.scale;
    const side = Math.max(info.size[0], info.size[1]) * 2; // кадр в атласе — 2x
    const zone =
      t.from === 'top'
        ? new Phaser.Geom.Rectangle(-width * 0.3, -40, width * 1.4, 10)
        : t.from === 'left'
          ? new Phaser.Geom.Rectangle(-t.sizePx[1], 0, 10, height)
          : new Phaser.Geom.Rectangle(0, 0, width, height);
    const travel = t.from === 'left' ? width + t.sizePx[1] * 2 : height + 80;
    const life = t.from === 'any' ? 9000 : (travel / t.speed[0]) * 1000;
    this.emitter = this.scene.add
      .particles(0, 0, info.group, {
        frame: info.frame,
        emitZone: {
          type: 'random',
          source: zone,
          quantity: 1,
        } as Phaser.Types.GameObjects.Particles.EmitZoneData,
        speed: { min: t.speed[0], max: t.speed[1] },
        angle: { min: t.angleDeg - 3, max: t.angleDeg + 3 },
        scale: { min: t.sizePx[0] / side, max: t.sizePx[1] / side },
        rotate: t.spin ? { start: 0, end: 360 } : 0,
        alpha:
          t.from === 'any'
            ? { onUpdate: (_p: unknown, _k: string, tt: number) => Math.sin(tt * Math.PI) * t.alpha }
            : t.alpha,
        lifespan: life,
        frequency: 1000 / t.perSec,
        quantity: 1,
        tint: t.tint ? Phaser.Display.Color.HexStringToColor(t.tint).color : 0xffffff,
      })
      .setDepth(this.depth);
    // Брызги дождя по всему экрану.
    const sp = t.splash ? getAssetInfo(t.splash) : null;
    if (sp)
      this.splash = this.scene.add
        .particles(0, 0, sp.group, {
          frame: sp.frame,
          emitZone: {
            type: 'random',
            source: new Phaser.Geom.Rectangle(0, height * 0.15, width, height * 0.85),
            quantity: 1,
          } as Phaser.Types.GameObjects.Particles.EmitZoneData,
          scale: { start: 8 / side, end: 18 / side },
          alpha: { start: 0.6, end: 0 },
          lifespan: 350,
          frequency: 1000 / (t.splashPerSec ?? 8),
        })
        .setDepth(this.depth);
  }

  /** Затемнение экрана плавно за 2 с (один прямоугольник на весь экран). */
  private fadeShade(alpha: number, color = '#000000'): void {
    const { width, height } = this.scene.scale;
    if (!this.shade)
      this.shade = this.scene.add
        .rectangle(0, 0, width, height, 0x000000, 1)
        .setOrigin(0)
        .setAlpha(0)
        .setDepth(this.depth - 1);
    this.shade.setFillStyle(Phaser.Display.Color.HexStringToColor(color).color, 1);
    this.scene.tweens.killTweensOf(this.shade);
    this.scene.tweens.add({ targets: this.shade, alpha, duration: 2000 });
  }

  private roll(biome: number): string {
    const opts = this.def.biomes[String(biome)] ?? [['clear', 1]];
    const sum = opts.reduce((a, [, w]) => a + w, 0);
    let r = Math.random() * sum;
    for (const [k, w] of opts) if ((r -= w) <= 0) return k;
    return opts[0]![0];
  }

  private stop(): void {
    for (const e of [this.emitter, this.splash]) {
      if (!e) continue;
      e.stop();
      this.scene.time.delayedCall(10000, () => e.destroy());
    }
    this.emitter = null;
    this.splash = null;
  }

  destroy(): void {
    this.fog?.destroy();
    this.fog = null;
    this.shade?.destroy();
    this.shade = null;
    this.emitter?.destroy();
    this.splash?.destroy();
    this.emitter = null;
    this.splash = null;
  }
}
