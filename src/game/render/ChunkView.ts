import Phaser from 'phaser';
import type { Registry } from '../../core/data/Registry';
import type { MaterialDef, WallPiece } from '../../core/data/schemas';
import {
  LAYER_WATER,
  WALL_DOOR,
  WALL_FENCE,
  WALL_NONE,
  WALL_WINDOW,
  WALL_WINDOW_BOARDED,
  EDGE_KIND,
  EDGE_LEAF,
  EDGE_T,
  type Chunk,
  type EdgeWall,
  type Side,
  type World,
  type WorldObject,
} from '../../core/world';
import { getAssetInfo } from '../assets/AssetIndex';
import { AssetLoader } from '../assets/AssetLoader';
import { spawnSprite } from '../assets/spawnSprite';
import { E, N, S, TILE, W, type GroundTileset } from './GroundTiles';
import { TEX } from './textures';
import { rarityColor } from '../world/rarity';

/** Глубины слоёв (объекты мира сортируются по y основания в пикселях, 0…32768). */
export const DEPTH = {
  ground: -3e6,
  edges: -2.9e6,
  floor: -2.8e6,
  shadow: -2.7e6,
  /** Блики воды — сразу над землёй (ADD, одним пакетом). */
  water: -2.85e6,
  glow: 1e6,
  lighting: 2e6,
  debug: 3e6,
};

/** Ветер (ANIMATIONS §4): амплитуда в градусах и период в секундах. */
const SWAY = {
  tree: { amp: 1.5, period: 3.5, breathe: 0 },
  grass: { amp: 3, period: 2, breathe: 0 },
  bush: { amp: 3, period: 2, breathe: 0.02 },
} as const;
/** Перекрытие героя: альфа и время перехода (ANIMATIONS §4). */
export const OCCLUDE_ALPHA = 0.45;
export const OCCLUDE_MS = 150;
/** Южная стена комнаты, когда герой внутри (building.json → assembly_rules). */
export const ROOM_SOUTH_ALPHA = 0.35;
/** Порции сборки чанка (на телефоне чанк целиком — 15–30 мс). */
const ROWS_PER_STEP = 4;
const OBJECTS_PER_STEP = 8;
/** Тинт обысканного контейнера (TZ 5.3.2: «гаснут, тинт 70%»). */
const OPENED_TINT = 0xb3b3b3;
/** Шаг рядов секций забора — доля высоты секции (ряды чуть перекрываются). */
const FENCE_ROW_STEP = 0.8;
/** Дроп: масштаб иконки и подъём над землёй, px. */
const DROP_SCALE = 0.5;
const DROP_LIFT = 12;
/** Размер свечения относительно спрайта. */
const GLOW_SIZE = 1.1;
/** Затемнение пола комнат относительно верха стен. */
const FLOOR_TINT = 0x9a9a9a;
/** Пульс свечения, мс (ANIMATIONS §4). */
const GLOW_PERIOD = 2000;

export interface ObjView {
  obj: WorldObject;
  img: Phaser.GameObjects.Image;
  shadow?: Phaser.GameObjects.Image;
  glow?: Phaser.GameObjects.Image;
  flame?: Phaser.GameObjects.Sprite;
  sway?: (typeof SWAY)[keyof typeof SWAY];
  /** Дроп парит ±2 px (ANIMATIONS §0). */
  float?: boolean;
  /** Рамка редкости дропа. */
  rarity?: Phaser.GameObjects.Image;
  phase: number;
  baseScaleX: number;
  baseScaleY: number;
  /** Текущая альфа перекрытия (плавно идёт к цели). */
  alpha: number;
}

export interface WallView {
  imgs: Phaser.GameObjects.Image[];
  room: number;
  south: boolean;
  /** Прямоугольник лица + верха в пикселях — для перекрытия героя. */
  depth: number;
  tx: number;
  ty: number;
  /** Стена игрока на ребре клетки (у стен префабов — нет). */
  side?: Side;
  /** Створка двери (сжимается по X к петле, когда открыта). */
  door?: Phaser.GameObjects.Image;
  open?: boolean;
  /** Лицо стены (тряска при уроне) и наложение трещин. */
  face?: Phaser.GameObjects.Image;
  overlay?: Phaser.GameObjects.Image;
}

