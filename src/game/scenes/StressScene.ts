import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import { assetIdsInGroup, getAssetInfo } from '../assets/AssetIndex';
import { spawnSprite } from '../assets/spawnSprite';
import { ctx, registry } from '../GameContext';
import { SceneKeys } from '../SceneKeys';
import { UI_FONT_MONO } from '../ui/BitmapFont';
import { LOGICAL_H, LOGICAL_W } from '../ui/layout';

/** Параметры замера из ТЗ шаг 1.7 (тестовая сцена, не баланс). */
const SCREENS = 3;
const OBJECTS = 300;
const ENEMIES = 40;
const PARTICLES = 100;
const ENEMY_ID = 'characters.enemies.walker_idle';
const WARMUP_MS = 2000;
const MEASURE_MS = 15000;

export interface StressResult {
  avgFps: number;
  minFps: number;
  p1LowFps: number;
  frames: number;
  /** Время кадра на CPU (логика + подготовка рендера), мс: среднее и 99-й перцентиль. */
  cpuMsAvg: number;
  cpuMsP99: number;
  renderer: string;
  size: string;
}

declare global {
  interface Window {
    __pustoshStress?: StressResult;
  }
}

/**
 * Временная сцена замера производительности (ТЗ 1.7): 3×3 экрана тайлов, 300 объектов биома 1 с
 * Y-сортировкой каждый кадр, 40 «врагов» с движением, маска ночи с мягким кругом, 100 частиц.
 */
export class StressScene extends Phaser.Scene {
  private sorted: Phaser.GameObjects.Image[] = [];
  private enemies: {
    img: Phaser.GameObjects.Image;
    vx: number;
    vy: number;
    phase: number;
    baseScaleY: number;
  }[] = [];
  private night!: Phaser.GameObjects.RenderTexture;
  private light!: Phaser.GameObjects.Image;
  private hud!: Phaser.GameObjects.BitmapText;
  private frameTimes: number[] = [];
  private cpuTimes: number[] = [];
  private frameStart = 0;
  private elapsed = 0;
  private worldW = 0;
  private worldH = 0;

  constructor() {
    super(SceneKeys.Stress);
  }

