import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import { dayNightAt } from '../../core/systems/DayNight';
import { getAssetInfo } from '../assets/AssetIndex';
import { AssetLoader } from '../assets/AssetLoader';
import { spawnSprite } from '../assets/spawnSprite';
import { ctx, registry } from '../GameContext';
import { OCCLUDE_ALPHA, OCCLUDE_MS } from '../render/ChunkView';
import * as Fx from '../render/Fx';
import { buildGroundTileset, TILE, type GroundTileset } from '../render/GroundTiles';
import { maskColor } from '../render/Lighting';
import { ensureFxTextures, LIGHT_TEX_R, TEX } from '../render/textures';
import { SceneKeys } from '../SceneKeys';
import { COLORS, FONT, TEXT_RES } from '../ui/layout';
import { HeroView } from '../hero/HeroView';
import { AnimationPlayer } from '../rig/AnimationPlayer';
import { humanoidAnims, type AnimName } from '../rig/Animations';
import { resolveCharacter } from '../rig/RigDef';
import { RigInstance } from '../rig/RigInstance';
import { WorldFx } from '../world/WorldFx';
import { DefenseViews } from '../world/DefenseViews';
import { EnemyViews } from '../enemies/EnemyViews';
import { Enemy } from '../../core/entities/Enemy';
import { UI_FONT } from '../ui/BitmapFont';
import { rarityColor } from '../world/rarity';
import type { ObjView } from '../render/ChunkView';
import type { WorldObject } from '../../core/world';

const CELL_W = 300;
const CELL_H = 230;
const PAD = 14;
const TOP = 48;

interface Demo {
  title: string;
  /** Строит демо в ячейке (x, y — левый верх области 300×190); возвращает функцию кадра и/или действие кнопки. */
  build(x: number, y: number): { update?: (time: number, delta: number) => void; action?: () => void };
}

/**
 * Отладочная галерея анимаций (F7): по ячейке на каждую анимацию из ANIMATIONS.md
 * §0 (общие приёмы), §4 (мир), §5 (сутки). Постоянные анимации идут сами, разовые — по кнопке.
 */
export class AnimationGalleryScene extends Phaser.Scene {
  private updaters: ((time: number, delta: number) => void)[] = [];
  private content!: Phaser.GameObjects.Container;
  private contentH = 0;
  private hitStopUntil = 0;

  constructor() {
    super(SceneKeys.AnimGallery);
  }

