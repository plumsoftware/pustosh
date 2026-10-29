import type { Registry } from '../data/Registry';
import type { ColliderRule } from '../data/schemas';
import { hashSeed, Rng } from '../util/rng';
import {
  LAYER_GROUND,
  LAYER_WATER,
  WALL_DOOR,
  WALL_FENCE,
  WALL_NONE,
  WALL_SOLID,
  WALL_WINDOW,
  EDGE_GEN,
  EDGE_LEAF,
  type BuildCell,
  type Collider,
  type EdgeRef,
  type EdgeWall,
  type Side,
  type ItemStack,
  type ObjectState,
  type Room,
  type WorldObject,
} from './types';
import { WorldLayout, type PendingObject, type SizeOf } from './WorldLayout';

/** Контейнер «рюкзак погибшего» из biomes.json → common.loot_containers. */
export const DEATH_BACKPACK = 'dead_backpack';

/** Чанк 32×32 клетки. Массивы по клеткам: индекс = y * 32 + x. */
export class Chunk {
  /** Индекс тайла в World.tileNames. */
  readonly tile: Uint8Array;
  /** 1 — тайл повёрнут на 90° (дорога сверху вниз). */
  readonly rot: Uint8Array;
  readonly biome: Uint8Array;
  readonly layer: Uint8Array;
  readonly passable: Uint8Array;
  /** Материал стены + 1 (0 — нет стены). */
  readonly wall: Uint8Array;
  readonly wallKind: Uint8Array;
  /** Материал пола + 1 (0 — нет пола). */
  readonly floor: Uint8Array;
  readonly room: Int16Array;
  /** Пол игрока в клетке (1) — генерация под ним не меняется. */
  readonly built: Uint8Array;
  /** Стены игрока на северном и западном рёбрах клетки: вид (WALL_*) | EDGE_LEAF; 0 — нет. */
  readonly edgeN: Uint8Array;
  readonly edgeW: Uint8Array;
  /** Стены домов мира на рёбрах (генерация): биты | EDGE_GEN и материал + 1. */
  readonly genN: Uint8Array;
  readonly genW: Uint8Array;
  readonly genMatN: Uint8Array;
  readonly genMatW: Uint8Array;
  objects: WorldObject[] = [];

  constructor(
    readonly cx: number,
    readonly cy: number,
    readonly n: number,
  ) {
    const len = n * n;
    this.tile = new Uint8Array(len);
    this.rot = new Uint8Array(len);
    this.biome = new Uint8Array(len);
    this.layer = new Uint8Array(len);
    this.passable = new Uint8Array(len);
    this.wall = new Uint8Array(len);
    this.wallKind = new Uint8Array(len);
    this.floor = new Uint8Array(len);
    this.room = new Int16Array(len).fill(-1);
    this.built = new Uint8Array(len);
    this.edgeN = new Uint8Array(len);
    this.edgeW = new Uint8Array(len);
    this.genN = new Uint8Array(len);
    this.genW = new Uint8Array(len);
    this.genMatN = new Uint8Array(len);
    this.genMatW = new Uint8Array(len);
  }

  get key(): string {
    return `${this.cx},${this.cy}`;
  }
}

/** Изменения чанка относительно генерации — только они сохраняются. */
export interface ObjectDelta {
  state?: ObjectState;
  removed?: true;
  /** Содержимое открытого контейнера — хранится до респауна. */
  contents?: ItemStack[];
  /** Когда контейнер открыли (игровые секунды мира). */
  openedAt?: number;
  /** Когда добытый объект восстановится. */
  respawnAt?: number;
}

export interface ChunkDelta {
  /** uid → новое состояние, удаление, содержимое контейнера. */
  objects: Record<string, ObjectDelta>;
  /** Объекты, поставленные игроком: станки, защита, дроп. */
  added: WorldObject[];
  /** Полы и стены на рёбрах игрока: индекс клетки в чанке → постройка. */
  build?: Record<string, BuildCell>;
}

export interface WorldDelta {
  seed: number;
  chunks: Record<string, ChunkDelta>;
  /** Счётчик id выброшенных предметов. */
  nextDropId?: number;
  /** Размер мира в клетках: сохранение другого размера не подходит (мир увеличен в 2 раза). */
  size?: number;
}

/** Что изменилось за World.update — чтобы рендер убрал/обновил объекты. */
export interface WorldChanges {
  /** Исчезнувшие дропы: uid и чанк. */
  expired: { uid: string; key: string }[];
  /** Контейнеры, вернувшиеся в исходное состояние (лут обновился). */
  respawned: { uid: string; key: string }[];
}

export interface WorldOptions {
  seed?: number;
  sizeOf: SizeOf;
}

/**
 * Мир: генерация чанков по сиду, кэш сгенерированных чанков, дельта изменений,
 * пространственная сетка коллайдеров. Без Phaser и браузера.
 */
