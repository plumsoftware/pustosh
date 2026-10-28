import Phaser from 'phaser';
import type { Registry } from '../../core/data/Registry';
import { needsFuel, type StationState, type Stations } from '../../core/systems/Craft';
import type { WorldObject } from '../../core/world';
import { spawnSprite } from '../assets/spawnSprite';
import { DEPTH, type ChunkView, type ObjView } from '../render/ChunkView';
import * as Fx from '../render/Fx';
import { TILE } from '../render/GroundTiles';
import { TEX } from '../render/textures';

/** Индикатор прогресса над станком, px. */
const BAR_W = 30;
const BAR_H = 4;
/** Подпрыгивание значка готовности (ANIMATIONS §8, §11): высота, px, и период, мс. */
const READY_HOP = 6;
const READY_PERIOD = 700;
/** Пульс свечения горна и плавильни, мс. */
const HOT_PERIOD = 1400;
/** Как часто искры/дым (мс): костёр, горн, генератор. */
const SPARK_EVERY = { campfire: 260, hot: 900, smoke: 700 } as const;
const GARDEN_STAGES = ['empty', 'sprouts', 'ripe'] as const;

interface Overlay {
  uid: string;
  view: ObjView;
  bar?: [Phaser.GameObjects.Rectangle, Phaser.GameObjects.Rectangle];
  ready?: Phaser.GameObjects.Image;
  readyId?: string;
  hot?: Phaser.GameObjects.Image;
  lamp?: Phaser.GameObjects.Image;
  nextSpark: number;
  nextSmoke: number;
}

/** Как выглядит станок сейчас: спрайт, свет, горит ли, работает ли. */
export interface StationLook {
  sprite: string;
  light: number | undefined;
  burning: boolean;
  working: boolean;
  progress: number | null;
}

export function stationLook(reg: Registry, stations: Stations, o: WorldObject, now: number): StationLook {
  const def = reg.stations.require(o.ref.id);
  const st = stations.get(o.uid);
  // Костёр из префаба (state on) — горит без топлива, пока его не трогали.
  const eternal = o.ref.type === 'station' && o.ref.state === 'on' && !st;
  const burning = eternal || (!!st && stations.burning(st));
  const head = st?.queue[0];
  const working = !!st && !!head && stations.blockedBy(st) === null;
  let sprite = def.sprite;
  if (o.ref.id === 'garden' && st) {
    sprite = def.stateSprites?.[GARDEN_STAGES[stations.gardenStage(st, now)]] ?? sprite;
  } else if (def.stateSprites?.['on'] && def.stateSprites['off']) {
    sprite = burning ? def.stateSprites['on'] : def.stateSprites['off'];
  }
  const light = o.ref.id === 'campfire' && burning ? reg.worldgen.lights.campfireRadiusTiles : undefined;
  return { sprite, light, burning, working, progress: head ? 1 - head.left / head.total : null };
}

/**
 * Визуал станков (ANIMATIONS §8): костёр — пламя, искры, дым; горн и плавильня — оранжевое свечение
 * и искры, когда работают; генератор — дрожь ±1 px, дым, мигающая лампа; индикатор прогресса над
 * работающим станком; значок готового предмета подпрыгивает; грядка — 3 стадии с отскоком.
 */