  async create(): Promise<void> {
    const { clock } = ctx();
    clock.pause('DIALOG');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => clock.resume('DIALOG'));
    this.updaters = [];
    ensureFxTextures(this);
    Fx.ensureFlameAnim(this);
    this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x15171b).setOrigin(0).setScrollFactor(0);
    this.content = this.add.container(0, 0);
    this.add
      .text(PAD, 12, t('anim.title'), {
        fontFamily: FONT,
        resolution: TEXT_RES,
        fontSize: '18px',
        color: COLORS.text,
        fontStyle: '700',
      })
      .setScrollFactor(0)
      .setDepth(10);
    this.input.keyboard?.on('keydown-ESC', () => this.scene.stop());
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      const max = Math.max(0, this.contentH - this.scale.height + TOP);
      this.cameras.main.scrollY = Phaser.Math.Clamp(this.cameras.main.scrollY + dy, 0, max);
    });
    // Грибы, экскаватор, кристаллы — в ленивых атласах биомов 2, 4, 6.
    await Promise.all(
      ['biome2', 'biome4', 'biome6', 'bosses', 'vehicles'].map((g) => AssetLoader.ensureGroup(this, g)),
    );
    if (!this.scene.isActive()) return;
    const ts = buildGroundTileset(this, registry().worldgen.blendPriority);
    this.layout(this.demos(ts));
  }

  private layout(demos: Demo[]): void {
    const cols = Math.max(1, Math.floor((this.scale.width - PAD) / (CELL_W + PAD)));
    demos.forEach((d, i) => {
      const x = PAD + (i % cols) * (CELL_W + PAD);
      const y = TOP + Math.floor(i / cols) * (CELL_H + PAD);
      this.add.rectangle(x, y, CELL_W, CELL_H, 0x22262d).setOrigin(0).setStrokeStyle(1, 0x3a404a);
      this.add.text(x + 8, y + 6, `${i + 1}. ${d.title}`, {
        fontFamily: FONT,
        resolution: TEXT_RES,
        fontSize: '13px',
        color: COLORS.text,
      });
      const r = d.build(x, y + 24);
      if (r.update) this.updaters.push(r.update);
      if (r.action) {
        const action = r.action;
        this.add
          .text(x + CELL_W - 8, y + CELL_H - 8, t('anim.play'), {
            fontFamily: FONT,
            resolution: TEXT_RES,
            fontSize: '13px',
            color: '#000',
            backgroundColor: '#e08a37',
            padding: { x: 8, y: 4 },
          })
          .setOrigin(1, 1)
          .setDepth(5)
          .setInteractive({ useHandCursor: true })
          .on('pointerup', action);
      }
    });
    this.contentH = TOP + Math.ceil(demos.length / cols) * (CELL_H + PAD);
  }

  override update(time: number, delta: number): void {
    if (time < this.hitStopUntil) return;
    for (const u of this.updaters) u(time, delta);
  }

  private sprite(x: number, y: number, id: string, scale = 1): Phaser.GameObjects.Image {
    return spawnSprite(this, x, y, id, { depth: 1, scale });
  }

  /** Мини-маска ночи в ячейке: заливка цветом фазы и стирание мягких кругов. */
  private nightPanel(
    x: number,
    y: number,
    w: number,
    h: number,
  ): (s: Parameters<typeof maskColor>[0], lights: { x: number; y: number; r: number }[]) => void {
    const rt = this.add.renderTexture(x, y, w, h).setOrigin(0).setDepth(3);
    const stamp = this.make.image({ key: TEX.light, add: false });
    return (s, lights) => {
      const { color, alpha } = maskColor(s);
      rt.clear();
      if (alpha < 0.01) return;
      rt.fill(color, alpha);
      stamp.setAlpha(Math.min(1, s.darkness * 1.2));
      for (const l of lights) {
        stamp.setScale(l.r / LIGHT_TEX_R);
        rt.erase(stamp, l.x, l.y);
      }
    };
  }

  private groundPatch(x: number, y: number, w: number, h: number, tile: string): void {
    const info = getAssetInfo(`tiles.${tile}`)!;
    const ts = this.add.tileSprite(x, y, w, h, info.group, info.frame).setOrigin(0);
    ts.setTileScale(info.size[0] / ts.frame.width);
  }

  private demos(ts: GroundTileset): Demo[] {
    const reg = registry();
    const cfg = { ...reg.balance.dayNight, transitionSec: reg.worldgen.dayNight.transitionSec };
    const W = CELL_W;
    const H = 190;
    return [
      ...this.bossDemos(),
      ...this.vehicleDemos(),
      ...this.uiStep9Demos(),
      ...this.enemyDemos(),
      ...this.combatDemos(),
      ...this.buildDemos(),
      ...this.stationDemos(),
      ...this.harvestDemos(),
      ...this.heroDemos(),
      ...this.uiDemos(),
      ...this.worldDemos(ts, cfg, W, H),
    ];
  }

  /** Риг героя с анимацией в ячейке; разовые анимации повторяются по кругу. */
  private heroCell(
    x: number,
    y: number,
    anim: AnimName,
    oneShotEvery = 1200,
    swaps?: Record<string, string>,
  ): (tm: number, dt: number) => void {
    const reg = registry();
    const def = resolveCharacter(reg, 'hero');
    // Тело при смерти падает навзничь (влево от стоп) — сдвигаем, чтобы осталось в ячейке.
    const rig = new RigInstance(this, def, x + CELL_W / 2 + (anim === 'death' ? 70 : 0), y + 170);
    rig.container.setScale(1.6).setDepth(2);
    const player = new AnimationPlayer(
      humanoidAnims(reg.rigs.humanoid['animations'] as Record<string, { loopSec?: number }>),
    );
    const loop = anim === 'idle' || anim === 'walk' || anim === 'run';
    if (loop) player.setBase(anim);
    let next = 0;
    return (tm, dt) => {
      if (!loop && tm >= next) {
        next = tm + oneShotEvery;
        player.stop();
        player.play(anim, { hold: anim === 'death' });
      }
      const pose = player.update(dt / 1000);
      if (swaps) pose.swaps = { ...pose.swaps, ...swaps };
      rig.apply(pose);
    };
  }

  /** §3 Боссы: дыхание, наклон, красная зона, фаза 2 (вспышка, рёв, пыль), смерть с трофеем; атаки частями. */
  private bossDemos(): Demo[] {
    const W = CELL_W;
    const H = 190;
    const reg = registry();
    const dust = () =>
      Fx.particles(this, ['effects.dust_1', 'effects.dust_2', 'effects.dust_3'], {
        tint: 0x9a8a70,
        lifespan: 900,
        speed: { min: 60, max: 180 },
        scale: { start: 0.35, end: 0 },
        gravityY: 40,
      }).setDepth(6);
    const boss = (id: string, x: number, y: number, h = 150) => {
      const d = reg.bosses.require(id);
      const img = this.sprite(x, y, d.sprites['idle']!).setOrigin(0.5, 1);
      img.setScale(h / img.frame.height);
      return { img, base: img.scale, d };
    };
    const zone = (g: Phaser.GameObjects.Graphics, draw: (p: number) => void) => ({ g, draw });
    void zone;
    return [
      {
        title: '§3 Мясник: дыхание, красная зона, крюк на цепи',
        build: (x, y) => {
          this.groundPatch(x + 10, y + 10, W - 20, H - 20, 'dirt');
          const b = boss('butcher', x + 70, y + H - 18, 140);
          const g = this.add.graphics().setDepth(2);
          let t0 = -1;
          const hero = this.sprite(x + W - 40, y + H - 20, 'characters.hero.ref_idle').setOrigin(0.5, 1);
          hero.setScale(70 / hero.frame.height);
          return {
            update: (tm) => {
              b.img.setScale(b.base, b.base * (1 + Math.sin(tm / 600) * 0.02));
              g.clear();
              if (t0 < 0) return;
              const p = Math.min(1, (tm - t0) / 1000);
              const x0 = b.img.x;
              const yy = y + H - 30;
              g.fillStyle(0xff2a1a, 0.18).fillRect(x0, yy - 12, hero.x - x0, 24);
              g.fillStyle(0xff2a1a, 0.35).fillRect(x0, yy - 12, (hero.x - x0) * p, 24);
              g.lineStyle(2, 0xff3020, 0.9).strokeRect(x0, yy - 12, hero.x - x0, 24);
              if (p >= 1) {
                t0 = -1;
                g.clear();
                const n = 6;
                for (let i = 0; i < n; i++) {
                  const c = this.sprite(x0, yy - 40, 'characters.bosses.butcher_hook_chain', 0.4).setDepth(4);
                  this.tweens.add({
                    targets: c,
                    x: x0 + ((hero.x - x0) * (i + 1)) / n,
                    duration: 200,
                    yoyo: true,
                    hold: 150,
                    onComplete: () => c.destroy(),
                  });
                }
                this.tweens.add({
                  targets: hero,
                  x: hero.x - 40,
                  duration: 300,
                  delay: 350,
                  yoyo: true,
                  hold: 600,
                });
              }
            },
            action: () => (t0 = this.time.now),
          };
        },
      },
      {
        title: '§3 фаза 2: вспышка, рёв, волна пыли',
        build: (x, y) => {
          this.groundPatch(x + 10, y + 10, W - 20, H - 20, 'grass');
          const b = boss('butcher', x + W / 2, y + H - 18, 140);
          const d = dust();
          return {
            update: (tm) => b.img.setAngle(Math.sin(tm / 400) * 2),
            action: () => {
              const p2 = getAssetInfo(b.d.sprites['phase2']!)!;
              const p1 = getAssetInfo(b.d.sprites['idle']!)!;
              const two = b.img.frame.name !== p2.frame;
              b.img.setTexture((two ? p2 : p1).group, (two ? p2 : p1).frame);
              this.cameras.main.flash(300, 255, 255, 255);
              Fx.cameraShake(this, 400, 0.01);
              for (let i = 0; i < 16; i++) {
                const a = (i / 16) * Math.PI * 2;
                d.explode(2, b.img.x + Math.cos(a) * 40, b.img.y + Math.sin(a) * 14);
              }
            },
          };
        },
      },
      {
        title: '§3 Королева: ныряние, круги на воде, мешки',
        build: (x, y) => {
          this.groundPatch(x + 10, y + 10, W - 20, H - 20, 'swamp_mud');
          const b = boss('queen', x + W / 2, y + H - 18, 120);
          const sacs = this.sprite(
            b.img.x - 20,
            b.img.y - 55,
            'characters.bosses.queen_egg_sacs',
            0.5,
          ).setDepth(3);
          let under = false;
          return {
            update: (tm) =>
              sacs.setAlpha(0.7 + 0.3 * Math.sin(tm / 300)).setScale(0.5 * (1 + 0.05 * Math.sin(tm / 300))),
            action: () => {
              under = !under;
              this.tweens.add({
                targets: [b.img, sacs],
                alpha: under ? 0 : 1,
                y: `${under ? '+' : '-'}=20`,
                duration: 400,
              });
              for (let i = 0; i < 3; i++)
                this.time.delayedCall(i * 150, () =>
                  Fx.ripple(this, b.img.x + (Math.random() - 0.5) * 50, y + H - 22, 2),
                );
            },
          };
        },
      },
      {
        title: '§3 Тиран: разгон, взмах хвостом, рёв',
        build: (x, y) => {
          this.groundPatch(x + 10, y + 10, W - 20, H - 20, 'asphalt_cracked');
          const b = boss('tyrant', x + W / 2, y + H - 18, 130);
          const tail = this.sprite(b.img.x - 50, b.img.y - 55, 'characters.bosses.tyrant_tail', 0.7)
            .setOrigin(1, 0.5)
            .setDepth(0.5);
          const bx = b.img.x;
          let n = 0;
          return {
            action: () => {
              n++;
              if (n % 3 === 1) {
                this.tweens.add({ targets: b.img, x: bx - 3, duration: 40, yoyo: true, repeat: 5 });
                this.tweens.add({ targets: b.img, x: bx + 60, delay: 400, duration: 250, yoyo: true });
              } else if (n % 3 === 2)
                this.tweens.add({ targets: tail, angle: -70, duration: 180, yoyo: true });
              else {
                this.tweens.add({ targets: b.img, angle: -6, duration: 150, yoyo: true, hold: 300 });
                Fx.cameraShake(this, 400, 0.012);
              }
            },
          };
        },
      },
      {
        title: '§3 смерть: падение, дым, трофей и блёстки',
        build: (x, y) => {
          this.groundPatch(x + 10, y + 10, W - 20, H - 20, 'dirt');
          const b = boss('butcher', x + W / 2, y + H - 18, 130);
          const gold = Fx.particles(this, ['effects.sparkle_1', 'effects.sparkle_2'], {
            tint: 0xffd040,
            lifespan: 1200,
            speed: { min: 30, max: 90 },
            scale: { start: 0.3, end: 0 },
            gravityY: -30,
            blendMode: Phaser.BlendModes.ADD,
          }).setDepth(6);
          const d = dust();
          return {
            action: () => {
              b.img.setAngle(0).setAlpha(1).clearTint();
              this.tweens.add({ targets: b.img, angle: 90, duration: 600, ease: 'Quad.In' });
              b.img.setTint(0x666666);
              d.explode(20, b.img.x, b.img.y);
              this.tweens.add({ targets: b.img, alpha: 0, delay: 1200, duration: 1200 });
              const tr = this.sprite(
                b.img.x,
                b.img.y - 30,
                'characters.bosses.butcher_trophy_key',
                0.6,
              ).setDepth(5);
              Fx.dropHop(this, tr);
              gold.explode(30, tr.x, tr.y);
              this.time.delayedCall(3000, () => {
                tr.destroy();
                b.img.setAngle(0).setAlpha(1).clearTint();
              });
            },
          };
        },
      },
    ];
  }

  /** §10 Транспорт: колёса по пути, гусеница, покачивание и наклон, пыль/брызги, таран. */
  private vehicleDemos(): Demo[] {
    const W = CELL_W;
    const H = 190;
    const reg = registry();
    const make = (id: string, x: number, y: number) => {
      const d = reg.vehicles.require(id);
      const body = this.sprite(x, y, d.body);
      const wheels = d.wheel
        ? [0, 1].map(() => this.sprite(0, 0, d.wheel!).setOrigin(0.5).setDepth(1.1))
        : [];
      let track: Phaser.GameObjects.TileSprite | null = null;
      if (d.track) {
        const info = getAssetInfo(d.track)!;
        track = this.add
          .tileSprite(x, y, info.size[0], info.size[1], info.group, info.frame)
          .setOrigin(0.5, 1)
          .setDepth(1.1);
      }
      return { d, body, wheels, track };
    };
    const pos: Record<string, [number, number]> = {
      pickup: [0.27, 0.8],
      quad: [0.2, 0.78],
      moped: [0.23, 0.82],
      bicycle: [0.2, 0.79],
    };
    const drive = (v: ReturnType<typeof make>, tm: number, x0: number, span: number, y: number) => {
      const p = (tm / 3000) % 2;
      const k = p < 1 ? p : 2 - p;
      const dir = p < 1 ? 1 : -1;
      const x = x0 + k * span;
      const odo = (tm / 3000) * span;
      const accel = Math.cos(k * Math.PI) * dir;
      v.body
        .setPosition(x, y - 8 + Math.round(Math.sin(tm / 60)))
        .setFlipX(dir < 0)
        .setAngle(-accel * 2 * dir);
      const w = v.body.displayWidth;
      const ps = pos[v.d.id] ?? [0.22, 0.8];
      v.wheels.forEach((wh, i) => {
        const fx = dir < 0 ? 1 - ps[i]! : ps[i]!;
        wh.setPosition(x - w / 2 + fx * w, y - wh.displayHeight / 2).setRotation(
          (odo / (wh.displayHeight / 2)) * dir,
        );
      });
      if (v.track) {
        v.track.setPosition(x, y);
        v.track.tilePositionX = odo * dir;
      }
      return { x, dir, w };
    };
    return [
      {
        title: '§10 пикап: колёса, покачивание, наклон, пыль',
        build: (x, y) => {
          this.groundPatch(x + 10, y + 10, W - 20, H - 20, 'dirt');
          const v = make('pickup', x + 100, y + H - 30);
          const d = Fx.particles(this, ['effects.dust_1', 'effects.dust_2'], {
            tint: 0x9a8a70,
            lifespan: 500,
            speed: { min: 20, max: 60 },
            angle: { min: 200, max: 340 },
            scale: { start: 0.22, end: 0 },
            gravityY: 60,
          }).setDepth(0.9);
          return {
            update: (tm) => {
              const r = drive(v, tm, x + 100, W - 200, y + H - 30);
              if (Math.random() < 0.5) d.explode(1, r.x - r.dir * r.w * 0.35, y + H - 34);
            },
          };
        },
      },
      {
        title: '§10 вездеход: прокрутка гусеницы',
        build: (x, y) => {
          this.groundPatch(x + 10, y + 10, W - 20, H - 20, 'snow');
          const v = make('snowcat', x + 100, y + H - 30);
          const d = Fx.particles(this, ['effects.dust_1'], {
            tint: 0xffffff,
            lifespan: 500,
            speed: { min: 20, max: 60 },
            angle: { min: 200, max: 340 },
            scale: { start: 0.22, end: 0 },
            gravityY: 60,
          }).setDepth(0.9);
          return {
            update: (tm) => {
              const r = drive(v, tm, x + 100, W - 200, y + H - 30);
              if (Math.random() < 0.5) d.explode(1, r.x - r.dir * r.w * 0.35, y + H - 34);
            },
          };
        },
      },
      {
        title: '§10 квадроцикл: брызги в болоте, таран',
        build: (x, y) => {
          this.groundPatch(x + 10, y + 10, W - 20, H - 20, 'swamp_mud');
          const v = make('quad', x + 90, y + H - 30);
          const sp = Fx.particles(this, ['effects.water_splash'], {
            lifespan: 400,
            speed: { min: 30, max: 80 },
            angle: { min: 220, max: 320 },
            scale: { start: 0.2, end: 0 },
            gravityY: 200,
          }).setDepth(0.9);
          const z = this.sprite(x + W - 50, y + H - 22, 'characters.enemies.walker_idle').setOrigin(0.5, 1);
          z.setScale(70 / z.frame.height);
          return {
            update: (tm) => {
              const r = drive(v, tm, x + 90, W - 180, y + H - 30);
              if (Math.random() < 0.6) sp.explode(1, r.x - r.dir * r.w * 0.35, y + H - 34);
            },
            action: () => {
              Fx.cameraShake(this, 150, 0.008);
              this.tweens.add({ targets: z, x: z.x + 40, angle: 40, duration: 250, yoyo: true, hold: 300 });
            },
          };
        },
      },
    ];
  }

  /** §11 (шаг 9): плашка уведомления, уровень — золотая вспышка, стрелка обучения и пульс кнопки, часы, счётчик. */
  private uiStep9Demos(): Demo[] {
    const W = CELL_W;
    const H = 190;
    return [
      {
        title: '§11 уведомление и уровень (вспышка, блёстки)',
        build: (x, y) => {
          const hero = this.sprite(x + W / 2, y + H - 20, 'characters.hero.ref_idle').setOrigin(0.5, 1);
          hero.setScale(90 / hero.frame.height);
          const sp = Fx.particles(this, ['effects.sparkle_1', 'effects.sparkle_2'], {
            tint: 0xffe070,
            lifespan: 900,
            speed: { min: 40, max: 120 },
            scale: { start: 0.3, end: 0 },
            gravityY: -40,
            blendMode: Phaser.BlendModes.ADD,
          }).setDepth(6);
          return {
            action: () => {
              const txt = this.add.bitmapText(0, 0, UI_FONT, 'Новый уровень: 5!', 16).setOrigin(0.5);
              const bg = this.add
                .rectangle(0, 0, txt.width + 30, 34, 0x1d1a16, 0.95)
                .setStrokeStyle(2, 0xffd040);
              const box = this.add.container(x + W / 2, y + 10, [bg, txt]).setDepth(7);
              this.tweens.add({ targets: box, y: y + 40, duration: 220, ease: 'Back.Out' });
              this.time.delayedCall(2500, () =>
                this.tweens.add({ targets: box, alpha: 0, duration: 220, onComplete: () => box.destroy() }),
              );
              const ring = this.add
                .circle(hero.x, hero.y - 45, 20, 0xffd040, 0.5)
                .setDepth(6)
                .setBlendMode(Phaser.BlendModes.ADD);
              this.tweens.add({
                targets: ring,
                scale: 4,
                alpha: 0,
                duration: 700,
                onComplete: () => ring.destroy(),
              });
              sp.explode(24, hero.x, hero.y - 45);
            },
          };
        },
      },
      {
        title: '§11 обучение: стрелка к цели, кнопка пульсирует',
        build: (x, y) => {
          this.groundPatch(x + 10, y + 10, W - 20, H - 20, 'grass');
          const bush = this.sprite(x + 80, y + H - 30, 'world.biome1_suburb.bush_berries');
          const arrow = this.add
            .triangle(0, 0, 0, 0, 22, 0, 11, 22, 0xffd040)
            .setStrokeStyle(2, 0x000000)
            .setDepth(5);
          const btn = this.sprite(x + W - 60, y + H - 60, 'ui.btn_action', 0.5).setDepth(5);
          this.tweens.add({ targets: btn, scale: btn.scale * 1.15, duration: 450, yoyo: true, repeat: -1 });
          return { update: (tm) => arrow.setPosition(bush.x - 11, bush.y - 90 + Math.sin(tm / 200) * 6) };
        },
      },
      {
        title: '§11 часы дня/ночи и «кровавая ночь скоро»',
        build: (x, y) => {
          const clock = this.sprite(x + 70, y + 90, 'ui.clock_day_night', 1.4);
          const txt = this.add
            .bitmapText(x + 130, y + 90, UI_FONT, 'Кровавая ночь через 1 ч!', 14)
            .setOrigin(0, 0.5)
            .setTint(0xff4030);
          return {
            update: (tm) => {
              clock.setRotation(((tm / 8000) % 1) * Math.PI * 2);
              txt.setScale(1 + 0.08 * Math.sin(tm / 120));
            },
          };
        },
      },
    ];
  }

  /** §2 Враги и звери: настоящий вид EnemyViews на сущностях Enemy (шаг, удар, особые механики). */
  private enemyDemos(): Demo[] {
    const W = CELL_W;
    const H = 190;
    const reg = registry();
    const views = new EnemyViews(this, reg);
    const list: Enemy[] = [];
    let night = false;
    this.events.on(Phaser.Scenes.Events.UPDATE, (time: number) => {
      // Демо: ходят туда-обратно, раз в 2 с — атака/особое действие.
      for (const e of list) {
        if (!e.alive) continue;
        const phase = Math.floor(time / 2000) % 2;
        e.moving = phase === 0;
        e.faceDeg = Math.floor(time / 4000) % 2 ? 180 : 0;
      }
      views.update(time, time / 1000, list, night, () => false, { x: 0, y: 0 });
    });
    const special: Record<string, string> = {
      spitter: 'sac',
      toad: 'tongue',
      sprinter: 'leap',
      raptor: 'leap',
      armored_lizard: 'windup',
      dog: 'leap',
      snow_wolf: 'leap',
      boar: 'windup',
    };
    return reg.enemies.all.map((d, i) => ({
      title: `§2 ${d.name_ru}${i % 5 === 0 ? ' (элита)' : ''}`,
      build: (x, y) => {
        this.groundPatch(x + 10, y + 10, W - 20, H - 20, d.biomes[0]! >= 4 ? 'sand' : 'grass');
        const e = new Enemy(reg, d, `g${d.id}`, (x + W / 2) / TILE, (y + H - 22) / TILE, i % 5 === 0);
        e.hidden = false;
        list.push(e);
        return {
          update: (tm) => {
            const k = tm / 1000;
            if (Math.floor(tm / 2000) % 2 === 1 && k - e.anim.at > 2)
              e.anim = { kind: special[d.id] ?? 'attack', at: k };
          },
          action: () => {
            if (d.id === 'snow_wolf') night = !night;
            else if (d.id === 'soldier') views.helmet(e);
            else if (d.id === 'crawler' || d.id === 'scorpion') {
              e.hidden = true;
              this.time.delayedCall(800, () => (e.hidden = false));
            } else {
              e.hp = 0;
              e.state = 'dead';
              this.time.delayedCall(2500, () => {
                e.hp = e.maxHp;
                e.state = 'idle';
                list.splice(list.indexOf(e), 1);
                const n = new Enemy(reg, d, `g${d.id}${tm()}`, e.x, e.y, e.elite);
                n.hidden = false;
                list.push(n);
              });
            }
          },
        };
      },
    }));
    function tm(): number {
      return Math.floor(Math.random() * 1e9);
    }
  }

  /** §9 Бой: попадание и цифры, выстрел (вспышка, трассер, гильза), молотов, граната. */
  private combatDemos(): Demo[] {
    const W = CELL_W;
    const H = 190;
    const reg = registry();
    const ground = (x: number, y: number) => this.groundPatch(x + 10, y + 10, W - 20, H - 20, 'dirt');
    const sparks = () =>
      Fx.particles(this, ['effects.spark_1', 'effects.spark_2', 'effects.spark_3'], {
        tint: 0xffe0a0,
        lifespan: 220,
        speed: { min: 60, max: 160 },
        scale: { start: 0.16, end: 0 },
        gravityY: 0,
        blendMode: Phaser.BlendModes.ADD,
      }).setDepth(6);
    const number = (px: number, py: number, v: string, tint: number, size: number) => {
      const txt = this.add.bitmapText(px, py, UI_FONT, v, size).setOrigin(0.5).setTint(tint).setDepth(7);
      this.tweens.add({
        targets: txt,
        y: py - 50,
        alpha: 0,
        duration: 800,
        ease: 'Quad.Out',
        onComplete: () => txt.destroy(),
      });
    };
    const target = (x: number, y: number) => {
      const e = this.sprite(x, y, 'characters.enemies.walker_idle').setOrigin(0.5, 1);
      e.setScale(80 / e.frame.height);
      return e;
    };
    return [
      {
        title: '§9 попадание: искры, вспышка, отброс, цифры',
        build: (x, y) => {
          ground(x, y);
          const sp = sparks();
          const e = target(x + W / 2 + 40, y + H - 20);
          const ex = e.x;
          let n = 0;
          return {
            action: () => {
              n++;
              sp.explode(8, e.x - 10, e.y - 45);
              e.setTintFill(0xffffff);
              this.time.delayedCall(90, () => e.clearTint());
              this.tweens.add({ targets: e, x: ex + 8, duration: 60, yoyo: true });
              const kind = n % 3;
              number(
                e.x,
                e.y - 90,
                kind === 2 ? '+15' : kind === 1 ? '42' : '12',
                kind === 2 ? 0x70e070 : kind === 1 ? 0xffd040 : 0xffffff,
                kind === 1 ? 22 : 16,
              );
              if (kind === 1) Fx.hitStop(this, 40);
            },
          };
        },
      },
      {
        title: '§9 выстрел: вспышка, трассер 60 мс, гильза',
        build: (x, y) => {
          ground(x, y);
          const gun = this.sprite(x + 60, y + H - 70, reg.items.require('pistol').icon, 0.6);
          const e = target(x + W - 50, y + H - 20);
          const casings = Fx.particles(this, ['effects.spark_3'], {
            tint: 0xd8b040,
            lifespan: 500,
            speed: { min: 60, max: 110 },
            angle: { min: 200, max: 250 },
            scale: { start: 0.1, end: 0.08 },
            gravityY: 400,
          }).setDepth(6);
          return {
            action: () => {
              const m = this.sprite(gun.x + 25, gun.y, 'effects.muzzle_1', 0.35)
                .setOrigin(0, 0.5)
                .setBlendMode(Phaser.BlendModes.ADD)
                .setDepth(6);
              this.time.delayedCall(60, () => m.destroy());
              const g = this.add.graphics().setDepth(6);
              g.lineStyle(2, 0xffe080, 0.9).lineBetween(gun.x + 30, gun.y, e.x, e.y - 45);
              this.time.delayedCall(60, () => g.destroy());
              casings.explode(1, gun.x, gun.y);
              e.setTintFill(0xffffff);
              this.time.delayedCall(90, () => e.clearTint());
              number(e.x, e.y - 90, '30', 0xffffff, 16);
            },
          };
        },
      },
      {
        title: '§9 молотов: вращение, огонь на площади 3 с',
        build: (x, y) => {
          ground(x, y);
          return {
            action: () => {
              const b = this.sprite(x + 40, y + H - 60, reg.items.require('molotov').icon, 0.4).setDepth(6);
              const tx = x + W - 80;
              const ty = y + H - 40;
              this.tweens.add({ targets: b, x: tx, duration: 600 });
              this.tweens.add({ targets: b, y: y + 40, duration: 300, yoyo: true, ease: 'Quad.Out' });
              this.tweens.add({ targets: b, angle: 720, duration: 600 });
              this.time.delayedCall(600, () => {
                b.destroy();
                for (let i = 0; i < 4; i++) {
                  const a = (i / 4) * Math.PI * 2;
                  const f = this.add
                    .sprite(tx + Math.cos(a) * 25, ty + Math.sin(a) * 10, 'effects')
                    .play({ key: 'fx-flame', startFrame: i })
                    .setOrigin(0.5, 1)
                    .setScale(0.45)
                    .setBlendMode(Phaser.BlendModes.ADD)
                    .setDepth(6);
                  this.time.delayedCall(3000, () =>
                    this.tweens.add({ targets: f, alpha: 0, duration: 400, onComplete: () => f.destroy() }),
                  );
                }
              });
            },
          };
        },
      },
      {
        title: '§9 граната: отскок, мигание, взрыв',
        build: (x, y) => {
          ground(x, y);
          const dv = new DefenseViews(this, reg);
          return {
            update: () => dv.update(this.time.now, [], [], () => {}),
            action: () => {
              const g = this.sprite(x + 40, y + H - 60, reg.items.require('grenade').icon, 0.35).setDepth(6);
              const tx = x + W - 90;
              const ty = y + H - 40;
              this.tweens.chain({
                targets: g,
                tweens: [
                  { x: tx - 30, y: ty, duration: 450, ease: 'Quad.In' },
                  { x: tx - 10, y: ty - 20, duration: 150, ease: 'Quad.Out' },
                  { x: tx, y: ty, duration: 150, ease: 'Quad.In' },
                ],
              });
              const blink = this.time.addEvent({
                delay: 120,
                loop: true,
                callback: () => g.setTint(g.tintTopLeft === 0xff4040 ? 0xffffff : 0xff4040),
              });
              this.time.delayedCall(1300, () => {
                blink.remove();
                g.destroy();
                dv.explode(tx / TILE, ty / TILE, 1.6);
              });
            },
          };
        },
      },
    ];
  }

  /** §7 Строительство и защита. */
  private buildDemos(): Demo[] {
    const W = CELL_W;
    const H = 190;
    const reg = registry();
    const mats = reg.building.materials;
    const ground = (x: number, y: number, tile = 'grass') =>
      this.groundPatch(x + 10, y + 10, W - 20, H - 20, tile);
    const dustFx = () =>
      Fx.particles(this, ['effects.dust_1', 'effects.dust_2', 'effects.dust_3'], {
        tint: 0x9a8a70,
        lifespan: 700,
        speed: { min: 30, max: 110 },
        angle: { min: 200, max: 340 },
        scale: { start: 0.3, end: 0 },
        gravityY: 150,
      }).setDepth(5);
    /** Стена: верх + лицо материала m в точке (x, y — левый верх верха). */
    const wall = (x: number, y: number, m: number, piece: 'face' | 'window' | 'door_opening' = 'face') => {
      const cap = this.sprite(x, y, mats[m]!.sprites.top_cap).setOrigin(0, 0);
      const face = this.sprite(x, y + TILE, mats[m]!.sprites[piece]).setOrigin(0, 0);
      return { cap, face };
    };
    return [
      {
        title: '§7 призрак: пульс, зелёный/красный',
        build: (x, y) => {
          ground(x, y);
          const g = [0, 1, 2].map((i) =>
            this.sprite(x + 60 + i * TILE, y + 50, mats[0]!.sprites.top_cap).setOrigin(0, 0),
          );
          return {
            update: (tm) => {
              const ok = Math.floor(tm / 1500) % 2 === 0;
              const a = 0.55 + 0.2 * Math.sin((tm / 900) * Math.PI * 2);
              g.forEach((im) => im.setTint(ok ? 0x80ff80 : 0xff6060).setAlpha(a));
            },
          };
        },
      },
      {
        title: '§7 установка: отскок + пыль',
        build: (x, y) => {
          ground(x, y);
          const d = dustFx();
          const parts = [0, 1, 2].map((i) => wall(x + 60 + i * TILE, y + 30, 0));
          return {
            action: () =>
              parts.forEach((p, i) =>
                this.time.delayedCall(i * 120, () => {
                  Fx.popIn(this, p.cap);
                  Fx.popIn(this, p.face);
                  d.explode(6, p.cap.x + TILE / 2, p.face.y + p.face.displayHeight);
                }),
              ),
          };
        },
      },
      {
        title: '§7 улучшение: вспышка, смена, искры',
        build: (x, y) => {
          ground(x, y);
          let m = 0;
          let p = wall(x + W / 2 - TILE / 2, y + 30, m);
          const sparks = Fx.particles(this, ['effects.spark_1', 'effects.spark_3'], {
            tint: 0xffd040,
            speed: { min: 60, max: 160 },
            scale: { start: 0.2, end: 0 },
            blendMode: Phaser.BlendModes.ADD,
          }).setDepth(5);
          return {
            action: () => {
              for (const im of [p.cap, p.face]) im.setTintFill(0xffffff);
              this.time.delayedCall(120, () => {
                p.cap.destroy();
                p.face.destroy();
                m = (m + 1) % mats.length;
                p = wall(x + W / 2 - TILE / 2, y + 30, m);
                sparks.explode(12, x + W / 2, y + 30 + TILE);
              });
            },
          };
        },
      },
      {
        title: '§7 урон стене: тряска, трещины, пыль',
        build: (x, y) => {
          ground(x, y);
          const d = dustFx();
          const p = wall(x + W / 2 - TILE / 2, y + 30, 1);
          const ov = this.sprite(p.face.x, p.face.y, mats[1]!.sprites.damage_overlay)
            .setOrigin(0, 0)
            .setAlpha(0);
          let hp = 1;
          return {
            action: () => {
              hp = hp <= 0.2 ? 1 : hp - 0.2;
              const lost = 1 - hp;
              ov.setAlpha(lost >= reg.build.damageOverlayFrom ? lost : 0);
              Fx.shake(this, p.face, 1);
              Fx.shake(this, p.cap, 1);
              d.explode(5, p.face.x + TILE / 2, p.face.y + p.face.displayHeight);
            },
          };
        },
      },
      {
        title: '§7 разрушение: обломки, пыль, тряска',
        build: (x, y) => {
          ground(x, y);
          const d = dustFx();
          let p = wall(x + W / 2 - TILE / 2, y + 30, 2);
          let rub: Phaser.GameObjects.Image | null = null;
          return {
            action: () => {
              if (rub) {
                rub.destroy();
                rub = null;
                p = wall(x + W / 2 - TILE / 2, y + 30, 2);
                return;
              }
              p.cap.destroy();
              p.face.destroy();
              rub = this.sprite(x + W / 2 - TILE / 2, y + 30 + TILE * 0.4, mats[2]!.sprites.rubble).setOrigin(
                0,
                0,
              );
              d.explode(18, x + W / 2, y + 30 + TILE * 1.5);
              Fx.cameraShake(this, 200, 0.006);
            },
          };
        },
      },
      {
        title: '§7 дверь: сжатие к петле 0.15 с',
        build: (x, y) => {
          ground(x, y);
          const p = wall(x + W / 2 - TILE / 2, y + 20, 0, 'door_opening');
          const door = this.sprite(p.face.x, p.face.y, mats[0]!.sprites.door).setOrigin(0, 0);
          const sx = door.scaleX;
          let open = false;
          return {
            action: () => {
              open = !open;
              this.tweens.add({ targets: door, scaleX: open ? sx * 0.2 : sx, duration: 150 });
            },
          };
        },
      },
      {
        title: '§7 капкан: захлопывание с тряской',
        build: (x, y) => {
          ground(x, y, 'dirt');
          const open = this.sprite(x + W / 2, y + H - 50, 'world.defense.bear_trap_open', 1.6);
          const closed = this.sprite(x + W / 2, y + H - 50, 'replacements.bear_trap_closed', 1.6).setVisible(
            false,
          );
          return {
            action: () => {
              const shut = !closed.visible;
              open.setVisible(!shut);
              closed.setVisible(shut);
              if (shut) Fx.shake(this, closed, 3);
            },
          };
        },
      },
      {
        title: '§7 турели: поворот, отдача, вспышка, гильзы',
        build: (x, y) => {
          ground(x, y, 'dirt');
          const bases = [x + 80, x + 220].map((bx) =>
            this.sprite(bx, y + H - 40, 'world.defense.turret_base'),
          );
          const heads = [
            this.sprite(bases[0]!.x, 0, 'replacements.turret_head_mg').setOrigin(0.5),
            this.sprite(bases[1]!.x, 0, 'world.defense.turret_head_energy').setOrigin(0.5),
          ];
          heads.forEach((h, i) => h.setY(bases[i]!.y - bases[i]!.displayHeight * 0.62).setDepth(3));
          const target = this.add.circle(x + W / 2, y + 40, 6, 0xd04030).setDepth(4);
          const casings = Fx.particles(this, ['effects.spark_3'], {
            tint: 0xd8b040,
            lifespan: 500,
            speed: { min: 60, max: 110 },
            angle: { min: 200, max: 250 },
            scale: { start: 0.1, end: 0.08 },
            gravityY: 400,
          }).setDepth(5);
          const angles = [0, 0];
          const next = [0, 0];
          return {
            update: (tm) => {
              target.x = x + W / 2 + Math.sin(tm / 900) * 110;
              heads.forEach((h, i) => {
                const want = Math.atan2(target.y - h.y, target.x - h.x);
                const diff = Phaser.Math.Angle.Wrap(want - angles[i]!);
                angles[i] = angles[i]! + Phaser.Math.Clamp(diff, -0.05, 0.05);
                const a = angles[i]!;
                const flip = Math.cos(a) < 0;
                h.setRotation(flip ? a - Math.PI : a).setFlipX(flip);
                if (i === 1)
                  h.setTint(Phaser.Display.Color.GetColor(200 + 55 * Math.abs(Math.sin(tm / 300)), 230, 255));
                if (Math.abs(diff) < 0.2 && tm > next[i]!) {
                  next[i] = tm + (i === 0 ? 200 : 650);
                  const tipX = h.x + Math.cos(a) * 30;
                  const tipY = h.y + Math.sin(a) * 30;
                  const m = this.sprite(tipX, tipY, i === 0 ? 'effects.muzzle_1' : 'effects.muzzle_2', 0.35)
                    .setOrigin(0, 0.5)
                    .setRotation(a)
                    .setBlendMode(Phaser.BlendModes.ADD)
                    .setDepth(5);
                  this.time.delayedCall(60, () => m.destroy());
                  const bx = h.x;
                  const by = h.y;
                  h.setPosition(bx - Math.cos(a) * 4, by - Math.sin(a) * 4);
                  this.tweens.add({ targets: h, x: bx, y: by, duration: 90 });
                  if (i === 0) casings.explode(1, bx, by);
                }
              });
            },
          };
        },
      },
      {
        title: '§7 мина/бочка: взрыв, тряска, пятно',
        build: (x, y) => {
          ground(x, y, 'dirt');
          const mine = this.sprite(x + W / 2, y + H - 50, 'world.defense.landmine', 1.5);
          const views = new DefenseViews(this, reg);
          const toLocal = (px: number) => px / TILE;
          return {
            action: () => {
              mine.setVisible(false);
              views.explode(toLocal(mine.x), toLocal(mine.y), 1.5);
              this.time.delayedCall(2500, () => mine.setVisible(true));
            },
            update: () => views.update(this.time.now, [], [], () => {}),
          };
        },
      },
    ];
  }

  /** §8 Станки и база, §11 готовность станка. */
  private stationDemos(): Demo[] {
    const W = CELL_W;
    const H = 190;
    const ground = (x: number, y: number, tile = 'dirt') =>
      this.groundPatch(x + 10, y + 10, W - 20, H - 20, tile);
    const sparks = () =>
      Fx.particles(this, ['effects.spark_1', 'effects.spark_2'], {
        tint: 0xffb040,
        lifespan: 700,
        speed: { min: 20, max: 60 },
        angle: { min: 250, max: 290 },
        scale: { start: 0.12, end: 0 },
        gravityY: -40,
        blendMode: Phaser.BlendModes.ADD,
      }).setDepth(4);
    const smoke = () =>
      Fx.particles(this, ['effects.smoke_1', 'effects.smoke_2'], {
        lifespan: 1800,
        speed: { min: 6, max: 16 },
        angle: { min: 255, max: 285 },
        scale: { start: 0.18, end: 0.45 },
        alpha: { start: 0.45, end: 0 },
        gravityY: -10,
      }).setDepth(4);
    const every = (ms: number) => {
      let next = 0;
      return (tm: number) => (tm >= next ? ((next = tm + ms * (0.6 + Math.random() * 0.8)), true) : false);
    };
    return [
      {
        title: '§8 костёр: пламя, искры, дым, свет',
        build: (x, y) => {
          ground(x, y);
          const cx = x + W / 2;
          const by = y + H - 30;
          const light = this.add
            .image(cx, by - 20, TEX.glow)
            .setDisplaySize(170, 170)
            .setTint(0xffa040)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setAlpha(0.5);
          const unlit = this.sprite(cx, by, 'world.interior.campfire_unlit', 1.4).setVisible(false);
          const coals = this.sprite(cx, by, 'world.interior.campfire_coals', 1.4);
          const flame = this.add
            .sprite(cx, by - 10, 'effects')
            .play('fx-flame')
            .setOrigin(0.5, 1)
            .setScale(0.7)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setDepth(3);
          const sp = sparks();
          const sm = smoke();
          const spark = every(260);
          const puff = every(700);
          let on = true;
          return {
            update: (tm) => {
              if (!on) return;
              light.setAlpha(0.5 * (1 + 0.1 * Math.sin(tm / 90) + 0.07 * Math.sin(tm / 37)));
              if (spark(tm)) sp.explode(1, cx + (Math.random() - 0.5) * 12, by - 26);
              if (puff(tm)) sm.explode(1, cx, by - 46);
            },
            action: () => {
              on = !on;
              unlit.setVisible(!on);
              coals.setVisible(on);
              flame.setVisible(on);
              light.setVisible(on);
            },
          };
        },
      },
      {
        title: '§8 горн и плавильня: свечение и искры',
        build: (x, y) => {
          ground(x, y, 'gravel');
          const sp = sparks();
          const items = ['world.interior.forge', 'world.interior.smelter'].map((id, i) => {
            const img = this.sprite(x + 90 + i * 130, y + H - 25, id, 1.3);
            const g = this.add
              .image(img.x, img.y - img.displayHeight * 0.35, TEX.glow)
              .setDisplaySize(img.displayWidth * 1.3, img.displayWidth * 1.3)
              .setTint(0xff7a1a)
              .setBlendMode(Phaser.BlendModes.ADD)
              .setDepth(2);
            return { img, g, spark: every(900) };
          });
          return {
            update: (tm) =>
              items.forEach(({ img, g, spark }) => {
                g.setAlpha(0.45 + 0.3 * Math.sin((tm / 1400) * Math.PI * 2));
                if (spark(tm)) sp.explode(2, img.x, img.y - img.displayHeight * 0.6);
              }),
          };
        },
      },
      {
        title: '§8 генератор: дрожь ±1 px, дым, лампа',
        build: (x, y) => {
          ground(x, y, 'gravel');
          const gen = this.sprite(x + W / 2, y + H - 25, 'world.interior.generator', 1.4);
          const bx = gen.x;
          const sm = smoke();
          const puff = every(700);
          const lamp = this.add
            .image(bx - gen.displayWidth * 0.25, gen.y - gen.displayHeight * 0.55, TEX.dot)
            .setDisplaySize(7, 7)
            .setTint(0x60ff60)
            .setDepth(3);
          return {
            update: (tm) => {
              gen.x = bx + (Math.floor(tm / 50) % 2 === 0 ? 1 : -1);
              lamp.setVisible(Math.floor(tm / 500) % 2 === 0);
              if (puff(tm)) sm.explode(1, bx + gen.displayWidth * 0.25, gen.y - gen.displayHeight + 4);
            },
          };
        },
      },
      {
        title: '§8/§11 станок: прогресс, готово',
        build: (x, y) => {
          ground(x, y, 'grass');
          const wb = this.sprite(x + W / 2, y + H - 30, 'world.interior.workbench_1', 1.3);
          const top = wb.y - wb.displayHeight;
          const bg = this.add
            .rectangle(wb.x - 16, top - 6, 32, 6, 0x000000, 0.65)
            .setOrigin(0, 0.5)
            .setDepth(3);
          const fill = this.add
            .rectangle(wb.x - 15, top - 6, 1, 4, 0x7ed957)
            .setOrigin(0, 0.5)
            .setDepth(3);
          const icon = this.sprite(wb.x, top - 12, 'icons.tools.wrench', 0.5)
            .setDepth(3)
            .setVisible(false);
          const CYCLE = 3000;
          return {
            update: (tm) => {
              const p = (tm % (CYCLE * 2)) / CYCLE;
              const working = p < 1;
              bg.setVisible(working);
              fill.setVisible(working).setSize(Math.max(1, 30 * Math.min(1, p)), 4);
              icon.setVisible(!working);
              icon.y = top - 8 - Math.abs(Math.sin((tm / 700) * Math.PI)) * 6;
            },
          };
        },
      },
      {
        title: '§8 грядка: 3 стадии, отскок',
        build: (x, y) => {
          ground(x, y);
          const ids = [
            'world.interior.garden_empty',
            'world.interior.garden_sprouts',
            'world.interior.garden_ripe',
          ];
          const imgs = ids.map((id) => this.sprite(x + W / 2, y + H - 30, id, 1.3).setVisible(false));
          let stage = 0;
          imgs[0]!.setVisible(true);
          const next = () => {
            imgs[stage]!.setVisible(false).setAngle(0);
            stage = (stage + 1) % 3;
            imgs[stage]!.setVisible(true);
            Fx.popIn(this, imgs[stage]!);
          };
          return {
            update: (tm) => {
              if (stage === 2) imgs[2]!.setAngle(Math.sin(tm / 600) * 2);
            },
            action: next,
          };
        },
      },
      {
        title: '§8 тотем: лампа, кольцо',
        build: (x, y) => {
          ground(x, y, 'grass');
          const core = this.sprite(x + W / 2, y + H - 40, 'world.interior.base_core', 1.3);
          const lamp = this.add
            .image(core.x, core.y - core.displayHeight + 6, TEX.dot)
            .setDisplaySize(9, 9)
            .setTint(0xff3030)
            .setDepth(3);
          const ring = this.add
            .ellipse(core.x, core.y - 4, 10, 5)
            .setStrokeStyle(2, 0xff5040, 1)
            .setDepth(1);
          return {
            update: (tm) => {
              lamp.setAlpha(0.35 + 0.65 * Math.abs(Math.sin((tm / 900) * Math.PI)));
              const p = (tm % 2000) / 2000;
              ring.setSize(20 + p * 230, (20 + p * 230) * 0.45).setAlpha(1 - p);
            },
          };
        },
      },
    ];
  }

  /** Псевдо-вид объекта мира для эффектов WorldFx. */
  private fakeView(img: Phaser.GameObjects.Image, kind: string, id: string): ObjView {
    const obj: WorldObject = {
      uid: id,
      ref: { type: 'biome', biome: 1, id },
      kind,
      sprite: '',
      x: img.x / TILE,
      y: img.y / TILE,
      biome: 1,
      collider: null,
      state: 'intact',
    };
    return { obj, img, phase: 0, baseScaleX: img.scaleX, baseScaleY: img.scaleY, alpha: 1 };
  }

  /** §6 Добыча и взаимодействие, §11 перетаскивание и панели. */
  private harvestDemos(): Demo[] {
    const W = CELL_W;
    const H = 190;
    const fx = new WorldFx(this, registry());
    const hit = { progress: 1, wear: 1, stamina: 1, proper: true };
    const ground = (x: number, y: number, tile = 'grass') =>
      this.groundPatch(x + 10, y + 10, W - 20, H - 20, tile);
    return [
      {
        title: '§6 удар: тряска + частицы по материалу',
        build: (x, y) => {
          ground(x, y, 'dirt');
          const items: [string, string][] = [
            ['world.biome1_suburb.pine', 'tree'],
            ['world.biome1_suburb.boulder', 'rock'],
            ['world.biome1_suburb.scrap_pile', 'scrap'],
          ];
          const views = items.map(([id, kind], i) =>
            this.fakeView(this.sprite(x + 55 + i * 95, y + H - 22, id, i === 0 ? 0.55 : 0.8), kind, id),
          );
          return { action: () => views.forEach((v) => fx.hit(v.obj, v, hit, v.img.x - 50)) };
        },
      },
      {
        title: '§6 падение дерева (0.6 с, пыль, тряска)',
        build: (x, y) => {
          ground(x, y);
          const tree = this.sprite(x + W / 2, y + H - 20, 'world.biome1_suburb.pine', 0.7);
          const stump = this.sprite(x + W / 2, y + H - 20, 'world.biome1_suburb.pine_stump', 0.7).setVisible(
            false,
          );
          return {
            action: () => {
              tree.setVisible(true);
              stump.setVisible(false);
              fx.treeFall(this.fakeView(tree, 'tree', 'pine'), x + 20);
              tree.setVisible(false);
              stump.setVisible(true);
              this.time.delayedCall(2200, () => {
                tree.setVisible(true);
                stump.setVisible(false);
              });
            },
          };
        },
      },
      {
        title: '§6 камень раскалывается',
        build: (x, y) => {
          ground(x, y, 'gravel');
          const rock = this.sprite(x + W / 2, y + H - 25, 'world.biome1_suburb.boulder');
          const mined = this.sprite(x + W / 2, y + H - 25, 'world.biome1_suburb.boulder_mined').setVisible(
            false,
          );
          return {
            action: () => {
              const v = this.fakeView(rock, 'rock', 'boulder');
              fx.hit(v.obj, v, hit, x);
              this.time.delayedCall(140, () => {
                rock.setVisible(false);
                mined.setVisible(true);
                fx.rockCrack(v.obj);
              });
              this.time.delayedCall(1800, () => {
                rock.setVisible(true);
                mined.setVisible(false);
              });
            },
          };
        },
      },
      {
        title: '§6 куст обирается',
        build: (x, y) => {
          ground(x, y);
          const bush = this.sprite(x + W - 80, y + H - 30, 'world.biome1_suburb.bush_berries');
          const picked = this.sprite(x + W - 80, y + H - 30, 'world.biome1_suburb.bush_picked').setVisible(
            false,
          );
          const hero = this.sprite(x + 60, y + H - 15, 'characters.hero.ref_idle').setOrigin(0.5, 1);
          hero.setScale(80 / hero.frame.height);
          return {
            action: () => {
              bush.setVisible(false);
              picked.setVisible(true);
              for (let i = 0; i < 3; i++) {
                const b = this.sprite(bush.x, bush.y - 20, 'icons.food_medicine.berries', 0.4);
                Fx.popIn(this, b);
                this.tweens.add({
                  targets: b,
                  x: hero.x,
                  y: hero.y - 40,
                  scale: 0.1,
                  delay: 250 + i * 90,
                  duration: 300,
                  ease: 'Quad.In',
                  onComplete: () => b.destroy(),
                });
              }
              this.time.delayedCall(1800, () => {
                bush.setVisible(true);
                picked.setVisible(false);
              });
            },
          };
        },
      },
      {
        title: '§6 дроп: рамка редкости, подбор',
        build: (x, y) => {
          ground(x, y, 'dirt');
          const tiers = [1, 2, 3, 4, 6];
          const drops = tiers.map((tier, i) => {
            const rx = x + 40 + i * 52;
            const ry = y + 95;
            const ring = this.add.image(rx, ry, TEX.glow).setDisplaySize(44, 44).setTint(rarityColor(tier));
            const ic = this.sprite(
              rx,
              ry,
              [
                'icons.resources.sticks',
                'icons.base.scrap_metal',
                'icons.resources.copper_ingot',
                'icons.base.steel_ingot',
                'icons.resources.uranium',
              ][i]!,
              0.45,
            );
            return { ring, ic, ry, phase: i };
          });
          const hero = this.sprite(x + W - 30, y + H - 15, 'characters.hero.ref_idle').setOrigin(0.5, 1);
          hero.setScale(70 / hero.frame.height);
          return {
            update: (tm) =>
              drops.forEach((d) => {
                if (!d.ic.active) return;
                d.ic.y = d.ry + Math.sin(tm / 500 + d.phase) * 2;
                d.ring.setY(d.ic.y).setAlpha(0.45 + 0.35 * Math.sin(tm / 250 + d.phase));
              }),
            action: () => {
              const d = drops.find((q) => q.ic.visible);
              if (!d) {
                drops.forEach((q) => {
                  q.ic
                    .setVisible(true)
                    .setPosition(q.ic.x, q.ry)
                    .setScale(q.ic.scale > 0.1 ? q.ic.scale : 0.45 * (64 / q.ic.frame.width) * 2);
                  q.ring.setVisible(true);
                  Fx.dropHop(this, q.ic);
                });
                return;
              }
              d.ring.setVisible(false);
              const sc = d.ic.scale;
              this.tweens.add({
                targets: d.ic,
                x: hero.x,
                y: hero.y - 40,
                scale: sc * 0.3,
                duration: 280,
                ease: 'Quad.In',
                onComplete: () => d.ic.setVisible(false).setScale(sc),
              });
            },
          };
        },
      },
      {
        title: '§6 подсветка: пульс + иконка',
        build: (x, y) => {
          ground(x, y);
          const a = this.sprite(x + 80, y + H - 20, 'world.biome1_suburb.birch', 0.6);
          const b = this.sprite(x + 210, y + H - 25, 'world.interior.crate_wood_closed', 1.3);
          const ga = a.preFX?.addGlow(0xffffff, 2, 0, false, 0.1, 8);
          const gb = b.preFX?.addGlow(0xffd04a, 3, 0, false, 0.1, 8);
          const icon = this.sprite(b.x, b.y - 80, 'ui.btn_action', 0.4).setDepth(5);
          return {
            update: (tm) => {
              const p = 0.65 + 0.35 * Math.sin((tm / 1500) * Math.PI * 2);
              if (ga) ga.outerStrength = 1.6 * p;
              if (gb) gb.outerStrength = 3 * p;
              icon.y = b.y - 80 + Math.sin(tm / 250) * 3;
            },
          };
        },
      },
      {
        title: '§6 открытие контейнера',
        build: (x, y) => {
          this.add.rectangle(x + 10, y + 10, W - 20, H - 20, 0x3a3128).setOrigin(0);
          const closed = this.sprite(x + 90, y + H - 30, 'world.interior.crate_wood_closed', 1.4);
          const open = this.sprite(x + 90, y + H - 30, 'world.interior.crate_wood_open', 1.4).setVisible(
            false,
          );
          const cab = this.sprite(x + 210, y + H - 25, 'world.interior.locker', 1.1);
          return {
            action: () => {
              closed.setVisible(false);
              open.setVisible(true);
              fx.containerOpen(this.fakeView(open, 'container', 'crate'));
              fx.containerOpen(this.fakeView(cab, 'container', 'locker'));
              cab.setTint(0xb3b3b3);
              this.time.delayedCall(1600, () => {
                closed.setVisible(true);
                open.setVisible(false);
                cab.clearTint();
              });
            },
          };
        },
      },
      {
        title: '§6 слоты по одному (50 мс)',
        build: (x, y) => {
          const ids = [
            'icons.base.bandage',
            'icons.base.canned_food',
            'icons.base.water_bottle',
            'icons.base.scrap_metal',
            'icons.base.planks',
            'icons.base.medkit',
          ];
          const cells = ids.map((id, i) => {
            const cx = x + 40 + (i % 3) * 70;
            const cy = y + 60 + Math.floor(i / 3) * 70;
            this.sprite(cx, cy, 'ui.slot', 0.85);
            return this.sprite(cx, cy, id, 0.75).setAlpha(0);
          });
          return {
            action: () =>
              cells.forEach((c, i) => {
                c.setAlpha(0);
                const sc = c.scale;
                c.setScale(sc * 0.6);
                this.tweens.add({
                  targets: c,
                  alpha: 1,
                  scale: sc,
                  delay: i * 50,
                  duration: 160,
                  ease: 'Back.Out',
                });
              }),
          };
        },
      },
      {
        title: '§11 перетаскивание (×1.1)',
        build: (x, y) => {
          const from = { x: x + 60, y: y + 100 };
          const to = { x: x + W - 60, y: y + 100 };
          this.sprite(from.x, from.y, 'ui.slot', 0.9);
          const target = this.sprite(to.x, to.y, 'ui.slot', 0.9);
          const sel = this.sprite(to.x, to.y, 'ui.slot_selected', 0.9).setVisible(false);
          const ic = this.sprite(from.x, from.y, 'icons.tools.axe_steel', 0.8);
          const base = ic.scale;
          return {
            update: (tm) => {
              const p = (tm % 2400) / 2400;
              const k = p < 0.15 ? 0 : p < 0.75 ? (p - 0.15) / 0.6 : 1;
              ic.setPosition(
                from.x + (to.x - from.x) * k,
                from.y + (to.y - from.y) * k - Math.sin(k * Math.PI) * 20,
              );
              ic.setScale(k > 0 && k < 1 ? base * 1.1 : base);
              sel.setVisible(k > 0.7 && k < 1);
              target.setAlpha(1);
            },
          };
        },
      },
      {
        title: '§11 панель: 0.9→1, 0.18 с',
        build: (x, y) => {
          const info = getAssetInfo('ui.panel_9slice')!;
          const panel = this.add
            .nineslice(x + W / 2, y + H / 2, info.group, info.frame, W - 60, H - 40, 22, 22, 22, 22)
            .setDepth(2);
          return {
            action: () => {
              panel.setScale(0.9).setAlpha(0);
              this.tweens.add({ targets: panel, scale: 1, alpha: 1, duration: 180, ease: 'Quad.Out' });
            },
          };
        },
      },
    ];
  }

  /** §1 Герой. */
  private heroDemos(): Demo[] {
    const cell = (title: string, anim: AnimName, every?: number, swaps?: Record<string, string>): Demo => ({
      title,
      build: (x, y) => ({ update: this.heroCell(x, y, anim, every, swaps) }),
    });
    const view = (
      title: string,
      setup: (hv: HeroView, hx: number, hy: number) => (tm: number, dt: number) => void,
    ): Demo => ({
      title,
      build: (x, y) => {
        const hx = x + CELL_W / 2;
        const hy = y + 165;
        const hv = new HeroView(this, registry(), hx, hy);
        hv.setMode(false);
        const step = setup(hv, hx, hy);
        return { update: (tm, dt) => step(tm, dt) };
      },
    });
    return [
      cell('§1 idle: дыхание, голова ±2°, руки ±3°', 'idle'),
      cell('§1 walk', 'walk'),
      cell('§1 run: наклон +8°, амплитуда ×1.5', 'run'),
      view(
        '§1 бег: пыль из-под ног + разворот (сжатие)',
        (hv, hx, hy) => (tm, dt) =>
          hv.update(dt / 1000, hx, hy, {
            moving: true,
            sprinting: true,
            dodging: false,
            facing: Math.floor(tm / 1500) % 2 ? -1 : 1,
            cold: false,
          }),
      ),
      view('§1 attack_slash + след оружия', (hv, hx, hy) => {
        hv.setHeldItem('icons.tools.axe_steel');
        let next = 0;
        return (tm, dt) => {
          if (tm > next) {
            next = tm + 900;
            hv.act('attack_slash');
          }
          hv.update(dt / 1000, hx, hy, {
            moving: false,
            sprinting: false,
            dodging: false,
            facing: 1,
            cold: false,
          });
        };
      }),
      view('§1 attack_blunt (тряска камеры)', (hv, hx, hy) => {
        hv.setHeldItem('icons.weapons.bat_nails');
        let next = 0;
        return (tm, dt) => {
          if (tm > next) {
            next = tm + 1000;
            hv.act('attack_blunt');
          }
          hv.update(dt / 1000, hx, hy, {
            moving: false,
            sprinting: false,
            dodging: false,
            facing: 1,
            cold: false,
          });
        };
      }),
      view('§1 attack_pierce', (hv, hx, hy) => {
        hv.setHeldItem('icons.weapons.machete');
        let next = 0;
        return (tm, dt) => {
          if (tm > next) {
            next = tm + 800;
            hv.act('attack_pierce');
          }
          hv.update(dt / 1000, hx, hy, {
            moving: false,
            sprinting: false,
            dodging: false,
            facing: 1,
            cold: false,
          });
        };
      }),
      view('§1 shoot: отдача, вспышка, гильза', (hv, hx, hy) => {
        hv.setHeldItem('replacements.pistol');
        let next = 0;
        return (tm, dt) => {
          if (tm > next) {
            next = tm + 600;
            hv.act('shoot');
          }
          hv.update(dt / 1000, hx, hy, {
            moving: false,
            sprinting: false,
            dodging: false,
            facing: 1,
            cold: false,
          });
        };
      }),
      {
        title: '§1 throw: бросок по дуге с вращением',
        build: (x, y) => {
          const upd = this.heroCell(x, y, 'throw', 1400);
          let next = 300;
          return {
            update: (tm, dt) => {
              upd(tm, dt);
              if (tm > next) {
                next = tm + 1400;
                const g = spawnSprite(this, x + CELL_W / 2 + 10, y + 70, 'icons.weapons.molotov', {
                  depth: 3,
                  scale: 0.5,
                });
                this.tweens.add({ targets: g, x: x + CELL_W - 20, duration: 600 });
                this.tweens.add({
                  targets: g,
                  y: { from: y + 70, to: y + 20 },
                  duration: 300,
                  yoyo: true,
                  ease: 'Quad.Out',
                });
                this.tweens.add({ targets: g, angle: 540, duration: 600, onComplete: () => g.destroy() });
              }
            },
          };
        },
      },
      cell('§1 gather: рубка (топор сверху)', 'gather'),
      cell('§1 gather: копание (кирка/лопата)', 'gather_dig'),
      cell('§1 gather: ключ (вращение ±40°)', 'gather_wrench'),
      cell('§1 gather: нож (короткие удары)', 'gather_knife'),
      cell('§1 dodge: кувырок 360°', 'dodge', 900),
      view('§1 hurt: гримаса 0.3 с, красный тинт', (hv, hx, hy) => {
        let next = 0;
        return (tm, dt) => {
          if (tm > next) {
            next = tm + 1100;
            hv.hurt();
          }
          hv.update(dt / 1000, hx, hy, {
            moving: false,
            sprinting: false,
            dodging: false,
            facing: 1,
            cold: false,
          });
        };
      }),
      cell('§1 blink: моргание (здесь постоянно)', 'idle', undefined, { head: 'blink' }),
      cell('§1 death: падение навзничь', 'death', 2000),
      view(
        '§1 холод: синий тинт и дрожь',
        (hv, hx, hy) => (_tm, dt) =>
          hv.update(dt / 1000, hx, hy, {
            moving: false,
            sprinting: false,
            dodging: false,
            facing: 1,
            cold: true,
          }),
      ),
    ];
  }

  /** §1 низкие показатели и §11 стик, полосы, мигание, нажатие кнопки. */
  private uiDemos(): Demo[] {
    const W = CELL_W;
    const H = 190;
    return [
      {
        title: '§1 HP < 20%: красная виньетка с пульсом',
        build: (x, y) => {
          this.add.rectangle(x + 10, y + 10, W - 20, H - 20, 0x2a3a24).setOrigin(0);
          const v = this.add
            .image(x + W / 2, y + H / 2, TEX.vignette)
            .setDisplaySize(W - 20, H - 20)
            .setTint(0xd01818);
          return { update: (tm) => v.setAlpha(0.35 + 0.3 * Math.abs(Math.sin(tm / 450))) };
        },
      },
      {
        title: '§1 радиация: зелёное зерно по краям',
        build: (x, y) => {
          this.add.rectangle(x + 10, y + 10, W - 20, H - 20, 0x2a3a24).setOrigin(0);
          this.add
            .image(x + W / 2, y + H / 2, TEX.vignette)
            .setDisplaySize(W - 20, H - 20)
            .setTint(0x50ff40)
            .setAlpha(0.45);
          const g = this.add
            .tileSprite(x + 10, y + 10, W - 20, H - 20, TEX.grain)
            .setOrigin(0)
            .setAlpha(0.35)
            .setBlendMode(Phaser.BlendModes.ADD);
          return { update: () => g.setTilePosition(Math.random() * 128, Math.random() * 128) };
        },
      },
      {
        title: '§11 стик: ручка возвращается с пружиной',
        build: (x, y) => {
          const cx = x + W / 2;
          const cy = y + H / 2 + 10;
          spawnSprite(this, cx, cy, 'ui.joystick_base', { depth: 2, scale: 1.8 });
          const knob = spawnSprite(this, cx, cy, 'ui.joystick_knob', { depth: 3, scale: 0.9 });
          let next = 0;
          return {
            update: (tm) => {
              if (tm > next) {
                next = tm + 1600;
                const a = Math.random() * Math.PI * 2;
                knob.setPosition(cx + Math.cos(a) * 50, cy + Math.sin(a) * 50);
                this.tweens.add({ targets: knob, x: cx, y: cy, delay: 600, duration: 180, ease: 'Back.Out' });
              }
            },
          };
        },
      },
      {
        title: '§11 полоса: плавно 0.25 с, «хвост» 0.5 с',
        build: (x, y) => {
          const fw = W - 60;
          const bx = x + 30;
          const by = y + H / 2;
          this.add.rectangle(bx, by, fw, 18, 0x221e19).setOrigin(0, 0.5).setStrokeStyle(2, 0x5a4a35);
          const tail = this.add.rectangle(bx, by, fw, 14, 0xffffff).setOrigin(0, 0.5);
          const fill = this.add.rectangle(bx, by, fw, 14, 0xc8302a).setOrigin(0, 0.5);
          let target = 1;
          let shown = 1;
          let tailShown = 1;
          let next = 0;
          return {
            update: (tm, dt) => {
              if (tm > next) {
                next = tm + 1500;
                target = target < 0.3 ? 1 : target - 0.25;
              }
              const k = dt / 1000;
              shown += (target - shown) * Math.min(1, k / 0.25);
              if (tailShown < shown) tailShown = shown;
              else tailShown += (shown - tailShown) * Math.min(1, k / 0.5);
              fill.width = fw * shown;
              tail.width = fw * tailShown;
            },
          };
        },
      },
      {
        title: '§11 показатель < 20%: иконка мигает',
        build: (x, y) => {
          const icons = ['ui.icon_hunger', 'ui.icon_thirst', 'ui.icon_stamina'].map((id, i) =>
            spawnSprite(this, x + 70 + i * 80, y + H / 2, id, { depth: 2, scale: 0.8 }),
          );
          return {
            update: (tm) => icons[0]!.setAlpha(0.35 + 0.65 * Math.abs(Math.sin((tm / 400) * Math.PI))),
          };
        },
      },
      {
        title: '§11 нажатие кнопки: 1 → 0.92 → 1 за 0.12 с',
        build: (x, y) => {
          const b = spawnSprite(this, x + W / 2, y + H / 2 + 10, 'ui.btn_action', { depth: 2, scale: 1.4 });
          const base = b.scale;
          return {
            action: () => {
              this.tweens.add({ targets: b, scale: base * 0.92, duration: 60, yoyo: true });
              b.setTint(0xbbbbbb);
              this.time.delayedCall(120, () => b.clearTint());
            },
          };
        },
      },
    ];
  }

  /** §0, §4, §5 — мир (шаг 3). */
  private worldDemos(ts: GroundTileset, cfg: Parameters<typeof dayNightAt>[1], W: number, H: number): Demo[] {
    const reg = registry();
    return [
      {
        title: 'Ветер: деревья (±1.5°, 3.5 с)',
        build: (x, y) => {
          this.groundPatch(x + 10, y + 10, W - 20, H - 20, 'grass');
          const trees = [0, 1, 2].map((i) =>
            this.sprite(x + 60 + i * 90, y + H - 14, 'world.biome1_suburb.pine', 0.8),
          );
          return {
            update: (tm) => trees.forEach((tr, i) => tr.setAngle(Fx.swayAngle(tm, 1.5, 3.5, i * 1.9))),
          };
        },
      },
      {
        title: 'Ветер: трава, камыш, кусты (±3°, 2 с; дыхание)',
        build: (x, y) => {
          this.groundPatch(x + 10, y + 10, W - 20, H - 20, 'swamp_mud');
          const grass = this.sprite(x + 60, y + H - 30, 'world.biome1_suburb.tall_grass');
          const reeds = this.sprite(x + 140, y + H - 30, 'world.biome2_swamp.cattails');
          const bush = this.sprite(x + 225, y + H - 30, 'world.biome1_suburb.bush_berries');
          const bx = bush.scaleX;
          const by = bush.scaleY;
          return {
            update: (tm) => {
              grass.setAngle(Fx.swayAngle(tm, 3, 2, 0));
              reeds.setAngle(Fx.swayAngle(tm, 3, 2, 1.3));
              bush.setAngle(Fx.swayAngle(tm, 3, 2, 2.1));
              Fx.breathe(bush, bx, by, tm, 0.02, 2, 0.5);
            },
          };
        },
      },
      {
        title: 'Вода: течение 6 px/с + блики',
        build: (x, y) => {
          const map = this.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: 4, height: 2 });
          const wt = map.addTilesetImage(ts.waterKey, ts.waterKey, TILE, TILE, ts.margin, ts.spacing, 0)!;
          const layer = map.createBlankLayer('w', wt, x + 22, y + 30)!;
          layer.fill(0);
          let next = 0;
          return {
            update: (tm) => {
              ts.updateWater(tm);
              if (tm > next) {
                next = tm + 350;
                Fx.ripple(this, x + 22 + Math.random() * 256, y + 30 + Math.random() * 128, 2);
              }
            },
          };
        },
      },
      {
        title: 'Свечение грибов, кристаллов, урана (пульс 2 с)',
        build: (x, y) => {
          this.add.rectangle(x + 10, y + 10, W - 20, H - 20, 0x0b0f1f).setOrigin(0);
          const items: [string, string][] = [
            ['world.biome2_swamp.mushrooms_glow', reg.worldgen.glow['mushrooms_glow']!],
            ['world.biome6_epicenter.crystals', reg.worldgen.glow['crystals']!],
            ['world.biome6_epicenter.uranium_rock', reg.worldgen.glow['uranium_rock']!],
          ];
          items.forEach(([id, color], i) => {
            const s = this.sprite(x + 55 + i * 95, y + H - 25, id, 0.8);
            Fx.glow(
              this,
              s.x,
              s.y - s.displayHeight * 0.4,
              Phaser.Display.Color.HexStringToColor(color).color,
              s.displayWidth * 1.5,
            ).setDepth(2);
          });
          return {};
        },
      },
      {
        title: 'Перекрытие героя (альфа 0.45 за 0.15 с)',
        build: (x, y) => {
          this.groundPatch(x + 10, y + 10, W - 20, H - 20, 'grass');
          const tree = this.sprite(x + W / 2, y + H - 20, 'world.biome1_suburb.oak', 0.7);
          const hero = this.sprite(x + 40, y + H - 50, 'characters.hero.ref_idle');
          hero.setScale((reg.rigs.humanoid['bodyHeightPx'] as number) / hero.frame.height);
          let a = 1;
          return {
            update: (tm, dt) => {
              const p = (tm / 4000) % 1;
              hero.x = x + 40 + Math.abs(p * 2 - 1) * (W - 80);
              const behind = Math.floor(tm / 8000) % 2 === 0;
              hero.y = y + H - (behind ? 50 : 10);
              hero.setDepth(behind ? 0.5 : 1.5);
              const target =
                behind && Phaser.Geom.Rectangle.Overlaps(tree.getBounds(), hero.getBounds())
                  ? OCCLUDE_ALPHA
                  : 1;
              a += Math.sign(target - a) * Math.min(Math.abs(target - a), dt / OCCLUDE_MS);
              tree.setAlpha(a);
            },
          };
        },
      },
      {
        title: 'Смена дня и ночи (сутки за 12 с, закат тёплый)',
        build: (x, y) => {
          this.groundPatch(x + 10, y + 10, W - 20, H - 20, 'grass');
          this.sprite(x + 90, y + H - 20, 'world.biome1_suburb.birch', 0.7);
          const night = this.nightPanel(x + 10, y + 10, W - 20, H - 20);
          const label = this.add
            .text(x + 16, y + 14, '', {
              fontFamily: FONT,
              resolution: TEXT_RES,
              fontSize: '12px',
              color: '#fff',
            })
            .setDepth(4);
          return {
            update: (tm) => {
              const s = dayNightAt(((tm / 12000) % 1) * cfg.fullDaySec, cfg);
              night(s, [{ x: 190, y: 120, r: 70 }]);
              label.setText(`${t(`hud.phase.${s.phase}`)} · ${s.darkness.toFixed(2)}`);
            },
          };
        },
      },
      {
        title: 'Ночь: мягкие пятна света (герой, костёр)',
        build: (x, y) => {
          this.groundPatch(x + 10, y + 10, W - 20, H - 20, 'dirt');
          const fire = this.sprite(x + 200, y + 120, 'world.interior.campfire_coals');
          const flame = this.add
            .sprite(fire.x, fire.y - 6, 'effects')
            .play('fx-flame')
            .setOrigin(0.5, 1)
            .setScale(0.4)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setDepth(2);
          const hero = this.sprite(x + 80, y + 140, 'characters.hero.ref_idle');
          hero.setScale(96 / hero.frame.height);
          const night = this.nightPanel(x + 10, y + 10, W - 20, H - 20);
          const s = dayNightAt(cfg.daySec + 60, cfg);
          return {
            update: (tm) => {
              const fl = 1 + 0.05 * Math.sin(tm / 90) + 0.03 * Math.sin(tm / 37);
              night(s, [
                { x: 70, y: 90, r: 80 },
                { x: 190, y: 90, r: 95 * fl },
              ]);
              flame.setAlpha(0.9);
            },
          };
        },
      },
      {
        title: 'Кровавая ночь: красный тон и пульс',
        build: (x, y) => {
          this.groundPatch(x + 10, y + 10, W - 20, H - 20, 'grass');
          this.sprite(x + 200, y + H - 20, 'world.biome1_suburb.dead_tree', 0.7);
          const night = this.nightPanel(x + 10, y + 10, W - 20, H - 20);
          return {
            update: (tm) => {
              const elapsed = (tm / 1000) % 10;
              const s = dayNightAt(6 * cfg.fullDaySec + cfg.daySec + elapsed, cfg);
              night(s, [{ x: 80, y: 110, r: 80 }]);
            },
          };
        },
      },
      {
        title: '§0 Качание от основания',
        build: (x, y) => {
          const pole = this.sprite(x + 80, y + H - 10, 'world.biome1_suburb.power_pole', 0.8);
          const scare = this.sprite(x + 210, y + H - 20, 'world.biome1_suburb.scarecrow');
          return {
            update: (tm) => {
              pole.setAngle(Fx.swayAngle(tm, 1.5, 3.5, 0));
              scare.setAngle(Fx.swayAngle(tm, 4, 1.2, 1));
            },
          };
        },
      },
      {
        title: '§0 Дыхание',
        build: (x, y) => {
          const b = this.sprite(x + W / 2, y + H - 30, 'world.biome2_swamp.mushrooms_glow');
          const bx = b.scaleX;
          const by = b.scaleY;
          return { update: (tm) => Fx.breathe(b, bx, by, tm, 0.04, 2) };
        },
      },
      {
        title: '§0 Тряска объекта',
        build: (x, y) => {
          const s = this.sprite(x + W / 2, y + H - 30, 'world.biome1_suburb.boulder');
          return { action: () => Fx.shake(this, s) };
        },
      },
      {
        title: '§0 Отскок появления',
        build: (x, y) => {
          const s = this.sprite(x + W / 2, y + H - 30, 'world.interior.crate_wood_closed', 1.4);
          return { action: () => Fx.popIn(this, s) };
        },
      },
      {
        title: '§0 Подпрыгивание дропа',
        build: (x, y) => {
          let s: Phaser.GameObjects.Image | null = null;
          return {
            action: () => {
              s?.destroy();
              this.tweens.killTweensOf(s ?? []);
              s = this.sprite(x + W / 2, y + H / 2 + 20, 'icons.base.canned_food');
              Fx.popIn(this, s);
              Fx.dropHop(this, s);
            },
          };
        },
      },
      {
        title: '§0 Вспышка урона',
        build: (x, y) => {
          const s = this.sprite(x + W / 2, y + H - 20, 'characters.enemies.walker_idle', 0.6);
          return { action: () => Fx.damageFlash(this, s) };
        },
      },
      {
        title: '§0 Растворение',
        build: (x, y) => {
          const s = this.sprite(x + W / 2, y + H - 20, 'characters.enemies.walker_idle', 0.6);
          const y0 = s.y;
          return {
            action: () => {
              this.tweens.killTweensOf(s);
              s.setAlpha(1).setY(y0);
              Fx.dissolve(this, s, () => this.time.delayedCall(600, () => s.setAlpha(1).setY(y0)));
            },
          };
        },
      },
      {
        title: '§0 Тряска камеры',
        build: (x, y) => {
          this.sprite(x + W / 2, y + H - 20, 'world.biome4_desert.excavator', 0.8);
          return { action: () => Fx.cameraShake(this, 250, 0.01) };
        },
      },
      {
        title: '§0 Хит-стоп (40 мс)',
        build: (x, y) => {
          const s = this.sprite(x + W / 2, y + H / 2, 'icons.tools.axe_steel', 1.3);
          return {
            update: (_tm, dt) => s.setAngle(s.angle + dt * 0.25),
            action: () => {
              // Для наглядности стоп-кадр 40 мс повторяется 5 раз подряд.
              for (let i = 0; i < 5; i++)
                this.time.delayedCall(
                  i * 140,
                  () => (this.hitStopUntil = this.time.now + Fx.hitStop(this, 40)),
                );
            },
          };
        },
      },
      {
        title: '§0 Свечение (ADD + пульс)',
        build: (x, y) => {
          this.add.rectangle(x + 10, y + 10, W - 20, H - 20, 0x0b0f1f).setOrigin(0);
          const s = this.sprite(x + W / 2, y + H - 30, 'world.biome6_epicenter.crystals');
          Fx.glow(this, s.x, s.y - s.displayHeight * 0.4, 0x7fd8ff, s.displayWidth * 1.8).setDepth(2);
          return {};
        },
      },
      {
        title: '§0 Пул частиц (пыль, искры)',
        build: (x, y) => {
          const dust = Fx.particles(this, ['effects.dust_1', 'effects.dust_2', 'effects.dust_3'], {
            gravityY: -20,
            speed: { min: 20, max: 70 },
          }).setDepth(3);
          const sparks = Fx.particles(this, ['effects.spark_1', 'effects.spark_2', 'effects.spark_3'], {
            blendMode: Phaser.BlendModes.ADD,
            scale: { start: 0.25, end: 0 },
          }).setDepth(3);
          this.sprite(x + W / 2, y + H - 30, 'world.biome1_suburb.boulder');
          return {
            action: () => {
              dust.explode(8, x + W / 2, y + H - 40);
              sparks.explode(12, x + W / 2, y + H - 60);
            },
          };
        },
      },
      {
        title: 'Пламя костра (effects/flame_1..6)',
        build: (x, y) => {
          this.add.rectangle(x + 10, y + 10, W - 20, H - 20, 0x0b0f1f).setOrigin(0);
          const fire = this.sprite(x + W / 2, y + H - 30, 'world.interior.campfire_coals', 1.3);
          this.add
            .sprite(fire.x, fire.y - 8, 'effects')
            .play('fx-flame')
            .setOrigin(0.5, 1)
            .setScale(0.55)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setDepth(2);
          Fx.glow(this, fire.x, fire.y - 20, 0xff8a3a, 160, 400).setDepth(1.5);
          return {};
        },
      },
    ];
  }
}