export class World {
  readonly seed: number;
  readonly size: number;
  readonly chunkTiles: number;
  readonly chunksPerSide: number;
  readonly layout: WorldLayout;
  /** Имена тайлов: индекс в массиве = код тайла в чанке; порядок = приоритет смешивания краёв. */
  readonly tileNames: readonly string[];
  readonly waterTiles: ReadonlySet<number>;

  private readonly cache = new Map<string, Chunk>();
  private readonly deltas = new Map<string, ChunkDelta>();
  /** Пространственная сетка: клетка → объекты, чей коллайдер её задевает. */
  private readonly spatial = new Map<number, WorldObject[]>();
  private readonly tileIndex: Map<string, number>;
  private nextDropId = 1;

  constructor(
    private readonly reg: Registry,
    private readonly opts: WorldOptions,
  ) {
    const w = reg.balance.world;
    this.seed = opts.seed ?? w.seed;
    this.size = w.sizeTiles[0];
    this.chunkTiles = w.chunkTiles;
    this.chunksPerSide = Math.ceil(this.size / this.chunkTiles);
    this.tileNames = reg.worldgen.blendPriority;
    this.tileIndex = new Map(this.tileNames.map((t, i) => [t, i]));
    this.waterTiles = new Set(reg.worldgen.waterTiles.map((t) => this.tileIndex.get(t) ?? -1));
    this.layout = new WorldLayout(reg, this.seed, (id) => {
      const s = opts.sizeOf(id);
      return s ? [s[0], s[1]] : undefined;
    });
  }

  get rooms(): readonly Room[] {
    return this.layout.rooms;
  }

  get start(): { x: number; y: number } {
    return this.layout.start;
  }

  // ------------------------------------------------------------------ чанки