  create(): void {
    this.sorted = [];
    this.enemies = [];
    this.frameTimes = [];
    this.cpuTimes = [];
    this.elapsed = 0;
    const onPre = () => (this.frameStart = performance.now());
    const onPost = () => {
      if (this.elapsed > WARMUP_MS && this.elapsed <= WARMUP_MS + MEASURE_MS)
        this.cpuTimes.push(performance.now() - this.frameStart);
    };
    this.game.events.on(Phaser.Core.Events.PRE_STEP, onPre);
    this.game.events.on(Phaser.Core.Events.POST_RENDER, onPost);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.PRE_STEP, onPre);
      this.game.events.off(Phaser.Core.Events.POST_RENDER, onPost);
    });
    const tilePx = registry().balance.world.tilePx;
    this.worldW = LOGICAL_W * SCREENS;
    this.worldH = LOGICAL_H * SCREENS;
    const rnd = new Phaser.Math.RandomDataGenerator(['stress']);

    // Тайлы: по одной RenderTexture на экран (так будет устроен чанк на шаге 3).
    const tiles = registry()
      .biomes.get(1)!
      .tiles.map((n) => `tiles.${n}`);
    const cols = Math.ceil(LOGICAL_W / tilePx);
    const rows = Math.ceil(LOGICAL_H / tilePx);
    for (let sy = 0; sy < SCREENS; sy++) {
      for (let sx = 0; sx < SCREENS; sx++) {
        const rt = this.add
          .renderTexture(sx * LOGICAL_W, sy * LOGICAL_H, LOGICAL_W, LOGICAL_H)
          .setOrigin(0)
          .setDepth(-1e6);
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const id = rnd.pick(tiles);
            const info = getAssetInfo(id)!;
            const stamp = this.make
              .image({ key: info.group, frame: info.frame }, false)
              .setOrigin(0)
              .setScale(tilePx / 128);
            rt.draw(stamp, x * tilePx, y * tilePx);
            stamp.destroy();
          }
        }
      }
    }

    // 300 объектов биома 1
    const objects = assetIdsInGroup('biome1');
    for (let i = 0; i < OBJECTS; i++) {
      this.sorted.push(
        spawnSprite(
          this,
          rnd.between(32, this.worldW - 32),
          rnd.between(64, this.worldH - 8),
          rnd.pick(objects),
        ),
      );
    }

    // 40 врагов
    for (let i = 0; i < ENEMIES; i++) {
      const img = spawnSprite(this, rnd.between(0, this.worldW), rnd.between(0, this.worldH), ENEMY_ID, {
        scale: 1,
      });
      // Часть рига: логический размер → рост 96 px (как в rigs.json → bodyHeightPx).
      const k = registry().rigs.humanoid['bodyHeightPx'] as number;
      img.setScale(k / img.frame.height);
      this.enemies.push({
        img,
        vx: rnd.realInRange(-60, 60),
        vy: rnd.realInRange(-40, 40),
        phase: rnd.frac() * 6,
        baseScaleY: img.scaleY,
      });
      this.sorted.push(img);
    }

    // 100 частиц (эффекты рисуются в режиме сложения цветов)
    const fx = getAssetInfo('effects.spark_1') ?? getAssetInfo(assetIdsInGroup('effects')[0]!)!;
    this.add
      .particles(this.worldW / 2, this.worldH / 2, fx.group, {
        frame: fx.frame,
        lifespan: 2000,
        speed: { min: 20, max: 120 },
        scale: { start: 0.35, end: 0 },
        alpha: { start: 1, end: 0 },
        blendMode: Phaser.BlendModes.ADD,
        frequency: 20,
        maxAliveParticles: PARTICLES,
        emitZone: {
          type: 'random',
          source: new Phaser.Geom.Rectangle(-600, -400, 1200, 800),
          quantity: 1,
        } as Phaser.Types.GameObjects.Particles.EmitZoneData,
      })
      .setDepth(1e6);

    // Маска ночи: тёмная RenderTexture на экран, мягкий круг света стирается каждый кадр.
    const { width, height } = this.scale;
    this.night = this.add.renderTexture(0, 0, width, height).setOrigin(0).setScrollFactor(0).setDepth(2e6);
    this.light = this.make.image({ key: this.makeLightTexture(), add: false });

    // Мир виден одинаково при любом масштабе рендера: зум камеры = renderScale.
    const cam = this.cameras.main;
    cam.setZoom(ctx().renderScale);
    cam.setBounds(0, 0, this.worldW, this.worldH);
    cam.setBackgroundColor('#000000');

    this.hud = this.add
      .bitmapText(8, this.scale.height - 8, UI_FONT_MONO, '', 13)
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(3e6);
    // Ночь и подпись — на отдельной экранной камере без зума.
    const overlay = this.cameras.add(0, 0, width, height);
    for (const o of this.children.list) if (o !== this.night && o !== this.hud) overlay.ignore(o);
    cam.ignore([this.night, this.hud]);
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start(SceneKeys.MainMenu));
    window.__pustoshStress = undefined;
  }

  private makeLightTexture(): string {
    const key = 'stress-light';
    if (this.textures.exists(key)) return key;
    const r = 260;
    const tex = this.textures.createCanvas(key, r * 2, r * 2)!;
    const g = tex.context.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    tex.context.fillStyle = g;
    tex.context.fillRect(0, 0, r * 2, r * 2);
    tex.refresh();
    return key;
  }

  override update(time: number, delta: number): void {
    const dt = delta / 1000;
    for (const e of this.enemies) {
      const img = e.img;
      img.x += e.vx * dt;
      img.y += e.vy * dt;
      if (img.x < 0 || img.x > this.worldW) e.vx = -e.vx;
      if (img.y < 0 || img.y > this.worldH) e.vy = -e.vy;
      img.setFlipX(e.vx < 0);
      img.scaleY = e.baseScaleY * (1 + Math.sin(time / 180 + e.phase) * 0.03);
      img.rotation = Math.sin(time / 260 + e.phase) * 0.05;
    }
    // Y-сортировка каждый кадр
    for (const s of this.sorted) s.setDepth(s.y);

    // Камера облетает 3×3 экрана
    const cam = this.cameras.main;
    const a = time / 6000;
    cam.centerOn(
      this.worldW / 2 + Math.cos(a) * this.worldW * 0.3,
      this.worldH / 2 + Math.sin(a * 1.3) * this.worldH * 0.3,
    );

    // Ночь
    const { width, height } = this.scale;
    this.night.clear();
    this.night.fill(0x05070f, 0.82);
    this.night.erase(this.light, width / 2, height / 2); // origin 0.5 — по центру экрана

    this.measure(delta);
  }

  private measure(delta: number): void {
    this.elapsed += delta;
    if (this.elapsed > WARMUP_MS && this.elapsed <= WARMUP_MS + MEASURE_MS) this.frameTimes.push(delta);
    const fps = this.game.loop.actualFps;
    let line = `${t('stress.title', { objects: OBJECTS, enemies: ENEMIES, particles: PARTICLES })} · FPS ${fps.toFixed(0)} · ${t('stress.exit')}`;
    if (this.elapsed > WARMUP_MS + MEASURE_MS) {
      if (!window.__pustoshStress) window.__pustoshStress = this.result();
      const r = window.__pustoshStress;
      line += `\nИтог ${MEASURE_MS / 1000} с: средний ${r.avgFps.toFixed(1)}, мин ${r.minFps.toFixed(1)}, 1% low ${r.p1LowFps.toFixed(1)}, CPU ${r.cpuMsAvg.toFixed(1)} мс (p99 ${r.cpuMsP99.toFixed(1)}) (${r.renderer}, ${r.size})`;
    }
    this.hud.setText(line);
  }

  private result(): StressResult {
    const ft = [...this.frameTimes].sort((a, b) => b - a);
    const total = ft.reduce((s, x) => s + x, 0);
    const p1 = ft.slice(0, Math.max(1, Math.floor(ft.length / 100)));
    const cpu = [...this.cpuTimes].sort((a, b) => a - b);
    return {
      avgFps: (ft.length * 1000) / total,
      minFps: 1000 / (ft[0] ?? 1),
      p1LowFps: (p1.length * 1000) / p1.reduce((s, x) => s + x, 0),
      frames: ft.length,
      cpuMsAvg: cpu.reduce((a, x) => a + x, 0) / Math.max(1, cpu.length),
      cpuMsP99: cpu[Math.floor(cpu.length * 0.99)] ?? 0,
      renderer: this.game.renderer.type === Phaser.WEBGL ? 'WebGL' : 'Canvas',
      size: `${this.scale.width}×${this.scale.height}`,
    };
  }
}
