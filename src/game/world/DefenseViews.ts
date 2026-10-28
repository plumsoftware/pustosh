import Phaser from 'phaser';
import type { Registry } from '../../core/data/Registry';
import { effectOf, type DefenseEvent, type Dummy } from '../../core/systems/Defense';
import type { WorldObject } from '../../core/world';
import { AssetLoader } from '../assets/AssetLoader';
import { getAssetInfo } from '../assets/AssetIndex';
import { spawnSprite } from '../assets/spawnSprite';
import { DEPTH, type ChunkView, type ObjView } from '../render/ChunkView';
import * as Fx from '../render/Fx';
import { TILE } from '../render/GroundTiles';
import { TEX } from '../render/textures';

/** Отдача головы турели, px, и её возврат, мс. */
const RECOIL_PX = 4;
const RECOIL_MS = 90;
const DUMMY_SPRITE = 'characters.enemies.walker_idle';
const DUMMY_TINT = 0xb89a6a;
const EXPLOSION_FRAMES = [1, 2, 3, 4, 5].map((i) => `effects.explosion_${i}`);

interface Head {
  uid: string;
  view: ObjView;
  img: Phaser.GameObjects.Image;
  recoil: number;
}

/**
 * Визуал защиты (ANIMATIONS §7): головы турелей поворачиваются к цели, отдача и вспышка `muzzle_*`,
 * гильзы, пульс катушек энергетической; капкан захлопывается с тряской; взрыв `explosion_1..5`, тряска
 * камеры и обгорелое пятно; волны тревоги; искры электрозабора; манекены-мишени с полоской HP.
 */