  static key(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  inChunkRange(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.chunksPerSide && cy < this.chunksPerSide;
  }

  isLoaded(cx: number, cy: number): boolean {
    return this.cache.has(World.key(cx, cy));
  }

  /** Чанк (генерируется при первом обращении, к нему применяется дельта). */
  getChunk(cx: number, cy: number): Chunk {
    const key = World.key(cx, cy);
    let c = this.cache.get(key);
    if (!c) {
      c = this.generate(cx, cy);
      this.applyDelta(c);
      this.cache.set(key, c);
      for (const o of c.objects) this.index(o);
    } else {
      // LRU: свежий чанк в конец
      this.cache.delete(key);
      this.cache.set(key, c);
    }
    return c;
  }

  /** Выгрузить чанк из памяти (изменения остаются в дельте). */
  unloadChunk(cx: number, cy: number): void {
    const key = World.key(cx, cy);
    const c = this.cache.get(key);
    if (!c) return;
    for (const o of c.objects) this.unindex(o);
    this.cache.delete(key);
  }

  /** Держит в кэше не больше max чанков, кроме keep. */
  trimCache(max: number, keep: ReadonlySet<string>): void {
    for (const key of [...this.cache.keys()]) {
      if (this.cache.size <= max) break;
      if (keep.has(key)) continue;
      const [cx, cy] = key.split(',').map(Number) as [number, number];
      this.unloadChunk(cx, cy);
    }
  }

  get loadedChunkCount(): number {
    return this.cache.size;
  }

  private generate(cx: number, cy: number): Chunk {
    const n = this.chunkTiles;
    const c = new Chunk(cx, cy, n);
    const L = this.layout;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const tx = cx * n + x;
        const ty = cy * n + y;
        const i = y * n + x;
        const biome = L.biomeAt(tx + 0.5, ty + 0.5);
        const { tile, vertical } = L.tileAt(tx, ty, biome);
        const code = this.tileIndex.get(tile) ?? 0;
        c.tile[i] = code;
        c.rot[i] = vertical ? 1 : 0;
        c.biome[i] = biome;
        c.layer[i] = this.waterTiles.has(code) ? LAYER_WATER : LAYER_GROUND;
        c.passable[i] = biome === 0 ? 0 : 1;
        const st = L.stamps.get(L.cellIndex(tx, ty));
        if (st) {
          c.room[i] = st.room;
          if (st.kind === 'floor') {
            c.floor[i] = st.material + 1;
            c.layer[i] = LAYER_GROUND;
          } else if (st.kind === 'fence') {
            c.wall[i] = st.material + 1;
            c.wallKind[i] = WALL_FENCE;
            c.passable[i] = 0;
            c.layer[i] = LAYER_GROUND;
          } else if (st.kind === 'wall' || st.kind === 'door' || st.kind === 'window') {
            // Стены домов — тонкие, на рёбрах (genEdge): клетка стены — земля снаружи дома,
            // перегородка — пол комнаты.
            c.layer[i] = LAYER_GROUND;
            if (this.partition(tx, ty)) c.floor[i] = st.material + 1;
            else c.room[i] = -1;
          }
        }
        for (const side of ['n', 'w'] as const) {
          const g = this.genEdge(tx, ty, side);
          if (!g) continue;
          (side === 'n' ? c.genN : c.genW)[i] = g.bits;
          (side === 'n' ? c.genMatN : c.genMatW)[i] = g.mat + 1;
          (side === 'n' ? c.edgeN : c.edgeW)[i] = g.bits;
        }
      }
    }
    const pending = [...this.scatterObjects(c), ...(L.prefabObjects.get(c.key) ?? [])];
    c.objects = pending.map((p) => this.finishObject(p));
    return c;
  }

  /** Клетка стены префаба между полами комнат (по X или по Y) — перегородка: становится полом. */
  private partition(tx: number, ty: number): 'v' | 'h' | null {
    const L = this.layout;
    const floor = (x: number, y: number) => L.stamps.get(L.cellIndex(x, y))?.kind === 'floor';
    if (floor(tx - 1, ty) && floor(tx + 1, ty)) return 'v';
    if (floor(tx, ty - 1) && floor(tx, ty + 1)) return 'h';
    return null;
  }

  /**
   * Стена дома мира на ребре клетки (северном или западном). План префаба — клетки стен вокруг пола;
   * тонкая стена встаёт между клеткой стены и полом комнаты (внутренний край кольца стен), перегородка —
   * одной стеной по своему западному (вертикальная) или северному (горизонтальная) краю.
   */
  private genEdge(tx: number, ty: number, side: Side): { bits: number; mat: number } | null {
    const L = this.layout;
    if (!L.inBounds(tx, ty)) return null;
    const ax = side === 'w' ? tx - 1 : tx;
    const ay = side === 'n' ? ty - 1 : ty;
    if (!L.inBounds(ax, ay)) return null;
    const sa = L.stamps.get(L.cellIndex(ax, ay));
    const sb = L.stamps.get(L.cellIndex(tx, ty));
    const isWall = (k: string | undefined) => k === 'wall' || k === 'door' || k === 'window';
    const bits = (k: string) =>
      (k === 'door' ? WALL_DOOR | EDGE_LEAF : k === 'window' ? WALL_WINDOW : WALL_SOLID) | EDGE_GEN;
    // Перегородка: своя стена по западному/северному краю.
    if (sb && isWall(sb.kind)) {
      const p = this.partition(tx, ty);
      if ((p === 'v' && side === 'w') || (p === 'h' && side === 'n'))
        return { bits: bits(sb.kind), mat: sb.material };
    }
    const inside = (x: number, y: number, k: string | undefined) =>
      k === 'floor' || (isWall(k) && !!this.partition(x, y));
    // Кольцо стен ↔ пол комнаты.
    if (sa && isWall(sa.kind) && !this.partition(ax, ay) && inside(tx, ty, sb?.kind))
      return { bits: bits(sa.kind), mat: sa.material };
    if (sb && isWall(sb.kind) && !this.partition(tx, ty) && inside(ax, ay, sa?.kind))
      return { bits: bits(sb.kind), mat: sb.material };
    return null;
  }

  /** Случайные объекты по сетке с джиттером; решения зависят только от сида и клетки сетки. */
  private scatterObjects(c: Chunk): PendingObject[] {
    const g = this.reg.worldgen.objects;
    const L = this.layout;
    const n = this.chunkTiles;
    const grid = g.gridTiles;
    const x0 = c.cx * n;
    const y0 = c.cy * n;
    const out: PendingObject[] = [];
    const startClear = this.reg.worldgen.start.clearRadiusTiles;
    for (let gy = Math.floor(y0 / grid); gy * grid < y0 + n; gy++) {
      for (let gx = Math.floor(x0 / grid); gx * grid < x0 + n; gx++) {
        const rng = new Rng(hashSeed(this.seed, gx, gy, 77));
        const x = gx * grid + 0.5 + rng.next() * (grid - 1);
        const y = gy * grid + 0.5 + rng.next() * (grid - 1);
        if (x < x0 || y < y0 || x >= x0 + n || y >= y0 + n) continue;
        const tx = Math.floor(x);
        const ty = Math.floor(y);
        const i = (ty - y0) * n + (tx - x0);
        const biome = c.biome[i]!;
        if (biome === 0 || c.layer[i] === LAYER_WATER) continue;
        if (L.stamps.has(L.cellIndex(tx, ty))) continue;
        const rd = L.roadDistance(tx, ty);
        if (rd <= g.keepOutFromRoadTiles) continue;
        if (Math.hypot(x - L.start.x, y - L.start.y) < startClear + 1) continue;

        const kind = this.pickKind(rng, x, y, biome, rd);
        if (!kind) continue;
        const pool = this.reg.objects.byBiome(biome).filter((d) => d.kind === kind);
        if (pool.length === 0) continue;
        const d = pool[rng.int(0, pool.length - 1)]!;
        out.push({
          uid: `o${gx}_${gy}`,
          ref: { type: 'biome', biome, id: d.id },
          kind: d.kind,
          sprite: d.sprite,
          spriteAfter: d.afterHarvest,
          x,
          y,
          biome,
        });
      }
    }
    return out;
  }

  private pickKind(rng: Rng, x: number, y: number, biome: number, roadDist: number): string | null {
    const g = this.reg.worldgen.objects;
    const L = this.layout;
    if (roadDist <= g.roadside.maxDistTiles && rng.next() < g.roadside.chance)
      return g.roadside.kinds[rng.int(0, g.roadside.kinds.length - 1)]!;
    const near = L.settlements.find(
      (s) => s.biome === biome && Math.hypot(s.x - x, s.y - y) < g.settlements.radiusTiles,
    );
    if (near && rng.next() < g.settlements.poiChance)
      return g.settlements.kinds[rng.int(0, g.settlements.kinds.length - 1)]!;
    const edgeBoost = L.ringEdgeDistance(x, y) < g.treeEdgeBoost.edgeTiles ? g.treeEdgeBoost.mul : 1;
    const roll = rng.next();
    let acc = 0;
    for (const [kind, chance] of Object.entries(g.kindChance)) {
      acc += kind === 'tree' ? chance * edgeBoost : chance;
      if (roll < acc) return kind;
    }
    return null;
  }

  private finishObject(p: PendingObject): WorldObject {
    const w = this.reg.worldgen;
    const glow = p.ref.type === 'biome' ? w.glow[p.ref.id] : undefined;
    const lamp =
      p.ref.type === 'biome' && w.lights.lampObjects.includes(p.ref.id)
        ? w.lights.streetLampRadiusTiles
        : undefined;
    // Отражение по X — разнообразие природы (детерминированно по uid).
    const flip =
      (p.kind === 'tree' || p.kind === 'bush' || p.kind === 'rock' || p.kind === 'grass') &&
      (hashSeed(this.seed, strHash(p.uid)) & 1) === 1;
    return {
      ...p,
      state: 'intact',
      collider: this.colliderFor(p),
      glow: p.glow ?? glow,
      light: p.light ?? lamp,
      flipX: flip || undefined,
    };
  }

  private colliderFor(p: PendingObject): Collider | null {
    const rule: ColliderRule | undefined = this.reg.worldgen.colliders[p.kind];
    if (!rule) return null;
    const size = this.opts.sizeOf(p.sprite);
    const wTiles = size ? size[0] : 1;
    if (rule.shape === 'circle') {
      const r =
        'radiusTiles' in rule ? (rule.radiusTiles as number) : (rule.radiusOfWidth as number) * wTiles;
      return { shape: 'circle', x: p.x, y: p.y - r * 0.6, r };
    }
    const half = ((rule.widthOfWidth as number) * wTiles) / 2;
    const depth = rule.depthTiles as number;
    return { shape: 'rect', x0: p.x - half, y0: p.y - depth, x1: p.x + half, y1: p.y };
  }

  // ------------------------------------------------------------------ клетки

  private chunkOfCell(tx: number, ty: number): { c: Chunk; i: number } | null {
    if (tx < 0 || ty < 0 || tx >= this.size || ty >= this.size) return null;
    const n = this.chunkTiles;
    const c = this.getChunk(Math.floor(tx / n), Math.floor(ty / n));
    return { c, i: (ty % n) * n + (tx % n) };
  }

  /** Клетка: тайл, биом, проходимость, стена. Вне карты — непроходимое море. */
  cell(
    tx: number,
    ty: number,
  ): {
    tile: number;
    biome: number;
    layer: number;
    passable: boolean;
    wall: number;
    wallKind: number;
    floor: number;
    room: number;
  } {
    const r = this.chunkOfCell(tx, ty);
    if (!r)
      return {
        tile: 0,
        biome: 0,
        layer: LAYER_WATER,
        passable: false,
        wall: 0,
        wallKind: WALL_NONE,
        floor: 0,
        room: -1,
      };
    const { c, i } = r;
    return {
      tile: c.tile[i]!,
      biome: c.biome[i]!,
      layer: c.layer[i]!,
      passable: c.passable[i] === 1,
      wall: c.wall[i]!,
      wallKind: c.wallKind[i]!,
      floor: c.floor[i]!,
      room: c.room[i]!,
    };
  }

  /** Комната, внутри которой точка (по полу и дверям), или null. */
  roomAt(x: number, y: number): Room | null {
    const c = this.cell(Math.floor(x), Math.floor(y));
    if (c.room < 0 || (c.wall !== 0 && c.wallKind !== WALL_DOOR)) return null;
    return this.layout.rooms[c.room] ?? null;
  }

  // ------------------------------------------------------------------ объекты и дельта

  private index(o: WorldObject): void {
    if (!o.collider) return;
    for (const idx of this.cellsOf(o.collider)) {
      const list = this.spatial.get(idx);
      if (list) list.push(o);
      else this.spatial.set(idx, [o]);
    }
  }

  private unindex(o: WorldObject): void {
    if (!o.collider) return;
    for (const idx of this.cellsOf(o.collider)) {
      const list = this.spatial.get(idx);
      if (!list) continue;
      const k = list.indexOf(o);
      if (k >= 0) list.splice(k, 1);
      if (list.length === 0) this.spatial.delete(idx);
    }
  }

  private *cellsOf(col: Collider): Generator<number> {
    const [x0, y0, x1, y1] =
      col.shape === 'circle'
        ? [col.x - col.r, col.y - col.r, col.x + col.r, col.y + col.r]
        : [col.x0, col.y0, col.x1, col.y1];
    for (let y = Math.floor(y0); y <= Math.floor(y1); y++) {
      for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
        if (x >= 0 && y >= 0 && x < this.size && y < this.size) yield y * this.size + x;
      }
    }
  }

  /** Объекты, чьи коллайдеры задевают клетку (только загруженные чанки). Исчезнувшие после добычи — не твёрдые. */
  collidersAt(tx: number, ty: number): readonly WorldObject[] {
    const list = this.spatial.get(ty * this.size + tx);
    return list ? list.filter((o) => isSolid(o)) : [];
  }

  /** Объекты в клетке по точке основания или коллайдеру (поиск цели, подсветка). */
  objectsAt(tx: number, ty: number): readonly WorldObject[] {
    const c = this.cache.get(World.key(Math.floor(tx / this.chunkTiles), Math.floor(ty / this.chunkTiles)));
    const byBase = c ? c.objects.filter((o) => Math.floor(o.x) === tx && Math.floor(o.y) === ty) : [];
    const byCol = this.spatial.get(ty * this.size + tx) ?? [];
    return byCol.length ? [...new Set([...byBase, ...byCol])] : byBase;
  }

  /**
   * Объект добыт: состояние «harvested» до восстановления (игровые секунды мира).
   * Пни и остовы остаются, остальное исчезает и не мешает ходить.
   */
  markHarvested(o: WorldObject, respawnAt: number): void {
    o.state = 'harvested';
    const d = this.deltaFor(this.chunkKeyOf(o));
    d.objects[o.uid] = { ...d.objects[o.uid], state: 'harvested', respawnAt };
  }

  findObject(uid: string, cx: number, cy: number): WorldObject | undefined {
    return this.getChunk(cx, cy).objects.find((o) => o.uid === uid);
  }

  /** Меняет состояние объекта и записывает изменение в дельту. */
  setObjectState(o: WorldObject, state: ObjectState): void {
    o.state = state;
    const d = this.deltaFor(this.chunkKeyOf(o));
    d.objects[o.uid] = { ...d.objects[o.uid], state };
  }

  removeObject(o: WorldObject): void {
    const key = this.chunkKeyOf(o);
    const c = this.cache.get(key);
    if (c) {
      c.objects = c.objects.filter((x) => x !== o);
      this.unindex(o);
    }
    const d = this.deltaFor(key);
    if (d.added.some((x) => x.uid === o.uid)) d.added = d.added.filter((x) => x.uid !== o.uid);
    else d.objects[o.uid] = { removed: true };
  }

  addObject(o: WorldObject): void {
    const key = this.chunkKeyOf(o);
    this.deltaFor(key).added.push(o);
    const c = this.cache.get(key);
    if (c) {
      c.objects.push(o);
      this.index(o);
    }
  }

  private chunkKeyOf(o: { x: number; y: number }): string {
    return World.key(Math.floor(o.x / this.chunkTiles), Math.floor(o.y / this.chunkTiles));
  }

  private deltaFor(key: string): ChunkDelta {
    let d = this.deltas.get(key);
    if (!d) this.deltas.set(key, (d = { objects: {}, added: [] }));
    return d;
  }

  private applyDelta(c: Chunk): void {
    const d = this.deltas.get(c.key);
    if (!d) return;
    c.objects = c.objects.filter((o) => !d.objects[o.uid]?.removed);
    for (const o of c.objects) {
      const s = d.objects[o.uid]?.state;
      if (s) o.state = s;
    }
    // Те же объекты, что в дельте: их состояние (прочность, патроны, капкан) сохраняется без копирования.
    c.objects.push(...d.added);
    for (const [k, b] of Object.entries(d.build ?? {})) applyBuild(c, Number(k), b);
  }

  // ------------------------------------------------------------------ постройки игрока

  private cellRef(tx: number, ty: number): { key: string; i: number } | null {
    if (tx < 0 || ty < 0 || tx >= this.size || ty >= this.size) return null;
    const n = this.chunkTiles;
    return { key: World.key(Math.floor(tx / n), Math.floor(ty / n)), i: (ty % n) * n + (tx % n) };
  }

  /** Постройка игрока в клетке или null. */
  builtAt(tx: number, ty: number): BuildCell | null {
    const r = this.cellRef(tx, ty);
    return r ? (this.deltas.get(r.key)?.build?.[r.i] ?? null) : null;
  }

  /** Записать постройку клетки (null — снести всё построенное игроком) и применить к загруженному чанку. */
  setBuilt(tx: number, ty: number, cell: BuildCell | null): void {
    const r = this.cellRef(tx, ty);
    if (!r) return;
    const d = this.deltaFor(r.key);
    const build = (d.build ??= {});
    const empty = !cell || (cell.n === undefined && cell.w === undefined && cell.floor === undefined);
    if (empty) delete build[r.i];
    else build[r.i] = { ...cell };
    const c = this.cache.get(r.key);
    if (c) {
      clearBuild(c, r.i);
      if (!empty) applyBuild(c, r.i, cell);
    }
  }

  /** Множитель урона по постройкам игрока («Укрепление»: +HP построек = меньше урона). */
  buildDamageMul = 1;

  /** Стена игрока на ребре или null. */
  edgeAt(e: EdgeRef): EdgeWall | null {
    return this.builtAt(e.tx, e.ty)?.[e.side] ?? null;
  }

  /** Поставить/снять стену на ребре (остальное в клетке не меняется). */
  setEdge(e: EdgeRef, wall: EdgeWall | null): void {
    const b = { ...this.builtAt(e.tx, e.ty) };
    if (wall) b[e.side] = { ...wall };
    else delete b[e.side];
    this.setBuilt(e.tx, e.ty, b);
  }

  /** Вид стены на ребре | EDGE_LEAF из загруженного чанка (0 — нет); быстро, для коллизий и ИИ. */
  edgeBits(tx: number, ty: number, side: Side): number {
    const r = this.chunkOfCell(tx, ty);
    if (!r) return 0;
    return (side === 'n' ? r.c.edgeN : r.c.edgeW)[r.i]!;
  }

  /**
   * Стена между соседними по стороне клетками (a → b): вид | EDGE_LEAF или 0. Для диагонали — 0
   * (проверяется по двум сторонам вызывающим).
   */
  edgeBetween(ax: number, ay: number, bx: number, by: number): number {
    if (ay === by && Math.abs(bx - ax) === 1) return this.edgeBits(Math.max(ax, bx), ay, 'w');
    if (ax === bx && Math.abs(by - ay) === 1) return this.edgeBits(ax, Math.max(ay, by), 'n');
    return 0;
  }

  /**
   * Урон стене игрока на ребре. Возвращает 'destroyed' (стена снесена), 'damaged' или null
   * (на ребре нет стены игрока).
   */
  damageEdge(e: EdgeRef, amount: number): 'destroyed' | 'damaged' | null {
    const w = this.edgeAt(e);
    if (!w) return null;
    const hp = w.hp - amount * this.buildDamageMul;
    this.setEdge(e, hp <= 0 ? null : { ...w, hp });
    return hp <= 0 ? 'destroyed' : 'damaged';
  }

  /** Урон стенам на обоих рёбрах клетки (таран, взрыв по клетке): что задели. */
  damageEdgesOfCell(
    tx: number,
    ty: number,
    amount: number,
  ): { e: EdgeRef; result: 'destroyed' | 'damaged' }[] {
    const out: { e: EdgeRef; result: 'destroyed' | 'damaged' }[] = [];
    for (const side of ['n', 'w'] as const) {
      const e = { tx, ty, side };
      const result = this.damageEdge(e, amount);
      if (result) out.push({ e, result });
    }
    return out;
  }

  /** Все постройки игрока (для ремонта базы): мировые координаты клеток. */
  *builtCells(): Generator<{ tx: number; ty: number; cell: BuildCell }> {
    const n = this.chunkTiles;
    for (const [key, d] of this.deltas) {
      if (!d.build) continue;
      const [cx, cy] = key.split(',').map(Number) as [number, number];
      for (const [k, cell] of Object.entries(d.build)) {
        const i = Number(k);
        yield { tx: cx * n + (i % n), ty: cy * n + Math.floor(i / n), cell };
      }
    }
  }

  /**
   * Поставить объект игрока (станок, сундук): коллайдер по worldgen.colliders, хранится в дельте.
   * x, y — точка основания (центр нижнего края), как у объектов генерации.
   */
  placeObject(p: Omit<PendingObject, 'uid'>): WorldObject {
    const o = this.finishObject({ ...p, uid: `pl${this.nextDropId++}` });
    o.flipX = undefined;
    this.addObject(o);
    return o;
  }

  /**
   * Можно ли занять прямоугольник клеток [tx, tx+w) × [ty, ty+h): суша, проходимо, без стен,
   * без твёрдых объектов (только загруженные чанки — ставят рядом с героем).
   */
  canOccupy(tx: number, ty: number, w: number, h: number): boolean {
    for (let y = ty; y < ty + h; y++) {
      for (let x = tx; x < tx + w; x++) {
        const c = this.cell(x, y);
        if (!c.passable || c.wall !== 0 || c.layer === LAYER_WATER || c.biome === 0) return false;
        if (this.collidersAt(x, y).length > 0) return false;
        if (this.objectsAt(x, y).some((o) => o.kind === 'station' || o.kind === 'container')) return false;
        // Стена игрока внутри прямоугольника (не по его краю) — объект её перекрыл бы.
        if ((y > ty && this.edgeBits(x, y, 'n')) || (x > tx && this.edgeBits(x, y, 'w'))) return false;
      }
    }
    return true;
  }

  // ------------------------------------------------------------------ дроп и контейнеры

  /**
   * Выбросить предмет на землю: лежит droppedItemLifetimeSec игровых секунд, переживает выгрузку чанка
   * и сохранение (хранится в дельте).
   */
  dropItem(item: ItemStack, x: number, y: number, nowSec: number): WorldObject {
    const def = this.reg.items.require(item.id);
    const o: WorldObject = {
      uid: `drop${this.nextDropId++}`,
      ref: { type: 'prefab', id: 'drop' },
      kind: 'drop',
      sprite: def.icon,
      x,
      y,
      biome: this.layout.biomeAt(x, y),
      collider: null,
      state: 'intact',
      item: { ...item },
      expiresAt: nowSec + this.reg.worldgen.persistence.droppedItemLifetimeSec,
    };
    this.addObject(o);
    return o;
  }

  /**
   * Рюкзак погибшего (GDD §4): контейнер с содержимым инвентаря на месте смерти,
   * исчезает через balance.json → player.deathBackpackLifetimeSec игровых секунд.
   */
  placeDeathBackpack(x: number, y: number, contents: ItemStack[], nowSec: number): WorldObject {
    const def = this.reg.objects.containers.require(DEATH_BACKPACK);
    const o: WorldObject = {
      uid: `pack${this.nextDropId++}`,
      ref: { type: 'container', id: def.id },
      kind: 'container',
      sprite: def.sprite,
      x,
      y,
      biome: this.layout.biomeAt(x, y),
      collider: null,
      state: 'intact',
      expiresAt: nowSec + this.reg.balance.player.deathBackpackLifetimeSec,
    };
    this.addObject(o);
    this.setContainerContents(o, contents);
    return o;
  }

  /** Подобрать дроп: объект исчезает, возвращается предмет. */
  pickUp(o: WorldObject): ItemStack | null {
    if (o.kind !== 'drop' || !o.item) return null;
    this.removeObject(o);
    return o.item;
  }

  /**
   * Открыть контейнер. Первое открытие — содержимое из generate (таблицы лута — шаг 5), дальше — сохранённое
   * в дельте, пока не пройдёт lootRespawnGameDays игровых суток.
   */
  openContainer(o: WorldObject, nowSec: number, generate: () => ItemStack[]): ItemStack[] {
    const d = this.deltaFor(this.chunkKeyOf(o));
    const entry = d.objects[o.uid];
    if (entry?.contents) return entry.contents;
    const contents = generate();
    d.objects[o.uid] = { ...entry, state: 'opened', contents, openedAt: nowSec };
    o.state = 'opened';
    return contents;
  }

  /** Записать новое содержимое (игрок взял или положил предметы). */
  setContainerContents(o: WorldObject, contents: ItemStack[]): void {
    const d = this.deltaFor(this.chunkKeyOf(o));
    d.objects[o.uid] = { ...d.objects[o.uid], contents: contents.map((c) => ({ ...c })) };
  }

  containerContents(o: WorldObject): ItemStack[] | null {
    return this.deltas.get(this.chunkKeyOf(o))?.objects[o.uid]?.contents ?? null;
  }

  /**
   * Время мира: исчезают просроченные дропы, контейнеры обновляются после респауна.
   * Работает по дельте — в том числе для выгруженных чанков.
   */
  update(nowSec: number): WorldChanges {
    const out: WorldChanges = { expired: [], respawned: [] };
    const respawnSec =
      (this.reg.balance.world['lootRespawnGameDays'] as number) * this.reg.balance.dayNight.fullDaySec;
    for (const [key, d] of this.deltas) {
      const keep: WorldObject[] = [];
      for (const o of d.added) {
        if (o.expiresAt !== undefined && o.expiresAt <= nowSec) {
          out.expired.push({ uid: o.uid, key });
          delete d.objects[o.uid]; // содержимое исчезнувшего рюкзака
        } else keep.push(o);
      }
      if (keep.length !== d.added.length) {
        d.added = keep;
        const c = this.cache.get(key);
        if (c) {
          for (const e of out.expired) {
            if (e.key !== key) continue;
            const o = c.objects.find((x) => x.uid === e.uid);
            if (o) {
              this.unindex(o);
              c.objects = c.objects.filter((x) => x !== o);
            }
          }
        }
      }
      for (const [uid, od] of Object.entries(d.objects)) {
        const due =
          od.respawnAt !== undefined
            ? od.respawnAt <= nowSec
            : od.openedAt !== undefined && od.openedAt + respawnSec <= nowSec;
        if (!due) continue;
        delete d.objects[uid];
        out.respawned.push({ uid, key });
        const o = this.cache.get(key)?.objects.find((x) => x.uid === uid);
        if (o) o.state = 'intact';
      }
      if (d.added.length === 0 && Object.keys(d.objects).length === 0 && !Object.keys(d.build ?? {}).length)
        this.deltas.delete(key);
    }
    return out;
  }

  /** Только изменённые чанки. */
  exportDelta(): WorldDelta {
    const chunks: Record<string, ChunkDelta> = {};
    for (const [k, d] of this.deltas) {
      if (Object.keys(d.objects).length > 0 || d.added.length > 0 || Object.keys(d.build ?? {}).length > 0)
        chunks[k] = JSON.parse(JSON.stringify(d)) as ChunkDelta;
    }
    return { seed: this.seed, chunks, nextDropId: this.nextDropId, size: this.size };
  }

  importDelta(delta: WorldDelta): void {
    if ((delta.size ?? 512) !== this.size)
      throw new Error(`Сохранение мира другого размера (${delta.size ?? 512} ≠ ${this.size})`);
    if (delta.seed !== this.seed)
      throw new Error(`Сохранение мира с другим сидом (${delta.seed} ≠ ${this.seed})`);
    this.deltas.clear();
    this.nextDropId = delta.nextDropId ?? 1;
    for (const [k, d] of Object.entries(delta.chunks)) {
      const copy = JSON.parse(JSON.stringify(d)) as ChunkDelta;
      dropLegacyWalls(copy);
      this.deltas.set(k, copy);
    }
    for (const key of [...this.cache.keys()]) {
      const [cx, cy] = key.split(',').map(Number) as [number, number];
      this.unloadChunk(cx, cy);
    }
  }

  /** Хеш содержимого чанка (для проверки детерминированности). */
  chunkHash(cx: number, cy: number): string {
    const c = this.getChunk(cx, cy);
    let h = 0x811c9dc5;
    const mix = (v: number) => {
      h ^= v & 0xffff;
      h = Math.imul(h, 0x01000193) >>> 0;
    };
    for (const arr of [c.tile, c.rot, c.biome, c.layer, c.passable, c.wall, c.wallKind, c.floor])
      for (const v of arr) mix(v);
    for (const v of c.room) mix(v + 1);
    for (const o of c.objects) {
      mix(strHash(o.uid));
      mix(strHash(o.sprite));
      mix(Math.round(o.x * 1000));
      mix(Math.round(o.y * 1000));
    }
    return h.toString(16).padStart(8, '0');
  }
}

