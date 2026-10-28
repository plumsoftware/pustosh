import type { Registry } from '../data/Registry';
import type { AssetId, PrefabDef, PrefabObjectDef } from '../data/schemas';
import { hashSeed, Rng } from '../util/rng';
import { Perlin } from './noise';
import type { ObjectRef, Room } from './types';

/** Размер спрайта в клетках (ширина, высота) — даёт игра по asset_index.json. */
export type SizeOf = (assetId: AssetId) => readonly [number, number] | undefined;

export type StampKind = 'wall' | 'door' | 'window' | 'floor' | 'clear' | 'fence';
export interface Stamp {
  kind: StampKind;
  /** Индекс материала в building.json → materials (-1 — нет). */
  material: number;
  /** id комнаты (-1 — нет). */
  room: number;
}

/** Объект префаба до расчёта коллайдера. */
export interface PendingObject {
  uid: string;
  ref: ObjectRef;
  kind: string;
  sprite: AssetId;
  spriteAfter?: AssetId;
  x: number;
  y: number;
  biome: number;
  glow?: string;
  light?: number;
  requires?: string;
  room?: number;
}

export interface PlacedPrefab {
  id: string;
  kind: PrefabDef['kind'];
  /** Центр в клетках (для карты и расстояний). */
  x: number;
  y: number;
  biome: number;
  radius: number;
}

export interface RoadCell {
  center: boolean;
  /** Дорога идёт сверху вниз — тайл дороги поворачивается на 90°. */
  vertical: boolean;
}

const FAR = 255;

/**
 * Глобальная раскладка мира по сиду: кольца биомов с рваной границей, дороги к центру,
 * бункер старта, арены боссов, руины, ворота между кольцами, «посёлки». Считается один раз.
 */
export class WorldLayout {
  readonly size: number;
  readonly center: number;
  /** Внешние радиусы колец 1…6. */
  readonly radii: readonly number[];
  readonly start: { x: number; y: number };
  readonly stamps = new Map<number, Stamp>();
  readonly rooms: Room[] = [];
  readonly prefabs: PlacedPrefab[] = [];
  readonly roads = new Map<number, RoadCell>();
  /** Расстояние до дороги в клетках (до FAR). */
  readonly roadDist: Uint8Array;
  readonly roadLines: { x: number; y: number }[][] = [];
  readonly settlements: { x: number; y: number; biome: number }[] = [];
  /** Объекты префабов по чанкам: ключ chunkKey. */
  readonly prefabObjects = new Map<string, PendingObject[]>();

  private readonly ringNoise: Perlin;
  private readonly tileNoise: Perlin;
  private readonly roadNoise: Perlin;
  private readonly chunkTiles: number;
  private readonly materialIndex: Map<string, number>;

  constructor(
    private readonly reg: Registry,
    readonly seed: number,
    private readonly sizeOf: SizeOf,
  ) {
    const w = reg.balance.world;
    this.size = w.sizeTiles[0];
    this.center = this.size / 2;
    this.radii = w.biomeRingsRadiusTiles;
    this.chunkTiles = w.chunkTiles;
    this.ringNoise = new Perlin(hashSeed(seed, 1));
    this.tileNoise = new Perlin(hashSeed(seed, 2));
    this.roadNoise = new Perlin(hashSeed(seed, 3));
    this.roadDist = new Uint8Array(this.size * this.size).fill(FAR);
    this.materialIndex = new Map(reg.building.materials.map((m, i) => [m.id, i]));

    const g = reg.worldgen;
    const a = (g.start.angleDeg * Math.PI) / 180;
    this.start = {
      x: Math.floor(this.center + Math.cos(a) * g.start.radiusTiles) + 0.5,
      y: Math.floor(this.center + Math.sin(a) * g.start.radiusTiles) + 0.5,
    };

    const rng = new Rng(hashSeed(seed, 10));
    this.buildRoads(rng);
    this.computeRoadDist();
    this.placeRingFences();
    this.placeBunker();
    this.placeArenas(rng);
    this.placeGates();
    this.sealRoadsAroundGates();
    this.placeRuins(rng);
    this.placeSettlements(rng);
  }

