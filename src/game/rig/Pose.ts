/** Поза: добавки к кости относительно покоя. rot — градусы (по часовой, как в Phaser), dx/dy — доли роста. */
export interface BonePose {
  rot?: number;
  dx?: number;
  dy?: number;
  /** Масштаб по высоте (дыхание). */
  sy?: number;
}

export interface Pose {
  root?: BonePose & {
    /** Точка поворота корня по высоте, доли роста (кувырок — вокруг центра тела). */
    pivotY?: number;
  };
  bones: Record<string, BonePose>;
  /** Замены частей (голова — гримаса/моргание, кулак). */
  swaps?: Record<string, string>;
}

export const EMPTY_POSE: Pose = { bones: {} };

function lerp(a: number | undefined, b: number | undefined, k: number, def = 0): number {
  const x = a ?? def;
  return x + ((b ?? def) - x) * k;
}

/** Угол — по кратчайшей дуге (после кувырка 359° → 0° без обратного оборота). */
function lerpAngle(a: number | undefined, b: number | undefined, k: number): number {
  const x = a ?? 0;
  const d = (((((b ?? 0) - x) % 360) + 540) % 360) - 180;
  return x + d * k;
}

/** Смешивание поз (переход 0.1 с). */
export function blendPoses(a: Pose, b: Pose, k: number): Pose {
  const ids = new Set([...Object.keys(a.bones), ...Object.keys(b.bones)]);
  const bones: Record<string, BonePose> = {};
  for (const id of ids) {
    const pa = a.bones[id] ?? {};
    const pb = b.bones[id] ?? {};
    bones[id] = {
      rot: lerpAngle(pa.rot, pb.rot, k),
      dx: lerp(pa.dx, pb.dx, k),
      dy: lerp(pa.dy, pb.dy, k),
      sy: lerp(pa.sy, pb.sy, k, 1),
    };
  }
  const ra = a.root ?? {};
  const rb = b.root ?? {};
  return {
    root: {
      rot: lerpAngle(ra.rot, rb.rot, k),
      dx: lerp(ra.dx, rb.dx, k),
      dy: lerp(ra.dy, rb.dy, k),
      pivotY: k < 0.5 ? ra.pivotY : rb.pivotY,
    },
    bones,
    swaps: k < 0.5 ? a.swaps : b.swaps,
  };
}

/** Ease in-out для ключей. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Значение по ключам [время 0…1, значение] с ease in-out между ключами. */
export function keys(t: number, k: [number, number][]): number {
  if (t <= k[0]![0]) return k[0]![1];
  for (let i = 1; i < k.length; i++) {
    const [t1, v1] = k[i]!;
    const [t0, v0] = k[i - 1]!;
    if (t <= t1) return v0 + (v1 - v0) * easeInOut((t - t0) / (t1 - t0));
  }
  return k[k.length - 1]![1];
}
