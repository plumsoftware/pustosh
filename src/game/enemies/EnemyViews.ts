import Phaser from 'phaser';
import type { Registry } from '../../core/data/Registry';
import type { Enemy } from '../../core/entities/Enemy';
import { getAssetInfo } from '../assets/AssetIndex';
import { spawnSprite } from '../assets/spawnSprite';
import { DEPTH } from '../render/ChunkView';
import * as Fx from '../render/Fx';
import { TILE } from '../render/GroundTiles';
import { TEX } from '../render/textures';

/** Глаза на спрайте (доля ширины/высоты от левого верхнего угла, морда вправо) — для элиты и ночи. */
const EYES: Record<string, [number, number]> = {
  walker: [0.62, 0.12],
  crawler: [0.9, 0.38],
  spitter: [0.6, 0.12],
  sprinter: [0.62, 0.1],
  bloated: [0.58, 0.12],
  soldier: [0.6, 0.1],
  glowing: [0.6, 0.11],
  dog: [0.9, 0.28],
  toad: [0.78, 0.25],
  raptor: [0.9, 0.12],
  scorpion: [0.85, 0.45],
  armored_lizard: [0.9, 0.35],
  snow_wolf: [0.9, 0.25],
  deer: [0.9, 0.15],
  boar: [0.9, 0.4],
  hare: [0.85, 0.25],
};
/** Четвероногие и рептилии — «скачут» с другой частотой. */
const QUAD = new Set([
  'dog',
  'toad',
  'raptor',
  'scorpion',
  'armored_lizard',
  'snow_wolf',
  'deer',
  'boar',
  'hare',
]);
const FLASH_MS = 90;

interface View {
  e: Enemy;
  img: Phaser.GameObjects.Image;
  base: number;
  shadow: Phaser.GameObjects.Image;
  eyes?: Phaser.GameObjects.Image[];
  extra?: Phaser.GameObjects.Image;
  bar?: [Phaser.GameObjects.Rectangle, Phaser.GameObjects.Rectangle];
  mound?: Phaser.GameObjects.Image;
  phase: number;
  flashUntil: number;
  lastHp: number;
  revealed: boolean;
  swell: number;
  dying: boolean;
  runPose: boolean;
}

/**
 * Враги и звери целым спрайтом (`<id>_idle`, запасной режим ригов — TZ 8.3.2) с процедурной анимацией
 * (ANIMATIONS §2): дыхание, шаг/бег с наклоном, удар-выпад, урон (вспышка, отброс), смерть (падение и
 * растворение за 2 с), элита ×1.15 с красными глазами, глаза ночью светятся. Особые части: лоскут бродяги,
 * мешок болотника, волдыри толстяка, каска солдата, аура светящегося, язык жабы, уши зайца.
 */
