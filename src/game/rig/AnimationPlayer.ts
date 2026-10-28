import type { AnimName, AnimSpec } from './Animations';
import { blendPoses, EMPTY_POSE, type Pose } from './Pose';

/** Переход между анимациями, с (ТЗ 4.3.4). */
const BLEND_SEC = 0.1;

interface OneShot {
  name: AnimName;
  t: number;
  hitSent: boolean;
  onHit?: () => void;
  onDone?: () => void;
  /** Держать последний кадр (смерть). */
  hold: boolean;
}

/**
 * Проигрыватель: базовая циклическая анимация (idle / walk / run / gather) и разовые поверх
 * (атака, перекат, урон, смерть). Смена анимации смешивается за 0.1 с; хит-кадр атаки — колбэк в логику.
 */
export class AnimationPlayer {
  private base: AnimName = 'idle';
  private baseT = 0;
  private shot: OneShot | null = null;
  private last: Pose = EMPTY_POSE;
  private from: Pose | null = null;
  private blendLeft = 0;
  private current: string = 'idle';

  constructor(private readonly specs: Record<AnimName, AnimSpec>) {}

  get name(): AnimName {
    return (this.shot?.name ?? this.base) as AnimName;
  }

  get busy(): boolean {
    return this.shot !== null && !this.shot.hold;
  }

  setBase(name: AnimName): void {
    if (this.base === name) return;
    this.base = name;
    this.baseT = 0;
  }

  play(name: AnimName, opts: { onHit?: () => void; onDone?: () => void; hold?: boolean } = {}): void {
    this.shot = {
      name,
      t: 0,
      hitSent: false,
      onHit: opts.onHit,
      onDone: opts.onDone,
      hold: opts.hold ?? false,
    };
  }

  /** Сбросить разовую анимацию (возрождение после смерти). */
  stop(): void {
    this.shot = null;
  }

  update(dt: number): Pose {
    let pose: Pose;
    let key: string;
    if (this.shot) {
      const spec = this.specs[this.shot.name];
      this.shot.t += dt / spec.dur;
      const t = Math.min(1, this.shot.t);
      if (!this.shot.hitSent && spec.hitAt !== undefined && t >= spec.hitAt) {
        this.shot.hitSent = true;
        this.shot.onHit?.();
      }
      // Разовый запуск циклической анимации (добыча) — ровно один цикл: следующий удар запускает логика.
      pose = spec.pose(t);
      key = `shot:${this.shot.name}`;
      if (this.shot.t >= 1 && !this.shot.hold) {
        const done = this.shot.onDone;
        this.shot = null;
        done?.();
      }
    } else {
      const spec = this.specs[this.base];
      this.baseT = (this.baseT + dt / spec.dur) % 1;
      pose = spec.pose(this.baseT);
      key = `base:${this.base}`;
    }
    if (key !== this.current) {
      this.current = key;
      this.from = this.last;
      this.blendLeft = BLEND_SEC;
    }
    if (this.from && this.blendLeft > 0) {
      this.blendLeft = Math.max(0, this.blendLeft - dt);
      pose = blendPoses(this.from, pose, 1 - this.blendLeft / BLEND_SEC);
      if (this.blendLeft === 0) this.from = null;
    }
    this.last = pose;
    return pose;
  }
}