/** Дверь открывается/закрывается за 0.15 с, открытая — 20% ширины (assembly_rules). */
const DOOR_MS = 150;
const DOOR_OPEN_SCALE = 0.2;

/**
 * Отрисовка одного чанка: слои тайлов (база + 2 слоя мягких краёв), пол комнат, стены по
 * assembly_rules, объекты со своими тенями, свечением и огнём. Объекты ленивых биомов
 * появляются после догрузки атласа.
 */
export class ChunkView {
  readonly objects: ObjView[] = [];
  readonly walls: WallView[] = [];
  /** Клетки воды (мировые координаты клеток) — для бликов. */
  readonly waterCells: [number, number][] = [];
  private readonly map: Phaser.Tilemaps.Tilemap;
  private readonly extra: Phaser.GameObjects.GameObject[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
    private readonly reg: Registry,
    readonly chunk: Chunk,
    ts: GroundTileset,
  ) {
    const n = chunk.n;
    const ox = chunk.cx * n * TILE;
    const oy = chunk.cy * n * TILE;
    this.map = scene.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: n, height: n });
    const ground = this.map.addTilesetImage(ts.key, ts.key, TILE, TILE, ts.margin, ts.spacing, 0)!;
    const water = this.map.addTilesetImage(
      ts.waterKey,
      ts.waterKey,
      TILE,
      TILE,
      ts.margin,
      ts.spacing,
      ts.tileCount,
    )!;
    const base = this.map.createBlankLayer('base', [ground, water], ox, oy)!.setDepth(DEPTH.ground);
    const e1 = this.map.createBlankLayer('edge1', ground, ox, oy)!.setDepth(DEPTH.edges);
    const e2 = this.map.createBlankLayer('edge2', ground, ox, oy)!.setDepth(DEPTH.edges + 1);
    this.steps = this.build(ts, base, e1, e2);
  }

  private readonly steps: Generator<void, void, void>;
  /** Сборка закончена. */
  ready = false;
  /** Ждём догрузку атласа — дальше в этом кадре не продвигаемся. */
  private waiting = false;

  /** Сборка порциями: тайлы по строкам, стены, объекты пачками. Возвращает true, когда готово. */
  buildStep(deadline: number): boolean {
    if (this.ready) return true;
    do {
      if (this.steps.next().done) {
        this.ready = true;
        return true;
      }
    } while (!this.waiting && performance.now() < deadline);
    return false;
  }

  private *build(
    ts: GroundTileset,
    base: Phaser.Tilemaps.TilemapLayer,
    e1: Phaser.Tilemaps.TilemapLayer,
    e2: Phaser.Tilemaps.TilemapLayer,
  ): Generator<void, void, void> {
    yield* this.fillTiles(ts, base, e1, e2);
    yield* this.buildFloorsAndWalls();
    yield* this.buildObjects();
  }

  // ------------------------------------------------------------------ тайлы

  private *fillTiles(
    ts: GroundTileset,
    base: Phaser.Tilemaps.TilemapLayer,
    e1: Phaser.Tilemaps.TilemapLayer,
    e2: Phaser.Tilemaps.TilemapLayer,
  ): Generator<void, void, void> {
    const c = this.chunk;
    const n = c.n;
    const x0 = c.cx * n;
    const y0 = c.cy * n;
    // Соседи на краю чанка берём из мира (соседний чанк генерируется при необходимости).
    const tileAt = (tx: number, ty: number) => {
      const lx = tx - x0;
      const ly = ty - y0;
      if (lx >= 0 && ly >= 0 && lx < n && ly < n) return c.tile[ly * n + lx]!;
      return this.world.cell(tx, ty).tile;
    };
    for (let y = 0; y < n; y++) {
      if (y % ROWS_PER_STEP === 0 && y > 0) yield;
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const t = c.tile[i]!;
        const tile =
          c.layer[i] === LAYER_WATER && this.world.waterTiles.has(t)
            ? base.putTileAt(ts.tileCount, x, y)
            : base.putTileAt(ts.index(t, 0), x, y);
        if (c.rot[i]) tile.rotation = Math.PI / 2;
        if (c.layer[i] === LAYER_WATER && c.biome[i] !== 0) this.waterCells.push([x0 + x, y0 + y]);
        // Края: соседи с бо́льшим приоритетом заходят на клетку мягким краем (до двух разных соседей).
        const tx = x0 + x;
        const ty = y0 + y;
        const masks = new Map<number, number>();
        const add = (nt: number, bit: number) => {
          if (nt > t) masks.set(nt, (masks.get(nt) ?? 0) | bit);
        };
        add(tileAt(tx, ty - 1), N);
        add(tileAt(tx + 1, ty), E);
        add(tileAt(tx, ty + 1), S);
        add(tileAt(tx - 1, ty), W);
        if (masks.size === 0) continue;
        const sorted = [...masks.entries()].sort((a, b) => a[0] - b[0]);
        const [first, second] = sorted;
        if (first) e1.putTileAt(ts.index(first[0], first[1]), x, y);
        if (second) e2.putTileAt(ts.index(second[0], second[1]), x, y);
      }
    }
  }

  // ------------------------------------------------------------------ пол и стены

  private *buildFloorsAndWalls(): Generator<void, void, void> {
    const c = this.chunk;
    const n = c.n;
    const mats = this.reg.building.materials;
    for (let y = 0; y < n; y++) {
      if (y % ROWS_PER_STEP === 0 && y > 0) yield;
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const tx = c.cx * n + x;
        const ty = c.cy * n + y;
        if (c.floor[i]) {
          const m = mats[c.floor[i]! - 1]!;
          // Пол темнее верха стен — иначе комната из одного материала не читается.
          this.extra.push(
            // У кадра пола прозрачная кайма ~2%: без неё между плитками видна трава.
            this.strip(
              m.sprites.floor,
              [0.03, 0.03, 0.94, 0.94],
              [tx * TILE, ty * TILE, TILE, TILE],
              DEPTH.floor,
            ).setTint(FLOOR_TINT),
          );
        }
        if (c.wall[i]) this.buildWall(tx, ty, c.wall[i]! - 1, c.wallKind[i]!, c.room[i]!);
        if (c.edgeN[i] || c.edgeW[i]) {
          const b = this.world.builtAt(tx, ty);
          const n = b?.n ?? this.genWall(i, 'n');
          const w = b?.w ?? this.genWall(i, 'w');
          if (n) this.buildEdge(tx, ty, 'n', n);
          if (w) this.buildEdge(tx, ty, 'w', w);
        }
      }
    }
  }

  /** Стена дома мира на ребре (генерация): целая, двери со створкой. */
  private genWall(i: number, side: Side): EdgeWall | null {
    const c = this.chunk;
    const bits = (side === 'n' ? c.genN : c.genW)[i]!;
    if (!bits) return null;
    const mat = (side === 'n' ? c.genMatN : c.genMatW)[i]! - 1;
    const m = this.reg.building.materials[mat];
    if (!m) return null;
    return { mat, kind: bits & EDGE_KIND, hp: m.hp, leaf: (bits & EDGE_LEAF) !== 0 };
  }

  /**
   * Кусок кадра: доля src (x, y, w, h от размера кадра) растянута в прямоугольник dst (px мира).
   * Тонкие стены собираются из полос обычных спрайтов материала — без новых картинок.
   */
  private strip(
    id: string,
    src: readonly [number, number, number, number],
    dst: readonly [number, number, number, number],
    depth: number,
  ): Phaser.GameObjects.Image {
    const img = spawnSprite(this.scene, 0, 0, id, { depth }).setOrigin(0, 0);
    const fw = img.frame.width;
    const fh = img.frame.height;
    const cx = src[0] * fw;
    const cy = src[1] * fh;
    const cw = Math.max(1, src[2] * fw);
    const ch = Math.max(1, src[3] * fh);
    const sx = dst[2] / cw;
    const sy = dst[3] / ch;
    return img
      .setScale(sx, sy)
      .setCrop(cx, cy, cw, ch)
      .setPosition(dst[0] - cx * sx, dst[1] - cy * sy);
  }

  /**
   * Стена игрока на ребре клетки (как в Last Day on Earth): полоса толщиной EDGE_T по линии между
   * клетками. Северное ребро — лицо стены (стена, окно, проём с дверью) от линии вверх на высоту
   * лица и узкий верх над ним; западное — узкий верх вдоль ребра, поднятый на высоту лица, и торец
   * у южного конца. Забор — секции fence / fence_vertical.
   */
  private buildEdge(tx: number, ty: number, side: Side, w: EdgeWall): void {
    const m = this.reg.building.materials[w.mat]!;
    const T = EDGE_T * TILE;
    const H = getAssetInfo(m.sprites.face)?.size[1] ?? TILE * 0.75;
    const X = tx * TILE;
    const Y = ty * TILE;
    const imgs: Phaser.GameObjects.Image[] = [];
    const lost = 1 - w.hp / m.hp;
    const view: WallView = { imgs, room: -1, south: false, depth: 0, tx, ty, side };
    const extra = (name: string) => {
      const id = `building.walls.${m.id}_${name}`;
      return getAssetInfo(id) ? id : null;
    };
    if (w.kind === WALL_FENCE) {
      if (side === 'n') {
        const fh = getAssetInfo(m.sprites.fence)?.size[1] ?? TILE / 2;
        view.depth = Y + T / 2;
        imgs.push(spawnSprite(this.scene, X, Y + T / 2 - fh, m.sprites.fence, { depth: view.depth }));
      } else {
        const id = extra('fence_vertical') ?? m.sprites.fence;
        view.depth = Y + TILE + T / 2;
        const img = spawnSprite(this.scene, X, view.depth, id, { depth: view.depth }).setOrigin(0.5, 1);
        img.setDisplaySize(T, TILE + T / 2 + (getAssetInfo(m.sprites.fence)?.size[1] ?? TILE / 2) * 0.6);
        imgs.push(img);
      }
      view.face = imgs[0];
      this.walls.push(view);
      return;
    }
    const piece: WallPiece =
      w.kind === WALL_WINDOW
        ? 'window'
        : w.kind === WALL_WINDOW_BOARDED
          ? 'window_boarded'
          : w.kind === WALL_DOOR
            ? 'door_opening'
            : 'face';
    const cracked = lost >= this.reg.build.crackedFaceFrom;
    if (side === 'n') {
      const base = Y + T / 2;
      view.depth = base;
      const faceId =
        piece === 'face' && cracked ? (extra('face_cracked') ?? m.sprites.face) : m.sprites[piece];
      view.face = spawnSprite(this.scene, X, base - H, faceId, { depth: base - 0.1 }).setDisplaySize(TILE, H);
      imgs.push(view.face);
      // Верх стены: средняя полоса top_cap толщиной T над лицом.
      imgs.push(this.strip(m.sprites.top_cap, [0, 0.4, 1, 0.2], [X, base - H - T, TILE, T], base - 0.2));
      if (w.kind === WALL_DOOR && w.leaf) {
        const door = spawnSprite(this.scene, X + TILE / 2, base, m.sprites.door, { depth: base });
        const k = (H * 0.94) / door.frame.height;
        door.setOrigin(0.5, 1).setScale(k);
        view.door = door;
        imgs.push(door);
      }
      if (!cracked && lost >= this.reg.build.damageOverlayFrom) {
        view.overlay = spawnSprite(this.scene, X, base - H, m.sprites.damage_overlay, { depth: base - 0.05 })
          .setDisplaySize(TILE, H)
          .setAlpha(Math.min(1, lost));
        imgs.push(view.overlay);
      }
    } else {
      const base = Y + TILE + T / 2;
      view.depth = base;
      const top = extra('top_vertical') ?? m.sprites.top_cap;
      const x0 = X - T / 2;
      const y0 = Y - T / 2 - H;
      const len = TILE + T;
      if (w.kind === WALL_DOOR) {
        // Проём: столбы по концам, между ними створка (закрыта) или пусто.
        const post = len * 0.2;
        imgs.push(this.strip(top, [0.4, 0, 0.2, 0.2], [x0, y0, T, post], base - 0.2));
        imgs.push(this.strip(top, [0.4, 0.8, 0.2, 0.2], [x0, y0 + len - post, T, post], base - 0.2));
        if (w.leaf) {
          view.door = this.strip(
            m.sprites.door,
            [0.4, 0.1, 0.2, 0.8],
            [x0 + 2, y0 + post, T - 4, len - 2 * post],
            base - 0.15,
          );
          imgs.push(view.door);
        }
      } else {
        imgs.push(this.strip(top, [0.4, 0, 0.2, 1], [x0, y0, T, len], base - 0.2));
        if (piece === 'window' || piece === 'window_boarded')
          imgs.push(
            this.strip(
              m.sprites[piece],
              [0.45, 0.3, 0.1, 0.4],
              [x0 + 2, y0 + len * 0.25, T - 4, len * 0.5],
              base - 0.15,
            ),
          );
      }
      // Торец у южного конца: узкая полоса лица.
      view.face = this.strip(m.sprites.face, [0.45, 0, 0.1, 1], [x0, base - H, T, H], base - 0.1);
      imgs.push(view.face);
      if (cracked) for (const img of imgs) if (img !== view.door) img.setTint(0xb8a890);
    }
    this.walls.push(view);
  }

  /** Стена: top_cap в клетке + лицо под ней, если южнее не стена (assembly_rules). */
  private buildWall(tx: number, ty: number, mat: number, kind: number, roomId: number): void {
    const m = this.reg.building.materials[mat]!;
    if (kind === WALL_FENCE) {
      // Забор между кольцами: секции fence рядами от нижней кромки клетки до верхней — клетка закрыта целиком.
      const h = getAssetInfo(m.sprites.fence)?.size[1] ?? TILE / 2;
      const base = (ty + 1) * TILE;
      const imgs: Phaser.GameObjects.Image[] = [];
      for (let y = base - h, i = 0; y > ty * TILE - h * 0.5; y -= h * FENCE_ROW_STEP, i++) {
        imgs.push(spawnSprite(this.scene, tx * TILE, y, m.sprites.fence, { depth: base - i * 0.01 }));
      }
      this.walls.push({ imgs, room: -1, south: false, depth: base, tx, ty });
      return;
    }
    const below = this.world.cell(tx, ty + 1);
    const hasFace = below.wall === WALL_NONE || kind === WALL_DOOR;
    const faceH = getAssetInfo(m.sprites.face)?.size[1] ?? TILE * 0.75;
    const baseY = (ty + 1) * TILE + (hasFace ? faceH : 0);
    const imgs: Phaser.GameObjects.Image[] = [];
    const room = this.world.rooms[roomId];
    if (kind !== WALL_DOOR)
      imgs.push(spawnSprite(this.scene, tx * TILE, ty * TILE, m.sprites.top_cap, { depth: baseY - 0.2 }));
    const view: WallView = {
      imgs,
      room: roomId,
      south: room !== undefined && room.southY === ty,
      depth: baseY,
      tx,
      ty,
    };
    if (hasFace) {
      const piece: WallPiece =
        kind === WALL_WINDOW
          ? 'window'
          : kind === WALL_WINDOW_BOARDED
            ? 'window_boarded'
            : kind === WALL_DOOR
              ? 'door_opening'
              : 'face';
      view.face = spawnSprite(this.scene, tx * TILE, (ty + 1) * TILE, this.faceSprite(m, piece, tx, ty), {
        depth: baseY - 0.1,
      });
      imgs.push(view.face);
      // Дверь префаба есть всегда (двери игрока — на рёбрах, buildEdge).
      if (kind === WALL_DOOR) {
        view.door = spawnSprite(this.scene, tx * TILE, (ty + 1) * TILE, m.sprites.door, { depth: baseY });
        imgs.push(view.door);
      }
    }
    this.walls.push(view);
  }

  /**
   * Лицо стены префаба из дополнительного листа s26: треснувшее — каждая 5-я стена руин; на концах
   * горизонтальной стены — лицо со столбом.
   */
  private faceSprite(m: MaterialDef, piece: WallPiece, tx: number, ty: number): string {
    const base = m.sprites[piece];
    if (piece !== 'face') return base;
    const extra = (name: string) => {
      const id = `building.walls.${m.id}_${name}`;
      return getAssetInfo(id) ? id : null;
    };
    const cracked = Math.abs((tx * 73856093) ^ (ty * 19349663)) % 5 === 0;
    if (cracked) return extra('face_cracked') ?? base;
    // Сосед с лицом: стена (не забор), под которой пусто или проём.
    const faced = (x: number) => {
      const n = this.world.cell(x, ty);
      if (n.wall === WALL_NONE || n.wallKind === WALL_FENCE) return false;
      return this.world.cell(x, ty + 1).wall === WALL_NONE || n.wallKind === WALL_DOOR;
    };
    const left = !faced(tx - 1);
    const right = !faced(tx + 1);
    if (left && !right) return extra('face_end_left') ?? base;
    if (right && !left) return extra('face_end_right') ?? base;
    return base;
  }

  /** Перестроить пол и стены чанка (постройка, улучшение, урон, снос) — синхронно. */
  rebuildWalls(): void {
    for (const o of this.extra) o.destroy();
    this.extra.length = 0;
    for (const w of this.walls) for (const img of w.imgs) img.destroy();
    this.walls.length = 0;
    for (const _ of this.buildFloorsAndWalls()) void _;
    if (!this.visible) {
      for (const o of this.extra) (o as Phaser.GameObjects.Image).setVisible(false);
      for (const w of this.walls) for (const img of w.imgs) img.setVisible(false);
    }
  }

  /** Вид стены: на ребре (side) или стены префаба в клетке. */
  wallAt(tx: number, ty: number, side?: Side): WallView | undefined {
    return this.walls.find((w) => w.tx === tx && w.ty === ty && w.side === side);
  }

  /** Открыть/закрыть дверь: сжатие по X к петле за 0.15 с. */
  setDoorOpen(w: WallView, open: boolean): void {
    if (!w.door || w.open === open) return;
    w.open = open;
    // Дверь в западном ребре видна сверху узкой полосой — открытая просто убирается.
    if (w.side === 'w') {
      w.door.setVisible(open ? false : this.visible);
      return;
    }
    // Открытая дверь из листа s26 (створка ребром у петли); без неё — сжатие закрытой по X.
    const closedFrame = (w.door.getData('closedFrame') as string | undefined) ?? w.door.frame.name;
    w.door.setData('closedFrame', closedFrame);
    const openInfo = getAssetInfo(closedFrame.replace(/_door$/, '_door_open'));
    if (openInfo) {
      w.door.setFrame(open ? openInfo.frame : closedFrame);
      this.scene.tweens.killTweensOf(w.door);
      const sx = (w.door.getData('sx') as number | undefined) ?? w.door.scaleX;
      w.door.setData('sx', sx);
      w.door.setScale(sx * 0.7, w.door.scaleY);
      this.scene.tweens.add({ targets: w.door, scaleX: sx, duration: DOOR_MS });
      return;
    }
    const base = w.door.getData('sx') as number | undefined;
    const sx = base ?? w.door.scaleX;
    if (base === undefined) w.door.setData('sx', sx);
    this.scene.tweens.killTweensOf(w.door);
    this.scene.tweens.add({ targets: w.door, scaleX: open ? sx * DOOR_OPEN_SCALE : sx, duration: DOOR_MS });
  }

  // ------------------------------------------------------------------ объекты

  private *buildObjects(): Generator<void, void, void> {
    const groups = new Set<string>();
    for (const o of this.chunk.objects) {
      const g = getAssetInfo(o.sprite)?.group;
      if (g) groups.add(g);
    }
    const missing = [...groups].filter((g) => !AssetLoader.isLoaded(this.scene, g));
    for (const g of missing) void AssetLoader.ensureGroup(this.scene, g);
    // Ленивые атласы (биомы 2–6) догружаются в фоне — ждём, не блокируя кадр.
    while (missing.some((g) => !AssetLoader.isLoaded(this.scene, g))) {
      this.waiting = true;
      yield;
    }
    this.waiting = false;
    let k = 0;
    for (const o of this.chunk.objects) {
      this.addObject(o);
      if (++k % OBJECTS_PER_STEP === 0) yield;
    }
  }

  addObject(o: WorldObject): ObjView | null {
    // Добыт и без «остатка» (трава, ветки, обломки) — не рисуется до восстановления.
    if (o.state === 'harvested' && !o.spriteAfter) return null;
    const info = getAssetInfo(o.state === 'intact' || !o.spriteAfter ? o.sprite : o.spriteAfter);
    if (!info) return null;
    const px = o.x * TILE;
    const py = o.y * TILE;
    const img = spawnSprite(
      this.scene,
      px,
      py,
      o.state === 'intact' || !o.spriteAfter ? o.sprite : o.spriteAfter,
    );
    if (o.flipX) img.setFlipX(true);
    const view: ObjView = {
      obj: o,
      img,
      phase: ((o.x * 0.37 + o.y * 0.61) % 1) * Math.PI * 2,
      baseScaleX: img.scaleX,
      baseScaleY: img.scaleY,
      alpha: 1,
    };
    if (o.kind in SWAY) view.sway = SWAY[o.kind as keyof typeof SWAY];
    if (o.kind === 'drop') {
      // Предмет на земле: иконка вдвое меньше, приподнята и слегка парит.
      img.setScale(img.scaleX * DROP_SCALE, img.scaleY * DROP_SCALE).setPosition(px, py - DROP_LIFT);
      view.baseScaleX = img.scaleX;
      view.baseScaleY = img.scaleY;
      view.float = true;
      // Рамка редкости с пульсом (обычное смешивание — не рвёт пакет отрисовки).
      const tier = o.item ? (this.reg.items.get(o.item.id)?.tier ?? 0) : 0;
      view.rarity = this.scene.add
        .image(px, py - DROP_LIFT, TEX.glow)
        .setDisplaySize(30, 30)
        .setTint(rarityColor(tier))
        .setDepth(py - 0.5);
    }
    // Обысканный контейнер без «открытого» спрайта гаснет (тинт 70%).
    if (o.state === 'opened' && !o.spriteAfter) img.setTint(OPENED_TINT);
    if (o.kind !== 'grass') {
      const w = info.size[0] * 0.8;
      view.shadow = this.scene.add
        .image(px, py, TEX.shadow)
        .setDisplaySize(w, Math.max(10, w * 0.3))
        .setDepth(DEPTH.shadow);
    }
    if (o.glow) {
      const color = Phaser.Display.Color.HexStringToColor(o.glow).color;
      const size = Math.max(info.size[0], info.size[1]) * GLOW_SIZE;
      view.glow = this.scene.add
        .image(px, py - info.size[1] * 0.4, TEX.glow)
        .setDisplaySize(size, size)
        .setTint(color)
        .setBlendMode(Phaser.BlendModes.ADD)
        // Все свечения на одной глубине — один пакет отрисовки с ADD (иначе каждое рвёт пакет; на телефоне ×5 медленнее).
        .setDepth(DEPTH.glow);
    }
    if (o.light && o.ref.type === 'station' && this.scene.anims.exists('fx-flame')) {
      view.flame = this.scene.add
        .sprite(px, py - 8, 'effects')
        .play({ key: 'fx-flame', startFrame: Math.floor(view.phase) % 6 })
        .setOrigin(0.5, 1)
        .setScale(0.5)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(py + 0.6);
    }
    this.objects.push(view);
    if (!this.visible) {
      view.img.setVisible(false);
      view.shadow?.setVisible(false);
      view.glow?.setVisible(false);
      view.flame?.setVisible(false);
    }
    return view;
  }

  /** Ветер, дыхание кустов, пульс свечения. timeMs — время рендера. */
  animate(timeMs: number, darkness: number, windMul: number): void {
    const t = timeMs / 1000;
    for (const v of this.objects) {
      if (v.float) {
        v.img.setY(v.obj.y * TILE - DROP_LIFT + Math.sin(t * 2 + v.phase) * 2);
        v.rarity?.setY(v.img.y).setAlpha(0.45 + 0.35 * Math.sin(t * 4 + v.phase));
      }
      if (v.sway) {
        const a = Math.sin((t / v.sway.period) * Math.PI * 2 + v.phase) * v.sway.amp * windMul;
        v.img.setAngle(a);
        if (v.sway.breathe) {
          const b = Math.sin((t / 2) * Math.PI * 2 + v.phase) * v.sway.breathe;
          v.img.setScale(v.baseScaleX * (1 - b / 2), v.baseScaleY * (1 + b));
        }
      }
      if (v.glow) {
        const pulse = 0.5 + 0.5 * Math.sin((timeMs / GLOW_PERIOD) * Math.PI * 2 + v.phase);
        v.glow.setAlpha((0.25 + 0.6 * darkness) * (0.7 + 0.3 * pulse));
      }
    }
  }

  /** Убрать объект (подобран, исчез по сроку). */
  removeObject(uid: string): void {
    const i = this.objects.findIndex((v) => v.obj.uid === uid);
    if (i < 0) return;
    const v = this.objects[i]!;
    v.img.destroy();
    v.shadow?.destroy();
    v.glow?.destroy();
    v.flame?.destroy();
    v.rarity?.destroy();
    this.objects.splice(i, 1);
  }

  /** Вид объекта по uid. */
  findView(uid: string): ObjView | undefined {
    return this.objects.find((v) => v.obj.uid === uid);
  }

  /** Отсоединить вид без уничтожения картинки (анимация подбора уничтожит её сама). */
  detachObject(uid: string): ObjView | null {
    const i = this.objects.findIndex((v) => v.obj.uid === uid);
    if (i < 0) return null;
    const v = this.objects[i]!;
    this.objects.splice(i, 1);
    v.rarity?.destroy();
    return v;
  }

  /** Перерисовать объект после смены состояния (открыт / снова закрыт). */
  refreshObject(o: WorldObject): void {
    this.removeObject(o.uid);
    if (this.ready) this.addObject(o);
  }

  /** Видим ли чанк (вне кадра всё скрыто — Phaser сам объекты за кадром не отсекает). */
  visible = true;

  setVisible(v: boolean): void {
    if (this.visible === v) return;
    this.visible = v;
    for (const l of this.map.layers) l.tilemapLayer?.setVisible(v);
    for (const o of this.extra) (o as Phaser.GameObjects.Image).setVisible(v);
    for (const w of this.walls) for (const i of w.imgs) i.setVisible(v);
    for (const o of this.objects) {
      o.img.setVisible(v);
      o.shadow?.setVisible(v);
      o.glow?.setVisible(v);
      o.flame?.setVisible(v);
      o.rarity?.setVisible(v);
    }
  }

  destroy(): void {
    this.map.destroy();
    for (const o of this.extra) o.destroy();
    for (const w of this.walls) for (const i of w.imgs) i.destroy();
    for (const v of this.objects) {
      v.img.destroy();
      v.shadow?.destroy();
      v.glow?.destroy();
      v.flame?.destroy();
      v.rarity?.destroy();
    }
    this.objects.length = 0;
    this.walls.length = 0;
  }
}
