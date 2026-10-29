import type { Registry } from '../data/Registry';
import type { MaterialDef } from '../data/schemas';
import type { ItemSet } from '../inventory/Inventory';
import { edgeRect, type Rect } from './Collision';
import {
  LAYER_WATER,
  WALL_DOOR,
  WALL_FENCE,
  WALL_NONE,
  WALL_SOLID,
  WALL_WINDOW,
  WALL_WINDOW_BOARDED,
  type BuildCell,
  type BuildSlot,
  type Collider,
  type EdgeRef,
  type EdgeWall,
} from './types';
import type { World } from './World';

/** Детали строительства на сетке (TZ 7.1). */
export type BuildPiece = 'wall' | 'window' | 'window_boarded' | 'door_opening' | 'door' | 'floor' | 'fence';
export const BUILD_PIECES: readonly BuildPiece[] = [
  'wall',
  'window',
  'window_boarded',
  'door_opening',
  'door',
  'floor',
  'fence',
];

/** Вид стены на ребре для детали. */
export const PIECE_KIND: Partial<Record<BuildPiece, number>> = {
  wall: WALL_SOLID,
  window: WALL_WINDOW,
  window_boarded: WALL_WINDOW_BOARDED,
  door_opening: WALL_DOOR,
  fence: WALL_FENCE,
};

export function pieceOfKind(kind: number): BuildPiece {
  return kind === WALL_WINDOW
    ? 'window'
    : kind === WALL_WINDOW_BOARDED
      ? 'window_boarded'
      : kind === WALL_DOOR
        ? 'door_opening'
        : kind === WALL_FENCE
          ? 'fence'
          : 'wall';
}

function scaled(cost: ItemSet, mul: number): ItemSet {
  const out: Record<string, number> = {};
  for (const [id, n] of Object.entries(cost)) out[id] = Math.max(1, Math.ceil(n * mul));
  return out;
}

/** Стоимость детали из материала (TZ 7.1.3): стена — cost, пол ×floorCostMul, окна ×windowCostMul, дверь — doorCost. */
export function pieceCost(reg: Registry, piece: BuildPiece, mat: number): ItemSet {
  const B = reg.building.def;
  const m = reg.building.materials[mat]!;
  switch (piece) {
    case 'floor':
      return scaled(m.cost, B.floorCostMul);
    case 'window':
    case 'window_boarded':
      return scaled(m.cost, B.windowCostMul);
    case 'door':
      return { ...B.doorCost };
    case 'fence':
      return scaled(m.cost, reg.build.fenceCostMul);
    default:
      return { ...m.cost };
  }
}

/** Прочность детали: стены, окна, проёмы, заборы — HP материала. */
export function maxHp(reg: Registry, mat: number): number {
  return reg.building.materials[mat]!.hp;
}

/** Требование материала (requires): предмет в инвентаре или станок рядом. */
export function requirementMet(
  reg: Registry,
  m: MaterialDef,
  hasItem: (id: string) => boolean,
  stationNear: (id: string) => boolean,
): boolean {
  return reg.stations.has(m.requires) ? stationNear(m.requires) : hasItem(m.requires);
}

export type BuildBlock =
  'out' | 'water' | 'occupied' | 'object' | 'creature' | 'no_opening' | 'no_floor' | 'wrong_slot';

/** Деталь ставится на ребро клетки (всё, кроме пола). */
export function onEdge(piece: BuildPiece): boolean {
  return piece !== 'floor';
}

/** Две клетки по сторонам ребра: для 'n' — северная и южная, для 'w' — западная и восточная. */
export function edgeCells(e: EdgeRef): [[number, number], [number, number]] {
  return e.side === 'n'
    ? [
        [e.tx, e.ty - 1],
        [e.tx, e.ty],
      ]
    : [
        [e.tx - 1, e.ty],
        [e.tx, e.ty],
      ];
}