  // ------------------------------------------------------------------ биомы и тайлы

  cellIndex(tx: number, ty: number): number {
    return ty * this.size + tx;
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.size && ty < this.size;
  }

  /** «Рваное» расстояние от центра (для колец). */
  ringDistance(x: number, y: number): number {
    const n = this.reg.worldgen.ringNoise;
    const d = Math.hypot(x - this.center, y - this.center);
    return d + this.ringNoise.fbm(x / n.scaleTiles, y / n.scaleTiles, 2) * n.amplitudeTiles;
  }

  /** Биом в точке (клетки, float): 1…6, 0 — море за краем острова. */
  biomeAt(x: number, y: number): number {
    const d = this.ringDistance(x, y);
    if (d > this.radii[0]!) return 0;
    let b = 1;
    for (let k = 1; k < this.radii.length; k++) if (d <= this.radii[k]!) b = k + 1;
    return b;
  }

  /** Расстояние до ближайшей границы колец — деревья гуще у края кольца. */
  ringEdgeDistance(x: number, y: number): number {
    const d = this.ringDistance(x, y);
    let best = Infinity;
    for (const r of this.radii) best = Math.min(best, Math.abs(d - r));
    return best;
  }

  /** Имя тайла клетки по генерации (без построек). */
  tileAt(tx: number, ty: number, biome: number): { tile: string; vertical: boolean } {
    const g = this.reg.worldgen;
    if (biome === 0) return { tile: g.sea.tile, vertical: false };
    const road = this.roads.get(this.cellIndex(tx, ty));
    const b = String(biome);
    if (road)
      return { tile: (road.center ? g.roads.centerTile[b] : g.roads.sideTile[b])!, vertical: road.vertical };
    const mix = g.tileMix[b]!;
    const n = this.tileNoise.fbm(
      tx / g.tileNoise.scaleTiles,
      ty / g.tileNoise.scaleTiles,
      g.tileNoise.octaves,
    );
    // fbm собран около 0 — растягиваем, чтобы доли тайлов были близки к весам.
    const v = Math.min(0.9999, Math.max(0, 0.5 + n * 1.25));
    const entries = Object.entries(mix);
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let acc = 0;
    for (const [tile, w] of entries) {
      acc += w / total;
      if (v < acc) return { tile, vertical: false };
    }
    return { tile: entries[entries.length - 1]![0], vertical: false };
  }

  // ------------------------------------------------------------------ дороги

  private buildRoads(rng: Rng): void {
    const g = this.reg.worldgen.roads;
    const startA = (this.reg.worldgen.start.angleDeg * Math.PI) / 180;
    for (let i = 0; i < g.count; i++) {
      const base = startA + ((i + 0.5) * Math.PI * 2) / g.count + (rng.next() - 0.5) * 0.3;
      const pts: { x: number; y: number }[] = [];
      for (let r = this.radii[0]! + 2; r >= g.endRadiusTiles; r -= g.segmentTiles) {
        const wob = this.roadNoise.noise(r / 60, i * 7.31) * g.wobbleTiles;
        const a = base + this.roadNoise.noise(r / 140, i * 3.7 + 50) * 0.35;
        const px = -Math.sin(a);
        const py = Math.cos(a);
        pts.push({
          x: this.center + Math.cos(a) * r + px * wob,
          y: this.center + Math.sin(a) * r + py * wob,
        });
      }
      this.roadLines.push(pts);
      this.rasterRoad(pts, g.widthTiles);
    }
  }