/**
 * Стены старого формата занимали клетку целиком (поля wall/kind/hp/leaf) — при загрузке сносятся,
 * пол остаётся (стены теперь на рёбрах клеток).
 */
function dropLegacyWalls(d: ChunkDelta): void {
  if (!d.build) return;
  for (const [k, raw] of Object.entries(d.build)) {
    const b = raw as BuildCell & { wall?: unknown; kind?: unknown; hp?: unknown; leaf?: unknown };
    if (b.wall === undefined && b.kind === undefined && b.hp === undefined && b.leaf === undefined) continue;
    const next: BuildCell = {};
    if (b.floor !== undefined) next.floor = b.floor;
    if (b.n) next.n = b.n;
    if (b.w) next.w = b.w;
    if (next.floor === undefined && !next.n && !next.w) delete d.build[k];
    else d.build[k] = next;
  }
}

/** Снять постройку игрока с клетки чанка (генерация под ней не меняется). */
function clearBuild(c: Chunk, i: number): void {
  if (c.built[i]! & 1) c.floor[i] = 0;
  c.built[i] = 0;
  c.edgeN[i] = c.genN[i]!;
  c.edgeW[i] = c.genW[i]!;
}

function edgeBitsOf(w: EdgeWall | undefined): number {
  return w ? w.kind | (w.leaf ? EDGE_LEAF : 0) : 0;
}

function applyBuild(c: Chunk, i: number, b: BuildCell): void {
  if (b.floor !== undefined) {
    c.floor[i] = b.floor + 1;
    c.built[i]! |= 1;
  }
  c.edgeN[i] = edgeBitsOf(b.n) || c.genN[i]!;
  c.edgeW[i] = edgeBitsOf(b.w) || c.genW[i]!;
}

/** Твёрдый ли объект: добытый без «остатка» (трава, ветки, обломки) не мешает ходить. */
export function isSolid(o: WorldObject): boolean {
  return !(o.state === 'harvested' && !o.spriteAfter);
}

function strHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