function overlaps(r: Rect, c: Collider): boolean {
  if (c.shape === 'circle') {
    const dx = c.x - Math.max(r.x0, Math.min(c.x, r.x1));
    const dy = c.y - Math.max(r.y0, Math.min(c.y, r.y1));
    return dx * dx + dy * dy < c.r * c.r;
  }
  return c.x0 < r.x1 && c.x1 > r.x0 && c.y0 < r.y1 && c.y1 > r.y0;
}

function hasFloor(world: World, tx: number, ty: number): boolean {
  return world.builtAt(tx, ty)?.floor !== undefined;
}

/**
 * Можно ли поставить деталь (TZ 7.1.2, стены как в Last Day on Earth): пол — в свободную клетку суши;
 * стена, окно, проём — на свободное ребро рядом с полом игрока (фундамент); забор — на ребро без пола;
 * не на воду, не через объекты мира и персонажей; дверь — только в пустой проём игрока.
 * creatureIn — есть ли персонаж в прямоугольнике (клетки мира).
 */
export function canBuild(
  world: World,
  piece: BuildPiece,
  slot: BuildSlot,
  creatureIn: (r: Rect) => boolean,
): BuildBlock | null {
  const land = (tx: number, ty: number): BuildBlock | null => {
    if (tx < 0 || ty < 0 || tx >= world.size || ty >= world.size) return 'out';
    const c = world.cell(tx, ty);
    if (c.biome === 0) return 'out';
    if (c.layer === LAYER_WATER) return 'water';
    if (c.wall !== WALL_NONE || !c.passable) return 'occupied';
    return null;
  };
  if (!onEdge(piece)) {
    if (slot.side !== 'c') return 'wrong_slot';
    return land(slot.tx, slot.ty) ?? (world.cell(slot.tx, slot.ty).floor !== 0 ? 'occupied' : null);
  }
  if (slot.side === 'c') return 'wrong_slot';
  const e: EdgeRef = { tx: slot.tx, ty: slot.ty, side: slot.side };
  const cur = world.edgeAt(e);
  if (piece === 'door') return !cur || cur.kind !== WALL_DOOR || cur.leaf ? 'no_opening' : null;
  if (cur || world.edgeBits(e.tx, e.ty, e.side)) return 'occupied';
  const cells = edgeCells(e);
  const blocks = cells.map(([x, y]) => land(x, y));
  // Стена держится на полу с одной стороны — другая может быть водой или обрывом; забору нужна суша с обеих.
  if (piece === 'fence') {
    const b = blocks.find((x) => x !== null);
    if (b) return b;
  } else {
    if (!cells.some(([x, y]) => hasFloor(world, x, y))) return 'no_floor';
    const b = blocks.find((x, i) => x !== null && x !== 'water' && hasFloor(world, ...cells[i]!));
    if (b) return b;
    if (blocks.every((x) => x !== null)) return blocks[0]!;
  }
  const r = edgeRect(e.tx, e.ty, e.side);
  for (const [x, y] of cells)
    for (const o of world.collidersAt(x, y))
      if (o.kind !== 'drop' && o.collider && overlaps(r, o.collider)) return 'object';
  if (creatureIn(r)) return 'creature';
  return null;
}

/** Клетка свободна под станок или защиту: суша, без объектов и персонажей (пол и стены по краю можно). */
export function cellFree(
  world: World,
  tx: number,
  ty: number,
  creatureIn: (r: Rect) => boolean,
): BuildBlock | null {
  if (tx < 0 || ty < 0 || tx >= world.size || ty >= world.size) return 'out';
  const c = world.cell(tx, ty);
  if (c.biome === 0) return 'out';
  if (c.layer === LAYER_WATER) return 'water';
  if (c.wall !== WALL_NONE || !c.passable) return 'occupied';
  for (const o of world.objectsAt(tx, ty)) if (o.kind !== 'drop') return 'object';
  if (creatureIn({ x0: tx, y0: ty, x1: tx + 1, y1: ty + 1 })) return 'creature';
  return null;
}