  private rasterRoad(pts: { x: number; y: number }[], width: number): void {
    const half = width / 2;
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i]!;
      const q = pts[i + 1]!;
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      const vertical = Math.abs(q.y - p.y) > Math.abs(q.x - p.x);
      const steps = Math.ceil(len * 3);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = p.x + (q.x - p.x) * t;
        const y = p.y + (q.y - p.y) * t;
        for (let dy = -Math.ceil(half); dy <= Math.ceil(half); dy++) {
          for (let dx = -Math.ceil(half); dx <= Math.ceil(half); dx++) {
            const tx = Math.floor(x) + dx;
            const ty = Math.floor(y) + dy;
            if (!this.inBounds(tx, ty)) continue;
            const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
            if (d > half) continue;
            const idx = this.cellIndex(tx, ty);
            const prev = this.roads.get(idx);
            const center = d < 0.5 || (prev?.center ?? false);
            this.roads.set(idx, { center, vertical: prev ? prev.vertical : vertical });
          }
        }
      }
    }
  }

  private computeRoadDist(): void {
    const N = this.size;
    let frontier: number[] = [];
    for (const idx of this.roads.keys()) {
      this.roadDist[idx] = 0;
      frontier.push(idx);
    }
    const maxD = 12;
    for (let d = 1; d <= maxD && frontier.length; d++) {
      const next: number[] = [];
      for (const idx of frontier) {
        const x = idx % N;
        const y = (idx - x) / N;
        for (const [nx, ny] of [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ] as const) {
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const j = ny * N + nx;
          if (this.roadDist[j]! > d) {
            this.roadDist[j] = d;
            next.push(j);
          }
        }
      }
      frontier = next;
    }
  }

  roadDistance(tx: number, ty: number): number {
    return this.inBounds(tx, ty) ? this.roadDist[this.cellIndex(tx, ty)]! : FAR;
  }

  // ------------------------------------------------------------------ заборы между кольцами

  /**
   * Забор по границе колец: клетки внутреннего кольца, у которых сосед по стороне — внешнее кольцо.
   * На дорогах забора нет — там ворота. Сканируется только полоса вокруг радиусов колец.
   */
  private placeRingFences(): void {
    const mats = this.reg.worldgen.ringFences.materials;
    const amp = this.reg.worldgen.ringNoise.amplitudeTiles + 2;
    const done = new Set<number>();
    for (let k = 1; k < this.radii.length; k++) {
      const material = this.materialIndex.get(mats[String(k)] ?? '') ?? -1;
      if (material < 0) continue;
      const r = this.radii[k]!;
      const R = Math.ceil(r + amp);
      for (let y = Math.floor(this.center - R); y <= Math.ceil(this.center + R); y++) {
        for (let x = Math.floor(this.center - R); x <= Math.ceil(this.center + R); x++) {
          if (!this.inBounds(x, y)) continue;
          const d = Math.hypot(x + 0.5 - this.center, y + 0.5 - this.center);
          if (Math.abs(d - r) > amp) continue;
          const idx = this.cellIndex(x, y);
          if (done.has(idx)) continue;
          if (this.biomeAt(x + 0.5, y + 0.5) !== k + 1) continue;
          const outside = [
            [x + 1, y],
            [x - 1, y],
            [x, y + 1],
            [x, y - 1],
          ].some(([nx, ny]) => this.biomeAt(nx! + 0.5, ny! + 0.5) === k);
          if (!outside) continue;
          // На дороге забор решается после ворот: там, где ворота не перекрывают дорогу (диагональный переезд).
          if (this.roadDist[idx] === 0) {
            this.roadFenceCells.push({ idx, material });
            continue;
          }
          done.add(idx);
          this.stamps.set(idx, { kind: 'fence', material, room: -1 });
          this.fenceCells++;
        }
      }
      // Диагональные стыки: добавляем клетку, чтобы забор был связным по сторонам (без щелей «в угол»).
      for (const idx of [...done]) {
        const st = this.stamps.get(idx);
        if (st?.kind !== 'fence' || st.material !== material) continue;
        const x = idx % this.size;
        const y = (idx - x) / this.size;
        for (const dx of [-1, 1]) {
          const diag = this.cellIndex(x + dx, y + 1);
          if (!this.inBounds(x + dx, y + 1) || this.stamps.get(diag)?.kind !== 'fence') continue;
          const a = this.cellIndex(x + dx, y);
          const b = this.cellIndex(x, y + 1);
          if (this.stamps.get(a)?.kind === 'fence' || this.stamps.get(b)?.kind === 'fence') continue;
          // Ставим в ту клетку, что не на дороге и внутри кольца k+1 (если обе подходят — первую).
          for (const c of [b, a]) {
            const cx = c % this.size;
            const cy = (c - cx) / this.size;
            if (this.roadDist[c] === 0 || this.stamps.has(c)) continue;
            if (this.biomeAt(cx + 0.5, cy + 0.5) < k) continue;
            this.stamps.set(c, { kind: 'fence', material, room: -1 });
            done.add(c);
            this.fenceCells++;
            break;
          }
        }
      }
    }
  }

  /** Сколько клеток забора (для отчёта и тестов). */
  fenceCells = 0;
  /** Клетки дороги на границе колец — закрываются забором, если их не перекрывают ворота. */
  private roadFenceCells: { idx: number; material: number }[] = [];
  private gatePieces: { x: number; y: number; w: number }[] = [];

  /** Дорога на границе вне ворот — забор (иначе в обход ворот можно пройти по краю широкой диагональной дороги). */
  private sealRoadsAroundGates(): void {
    for (const { idx, material } of this.roadFenceCells) {
      const x = idx % this.size;
      const y = (idx - x) / this.size;
      // Клетку закрывает створка ворот — забор не нужен.
      if (this.gatePieces.some((g) => Math.hypot(g.x - (x + 0.5), g.y - (y + 0.5)) <= g.w / 2 + 0.6))
        continue;
      const st = this.stamps.get(idx);
      if (st && st.kind !== 'clear') continue;
      this.stamps.set(idx, { kind: 'fence', material, room: -1 });
      this.fenceCells++;
    }
  }

  // ------------------------------------------------------------------ префабы

  private prefab(id: string): PrefabDef {
    const p = this.reg.prefabs[id];
    if (!p) throw new Error(`WorldLayout: нет префаба «${id}»`);
    return p;
  }

  private chunkKeyOf(x: number, y: number): string {
    return `${Math.floor(x / this.chunkTiles)},${Math.floor(y / this.chunkTiles)}`;
  }

  private addObject(o: PendingObject): void {
    const key = this.chunkKeyOf(o.x, o.y);
    const list = this.prefabObjects.get(key);
    if (list) list.push(o);
    else this.prefabObjects.set(key, [o]);
  }

  private stampClearCircle(cx: number, cy: number, r: number): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (!this.inBounds(x, y) || Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
        const idx = this.cellIndex(x, y);
        if (!this.stamps.has(idx)) this.stamps.set(idx, { kind: 'clear', material: -1, room: -1 });
      }
    }
  }

  /** Ставит префаб с планом: левый верхний угол (ox, oy). */
  private stampPlan(
    p: PrefabDef,
    ox: number,
    oy: number,
    biome: number,
    material: string,
    rng: Rng,
    uidBase: string,
  ): void {
    const plan = p.plan ?? [];
    const mat = this.materialIndex.get(material) ?? -1;
    const roomId = this.rooms.length;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let southY = -1;
    plan.forEach((row, py) => {
      for (let px = 0; px < row.length; px++) {
        const ch = row[px]!;
        if (ch === ' ') continue;
        const tx = ox + px;
        const ty = oy + py;
        if (!this.inBounds(tx, ty)) continue;
        const kind: StampKind =
          ch === '#' ? 'wall' : ch === 'D' ? 'door' : ch === 'O' ? 'window' : ch === '.' ? 'floor' : 'clear';
        const inRoom = kind !== 'clear';
        this.stamps.set(this.cellIndex(tx, ty), {
          kind,
          material: inRoom ? mat : -1,
          room: inRoom ? roomId : -1,
        });
        if (inRoom) {
          x0 = Math.min(x0, tx);
          y0 = Math.min(y0, ty);
          x1 = Math.max(x1, tx);
          y1 = Math.max(y1, ty);
          if (kind !== 'floor') southY = Math.max(southY, ty);
        }
      }
    });
    if (x0 <= x1) this.rooms.push({ id: roomId, x0, y0, x1, y1, southY });
    p.objects.forEach((o, i) => {
      const placed = this.resolvePrefabObject(o, ox + o.at[0], oy + o.at[1], biome, rng, `${uidBase}_${i}`);
      if (placed) this.addObject({ ...placed, room: x0 <= x1 ? roomId : undefined });
    });
  }

  /** Объект префаба → станок / контейнер / мебель / объект биома / спрайт. */
  private resolvePrefabObject(
    o: PrefabObjectDef,
    x: number,
    y: number,
    biome: number,
    rng: Rng,
    uid: string,
  ): PendingObject | null {
    const lights = this.reg.worldgen.lights;
    if (o.station) {
      const st = this.reg.stations.require(o.station);
      const sprite = (o.state ? st.stateSprites?.[o.state] : undefined) ?? st.sprite;
      const lit = o.station === 'campfire' && o.state === 'on';
      return {
        uid,
        ref: { type: 'station', id: st.id, state: o.state },
        kind: 'station',
        sprite,
        x,
        y,
        biome,
        light: lit ? lights.campfireRadiusTiles : undefined,
      };
    }
    if (o.container) {
      const list = this.reg.objects.containers.all;
      const c =
        o.container === 'random'
          ? list[rng.int(0, list.length - 1)]!
          : this.reg.objects.containers.require(o.container);
      return {
        uid,
        ref: { type: 'container', id: c.id },
        kind: 'container',
        sprite: c.sprite,
        spriteAfter: c.openedSprite ?? undefined,
        x,
        y,
        biome,
      };
    }
    if (o.furniture) {
      const list = this.reg.objects.furniture.all;
      const f =
        o.furniture === 'random'
          ? list[rng.int(0, list.length - 1)]!
          : this.reg.objects.furniture.require(o.furniture);
      return { uid, ref: { type: 'furniture', id: f.id }, kind: 'furniture', sprite: f.sprite, x, y, biome };
    }
    if (o.object) {
      const objs = this.reg.objects.byBiome(biome);
      const m = /^random:(\w+)$/.exec(o.object);
      const pool = m ? objs.filter((d) => d.kind === m[1]) : objs.filter((d) => d.id === o.object);
      if (pool.length === 0) return null;
      const d = pool[rng.int(0, pool.length - 1)]!;
      return {
        uid,
        ref: { type: 'biome', biome, id: d.id },
        kind: d.kind,
        sprite: d.sprite,
        spriteAfter: d.afterHarvest,
        x,
        y,
        biome,
      };
    }
    if (o.sprite)
      return {
        uid,
        ref: { type: 'prefab', id: uid },
        kind: o.kind ?? 'decor',
        sprite: o.sprite,
        x,
        y,
        biome,
      };
    return null;
  }

  private placeBunker(): void {
    const p = this.prefab(this.reg.worldgen.bunker.prefab);
    const [ax, ay] = p.anchor ?? [0, 0];
    const sx = Math.floor(this.start.x);
    const sy = Math.floor(this.start.y);
    const biome = this.biomeAt(this.start.x, this.start.y);
    const rows = p.plan?.length ?? 0;
    const cols = p.plan?.[0]?.length ?? 0;
    this.stampPlan(
      p,
      sx - ax,
      sy - ay,
      biome,
      p.material ?? 'concrete',
      new Rng(hashSeed(this.seed, 20)),
      'bunker',
    );
    this.stampClearCircle(this.start.x, this.start.y, this.reg.worldgen.start.clearRadiusTiles);
    this.prefabs.push({
      id: p.id,
      kind: p.kind,
      x: sx - ax + cols / 2,
      y: sy - ay + rows / 2,
      biome,
      radius: Math.max(rows, cols),
    });
  }

  private ringBounds(biome: number): [number, number] {
    return [this.radii[biome] ?? 0, this.radii[biome - 1]!];
  }

  private placeArenas(rng: Rng): void {
    const g = this.reg.worldgen.arenas;
    const p = this.prefab(g.prefab);
    const clear = p.clearRadiusTiles ?? 0;
    const startA = (this.reg.worldgen.start.angleDeg * Math.PI) / 180;
    for (const boss of this.reg.bosses.all) {
      const [inner, outer] = this.ringBounds(boss.biome);
      const r = inner + (outer - inner) * g.ringPosition;
      let a = startA + (g.angleOffsetDeg * Math.PI) / 180 + boss.biome * 0.9;
      // Арена не на дороге: поворачиваем, пока не найдём свободное место.
      for (let tries = 0; tries < 36; tries++) {
        const x = this.center + Math.cos(a) * r;
        const y = this.center + Math.sin(a) * r;
        if (this.areaClearOfRoads(x, y, clear + 3) || r < clear + 4) break;
        a += Math.PI / 18;
      }
      const cx = Math.floor(this.center + Math.cos(a) * r) + 0.5;
      const cy = Math.floor(this.center + Math.sin(a) * r) + 0.5;
      this.stampClearCircle(cx, cy, clear);
      const uid = `arena${boss.biome}`;
      if (p.ring) {
        const outward = Math.atan2(cy - this.center, cx - this.center);
        const gap = (p.ring.gapDeg * Math.PI) / 180 / 2;
        const objs = this.reg.objects.byBiome(boss.biome).filter((d) => d.kind === p.ring!.kind);
        for (let i = 0; i < p.ring.count && objs.length; i++) {
          const ang = (i / p.ring.count) * Math.PI * 2;
          const diff = Math.abs(Math.atan2(Math.sin(ang - outward), Math.cos(ang - outward)));
          if (diff < gap) continue;
          const d = objs[rng.int(0, objs.length - 1)]!;
          this.addObject({
            uid: `${uid}_r${i}`,
            ref: { type: 'biome', biome: boss.biome, id: d.id },
            kind: d.kind,
            sprite: d.sprite,
            spriteAfter: d.afterHarvest,
            x: cx + Math.cos(ang) * p.ring.radiusTiles,
            y: cy + Math.sin(ang) * p.ring.radiusTiles,
            biome: boss.biome,
          });
        }
      }
      p.objects.forEach((o, i) => {
        const placed = this.resolvePrefabObject(
          o,
          cx + o.at[0],
          cy + o.at[1],
          boss.biome,
          rng,
          `${uid}_${i}`,
        );
        if (placed) this.addObject(placed);
      });
      this.prefabs.push({ id: p.id, kind: 'arena', x: cx, y: cy, biome: boss.biome, radius: clear + 1 });
    }
  }

  /** Ворота: там, где дорога пересекает границу кольца k → k+1. Снимаются трофеем босса кольца k. */
  private placeGates(): void {
    const p = this.prefab(this.reg.worldgen.gates.prefab);
    const sprite = p.sprite;
    if (!sprite) return;
    const span = this.reg.worldgen.roads.widthTiles + (p.spanExtraTiles ?? 0);
    const size = this.sizeOf(sprite);
    const pieceW = size ? size[0] : 1.7;
    this.roadLines.forEach((pts, ri) => {
      let prevBiome = this.biomeAt(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const steps = 24;
        for (let s = 1; s <= steps; s++) {
          const x = a.x + ((b.x - a.x) * s) / steps;
          const y = a.y + ((b.y - a.y) * s) / steps;
          const bm = this.biomeAt(x, y);
          if (bm === prevBiome + 1 && prevBiome >= 1) {
            const trophy = this.reg.bosses.byBiome(prevBiome)?.trophy.item;
            const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const nx = -(b.y - a.y) / len;
            const ny = (b.x - a.x) / len;
            const pieces = Math.max(1, Math.ceil(span / pieceW));
            for (let k = 0; k < pieces; k++) {
              const off = (k - (pieces - 1) / 2) * pieceW;
              this.gatePieces.push({ x: x + nx * off, y: y + ny * off, w: pieceW });
              this.addObject({
                uid: `gate${ri}_${prevBiome}_${k}`,
                ref: { type: 'prefab', id: p.id },
                kind: 'gate',
                sprite,
                x: x + nx * off,
                y: y + ny * off,
                biome: bm,
                requires: trophy,
              });
            }
            this.stampClearCircle(x, y, p.clearRadiusTiles ?? 2);
            this.prefabs.push({ id: p.id, kind: 'gate', x, y, biome: bm, radius: 2 });
          }
          prevBiome = bm;
        }
      }
    });
  }

  private areaClearOfRoads(x: number, y: number, r: number): boolean {
    for (let dy = -r; dy <= r; dy += 2) {
      for (let dx = -r; dx <= r; dx += 2) {
        if (this.roadDistance(Math.floor(x + dx), Math.floor(y + dy)) === 0) return false;
      }
    }
    return true;
  }

  private placeRuins(rng: Rng): void {
    const g = this.reg.worldgen.ruins;
    for (const biome of this.reg.biomes.all.map((b) => b.id)) {
      const [inner, outer] = this.ringBounds(biome);
      const count = rng.int(g.perBiome[0], g.perBiome[1]);
      let placed = 0;
      for (let attempt = 0; attempt < count * 150 && placed < count; attempt++) {
        const p = this.prefab(g.prefabs[rng.int(0, g.prefabs.length - 1)]!);
        const rows = p.plan?.length ?? 0;
        const cols = p.plan?.[0]?.length ?? 0;
        const a = rng.next() * Math.PI * 2;
        const r = inner + g.edgeMarginTiles + rng.next() * Math.max(0, outer - inner - 2 * g.edgeMarginTiles);
        const cx = this.center + Math.cos(a) * r;
        const cy = this.center + Math.sin(a) * r;
        const ox = Math.floor(cx - cols / 2);
        const oy = Math.floor(cy - rows / 2);
        if (!this.footprintFree(ox, oy, cols, rows, biome, g.roadClearTiles)) continue;
        const radius = Math.max(rows, cols) / 2;
        if (this.prefabs.some((q) => Math.hypot(q.x - cx, q.y - cy) < g.minSpacingTiles + q.radius + radius))
          continue;
        if (Math.hypot(this.start.x - cx, this.start.y - cy) < g.minSpacingTiles) continue;
        const mats = g.materials[String(biome)]!;
        const material = p.material ?? mats[rng.int(0, mats.length - 1)]!;
        this.stampPlan(p, ox, oy, biome, material, rng, `ruin${biome}_${placed}`);
        this.prefabs.push({ id: p.id, kind: 'ruin', x: cx, y: cy, biome, radius });
        placed++;
      }
    }
  }

  private footprintFree(
    ox: number,
    oy: number,
    w: number,
    h: number,
    biome: number,
    roadClear: number,
  ): boolean {
    for (let y = oy - 1; y <= oy + h; y++) {
      for (let x = ox - 1; x <= ox + w; x++) {
        if (!this.inBounds(x, y)) return false;
        if (this.stamps.has(this.cellIndex(x, y))) return false;
        if (this.roadDistance(x, y) < roadClear) return false;
        if (this.biomeAt(x + 0.5, y + 0.5) !== biome) return false;
      }
    }
    return true;
  }

  private placeSettlements(rng: Rng): void {
    const g = this.reg.worldgen.objects.settlements;
    for (const biome of this.reg.biomes.all.map((b) => b.id)) {
      const [inner, outer] = this.ringBounds(biome);
      for (let i = 0; i < g.perRing; i++) {
        const a = rng.next() * Math.PI * 2;
        const r = inner + g.radiusTiles + rng.next() * Math.max(0, outer - inner - 2 * g.radiusTiles);
        this.settlements.push({ x: this.center + Math.cos(a) * r, y: this.center + Math.sin(a) * r, biome });
      }
    }
  }
}