export class EnemyViews {
  private views = new Map<string, View>();
  private dust: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly reg: Registry,
  ) {
    this.dust = Fx.particles(scene, ['effects.dust_1', 'effects.dust_2'], {
      tint: 0x7a8a50,
      lifespan: 600,
      speed: { min: 30, max: 90 },
      angle: { min: 200, max: 340 },
      scale: { start: 0.25, end: 0 },
      gravityY: 120,
    }).setDepth(DEPTH.glow - 1);
  }

  private make(e: Enemy): View | null {
    const id = e.def.id;
    const sprite = `characters.${QUAD.has(id) || !getAssetInfo(`characters.enemies.${id}_idle`) ? 'animals' : 'enemies'}.${id}_idle`;
    if (!getAssetInfo(sprite)) return null;
    const img = spawnSprite(this.scene, 0, 0, sprite).setOrigin(0.5, 1);
    const base = (e.def.targetHeightPx / img.frame.height) * (e.elite ? (e.def.elite?.scale ?? 1) : 1);
    img.setScale(base);
    const shadow = this.scene.add
      .image(0, 0, TEX.shadow)
      .setDisplaySize(img.displayWidth * 0.7, Math.max(8, img.displayWidth * 0.22))
      .setDepth(DEPTH.shadow);
    const v: View = {
      e,
      img,
      base,
      shadow,
      phase: Math.random() * 10,
      flashUntil: 0,
      lastHp: e.hp,
      revealed: !e.hidden,
      swell: 0,
      dying: false,
      runPose: false,
    };
    // Красные глаза элиты (кодом, с мягким свечением).
    if (e.elite || EYES[id]) {
      const color = e.elite ? 0xff3b2f : 0xffe060;
      v.eyes = [0, 1].map(() =>
        this.scene.add
          .image(0, 0, TEX.glow)
          .setDisplaySize(e.elite ? 10 : 7, e.elite ? 10 : 7)
          .setTint(color)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(DEPTH.glow),
      );
    }
    // Особые части поверх целого спрайта: мешок болотника, язык жабы, аура светящегося; волдыри толстяка —
    // мягкое пульсирующее свечение (детали рига на целом спрайте смотрятся грубо — ждут калибровки ригов).
    if (id === 'bloated' || id === 'glowing') {
      v.extra = this.scene.add.image(0, 0, TEX.glow).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.glow);
      v.extra.setTint(id === 'bloated' ? 0x90ff50 : 0x60ff60);
    } else {
      const extraId: Record<string, string> = {
        spitter: 'characters.enemies.spitter_throat_sac',
        toad: 'characters.animals.toad_tongue_and_sac',
      };
      const ex = extraId[id];
      if (ex && getAssetInfo(ex)) {
        v.extra = spawnSprite(this.scene, 0, 0, ex, { depth: false }).setVisible(false);
        if (id === 'toad') v.extra.setOrigin(0, 0.5);
      }
    }
    if (e.hidden && id === 'scorpion')
      v.mound = this.scene.add
        .image(0, 0, TEX.shadow)
        .setDisplaySize(40, 14)
        .setTint(0x8a6a40)
        .setDepth(DEPTH.shadow + 1);
    return v;
  }

  /** Кадр: позиции, анимации, видимость (засада, волки ночью вне света). */
  update(
    time: number,
    /** Игровое время (секунды мира) — в нём записаны моменты анимаций врага (anim.at). */
    now: number,
    enemies: readonly Enemy[],
    night: boolean,
    lit: (x: number, y: number) => boolean,
    hero: { x: number; y: number },
  ): void {
    const seen = new Set<string>();
    const t = time / 1000;
    for (const e of enemies) {
      seen.add(e.id);
      let v = this.views.get(e.id);
      if (!v) {
        const nv = this.make(e);
        if (!nv) continue;
        v = nv;
        this.views.set(e.id, v);
      }
      const x = e.x * TILE;
      const y = e.y * TILE;
      const img = v.img;
      if (!e.alive) {
        if (!v.dying) this.die(v);
        continue;
      }
      const id = e.def.id;
      const right = Math.cos((e.faceDeg * Math.PI) / 180) >= 0;
      img.setFlipX(!right);
      // Засада: невидим; вырастает из травы с частицами.
      const hidden = e.hidden;
      if (!hidden && !v.revealed) {
        v.revealed = true;
        img.setAlpha(1);
        Fx.popIn(this.scene, img);
        this.dust.explode(10, x, y);
        v.mound?.destroy();
        v.mound = undefined;
      }
      // Волк ночью полупрозрачен вне света.
      let alpha = hidden ? 0 : 1;
      if (id === 'snow_wolf' && night && !lit(e.x, e.y)) alpha = 0.18;
      img.setAlpha(alpha);
      v.mound?.setPosition(x, y).setVisible(hidden);
      // Шаг/бег: подпрыгивание и наклон; заражённые шаркают (амплитуда 60%), четвероногие — галоп.
      const speed = e.def.speedTilesPerSec;
      const quad = QUAD.has(id);
      const freq = quad ? 9 + speed * 2 : 6;
      const amp = !e.moving ? 0 : quad ? 4 : id === 'walker' ? 1.8 : 3;
      const bob = Math.abs(Math.sin(t * freq + v.phase)) * amp;
      let lean = !e.moving
        ? 0
        : quad
          ? Math.sin(t * freq + v.phase) * 3
          : id === 'sprinter'
            ? 14
            : id === 'walker'
              ? 6
              : 4;
      if (!right) lean = -lean;
      // Дыхание в покое.
      const breathe = 1 + Math.sin(t * 2.2 + v.phase) * 0.015;
      const sx = v.base;
      let sy = v.base * breathe;
      // Удар/выпад: короткий рывок к цели; прыжок — дуга; замах тарана — тряска.
      let offX = 0;
      let offY = 0;
      const animAge = now - e.anim.at;
      if (e.anim.kind === 'attack' && animAge < 0.25)
        offX = Math.sin((animAge / 0.25) * Math.PI) * 8 * (right ? 1 : -1);
      if (e.anim.kind === 'leap' && animAge < 0.35) offY = -Math.sin((animAge / 0.35) * Math.PI) * 18;
      if (e.anim.kind === 'windup' && animAge < 0.5) offX = Math.sin(time / 20) * 1.5;
      if (id === 'toad' && e.moving) {
        // Сжатие перед прыжком.
        const k = Math.sin(t * 5 + v.phase);
        sy *= 1 - Math.max(0, -k) * 0.12;
        offY -= Math.max(0, k) * 10;
      }
      if ((id === 'deer' || id === 'hare') && e.moving) offY -= Math.abs(Math.sin(t * 8 + v.phase)) * 10;
      if (id === 'bloated') lean += Math.sin(t * 1.5 + v.phase) * 4;
      // Бегун на полной скорости — поза бега.
      const runPose = id === 'sprinter' && e.moving && e.state === 'chase';
      if (runPose !== v.runPose && getAssetInfo('characters.enemies.sprinter_run_pose')) {
        v.runPose = runPose;
        const info = getAssetInfo(
          runPose ? 'characters.enemies.sprinter_run_pose' : 'characters.enemies.sprinter_idle',
        )!;
        img.setTexture(info.group, info.frame);
        v.base = (e.def.targetHeightPx / img.frame.height) * (e.elite ? (e.def.elite?.scale ?? 1) : 1);
      }
      img
        .setScale(sx, sy)
        .setPosition(x + offX, y - bob + offY)
        .setAngle(lean)
        .setDepth(y);
      v.shadow.setPosition(x, y).setVisible(alpha > 0.1);
      // Вспышка урона.
      if (e.hp < v.lastHp) {
        v.flashUntil = time + FLASH_MS;
        v.lastHp = e.hp;
      }
      if (time < v.flashUntil) img.setTintFill(0xffffff);
      else img.clearTint();
      // Глаза: элита всегда, остальные ночью (маленькие).
      if (v.eyes) {
        const [ex, ey] = EYES[id] ?? [0.7, 0.15];
        const w = img.displayWidth;
        const h = img.displayHeight;
        const showEyes = alpha > 0.1 && (e.elite || night);
        v.eyes.forEach((g, i) => {
          const fx = (right ? ex : 1 - ex) - 0.5;
          g.setPosition(img.x + fx * w + (i ? (right ? -5 : 5) : 0), img.y - h + ey * h)
            .setVisible(showEyes)
            .setAlpha(0.6 + 0.4 * Math.sin(t * 3 + i));
        });
      }
      this.updateExtra(v, time, now, right, hero);
      this.updateBar(v);
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      this.destroyView(v);
      this.views.delete(id);
    }
  }

  private updateExtra(
    v: View,
    time: number,
    now: number,
    right: boolean,
    hero: { x: number; y: number },
  ): void {
    const ex = v.extra;
    if (!ex) return;
    const e = v.e;
    const img = v.img;
    const id = e.def.id;
    const t = time / 1000;
    const w = img.displayWidth;
    const h = img.displayHeight;
    ex.setFlipX(!right)
      .setDepth(img.depth + 0.1)
      .setAlpha(img.alpha);
    const at = (fx: number, fy: number) =>
      ex.setPosition(img.x + ((right ? fx : 1 - fx) - 0.5) * w, img.y - h + fy * h);
    if (id === 'spitter') {
      // Мешок раздувается 0.6 с перед плевком.
      const age = now - e.anim.at;
      const k =
        e.anim.kind === 'sac'
          ? Math.min(1, age / 0.6)
          : e.anim.kind === 'spit' && age < 0.2
            ? 1 - age / 0.2
            : 0;
      ex.setVisible(k > 0 && img.alpha > 0.1);
      at(0.6, 0.24);
      const sz = (w * 0.22 * (0.6 + 0.8 * k)) / Math.max(ex.frame.width, 1);
      ex.setScale(sz);
    } else if (id === 'bloated' || id === 'glowing') {
      ex.setPosition(img.x, img.y - h * (id === 'bloated' ? 0.45 : 0.5));
      const pulse = 0.5 + 0.5 * Math.sin(t * (id === 'bloated' ? 4 : 2) + v.phase);
      ex.setDisplaySize(w * (id === 'bloated' ? 0.9 : 1.6), w * (id === 'bloated' ? 0.9 : 1.6));
      ex.setAlpha(img.alpha * (id === 'bloated' ? 0.15 + 0.2 * pulse : 0.25 + 0.15 * pulse));
    } else if (id === 'toad') {
      // Язык: верхняя часть растягивается по X к цели и обратно.
      const age = now - e.anim.at;
      const on = e.anim.kind === 'tongue' && age < 0.5;
      ex.setVisible(on && img.alpha > 0.1);
      if (on) {
        const dist = Math.hypot(hero.x * TILE - img.x, hero.y * TILE - img.y);
        const k = Math.sin((age / 0.5) * Math.PI);
        at(0.85, 0.35);
        ex.setOrigin(right ? 0 : 1, 0.5);
        ex.setScale(Math.max(0.05, (dist / ex.frame.width) * k), (h * 0.12) / ex.frame.height);
      }
    }
  }

  private updateBar(v: View): void {
    const e = v.e;
    if (e.hp >= e.maxHp || (e.def.family === 'animal' && e.hp >= e.maxHp)) {
      if (v.bar) v.bar.forEach((r) => r.setVisible(false));
      return;
    }
    if (!v.bar) {
      v.bar = [
        this.scene.add.rectangle(0, 0, 34, 5, 0x000000, 0.7),
        this.scene.add.rectangle(0, 0, 32, 3, e.elite ? 0xff8030 : 0xd04030).setOrigin(0, 0.5),
      ];
    }
    const top = v.img.y - v.img.displayHeight - 6;
    const vis = v.img.alpha > 0.1;
    v.bar[0]
      .setPosition(v.img.x, top)
      .setDepth(v.img.depth + 1)
      .setVisible(vis);
    v.bar[1]
      .setPosition(v.img.x - 16, top)
      .setDepth(v.img.depth + 2)
      .setSize(32 * Math.max(0, e.hp / e.maxHp), 3)
      .setVisible(vis);
  }

  /** Смерть: толстяк раздувается ×1.3 за 0.5 с; падение (поворот 90°), затемнение, растворение за 2 с. */
  private die(v: View): void {
    v.dying = true;
    const img = v.img;
    v.eyes?.forEach((g) => g.setVisible(false));
    v.bar?.forEach((r) => r.setVisible(false));
    v.extra?.setVisible(false);
    img.clearTint();
    const fall = () => {
      this.scene.tweens.add({ targets: img, angle: img.flipX ? -90 : 90, duration: 350, ease: 'Quad.In' });
      this.scene.tweens.add({ targets: img, alpha: 0, delay: 600, duration: 1400 });
      img.setTint(0x777777);
      this.scene.tweens.add({ targets: v.shadow, alpha: 0, delay: 600, duration: 1400 });
    };
    if (v.e.def.id === 'bloated') {
      this.scene.tweens.add({
        targets: img,
        scale: img.scale * 1.3,
        duration: 500,
        onComplete: () => img.setVisible(false),
      });
    } else if (v.e.def.id === 'soldier' && v.e.helmet) fall();
    else fall();
  }

  /** Каска солдата слетает по дуге и остаётся на земле. */
  helmet(e: Enemy): void {
    const v = this.views.get(e.id);
    if (!v || !getAssetInfo('characters.enemies.soldier_helmet')) return;
    const img = v.img;
    const h = spawnSprite(
      this.scene,
      img.x,
      img.y - img.displayHeight * 0.9,
      'characters.enemies.soldier_helmet',
    );
    h.setScale((img.displayWidth * 0.3) / h.frame.width);
    const dir = img.flipX ? 1 : -1;
    this.scene.tweens.add({ targets: h, x: h.x + dir * 40, duration: 500 });
    this.scene.tweens.add({
      targets: h,
      y: img.y,
      angle: dir * 200,
      duration: 500,
      ease: 'Quad.In',
      onComplete: () => h.setDepth(img.y - 1),
    });
    this.scene.time.delayedCall(20000, () => h.destroy());
  }

  /** Экранная позиция врага (для эффектов). */
  pos(e: Enemy): { x: number; y: number; h: number } {
    const v = this.views.get(e.id);
    return v ? { x: v.img.x, y: v.img.y, h: v.img.displayHeight } : { x: e.x * TILE, y: e.y * TILE, h: 64 };
  }

  private destroyView(v: View): void {
    v.img.destroy();
    v.shadow.destroy();
    v.eyes?.forEach((g) => g.destroy());
    v.extra?.destroy();
    v.bar?.forEach((r) => r.destroy());
    v.mound?.destroy();
  }

  destroy(): void {
    for (const v of this.views.values()) this.destroyView(v);
    this.views.clear();
    this.dust.destroy();
  }
}