/** Новая клетка после постройки детали: пол — в клетку, остальное — на её ребро. */
export function placePiece(
  reg: Registry,
  prev: BuildCell | null,
  piece: BuildPiece,
  mat: number,
  slot: BuildSlot,
): BuildCell {
  const next: BuildCell = { ...prev };
  if (slot.side === 'c') {
    next.floor = mat;
    return next;
  }
  const cur = next[slot.side];
  next[slot.side] =
    piece === 'door' && cur
      ? { ...cur, leaf: true }
      : { mat, kind: PIECE_KIND[piece] ?? WALL_SOLID, hp: maxHp(reg, mat) };
  return next;
}

/** Следующий материал для улучшения или null (армобетон — последний). */
export function nextMaterial(reg: Registry, mat: number): number | null {
  return mat + 1 < reg.building.materials.length ? mat + 1 : null;
}

/**
 * Улучшение молотком (upgradeRule): следующий материал за полную цену новой детали,
 * HP пересчитывается пропорционально (было 50% — станет 50% нового максимума).
 */
export function upgradeEdge(reg: Registry, w: EdgeWall): { wall: EdgeWall; cost: ItemSet } | null {
  const next = nextMaterial(reg, w.mat);
  if (next === null) return null;
  const frac = w.hp / maxHp(reg, w.mat);
  return {
    wall: { ...w, mat: next, hp: Math.max(1, Math.round(frac * maxHp(reg, next))) },
    cost: pieceCost(reg, pieceOfKind(w.kind), next),
  };
}

/** Починка молотком (TZ 7.1.5): +repairPerHit от максимума за удар, цена — repairCostFrac материала детали. */
export function repairEdge(reg: Registry, w: EdgeWall): { wall: EdgeWall; cost: ItemSet } | null {
  const max = maxHp(reg, w.mat);
  if (w.hp >= max) return null;
  return {
    wall: { ...w, hp: Math.min(max, w.hp + max * reg.build.repairPerHit) },
    cost: scaled(pieceCost(reg, pieceOfKind(w.kind), w.mat), reg.build.repairCostFrac),
  };
}

/** Сколько ресурсов нужно на полный ремонт (кнопка «Починить всё на базе»). */
export function fullRepairCost(reg: Registry, w: EdgeWall): ItemSet {
  const out: Record<string, number> = {};
  let cur: EdgeWall | null = w;
  for (let i = 0; i < 100 && cur; i++) {
    const r = repairEdge(reg, cur);
    if (!r) break;
    for (const [id, n] of Object.entries(r.cost)) out[id] = (out[id] ?? 0) + n;
    cur = r.wall;
  }
  return out;
}

/** Четыре ребра вокруг клетки. */
export function edgesAround(tx: number, ty: number): EdgeRef[] {
  return [
    { tx, ty, side: 'n' },
    { tx, ty, side: 'w' },
    { tx, ty: ty + 1, side: 'n' },
    { tx: tx + 1, ty, side: 'w' },
  ];
}

/** Пол клетки — единственная опора стены рядом (её разбирают первой). */
export function floorHoldsWalls(world: World, tx: number, ty: number): boolean {
  for (const e of edgesAround(tx, ty)) {
    const w = world.edgeAt(e);
    if (!w || w.kind === WALL_FENCE) continue;
    const other = edgeCells(e).find(([x, y]) => x !== tx || y !== ty)!;
    if (!hasFloor(world, other[0], other[1])) return true;
  }
  return false;
}

/**
 * Разбор (TZ 7.1.6): на ребре — сначала дверь (если есть), потом стена; в клетке — пол, если он
 * не держит стену. Возвращает новую клетку и disassembleReturn от стоимости снятой детали.
 */
