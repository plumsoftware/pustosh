import type Phaser from 'phaser';
import { getAssetInfo } from '../assets/AssetIndex';

/** Тайл на экране, px (масштаб 1). */
export const TILE = 64;
/** Шаг клетки в тайлсете: тайл + по 1 px выдавленного края с каждой стороны. */
const CELL = TILE + 2;
const MARGIN = 1;
const SPACING = 2;
/** Маски краёв: биты N=1, E=2, S=4, W=8 → 15 вариантов. */
export const MASKS = 15;
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;
/** Ширина мягкого края перехода в долях тайла. */
const EDGE = 0.42;
/** Скорость течения воды, px/с (ANIMATIONS §4). */
const WATER_FLOW = 6;

export const GROUND_KEY = 'ground-tiles';
export const WATER_KEY = 'ground-water';

export interface GroundTileset {
  key: string;
  waterKey: string;
  columns: number;
  tileCount: number;
  /** Индекс тайла в тайлсете: базовый (mask 0) или край соседа по маске. */
  index(tile: number, mask: number): number;
  margin: number;
  spacing: number;
  /** Сдвигает текстуру воды (вызывать каждый кадр). */
  updateWater(timeMs: number): void;
}

function tileSource(
  scene: Phaser.Scene,
  name: string,
): { img: CanvasImageSource; x: number; y: number; w: number; h: number } {
  const info = getAssetInfo(`tiles.${name}`);
  if (!info) throw new Error(`GroundTiles: нет тайла tiles.${name}`);
  const f = scene.textures.getFrame(info.group, info.frame);
  return { img: f.source.image as CanvasImageSource, x: f.cutX, y: f.cutY, w: f.cutWidth, h: f.cutHeight };
}

/** Маска мягкого края: альфа 1 у стороны соседа, 0 к середине; край чуть «рваный». */
function buildMask(mask: number): Float32Array {
  const a = new Float32Array(TILE * TILE);
  const edge = EDGE * TILE;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let v = 0;
      const side = (dist: number, along: number, k: number) => {
        const wob = 3.5 * Math.sin(along * 0.21 + k * 1.7) + 2 * Math.sin(along * 0.57 + k);
        const t = 1 - Math.min(1, Math.max(0, (dist + wob) / edge));
        return t * t * (3 - 2 * t);
      };
      if (mask & N) v = Math.max(v, side(y, x, 1));
      if (mask & S) v = Math.max(v, side(TILE - 1 - y, x, 2));
      if (mask & W) v = Math.max(v, side(x, y, 3));
      if (mask & E) v = Math.max(v, side(TILE - 1 - x, y, 4));
      a[y * TILE + x] = v;
    }
  }
  return a;
}

/**
 * Тайлсет земли, собранный кодом из атласа tiles: базовые тайлы + для каждого тайла 15 вариантов
 * «мягкого края» (переход к соседу). Рисуется в 1x (64 px) — рендер на телефонах тоже 1x.
 */
export function buildGroundTileset(scene: Phaser.Scene, tileNames: readonly string[]): GroundTileset {
  const T = tileNames.length;
  const count = T + T * MASKS;
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const index = (tile: number, mask: number) => (mask === 0 ? tile : T + tile * MASKS + (mask - 1));

  if (!scene.textures.exists(GROUND_KEY)) {
    // Phaser ждёт: (размер - 2·margin + spacing) кратен (тайл + spacing) → ровно columns × CELL.
    const tex = scene.textures.createCanvas(GROUND_KEY, columns * CELL, rows * CELL)!;
    const ctx = tex.context;
    const pos = (i: number) => ({
      x: MARGIN + (i % columns) * CELL,
      y: MARGIN + Math.floor(i / columns) * CELL,
    });
    // Базовые тайлы с выдавленным краем (рисуем на 1 px шире с каждой стороны).
    const base: HTMLCanvasElement[] = [];
    tileNames.forEach((name, t) => {
      const src = tileSource(scene, name);
      const p = pos(t);
      ctx.drawImage(src.img, src.x, src.y, src.w, src.h, p.x - 1, p.y - 1, TILE + 2, TILE + 2);
      const c = document.createElement('canvas');
      c.width = TILE;
      c.height = TILE;
      c.getContext('2d')!.drawImage(src.img, src.x, src.y, src.w, src.h, 0, 0, TILE, TILE);
      base.push(c);
    });
    // Края: тайл соседа × маска.
    const masks = Array.from({ length: MASKS }, (_, m) => buildMask(m + 1));
    const tmp = document.createElement('canvas');
    tmp.width = TILE;
    tmp.height = TILE;
    const tctx = tmp.getContext('2d', { willReadFrequently: true })!;
    for (let t = 0; t < T; t++) {
      tctx.clearRect(0, 0, TILE, TILE);
      tctx.drawImage(base[t]!, 0, 0);
      const src = tctx.getImageData(0, 0, TILE, TILE);
      for (let m = 0; m < MASKS; m++) {
        const out = new ImageData(new Uint8ClampedArray(src.data), TILE, TILE);
        const mk = masks[m]!;
        for (let i = 0; i < mk.length; i++) out.data[i * 4 + 3] = Math.round(out.data[i * 4 + 3]! * mk[i]!);
        const p = pos(index(t, m + 1));
        ctx.putImageData(out, p.x, p.y);
      }
    }
    tex.refresh();
  }

  // Вода — отдельная маленькая текстура, которую каждый кадр перерисовываем со сдвигом.
  const waterName = tileNames.find((n) => n.startsWith('water')) ?? tileNames[0]!;
  const wsrc = tileSource(scene, waterName);
  const water = document.createElement('canvas');
  water.width = TILE;
  water.height = TILE;
  water.getContext('2d')!.drawImage(wsrc.img, wsrc.x, wsrc.y, wsrc.w, wsrc.h, 0, 0, TILE, TILE);
  const wtex = scene.textures.exists(WATER_KEY)
    ? (scene.textures.get(WATER_KEY) as Phaser.Textures.CanvasTexture)
    : scene.textures.createCanvas(WATER_KEY, CELL, CELL)!;
  let lastShift = -1;
  const updateWater = (timeMs: number) => {
    const shift = Math.floor(((timeMs / 1000) * WATER_FLOW) % TILE);
    if (shift === lastShift) return;
    lastShift = shift;
    const c = wtex.context;
    // Текстура смещается по диагонали; рисуем 3×3 копии, чтобы закрыть клетку с выдавленным краем.
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        c.drawImage(water, MARGIN + dx * TILE + shift, MARGIN + dy * TILE + shift * 0.5);
    wtex.refresh();
  };
  updateWater(0);

  return {
    key: GROUND_KEY,
    waterKey: WATER_KEY,
    columns,
    tileCount: count,
    index,
    margin: MARGIN,
    spacing: SPACING,
    updateWater,
  };
}
