import type { Registry } from '../data/Registry';
import type { MaterialDef } from '../data/schemas';
import type { ItemSet } from '../inventory/Inventory';
import {
  LAYER_WATER,
  WALL_DOOR,
  WALL_FENCE,
  WALL_NONE,
  WALL_SOLID,
  WALL_WINDOW,
  WALL_WINDOW_BOARDED,
  type BuildCell,
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

/** Вид стены в чанке для детали. */
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

export type BuildBlock = 'out' | 'water' | 'occupied' | 'object' | 'creature' | 'no_opening' | 'no_wall';

/**
 * Можно ли поставить деталь в клетку (TZ 7.1.2): не на воду, не на объекты мира, не на персонажей;
 * пол — под стенами и мебелью можно; дверь — только в пустой проём игрока.
 */
export function canBuild(
  world: World,
  piece: BuildPiece,
  tx: number,
  ty: number,
  creatureAt: (tx: number, ty: number) => boolean,
): BuildBlock | null {
  if (tx < 0 || ty < 0 || tx >= world.size || ty >= world.size) return 'out';
  const c = world.cell(tx, ty);
  if (c.biome === 0) return 'out';
  if (c.layer === LAYER_WATER) return 'water';
  const b = world.builtAt(tx, ty);
  if (piece === 'door') {
    if (!b || b.kind !== WALL_DOOR || b.leaf) return 'no_opening';
    return null;
  }
  if (piece === 'floor') return c.floor !== 0 || (c.wall !== WALL_NONE && !b) ? 'occupied' : null;
  if (c.wall !== WALL_NONE) return 'occupied';
  if (!c.passable) return 'occupied';
  for (const o of world.objectsAt(tx, ty)) if (o.kind !== 'drop') return 'object';
  if (creatureAt(tx, ty)) return 'creature';
  return null;
}

/** Новая клетка после постройки детали. */
export function placePiece(reg: Registry, prev: BuildCell | null, piece: BuildPiece, mat: number): BuildCell {
  if (piece === 'floor') return { ...prev, floor: mat };
  if (piece === 'door') return { ...prev, leaf: true };
  return { ...prev, wall: mat, kind: PIECE_KIND[piece] ?? WALL_SOLID, hp: maxHp(reg, mat), leaf: false };
}

/** Следующий материал для улучшения или null (армобетон — последний). */
export function nextMaterial(reg: Registry, mat: number): number | null {
  return mat + 1 < reg.building.materials.length ? mat + 1 : null;
}

/**
 * Улучшение молотком (upgradeRule): следующий материал за полную цену новой детали,
 * HP пересчитывается пропорционально (было 50% — станет 50% нового максимума).
 */
export function upgradeCell(reg: Registry, b: BuildCell): { cell: BuildCell; cost: ItemSet } | null {
  if (b.wall === undefined) return null;
  const next = nextMaterial(reg, b.wall);
  if (next === null) return null;
  const frac = (b.hp ?? 0) / maxHp(reg, b.wall);
  const piece = pieceOfKind(b.kind ?? WALL_SOLID);
  return {
    cell: { ...b, wall: next, hp: Math.max(1, Math.round(frac * maxHp(reg, next))) },
    cost: pieceCost(reg, piece, next),
  };
}

/** Починка молотком (TZ 7.1.5): +repairPerHit от максимума за удар, цена — repairCostFrac материала детали. */
export function repairCell(reg: Registry, b: BuildCell): { cell: BuildCell; cost: ItemSet } | null {
  if (b.wall === undefined) return null;
  const max = maxHp(reg, b.wall);
  if ((b.hp ?? 0) >= max) return null;
  const piece = pieceOfKind(b.kind ?? WALL_SOLID);
  return {
    cell: { ...b, hp: Math.min(max, (b.hp ?? 0) + max * reg.build.repairPerHit) },
    cost: scaled(pieceCost(reg, piece, b.wall), reg.build.repairCostFrac),
  };
}

/** Сколько ударов и ресурсов нужно на полный ремонт (кнопка «Починить всё на базе»). */
export function fullRepairCost(reg: Registry, b: BuildCell): ItemSet {
  const out: Record<string, number> = {};
  let cur: BuildCell | null = b;
  for (let i = 0; i < 100 && cur; i++) {
    const r = repairCell(reg, cur);
    if (!r) break;
    for (const [id, n] of Object.entries(r.cost)) out[id] = (out[id] ?? 0) + n;
    cur = r.cell;
  }
  return out;
}

/**
 * Разбор (TZ 7.1.6): сначала дверь (если есть), потом стена/забор, потом пол.
 * Возвращает новую клетку и disassembleReturn от стоимости снятой детали (вниз, нули отбрасываются).
 */
export function disassembleCell(
  reg: Registry,
  b: BuildCell,
): { cell: BuildCell | null; piece: BuildPiece; refund: ItemSet } | null {
  let piece: BuildPiece;
  let next: BuildCell | null;
  let mat: number;
  if (b.leaf) {
    piece = 'door';
    mat = b.wall ?? 0;
    next = { ...b, leaf: false };
  } else if (b.wall !== undefined) {
    piece = pieceOfKind(b.kind ?? WALL_SOLID);
    mat = b.wall;
    next = b.floor !== undefined ? { floor: b.floor } : null;
  } else if (b.floor !== undefined) {
    piece = 'floor';
    mat = b.floor;
    next = null;
  } else return null;
  const refund: Record<string, number> = {};
  for (const [id, n] of Object.entries(pieceCost(reg, piece, mat))) {
    const k = Math.floor(n * reg.build.disassembleReturn);
    if (k > 0) refund[id] = k;
  }
  return { cell: next, piece, refund };
}

/** Клетки линии от (x0,y0) до (x1,y1) по большей оси (протяжка пальцем ставит линию стен). */
export function lineCells(x0: number, y0: number, x1: number, y1: number, max: number): [number, number][] {
  const out: [number, number][] = [];
  const horiz = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
  const n = Math.min(max, (horiz ? Math.abs(x1 - x0) : Math.abs(y1 - y0)) + 1);
  const sx = Math.sign(x1 - x0);
  const sy = Math.sign(y1 - y0);
  for (let i = 0; i < n; i++) out.push(horiz ? [x0 + i * sx, y0] : [x0, y0 + i * sy]);
  return out;
}

/** Замкнута ли клетка: стена (не проём без двери) — граница комнаты. */
function isBoundary(world: World, tx: number, ty: number): boolean {
  const c = world.cell(tx, ty);
  return c.wall !== WALL_NONE;
}

/**
 * Комната вокруг клетки (TZ 7.2): заливка от клетки героя по клеткам без стен; если заливка
 * упирается в лимит — комнаты нет (открытое место). southWalls — стены южного ряда (ключи «x,y»).
 */
export function enclosure(
  world: World,
  tx: number,
  ty: number,
  limit: number,
): { cells: Set<string>; southWalls: Set<string> } | null {
  if (isBoundary(world, tx, ty)) return null;
  const cells = new Set<string>();
  const stack: [number, number][] = [[tx, ty]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    const k = `${x},${y}`;
    if (cells.has(k)) continue;
    if (isBoundary(world, x, y)) continue;
    cells.add(k);
    if (cells.size > limit) return null;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  // Южный ряд: стены прямо под клетками комнаты + соседние по горизонтали (углы).
  const southWalls = new Set<string>();
  for (const k of cells) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    if (!isBoundary(world, x, y + 1)) continue;
    southWalls.add(`${x},${y + 1}`);
    for (const dx of [-1, 1]) if (isBoundary(world, x + dx, y + 1)) southWalls.add(`${x + dx},${y + 1}`);
  }
  return { cells, southWalls };
}