export class DefenseViews {
  private heads = new Map<string, Head>();
  private dummies = new Map<
    string,
    { img: Phaser.GameObjects.Image; bar: Phaser.GameObjects.Rectangle; bg: Phaser.GameObjects.Rectangle }
  >();
  private casings: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private dust: Phaser.GameObjects.Particles.ParticleEmitter;
  private scorches: { img: Phaser.GameObjects.Image; until: number }[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly reg: Registry,
  ) {
    this.casings = Fx.particles(scene, ['effects.spark_3'], {
      tint: 0xd8b040,
      lifespan: 500,
      speed: { min: 60, max: 110 },
      angle: { min: 200, max: 250 },
      scale: { start: 0.1, end: 0.08 },
      gravityY: 400,
    }).setDepth(DEPTH.glow - 2);
    this.sparks = Fx.particles(scene, ['effects.spark_1', 'effects.spark_2'], {
      tint: 0x9ad8ff,
      lifespan: 250,
      speed: { min: 40, max: 120 },
      scale: { start: 0.14, end: 0 },
      gravityY: 0,
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(DEPTH.glow);
    this.dust = Fx.particles(scene, ['effects.dust_1', 'effects.dust_2', 'effects.dust_3'], {
      tint: 0x9a8a70,
      lifespan: 700,
      speed: { min: 30, max: 110 },
      angle: { min: 200, max: 340 },
      scale: { start: 0.3, end: 0 },
      gravityY: 150,
    }).setDepth(DEPTH.glow - 1);
    if (!scene.anims.exists('fx-explosion')) {
      const frames = EXPLOSION_FRAMES.map((f) => getAssetInfo(f))
        .filter((x): x is NonNullable<typeof x> => !!x)
        .map((i) => ({ key: i.group, frame: i.frame }));
      if (frames.length) scene.anims.create({ key: 'fx-explosion', frames, frameRate: 16 });
    }
  }

  /** Спрайт защиты по состоянию: капкан открыт/закрыт, турель — обломки. true — нужна перерисовка. */
  sync(o: WorldObject): boolean {
    const def = this.reg.defense.get(o.ref.id);
    if (!def || o.ref.type !== 'defense') return false;
    const e = effectOf(def);
    let sprite = def.sprite;
    if (e.closedSprite && o.data?.['armed'] === false) sprite = e.closedSprite;
    if ((o.hp ?? 1) <= 0 && def.destroyedSprite) sprite = def.destroyedSprite;
    if (sprite === o.sprite) return false;
    o.sprite = sprite;
    return true;
  }

  /** Кадр: головы турелей у видимых объектов, манекены. */
  update(
    time: number,
    views: Iterable<ChunkView>,
    dummies: readonly Dummy[],
    refresh: (o: WorldObject) => void,
  ): void {
    const alive = new Set<string>();
    for (const cv of views) {
      for (const v of cv.objects) {
        const o = v.obj;
        if (o.ref.type !== 'defense') continue;
        if (this.sync(o)) {
          refresh(o);
          continue;
        }
        const def = this.reg.defense.get(o.ref.id)!;
        const e = effectOf(def);
        if (e.head && (o.hp ?? 1) > 0) {
          alive.add(o.uid);
          let h = this.heads.get(o.uid);
          if (!h || h.view !== v) {
            h?.img.destroy();
            const img = spawnSprite(this.scene, 0, 0, e.head, { depth: false }).setOrigin(0.5, 0.5);
            h = { uid: o.uid, view: v, img, recoil: 0 };
            this.heads.set(o.uid, h);
          }
          const a = ((o.data?.['angle'] as number | undefined) ?? 0) * (Math.PI / 180);
          const flip = Math.cos(a) < 0;
          h.img
            .setPosition(
              v.img.x - Math.cos(a) * h.recoil,
              v.img.y - v.img.displayHeight * 0.62 - Math.sin(a) * h.recoil,
            )
            .setRotation(flip ? a - Math.PI : a)
            .setFlipX(flip)
            .setDepth(v.img.depth + 0.2)
            .setVisible(v.img.visible);
          // Энергетическая: пульс катушек.
          if (o.ref.id === 'turret_energy')
            h.img.setTint(Phaser.Display.Color.GetColor(200 + 55 * Math.abs(Math.sin(time / 300)), 230, 255));
        }
        // Электрозабор: редкие искры между столбами.
        if (o.ref.id === 'electric_fence' && v.img.visible && Math.random() < 0.02)
          this.sparks.explode(
            2,
            v.img.x + (Math.random() - 0.5) * v.img.displayWidth,
            v.img.y - v.img.displayHeight * 0.6,
          );
      }
    }
    for (const [uid, h] of this.heads)
      if (!alive.has(uid)) {
        h.img.destroy();
        this.heads.delete(uid);
      }
    this.drawDummies(dummies);
    const now = this.scene.time.now;
    this.scorches = this.scorches.filter((s) => {
      if (now < s.until) return true;
      this.scene.tweens.add({ targets: s.img, alpha: 0, duration: 1000, onComplete: () => s.img.destroy() });
      return false;
    });
  }

  private drawDummies(list: readonly Dummy[]): void {
    const seen = new Set<string>();
    for (const d of list) {
      if (d.hp <= 0) continue;
      seen.add(d.id);
      let v = this.dummies.get(d.id);
      if (!v) {
        if (!AssetLoader.isLoaded(this.scene, 'enemies')) {
          void AssetLoader.ensureGroup(this.scene, 'enemies');
          continue;
        }
        const img = spawnSprite(this.scene, 0, 0, DUMMY_SPRITE).setTint(DUMMY_TINT);
        const bg = this.scene.add.rectangle(0, 0, 34, 5, 0x000000, 0.7).setOrigin(0.5);
        const bar = this.scene.add.rectangle(0, 0, 32, 3, 0xd04030).setOrigin(0, 0.5);
        v = { img, bar, bg };
        this.dummies.set(d.id, v);
      }
      const x = d.x * TILE;
      const y = d.y * TILE;
      v.img.setPosition(x, y).setDepth(y);
      const top = y - v.img.displayHeight - 6;
      v.bg.setPosition(x, top).setDepth(y + 1);
      v.bar
        .setPosition(x - 16, top)
        .setDepth(y + 2)
        .setSize(32 * (d.hp / d.maxHp), 3);
    }
    for (const [id, v] of this.dummies)
      if (!seen.has(id)) {
        Fx.dissolve(this.scene, v.img, () => v.img.destroy());
        v.bar.destroy();
        v.bg.destroy();
        this.dummies.delete(id);
      }
  }

  /** События защиты → эффекты. */
  event(ev: DefenseEvent, views: (o: WorldObject) => ObjView | undefined): void {
    switch (ev.type) {
      case 'shot': {
        const h = this.heads.get(ev.o.uid);
        const v = views(ev.o);
        const a = (ev.angle * Math.PI) / 180;
        const ox = h ? h.img.x : (v?.img.x ?? ev.o.x * TILE);
        const oy = h ? h.img.y : (v?.img.y ?? ev.o.y * TILE) - 20;
        const tip = h ? h.img.displayWidth * 0.5 : 10;
        const mx = ox + Math.cos(a) * tip;
        const my = oy + Math.sin(a) * tip;
        if (getAssetInfo('effects.muzzle_1')) {
          const m = spawnSprite(
            this.scene,
            mx,
            my,
            Math.random() < 0.5 ? 'effects.muzzle_1' : 'effects.muzzle_2',
            {
              depth: DEPTH.glow,
            },
          )
            .setOrigin(0, 0.5)
            .setRotation(a)
            .setScale(0.35)
            .setBlendMode(Phaser.BlendModes.ADD);
          this.scene.time.delayedCall(60, () => m.destroy());
        }
        // Трассер до цели.
        const g = this.scene.add.graphics().setDepth(DEPTH.glow);
        g.lineStyle(2, ev.o.ref.id === 'turret_energy' ? 0x80d0ff : 0xffe080, 0.9).lineBetween(
          mx,
          my,
          ev.target.x * TILE,
          ev.target.y * TILE - 30,
        );
        this.scene.tweens.add({ targets: g, alpha: 0, duration: 120, onComplete: () => g.destroy() });
        if (h) {
          h.recoil = RECOIL_PX;
          this.scene.tweens.add({ targets: h, recoil: 0, duration: RECOIL_MS });
          if (ev.o.ref.id === 'turret_mg') this.casings.explode(1, ox, oy);
        }
        break;
      }
      case 'hit': {
        const d = this.dummies.get(ev.target.id);
        if (d) Fx.damageFlash(this.scene, d.img);
        const v = views(ev.o);
        if (v && effectOf(this.reg.defense.require(ev.o.ref.id)).contactDamage)
          Fx.shake(this.scene, v.img, 1);
        break;
      }
      case 'trap': {
        const v = views(ev.o);
        if (v) Fx.shake(this.scene, v.img, 2);
        break;
      }
      case 'zap':
        this.sparks.explode(6, ev.target.x * TILE, ev.target.y * TILE - 20);
        break;
      case 'fire': {
        const v = views(ev.o);
        if (!v || Math.random() > 0.3 || !this.scene.anims.exists('fx-flame')) break;
        const a = (ev.angle * Math.PI) / 180;
        const f = this.scene.add
          .sprite(v.img.x + Math.cos(a) * 30, v.img.y - 16 + Math.sin(a) * 30, 'effects')
          .play('fx-flame')
          .setScale(0.5)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(DEPTH.glow);
        this.scene.tweens.add({
          targets: f,
          x: f.x + Math.cos(a) * 60,
          y: f.y + Math.sin(a) * 60,
          alpha: 0,
          duration: 400,
          onComplete: () => f.destroy(),
        });
        break;
      }
      case 'alert':
        this.alertWaves(ev.o, views(ev.o));
        break;
      case 'explode':
        this.explode(ev.x, ev.y, ev.radius);
        break;
    }
  }

  /** Волны звука от растяжки/колокола; колокол трясётся. */
  private alertWaves(o: WorldObject, v: ObjView | undefined): void {
    if (v) Fx.shake(this.scene, v.img, 2);
    for (let i = 0; i < 3; i++) {
      const c = this.scene.add
        .ellipse(o.x * TILE, o.y * TILE - 20, 10, 6)
        .setStrokeStyle(2, 0xffe080, 0.9)
        .setDepth(DEPTH.glow);
      this.scene.tweens.add({
        targets: c,
        scaleX: 14,
        scaleY: 14,
        alpha: 0,
        delay: i * 180,
        duration: 700,
        onComplete: () => c.destroy(),
      });
    }
  }

  /** Взрыв: кадры explosion_1..5, пыль, тряска камеры, обгорелое пятно на explosionScorchSec. */
  explode(x: number, y: number, radius: number, tint = 0xffffff): void {
    const px = x * TILE;
    const py = y * TILE;
    if (this.scene.anims.exists('fx-explosion')) {
      const s = this.scene.add
        .sprite(px, py - 20, 'effects')
        .play('fx-explosion')
        .setScale(Math.max(1, radius * 0.9))
        .setTint(tint)
        .setDepth(DEPTH.glow + 1);
      s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
    }
    this.dust.explode(18, px, py - 10);
    Fx.cameraShake(this.scene, 300, 0.012);
    const scorch = this.scene.add
      .image(px, py, TEX.shadow)
      .setDisplaySize(radius * TILE * 1.6, radius * TILE * 0.8)
      .setTint(0x000000)
      .setAlpha(0.85)
      .setDepth(DEPTH.shadow);
    this.scorches.push({
      img: scorch,
      until: this.scene.time.now + this.reg.build.defense.explosionScorchSec * 1000,
    });
  }

  /** Пыль у основания (установка, урон стене). */
  dustAt(px: number, py: number, n = 8): void {
    this.dust.explode(n, px, py);
  }

  destroy(): void {
    for (const h of this.heads.values()) h.img.destroy();
    for (const d of this.dummies.values()) {
      d.img.destroy();
      d.bar.destroy();
      d.bg.destroy();
    }
    for (const s of this.scorches) s.img.destroy();
    this.casings.destroy();
    this.sparks.destroy();
    this.dust.destroy();
  }
}
