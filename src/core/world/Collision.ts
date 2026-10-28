import { WALL_DOOR, WALL_FENCE, type Collider } from './types';
import type { World } from './World';

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Вектор выталкивания круга (x, y, r) из коллайдера или null, если не пересекаются. */
export function pushOut(
  x: number,
  y: number,
  r: number,
  c: Collider | Rect,
): { dx: number; dy: number } | null {
  if ('shape' in c && c.shape === 'circle') {
    const dx = x - c.x;
    const dy = y - c.y;
    const d = Math.hypot(dx, dy);
    const min = r + c.r;
    if (d >= min) return null;
    if (d < 1e-6) return { dx: 0, dy: min };
    const k = (min - d) / d;
    return { dx: dx * k, dy: dy * k };
  }
  const rect = c as Rect;
  const px = Math.max(rect.x0, Math.min(x, rect.x1));
  const py = Math.max(rect.y0, Math.min(y, rect.y1));
  const dx = x - px;
  const dy = y - py;
  const d = Math.hypot(dx, dy);
  if (d >= r) return null;
  if (d > 1e-6) {
    const k = (r - d) / d;
    return { dx: dx * k, dy: dy * k };
  }
  // Центр внутри прямоугольника — выталкиваем по кратчайшей оси.
  const left = x - rect.x0 + r;
  const right = rect.x1 - x + r;
  const up = y - rect.y0 + r;
  const down = rect.y1 - y + r;
  const m = Math.min(left, right, up, down);
  if (m === left) return { dx: -left, dy: 0 };
  if (m === right) return { dx: right, dy: 0 };
  if (m === up) return { dx: 0, dy: -up };
  return { dx: 0, dy: down };
}

/**
 * Твёрдые формы вокруг точки: коллайдеры объектов (пространственная сетка мира),
 * стены (клетка + лицо стены под ней, если южнее не стена), непроходимые клетки.
 */
export function solidsNear(
  world: World,
  x: number,
  y: number,
  reach: number,
  faceDepth: number,
  doorsSolid = false,
): (Collider | Rect)[] {
  const out: (Collider | Rect)[] = [];
  const seen = new Set<object>();
  for (let ty = Math.floor(y - reach) - 1; ty <= Math.floor(y + reach); ty++) {
    for (let tx = Math.floor(x - reach); tx <= Math.floor(x + reach); tx++) {
      for (const o of world.collidersAt(tx, ty)) {
        if (o.collider && !seen.has(o)) {
          seen.add(o);
          out.push(o.collider);
        }
      }
      const c = world.cell(tx, ty);
      // Враги не проходят двери игрока (створка закрыта для них всегда).
      const door = c.wallKind === WALL_DOOR && !(doorsSolid && world.builtAt(tx, ty)?.leaf);
      if (c.wall !== 0 && !door) {
        const below = world.cell(tx, ty + 1);
        const face = below.wall === 0 && c.wallKind !== WALL_FENCE ? faceDepth : 0;
        out.push({ x0: tx, y0: ty, x1: tx + 1, y1: ty + 1 + face });
      } else if (!c.passable && c.wall === 0) {
        out.push({ x0: tx, y0: ty, x1: tx + 1, y1: ty + 1 });
      }
    }
  }
  return out;
}

/**
 * Перемещение круга со скольжением вдоль препятствий: шаг делится на подшаги не длиннее r/2,
 * после каждого — несколько итераций выталкивания.
 */
export function moveCircle(
  world: World,
  x: number,
  y: number,
  r: number,
  dx: number,
  dy: number,
  faceDepth: number,
  doorsSolid = false,
): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / (r * 0.5)));
  let px = x;
  let py = y;
  for (let s = 0; s < steps; s++) {
    px += dx / steps;
    py += dy / steps;
    const solids = solidsNear(world, px, py, r + 1, faceDepth, doorsSolid);
    for (let it = 0; it < 4; it++) {
      let moved = false;
      for (const c of solids) {
        const p = pushOut(px, py, r, c);
        if (p) {
          px += p.dx;
          py += p.dy;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }
  return { x: px, y: py };
}
