import Phaser from 'phaser';
import { getAssetInfo } from '../assets/AssetIndex';
import { TEX } from './textures';

/**
 * Общие приёмы анимации (ANIMATIONS §0) — реализованы один раз, используются миром,
 * галереей анимаций и следующими шагами (добыча, бой, строительство).
 */
type Obj = Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;

/** Качание от основания: угол ±amp° с периодом period, фаза по позиции (значение для кадра). */
export function swayAngle(timeMs: number, amp: number, periodSec: number, phase: number): number {
  return Math.sin((timeMs / 1000 / periodSec) * Math.PI * 2 + phase) * amp;
}

/** «Дыхание»: scaleY = 1 ± a, scaleX = 1 ∓ a/2. */
export function breathe(
  obj: Obj,
  baseX: number,
  baseY: number,
  timeMs: number,
  a = 0.03,
  periodSec = 2,
  phase = 0,
): void {
  const s = Math.sin((timeMs / 1000 / periodSec) * Math.PI * 2 + phase) * a;
  obj.setScale(baseX * (1 - s / 2), baseY * (1 + s));
}

/** Тряска объекта: x ± 2 px, 4 раза за 0.12 с. */
export function shake(scene: Phaser.Scene, obj: Obj, px = 2): void {
  const x0 = obj.x;
  scene.tweens.add({
    targets: obj,
    x: { from: x0 - px, to: x0 + px },
    duration: 30,
    yoyo: true,
    repeat: 1,
    onComplete: () => obj.setX(x0),
  });
}

/** Отскок появления: масштаб 0 → 1.15 → 1 за 0.25 с. */
export function popIn(scene: Phaser.Scene, obj: Obj): void {
  const sx = obj.scaleX;
  const sy = obj.scaleY;
  obj.setScale(0);
  scene.tweens.chain({
    targets: obj,
    tweens: [
      { scaleX: sx * 1.15, scaleY: sy * 1.15, duration: 170, ease: 'Back.Out' },
      { scaleX: sx, scaleY: sy, duration: 80, ease: 'Sine.InOut' },
    ],
  });
}

/** Подпрыгивание дропа: дуга 12 px за 0.35 с, затем парение ±2 px. */
export function dropHop(scene: Phaser.Scene, obj: Obj): void {
  const y0 = obj.y;
  scene.tweens.chain({
    targets: obj,
    tweens: [
      { y: y0 - 12, duration: 175, ease: 'Quad.Out' },
      { y: y0, duration: 175, ease: 'Quad.In' },
      { y: y0 - 2, duration: 900, ease: 'Sine.InOut', yoyo: true, repeat: -1 },
    ],
  });
}

/** Вспышка урона: белая заливка 60 мс, затем красный тинт 0.15 с. */
export function damageFlash(scene: Phaser.Scene, obj: Obj): void {
  obj.setTintFill(0xffffff);
  scene.time.delayedCall(60, () => {
    obj.clearTint();
    obj.setTint(0xff5a5a);
    scene.time.delayedCall(150, () => obj.clearTint());
  });
}

/** Растворение: альфа 1 → 0 за 2 с + опускание на 4 px. */
export function dissolve(scene: Phaser.Scene, obj: Obj, onDone?: () => void): void {
  scene.tweens.add({
    targets: obj,
    alpha: 0,
    y: obj.y + 4,
    duration: 2000,
    ease: 'Sine.In',
    onComplete: () => onDone?.(),
  });
}

/** Тряска камеры. */
export function cameraShake(scene: Phaser.Scene, durMs = 200, intensity = 0.008): void {
  scene.cameras.main.shake(durMs, intensity);
}

/**
 * Хит-стоп: пауза логики и анимаций на 40 мс. Логику держит вызывающий (флаг до времени),
 * анимации сцены (tweens, anims) замораживаются здесь.
 */
export function hitStop(scene: Phaser.Scene, ms = 40): number {
  scene.tweens.pauseAll();
  scene.anims.pauseAll();
  window.setTimeout(() => {
    scene.tweens.resumeAll();
    scene.anims.resumeAll();
  }, ms);
  return ms;
}

/** Свечение: мягкий радиальный спрайт в режиме ADD + пульс альфы. */
export function glow(
  scene: Phaser.Scene,
  x: number,
  y: number,
  color: number,
  size: number,
  periodMs = 2000,
): Phaser.GameObjects.Image {
  const g = scene.add
    .image(x, y, TEX.glow)
    .setDisplaySize(size, size)
    .setTint(color)
    .setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: g,
    alpha: { from: 0.35, to: 0.9 },
    duration: periodMs / 2,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.InOut',
  });
  return g;
}

/** Эмиттер частиц с кадрами effects/* (пыль, искры, щепки, слизь). Запуск — emitter.explode(n, x, y). */
export function particles(
  scene: Phaser.Scene,
  frames: string[],
  cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {},
): Phaser.GameObjects.Particles.ParticleEmitter {
  const infos = frames.map((f) => getAssetInfo(f)).filter((x): x is NonNullable<typeof x> => !!x);
  const group = infos[0]?.group ?? 'effects';
  return scene.add.particles(0, 0, group, {
    frame: infos.map((i) => i.frame),
    lifespan: 600,
    speed: { min: 40, max: 140 },
    scale: { start: 0.35, end: 0 },
    alpha: { start: 1, end: 0 },
    gravityY: 120,
    emitting: false,
    ...cfg,
  });
}

/** Анимация пламени из effects/flame_1..6 (покадровая — разрешена для эффектов). */
export function ensureFlameAnim(scene: Phaser.Scene): void {
  if (scene.anims.exists('fx-flame')) return;
  const frames = [1, 2, 3, 4, 5, 6]
    .map((i) => getAssetInfo(`effects.flame_${i}`))
    .filter((x): x is NonNullable<typeof x> => !!x)
    .map((i) => ({ key: i.group, frame: i.frame }));
  if (frames.length) scene.anims.create({ key: 'fx-flame', frames, frameRate: 12, repeat: -1 });
}

/** Блик на воде: кружок растёт и гаснет (ANIMATIONS §4, вода). */
export function ripple(scene: Phaser.Scene, x: number, y: number, depth = 0): void {
  const r = scene.add
    .image(x, y, TEX.dot)
    .setDepth(depth)
    .setScale(0)
    .setAlpha(0.6)
    .setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: r,
    scaleX: 2.2,
    scaleY: 1.1,
    alpha: 0,
    duration: 900,
    ease: 'Sine.Out',
    onComplete: () => r.destroy(),
  });
}
