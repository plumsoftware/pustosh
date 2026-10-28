import type { AssetId } from '../data/schemas';

/** Коллайдер в клетках мира (1 = один тайл). */
export type Collider =
  | { shape: 'circle'; x: number; y: number; r: number }
  | { shape: 'rect'; x0: number; y0: number; x1: number; y1: number };

/** Откуда взят объект — для добычи, лута и сохранения. */
export type ObjectRef =
  | { type: 'biome'; biome: number; id: string }
  | { type: 'container'; id: string }
  | { type: 'furniture'; id: string }
  | { type: 'station'; id: string; state?: string }
  | { type: 'defense'; id: string }
  | { type: 'prefab'; id: string };

export type ObjectState = 'intact' | 'harvested' | 'opened';

export interface WorldObject {
  /** Стабильный id: одинаковый при каждой генерации с тем же сидом. */
  uid: string;
  ref: ObjectRef;
  /** Вид из biomes.json (tree, rock…) или furniture / container / station / gate. */
  kind: string;
  sprite: AssetId;
  /** Спрайт после добычи/открытия (если есть). */
  spriteAfter?: AssetId;
  /** Точка основания в клетках (float). */
  x: number;
  y: number;
  biome: number;
  collider: Collider | null;
  state: ObjectState;
  flipX?: boolean;
  /** Цвет свечения (#RRGGBB) — грибы, кристаллы, уран. */
  glow?: string;
  /** Радиус источника света в клетках — костёр, фонари. */
  light?: number;
  /** Предмет, который снимает препятствие (ворота). */
  requires?: string;
  /** Комната префаба, к которой относится объект. */
  room?: number;
  /** Дроп: что лежит на земле. */
  item?: ItemStack;
  /** Дроп исчезает в этот момент (игровые секунды мира). */
  expiresAt?: number;
  /** Прочность защиты (постройки игрока). */
  hp?: number;
  /** Состояние защиты: взведён ли капкан, патроны, топливо, угол головы турели. */
  data?: Record<string, number | boolean>;
}

/** Слой клетки. */
export const LAYER_GROUND = 0;
export const LAYER_WATER = 1;

/** Тип стены в клетке. */
export const WALL_NONE = 0;
export const WALL_SOLID = 1;
export const WALL_DOOR = 2;
export const WALL_WINDOW = 3;
/** Забор на границе колец: непроходим, рисуется деталью fence материала. */
export const WALL_FENCE = 4;
/** Заколоченное окно (постройка игрока). */
export const WALL_WINDOW_BOARDED = 5;

/** Стопка предметов (дроп, содержимое ящика, слот инвентаря). */
export interface ItemStack {
  id: string;
  count: number;
  /** Прочность (инструменты, оружие, одежда); 0 — сломан. */
  durability?: number;
  /** Модификации оружия (шаг 8). */
  mods?: string[];
}

/**
 * Постройка игрока в клетке (шаг 7): стена/окно/проём/забор с материалом и прочностью, створка двери, пол.
 * Материал — индекс в building.json → materials.
 */
export interface BuildCell {
  wall?: number;
  /** WALL_SOLID, WALL_WINDOW, WALL_WINDOW_BOARDED, WALL_DOOR (проём), WALL_FENCE. */
  kind?: number;
  hp?: number;
  /** В проёме висит дверь. */
  leaf?: boolean;
  floor?: number;
}

/** Комната префаба: границы по стенам (включительно), южный ряд стен. */
export interface Room {
  id: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** y южной стены — она полупрозрачна, когда герой внутри. */
  southY: number;
}