export class StationViews {
  private overlays = new Map<string, Overlay>();
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private smoke: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly reg: Registry,
    private readonly stations: Stations,
  ) {
    this.sparks = Fx.particles(scene, ['effects.spark_1', 'effects.spark_2'], {
      tint: 0xffb040,
      lifespan: 700,
      speed: { min: 20, max: 60 },
      angle: { min: 250, max: 290 },
      scale: { start: 0.12, end: 0 },
      gravityY: -40,
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(DEPTH.glow);
    this.smoke = Fx.particles(scene, ['effects.smoke_1', 'effects.smoke_2'], {
      lifespan: 1800,
      speed: { min: 6, max: 16 },
      angle: { min: 255, max: 285 },
      scale: { start: 0.18, end: 0.45 },
      alpha: { start: 0.45, end: 0 },
      gravityY: -10,
    }).setDepth(DEPTH.glow - 1);
  }

  /** Спрайт и свет станка по состоянию; true — объект поменялся (нужна перерисовка вида). */
  sync(o: WorldObject, now: number): boolean {
    const look = stationLook(this.reg, this.stations, o, now);
    if (look.sprite === o.sprite && look.light === o.light) return false;
    o.sprite = look.sprite;
    o.light = look.light;
    return true;
  }

  /** Кадр: оверлеи у видимых станков. */
  update(time: number, views: Iterable<ChunkView>, now: number, refresh: (o: WorldObject) => void): void {
    const alive = new Set<string>();
    for (const cv of views) {
      for (const v of cv.objects) {
        const o = v.obj;
        if (o.ref.type !== 'station') continue;
        const st = this.stations.get(o.uid);
        const eternal = o.ref.state === 'on' && !st;
        if (!st && !eternal && o.ref.id !== 'base_core') continue;
        if (this.sync(o, now)) {
          refresh(o);
          const nv = cv.findView(o.uid);
          if (nv && o.ref.id === 'garden') Fx.popIn(this.scene, nv.img);
          continue; // вид пересоздан — оверлей догонит в следующем кадре
        }
        alive.add(o.uid);
        this.drawOverlay(v, st, time, now);
      }
    }
    for (const [uid, ov] of this.overlays) {
      if (alive.has(uid)) continue;
      this.drop(ov);
      this.overlays.delete(uid);
    }
  }

  private drawOverlay(v: ObjView, st: StationState | undefined, time: number, now: number): void {
    const o = v.obj;
    let ov = this.overlays.get(o.uid);
    if (!ov || ov.view !== v) {
      if (ov) this.drop(ov);
      ov = { uid: o.uid, view: v, nextSpark: 0, nextSmoke: 0 };
      this.overlays.set(o.uid, ov);
    }
    const look = stationLook(this.reg, this.stations, o, now);
    const img = v.img;
    const top = img.y - img.displayHeight;
    const depth = img.depth + 0.3;
    const visible = img.visible;

    // Индикатор прогресса — только у работающего станка.
    if (look.working && look.progress !== null && visible) {
      if (!ov.bar) {
        const bg = this.scene.add.rectangle(0, 0, BAR_W + 2, BAR_H + 2, 0x000000, 0.65).setOrigin(0, 0.5);
        const fill = this.scene.add.rectangle(0, 0, BAR_W, BAR_H, 0x7ed957).setOrigin(0, 0.5);
        ov.bar = [bg, fill];
      }
      const [bg, fill] = ov.bar;
      bg.setPosition(img.x - BAR_W / 2 - 1, top - 6).setDepth(depth);
      fill
        .setPosition(img.x - BAR_W / 2, top - 6)
        .setDepth(depth + 0.01)
        .setSize(Math.max(1, BAR_W * Phaser.Math.Clamp(look.progress, 0, 1)), BAR_H);
    } else if (ov.bar) {
      ov.bar.forEach((r) => r.destroy());
      ov.bar = undefined;
    }

    // Значок готового предмета подпрыгивает.
    const out = st?.output[0];
    if (out && visible) {
      if (!ov.ready || ov.readyId !== out.id) {
        ov.ready?.destroy();
        const icon = this.reg.items.get(out.id)?.icon;
        ov.ready = icon ? spawnSprite(this.scene, 0, 0, icon, { depth: false }) : undefined;
        ov.ready?.setScale(22 / Math.max(ov.ready.frame.width, ov.ready.frame.height));
        ov.readyId = out.id;
      }
      const hop = Math.abs(Math.sin((time / READY_PERIOD) * Math.PI)) * READY_HOP;
      ov.ready?.setPosition(img.x, top - (look.working ? 18 : 8) - hop).setDepth(depth + 0.02);
    } else if (ov.ready) {
      ov.ready.destroy();
      ov.ready = undefined;
      ov.readyId = undefined;
    }

    const id = o.ref.id;
    const fx = this.reg.craft.fx;
    // Горн и плавильня: оранжевое свечение пульсом и редкие искры, когда работают.
    if (fx.hot.includes(id)) {
      const on = look.working && visible;
      if (on && !ov.hot) {
        ov.hot = this.scene.add
          .image(img.x, img.y - img.displayHeight * 0.35, TEX.glow)
          .setDisplaySize(img.displayWidth * 1.3, img.displayWidth * 1.3)
          .setTint(0xff7a1a)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(DEPTH.glow);
      } else if (!on && ov.hot) {
        ov.hot.destroy();
        ov.hot = undefined;
      }
      if (ov.hot) ov.hot.setAlpha(0.45 + 0.3 * Math.sin((time / HOT_PERIOD) * Math.PI * 2));
      if (on && time >= ov.nextSpark) {
        ov.nextSpark = time + SPARK_EVERY.hot * (0.6 + Math.random() * 0.8);
        this.sparks.explode(2, img.x, img.y - img.displayHeight * 0.6);
      }
    }
    // Костёр: искры вверх и дым (пламя рисует ChunkView, мерцание света — WorldScene).
    if (id === 'campfire' && look.burning && visible) {
      if (time >= ov.nextSpark) {
        ov.nextSpark = time + SPARK_EVERY.campfire * (0.5 + Math.random());
        this.sparks.explode(1, img.x + (Math.random() - 0.5) * 10, img.y - 20);
      }
      if (time >= ov.nextSmoke) {
        ov.nextSmoke = time + SPARK_EVERY.smoke * (0.7 + Math.random() * 0.6);
        this.smoke.explode(1, img.x, img.y - 34);
      }
    }
    // Генератор: дрожь ±1 px, дым из трубы, мигающая лампа.
    if (fx.vibrate.includes(id)) {
      const base = o.x * TILE;
      if (look.burning && visible) {
        img.x = base + (Math.floor(time / 50) % 2 === 0 ? 1 : -1);
        if (time >= ov.nextSmoke) {
          ov.nextSmoke = time + SPARK_EVERY.smoke;
          this.smoke.explode(1, base + img.displayWidth * 0.25, top + 4);
        }
        if (!ov.lamp) ov.lamp = this.scene.add.image(0, 0, TEX.dot).setDisplaySize(5, 5).setTint(0x60ff60);
        ov.lamp
          .setPosition(base - img.displayWidth * 0.25, img.y - img.displayHeight * 0.55)
          .setDepth(depth)
          .setVisible(Math.floor(time / 500) % 2 === 0);
      } else {
        img.x = base;
        ov.lamp?.destroy();
        ov.lamp = undefined;
      }
    }
    // Тотем базы: мигающая красная лампа (кольцо радиуса базы — в режиме строительства, шаг 7).
    if (id === 'base_core' && visible) {
      if (!ov.lamp) ov.lamp = this.scene.add.image(0, 0, TEX.dot).setDisplaySize(7, 7).setTint(0xff3030);
      ov.lamp
        .setPosition(img.x, top + 6)
        .setDepth(depth)
        .setAlpha(0.35 + 0.65 * Math.abs(Math.sin((time / 900) * Math.PI)));
    }
    // Грядка: созревшее слегка покачивается.
    if (id === 'garden' && st && this.stations.gardenStage(st, now) === 2) {
      img.setAngle(Math.sin(time / 600) * 2);
    }
    // Станок без топлива с заданиями: значок «нет топлива» — тусклый тинт.
    if (st && needsFuel(this.reg, id) && st.queue.length > 0 && this.stations.blockedBy(st) === 'fuel')
      img.setTint(0x9a9a9a);
    else if (img.tintTopLeft === 0x9a9a9a) img.clearTint();
  }

  private drop(ov: Overlay): void {
    ov.bar?.forEach((r) => r.destroy());
    ov.ready?.destroy();
    ov.hot?.destroy();
    ov.lamp?.destroy();
  }

  destroy(): void {
    for (const ov of this.overlays.values()) this.drop(ov);
    this.overlays.clear();
    this.sparks.destroy();
    this.smoke.destroy();
  }
}