export function disassembleSlot(
  reg: Registry,
  world: World,
  slot: BuildSlot,
): { cell: BuildCell | null; piece: BuildPiece; refund: ItemSet } | null {
  const b = world.builtAt(slot.tx, slot.ty);
  if (!b) return null;
  let piece: BuildPiece;
  let mat: number;
  const next: BuildCell = { ...b };
  if (slot.side === 'c') {
    if (b.floor === undefined || floorHoldsWalls(world, slot.tx, slot.ty)) return null;
    piece = 'floor';
    mat = b.floor;
    delete next.floor;
  } else {
    const w = b[slot.side];
    if (!w) return null;
    mat = w.mat;
    if (w.leaf) {
      piece = 'door';
      next[slot.side] = { ...w, leaf: false };
    } else {
      piece = pieceOfKind(w.kind);
      delete next[slot.side];
    }
  }
  const refund: Record<string, number> = {};
  for (const [id, n] of Object.entries(pieceCost(reg, piece, mat))) {
    const k = Math.floor(n * reg.build.disassembleReturn);
    if (k > 0) refund[id] = k;
  }
  const empty = next.floor === undefined && !next.n && !next.w;
  return { cell: empty ? null : next, piece, refund };
}

/** Рёбра линии вдоль ребра from до клетки (x, y): северные — по X, западные — по Y (протяжка). */
export function lineEdges(from: EdgeRef, x: number, y: number, max: number): EdgeRef[] {
  const out: EdgeRef[] = [];
  const along = from.side === 'n' ? x - from.tx : y - from.ty;
  const n = Math.min(max, Math.abs(along) + 1);
  const s = Math.sign(along);
  for (let i = 0; i < n; i++)
    out.push(
      from.side === 'n'
        ? { tx: from.tx + i * s, ty: from.ty, side: 'n' }
        : { tx: from.tx, ty: from.ty + i * s, side: 'w' },
    );
  return out;
}

/** Клетки прямоугольника от (x0,y0) до (x1,y1), не больше max по стороне (пол протяжкой). */
export function rectCells(x0: number, y0: number, x1: number, y1: number, max: number): [number, number][] {
  const out: [number, number][] = [];
  const sx = Math.sign(x1 - x0) || 1;
  const sy = Math.sign(y1 - y0) || 1;
  const w = Math.min(max, Math.abs(x1 - x0) + 1);
  const h = Math.min(max, Math.abs(y1 - y0) + 1);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push([x0 + i * sx, y0 + j * sy]);
  return out;
}

/** Ключ ребра для множеств. */
export function edgeKey(e: EdgeRef): string {
  return `${e.tx},${e.ty},${e.side}`;
}

/**
 * Комната вокруг клетки (TZ 7.2): заливка от клетки героя через рёбра без стен (проём тоже граница);
 * упёрлась в лимит — комнаты нет (открытое место). southEdges — северные рёбра южной границы (ключи edgeKey).
 */
export function enclosure(
  world: World,
  tx: number,
  ty: number,
  limit: number,
): { cells: Set<string>; southEdges: Set<string> } | null {
  if (world.cell(tx, ty).wall !== WALL_NONE) return null;
  const cells = new Set<string>();
  const stack: [number, number][] = [[tx, ty]];
  const open = (x: number, y: number, nx: number, ny: number) =>
    world.cell(nx, ny).wall === WALL_NONE && world.edgeBetween(x, y, nx, ny) === 0;
  while (stack.length) {
    const [x, y] = stack.pop()!;
    const k = `${x},${y}`;
    if (cells.has(k)) continue;
    cells.add(k);
    if (cells.size > limit) return null;
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as const)
      if (!cells.has(`${nx},${ny}`) && open(x, y, nx, ny)) stack.push([nx, ny]);
  }
  const southEdges = new Set<string>();
  for (const k of cells) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    if (world.edgeBits(x, y + 1, 'n')) southEdges.add(edgeKey({ tx: x, ty: y + 1, side: 'n' }));
  }
  return { cells, southEdges };
}
