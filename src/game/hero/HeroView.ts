import Phaser from 'phaser';
import type { Registry } from '../../core/data/Registry';
import type { AssetId } from '../../core/data/schemas';
import { getAssetInfo } from '../assets/AssetIndex';
import { spawnSprite } from '../assets/spawnSprite';
import * as Fx from '../render/Fx';
import { TEX } from '../render/textures';
import { AnimationPlayer } from '../rig/AnimationPlayer';
import { humanoidAnims, type AnimName } from '../rig/Animations';
import { resolveCharacter, type CharacterDef } from '../rig/RigDef';
import { RigInstance } from '../rig/RigInstance';

/** Голова (ТЗ 4.3.5): гримаса боли 0.3 с, моргание 0.12 с раз в 3–6 с. */
const HURT_HEAD_SEC = 0.3;
const BLINK_SEC = 0.12;
const BLINK_EVERY: [number, number] = [3, 6];
/** Запасной режим: смена ref_walk/ref_idle каждые 0.18 с и подпрыгивание 2 px (rigs.json → fallbackMVP). */
const FALLBACK_STEP_SEC = 0.18;
const FALLBACK_BOB_PX = 2;
/** Разворот: сжатие 1 → 0.85 → 1 за 0.1 с (ANIMATIONS §1). */
const TURN_SQUASH = 0.85;
const TURN_SEC = 0.1;
/** Красный тинт урона, с. */
const HURT_TINT_SEC = 0.15;
const HURT_TINT = 0xff6a6a;
const COLD_TINT = 0xb8d4ff;
/** След оружия — дуга 0.12 с. */
const TRAIL_SEC = 0.12;

const FALLBACK_KEY = 'pustosh.debug.rigFallback';

export function fallbackForced(): boolean {
  try {
    return localStorage.getItem(FALLBACK_KEY) === '1';
  } catch {
    return false;
  }
}

export function setFallbackForced(v: boolean): void {
  try {
    localStorage.setItem(FALLBACK_KEY, v ? '1' : '0');
  } catch {
    /* хранилище недоступно — режим только до перезапуска */
  }
}

export interface HeroVisualState {
  moving: boolean;
  sprinting: boolean;
  dodging: boolean;
  /** Направление взгляда: 1 — вправо, -1 — влево. */
  facing: 1 | -1;
  cold: boolean;
}

/**
 * Внешний вид героя: риг из частей с анимациями или запасной режим целым спрайтом
 * (если калибровки нет или включён переключатель F9).
 */
export class HeroView {
  readonly def: CharacterDef;
  private rig: RigInstance | null = null;
  private fallback: Phaser.GameObjects.Image | null = null;
  private player: AnimationPlayer;
  private shadow: Phaser.GameObjects.Image;
  private x = 0;
  private y = 0;
  private facing: 1 | -1 = 1;
  private turnLeft = 0;
  private hurtLeft = 0;
  private tintLeft = 0;
  private blinkIn = 3;
  private blinkLeft = 0;
  private fbStep = 0;
  private fbTime = 0;
  private dustAcc = 0;
  private lastPhase = 0;
  private dust: Phaser.GameObjects.Particles.ParticleEmitter;
  private time = 0;
  private dead = false;
  private headgear: AssetId | null = null;
  private held: AssetId | null = null;
  private dodging = false;
  private cold = false;
  /** Целая поза (лист s28: сон, еда, питьё) поверх рига на время. */
  private pose: Phaser.GameObjects.Image | null = null;
  private poseLeft = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    reg: Registry,
    x: number,
    y: number,
  ) {
    this.def = resolveCharacter(reg, 'hero');
    this.player = new AnimationPlayer(
      humanoidAnims(reg.rigs.humanoid['animations'] as Record<string, { loopSec?: number; durSec?: number }>),
    );
    this.shadow = scene.add.image(x, y, TEX.shadow).setDisplaySize(40, 14).setDepth(-2.7e6);
    this.dust = Fx.particles(scene, ['effects.dust_1'], {
      lifespan: 400,
      speed: { min: 10, max: 30 },
      scale: { start: 0.18, end: 0.05 },
      alpha: { start: 0.6, end: 0 },
      gravityY: -20,
    });
    this.x = x;
    this.y = y;
    this.setMode(this.useFallback());
  }

  /** Запасной режим: принудительно (F9) или если риг не откалиброван. */
  useFallback(): boolean {
    return fallbackForced() || !this.def.tuned;
  }

  get isFallback(): boolean {
    return this.fallback !== null;
  }

  setMode(fallback: boolean): void {
    this.rig?.destroy();
    this.fallback?.destroy();
    this.rig = null;
    this.fallback = null;
    if (fallback) {
      this.fallback = spawnSprite(this.scene, this.x, this.y, this.def.ref!, { depth: this.y }).setOrigin(
        0.5,
        1,
      );
      this.fallback.setScale(this.def.height / this.fallback.frame.height);
    } else {
      this.rig = new RigInstance(this.scene, this.def, this.x, this.y);
      this.rig.container.setDepth(this.y);
      if (this.headgear) this.rig.setPart('head', this.headgear);
      if (this.backpack !== undefined) this.rig.setPart('backpack', this.backpack);
      if (this.bodyTint !== null) this.rig.setPartTint('torso', this.bodyTint);
      this.rig.setHeldItem(this.held);
    }
    this.applyFacing();
  }

  /** Объект для Y-сортировки и проверок перекрытия. */
  get displayObject(): Phaser.GameObjects.Container | Phaser.GameObjects.Image {
    return (this.rig?.container ?? this.fallback)!;
  }

  /** Прямоугольник героя на экране (перекрытие деревьями). */
  bounds(): Phaser.Geom.Rectangle {
    const h = this.def.height;
    return new Phaser.Geom.Rectangle(this.x - h * 0.22, this.y - h, h * 0.44, h);
  }

  setHeadgear(asset: AssetId | null): void {
    this.headgear = asset;
    this.rig?.setPart('head', asset);
  }

  setHeldItem(icon: AssetId | null): void {
    this.held = icon;
    this.rig?.setHeldItem(icon);
  }

  /** Рюкзак на спине — только если надет (спрайт heroBackpack). */
  setBackpack(asset: AssetId | null): void {
    this.backpack = asset;
    this.rig?.setPart('backpack', asset);
  }

  /** Одежда на теле — тинт торса (GDD §9, MVP). */
  setBodyTint(color: number | null): void {
    this.bodyTint = color;
    this.rig?.setPartTint('torso', color);
  }

  private backpack: AssetId | null | undefined = undefined;
  private bodyTint: number | null = null;

  // ------------------------------------------------------------------ действия

  /** Атака/добыча; onHit — хит-кадр (55%) для логики. */
  act(anim: AnimName, onHit?: () => void): void {
    // Удержание «Собрать»: следующий взмах может прийти в тот же кадр, когда кончается предыдущий.
    if (this.dead || (this.player.busy && !(anim.startsWith('gather') && this.player.name === anim))) return;
    if (!this.rig) {
      // Запасной режим: короткий наклон спрайта вместо удара.
      this.scene.tweens.add({
        targets: this.fallback,
        angle: { from: 0, to: 12 * this.facing },
        duration: 120,
        yoyo: true,
      });
      this.scene.time.delayedCall(130, () => onHit?.());
      return;
    }
    this.player.play(anim, {
      onHit: () => {
        if (anim.startsWith('attack') || anim === 'throw') this.weaponTrail();
        if (anim === 'shoot') this.muzzleFlash();
        if (anim === 'attack_blunt') Fx.cameraShake(this.scene, 100, 0.004);
        onHit?.();
      },
    });
  }

  dodge(): void {
    if (this.dead) return;
    if (this.rig) this.player.play('dodge');
    else
      this.scene.tweens.add({
        targets: this.fallback,
        angle: { from: 0, to: 360 * this.facing },
        duration: 350,
        onComplete: () => this.fallback?.setAngle(0),
      });
  }

  hurt(): void {
    if (this.dead) return;
    this.hurtLeft = HURT_HEAD_SEC;
    this.tintLeft = HURT_TINT_SEC;
    if (this.rig && !this.player.busy) this.player.play('hurt');
    const o = this.displayObject;
    if (o instanceof Phaser.GameObjects.Image) Fx.damageFlash(this.scene, o);
  }

  die(onDone: () => void): void {
    this.dead = true;
    if (this.rig) this.player.play('death', { hold: true, onDone });
    else
      this.scene.tweens.add({
        targets: this.fallback,
        angle: -90 * this.facing,
        duration: 600,
        onComplete: onDone,
      });
    // Пока анимация «держит» кадр, onDone от плеера не придёт — вызываем по времени.
    if (this.rig) this.scene.time.delayedCall(650, onDone);
  }

  revive(): void {
    this.dead = false;
    this.player.stop();
    this.fallback?.setAngle(0);
    this.hurtLeft = 0;
  }

  // ------------------------------------------------------------------ кадр

  update(dt: number, x: number, y: number, s: HeroVisualState): void {
    this.time += dt;
    this.x = x;
    this.y = y;
    this.cold = s.cold;
    if (s.facing !== this.facing && !this.dead) {
      this.facing = s.facing;
      this.turnLeft = TURN_SEC;
    }
    this.turnLeft = Math.max(0, this.turnLeft - dt);
    this.hurtLeft = Math.max(0, this.hurtLeft - dt);
    this.tintLeft = Math.max(0, this.tintLeft - dt);

    // Моргание
    this.blinkLeft = Math.max(0, this.blinkLeft - dt);
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blinkLeft = BLINK_SEC;
      this.blinkIn = Phaser.Math.FloatBetween(BLINK_EVERY[0], BLINK_EVERY[1]);
    }

    const base: AnimName = s.moving ? (s.sprinting ? 'run' : 'walk') : 'idle';
    this.shadow.setPosition(x, y);
    if (this.rig) this.updateRig(dt, base, s);
    else this.updateFallback(dt, s);
    if (s.sprinting && !this.dead) this.runDust(dt);
    if (this.pose) {
      this.poseLeft -= dt;
      if (this.poseLeft <= 0 || this.dead) this.clearPose();
      else {
        this.displayObject.setVisible(false);
        this.pose
          .setPosition(x, y)
          .setFlipX(this.facing < 0)
          .setDepth(y);
      }
    }
  }

  /**
   * Показать целую позу героя вместо рига на sec секунд (Infinity — до clearPose). Позы нарисованы
   * лицом вправо, влево — отражение. Нет спрайта — false, риг остаётся.
   */
  showPose(id: string, sec: number): boolean {
    if (this.dead || !getAssetInfo(id)) return false;
    this.clearPose();
    this.pose = spawnSprite(this.scene, this.x, this.y, id, { depth: this.y });
    this.poseLeft = sec;
    this.displayObject.setVisible(false);
    return true;
  }

  /** Текущая целая поза (id спрайта) или null. */
  get poseId(): string | null {
    return this.pose ? this.pose.frame.name : null;
  }

  clearPose(): void {
    if (!this.pose) return;
    this.pose.destroy();
    this.pose = null;
    this.displayObject.setVisible(true);
  }

  private updateRig(dt: number, base: AnimName, s: HeroVisualState): void {
    const rig = this.rig!;
    this.player.setBase(base);
    if (s.dodging && !this.dodging && this.player.name !== 'dodge') this.player.play('dodge');
    this.dodging = s.dodging;
    const pose = this.player.update(dt);
    // Голова: гримаса боли важнее моргания.
    const head = this.dead ? 'hurt' : this.hurtLeft > 0 ? 'hurt' : this.blinkLeft > 0 ? 'blink' : undefined;
    if (head) pose.swaps = { ...pose.swaps, head };
    // Дрожь на холоде (ANIMATIONS §1: синеватый тинт и лёгкая дрожь).
    if (this.cold && !this.dead)
      pose.root = { ...pose.root, dx: (pose.root?.dx ?? 0) + Math.sin(this.time * 70) * 0.006 };
    rig.setTintAll(this.tintLeft > 0 ? HURT_TINT : this.cold ? COLD_TINT : null);
    rig.apply(pose);
    rig.setPosition(this.x, this.y);
    rig.container.setDepth(this.y);
    this.applyFacing();
  }

  private updateFallback(dt: number, s: HeroVisualState): void {
    const img = this.fallback!;
    if (s.moving && !this.dead) {
      this.fbTime += dt;
      if (this.fbTime >= FALLBACK_STEP_SEC) {
        this.fbTime -= FALLBACK_STEP_SEC;
        this.fbStep ^= 1;
        const id = this.fbStep ? this.def.refWalk! : this.def.ref!;
        const info = getAssetInfo(id)!;
        img.setTexture(info.group, info.frame);
      }
    } else if (this.fbStep) {
      this.fbStep = 0;
      const info = getAssetInfo(this.def.ref!)!;
      img.setTexture(info.group, info.frame);
    }
    const bob = s.moving
      ? -Math.abs(Math.sin((this.fbTime / FALLBACK_STEP_SEC) * Math.PI)) * FALLBACK_BOB_PX
      : 0;
    img.setPosition(this.x + (this.cold ? Math.sin(this.time * 70) * 0.6 : 0), this.y + bob).setDepth(this.y);
    if (this.tintLeft <= 0) {
      if (this.cold) img.setTint(COLD_TINT);
      else img.clearTint();
    }
    img.setAlpha(s.dodging ? 0.7 : 1);
    this.applyFacing();
  }

  private applyFacing(): void {
    const squash =
      this.turnLeft > 0 ? 1 - (1 - TURN_SQUASH) * Math.sin((1 - this.turnLeft / TURN_SEC) * Math.PI) : 1;
    if (this.rig) {
      this.rig.setFacing(this.facing);
      this.rig.container.scaleX = this.facing * squash;
    } else if (this.fallback) {
      const k = this.def.height / this.fallback.frame.height;
      this.fallback.setScale(k * squash * this.facing, k);
    }
  }

  /** Пыль из-под ног при беге — раз в шаг. */
  private runDust(dt: number): void {
    this.dustAcc += dt;
    const phase = Math.floor(this.dustAcc / 0.225);
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      this.dust.explode(2, this.x - this.facing * 6, this.y - 2);
    }
  }

  /** След оружия — дуга перед героем, 0.12 с. */
  private weaponTrail(): void {
    const g = this.scene.add.graphics().setDepth(this.y + 1);
    const h = this.def.height;
    const cx = this.x + this.facing * h * 0.12;
    const cy = this.y - h * 0.6;
    const r = h * 0.45;
    const a0 = this.facing > 0 ? -1.8 : Math.PI + 1.8;
    const a1 = this.facing > 0 ? 0.7 : Math.PI - 0.7;
    g.lineStyle(4, 0xffffff, 0.7);
    g.beginPath();
    g.arc(cx, cy, r, Math.min(a0, a1), Math.max(a0, a1), false);
    g.strokePath();
    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      duration: TRAIL_SEC * 1000,
      onComplete: () => g.destroy(),
    });
  }

  /** Вспышка выстрела (effects/muzzle_1|2) и гильза — жёлтый прямоугольник по дуге. */
  private muzzleFlash(): void {
    const hand = this.rig?.boneWorld('held_item') ?? this.rig?.boneWorld('arm_near_lower');
    const x = hand ? hand.x + this.facing * this.def.height * 0.25 : this.x + this.facing * 30;
    const y = hand ? hand.y : this.y - this.def.height * 0.6;
    const id = Math.random() < 0.5 ? 'effects.muzzle_1' : 'effects.muzzle_2';
    const fl = spawnSprite(this.scene, x, y, id, { depth: this.y + 2, scale: 0.6 }).setBlendMode(
      Phaser.BlendModes.ADD,
    );
    fl.setFlipX(this.facing < 0);
    this.scene.time.delayedCall(60, () => fl.destroy());
    const shell = this.scene.add.rectangle(x - this.facing * 10, y, 4, 2, 0xe8c040).setDepth(this.y + 2);
    this.scene.tweens.add({ targets: shell, x: shell.x - this.facing * 22, duration: 350 });
    this.scene.tweens.add({
      targets: shell,
      y: { from: y, to: y - 14 },
      duration: 150,
      yoyo: true,
      ease: 'Quad.Out',
    });
    this.scene.tweens.add({
      targets: shell,
      angle: 540,
      alpha: 0,
      duration: 400,
      onComplete: () => shell.destroy(),
    });
  }

  destroy(): void {
    this.clearPose();
    this.rig?.destroy();
    this.fallback?.destroy();
    this.shadow.destroy();
    this.dust.destroy();
  }
}
