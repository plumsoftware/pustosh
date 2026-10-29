import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import type { ItemSet } from '../../core/inventory/Inventory';
import { consumeFrom, missingFor } from '../../core/systems/Craft';
import { effectOf, initDefense } from '../../core/systems/Defense';
import {
  canBuild,
  cellFree,
  disassembleSlot,
  EDGE_T,
  edgeRect,
  floorHoldsWalls,
  lineEdges,
  onEdge,
  pieceCost,
  placePiece,
  rectCells,
  repairEdge,
  requirementMet,
  upgradeEdge,
  type BuildBlock,
  type BuildCell,
  type BuildPiece,
  type BuildSlot,
  type EdgeRef,
  type Rect,
  type WorldObject,
} from '../../core/world';
import { getAssetInfo } from '../assets/AssetIndex';
import { spawnSprite } from '../assets/spawnSprite';
import { registry } from '../GameContext';
import { DEPTH } from '../render/ChunkView';
import { TILE } from '../render/GroundTiles';
import { TOAST, type WorldScene } from '../scenes/WorldScene';

/** Что выбрано в режиме строительства. */
export type BuildSel =
  | { kind: 'piece'; piece: BuildPiece; mat: number }
  /** Станок или защита из инвентаря. */
  | { kind: 'object'; id: string }
  | { kind: 'tool'; tool: 'upgrade' | 'repair' | 'disassemble' };

/** Последнее действие — можно отменить undoSec секунд с полным возвратом ресурсов. */
interface UndoEntry {
  at: number;
  cells: { tx: number; ty: number; before: BuildCell | null }[];
  objects: WorldObject[];
  paid: ItemSet;
  items: string[];
}

const GHOST_OK = 0x80ff80;
const GHOST_BAD = 0xff6060;
/** Пульс призрака (ANIMATIONS §7), мс. */
const GHOST_PULSE = 900;
/** Как часто пересчитывать цену и допустимость, мс. */
const EVAL_MS = 250;

/** Молоток берёт ребро, если курсор ближе этого к линии между клетками (иначе — клетку: пол, объект). */
const EDGE_PICK = 0.3;

/**
 * Режим строительства в мире (TZ 7.3, стены как в Last Day on Earth): пол — в клетку, стены, окна,
 * двери и заборы — на ребро между клетками (ближайшее к курсору/пальцу). Призрак зелёный/красный;
 * протяжка ставит линию стен вдоль ребра или прямоугольник пола; инструменты молотка: улучшить,
 * починить, разобрать (удержание 1 с); отмена.
 */
export class BuildController {
  active = false;
  sel: BuildSel = { kind: 'piece', piece: 'wall', mat: 0 };
  /** Точка под курсором (клетки мира, дробные) и начало протяжки. */
  private cursor: { x: number; y: number } | null = null;
  private dragFrom: BuildSlot | null = null;
  private ghosts: Phaser.GameObjects.Image[] = [];
  private toolBox: Phaser.GameObjects.Graphics;
  private ring: Phaser.GameObjects.Graphics;
  private undoStack: UndoEntry | null = null;
  private hold: { t: number; slot: BuildSlot } | null = null;
  private lastEval: { ok: boolean[] } | null = null;
  private evalKey = '';
  private evalAt = 0;
  /** Строка о цене/наличии для панели. */
  status = '';
  statusOk = true;
  /** Область панели (экранные px) — касания там не двигают призрак. */
  blockRect: { y: number } = { y: Infinity };

  constructor(private readonly scene: WorldScene) {
    this.toolBox = scene.add.graphics().setDepth(DEPTH.debug - 2);
    this.ring = scene.add.graphics().setDepth(DEPTH.shadow + 1);
    const inp = scene.input;
    inp.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => this.down(p));
    inp.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => this.move(p));
    inp.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer) => this.up(p));
  }

  private get touch(): boolean {
    return this.scene.sys.game.device.input.touch && !this.scene.sys.game.device.os.desktop;
  }

  enter(sel?: BuildSel): void {
    this.active = true;
    if (sel) this.sel = sel;
    this.cursor = null;
    this.dragFrom = null;
  }

  exit(): void {
    this.active = false;
    this.clearGhosts();
    this.toolBox.clear();
    this.ring.clear();
    this.hold = null;
    this.dragFrom = null;
  }

  setSel(sel: BuildSel): void {
    this.sel = sel;
    this.dragFrom = null;
  }

  destroy(): void {
    this.exit();
    this.toolBox.destroy();
    this.ring.destroy();
  }

  // ------------------------------------------------------------------ ввод

  private pointOf(p: Phaser.Input.Pointer): { x: number; y: number } | null {
    if (p.y >= this.blockRect.y) return null;
    // Левая половина на телефоне — стик.
    if (this.touch && p.x < this.scene.scale.width * 0.45) return null;
    const w = p.positionToCamera(this.scene.cameras.main) as Phaser.Math.Vector2;
    return { x: w.x / TILE, y: w.y / TILE };
  }

  /** Протяжкой ставятся линия стен и прямоугольник пола (не дверь, не объект). */
  private get draggable(): boolean {
    return this.sel.kind === 'piece' && this.sel.piece !== 'door';
  }

  private down(p: Phaser.Input.Pointer): void {
    if (!this.active) return;
    const c = this.pointOf(p);
    if (!c) return;
    this.cursor = c;
    if (this.draggable) this.dragFrom = this.slotAt(c.x, c.y);
    if (!this.touch && this.sel.kind === 'tool' && this.sel.tool === 'disassemble') this.beginHold();
  }

  private move(p: Phaser.Input.Pointer): void {
    if (!this.active) return;
    const c = this.pointOf(p);
    if (c) this.cursor = c;
  }

  private up(p: Phaser.Input.Pointer): void {
    if (!this.active) return;
    if (this.pointOf(p) === null && !this.dragFrom) return;
    // ПК: клик/протяжка ставит сразу; телефон — подтверждение кнопкой ✓.
    if (!this.touch) {
      if (this.sel.kind === 'tool' && this.sel.tool === 'disassemble') this.endHold();
      else this.confirm();
      this.dragFrom = null;
    }
  }

  /** Точка по умолчанию: перед героем (телефон без касания, клавиатура). */
  private point(): { x: number; y: number } {
    if (this.cursor) return this.cursor;
    const h = this.scene.hero;
    return { x: h.pos.x + h.move.faceX, y: h.pos.y + h.move.faceY };
  }

  /** Ближайшее к точке ребро: северное (линия y = целое) или западное (x = целое). */
  private nearestEdge(x: number, y: number): EdgeRef & { dist: number } {
    const dy = Math.abs(y - Math.round(y));
    const dx = Math.abs(x - Math.round(x));
    return dy <= dx
      ? { tx: Math.floor(x), ty: Math.round(y), side: 'n', dist: dy }
      : { tx: Math.round(x), ty: Math.floor(y), side: 'w', dist: dx };
  }

  /** Место под точкой для текущего выбора: ребро для стен, клетка для пола и объектов. */
  private slotAt(x: number, y: number): BuildSlot {
    const cell: BuildSlot = { tx: Math.floor(x), ty: Math.floor(y), side: 'c' };
    const sel = this.sel;
    if (sel.kind === 'object' || (sel.kind === 'piece' && !onEdge(sel.piece))) return cell;
    const e = this.nearestEdge(x, y);
    const edge: BuildSlot = { tx: e.tx, ty: e.ty, side: e.side };
    if (sel.kind === 'piece' || sel.tool !== 'disassemble') return edge;
    // Разбор: ребро со стеной рядом с курсором, иначе клетка (пол, станок, защита).
    return e.dist <= EDGE_PICK && this.scene.world.edgeAt(e) ? edge : cell;
  }

  /** Места текущего действия: линия стен, прямоугольник пола или одно место. */
  private slots(): BuildSlot[] {
    const c = this.point();
    const one = this.slotAt(c.x, c.y);
    const from = this.dragFrom;
    if (!from || !this.draggable) return [one];
    const max = registry().build.lineMaxCells;
    if (from.side === 'c')
      return rectCells(from.tx, from.ty, one.tx, one.ty, max).map(([tx, ty]) => ({
        tx,
        ty,
        side: 'c' as const,
      }));
    return lineEdges({ tx: from.tx, ty: from.ty, side: from.side }, Math.floor(c.x), Math.floor(c.y), max);
  }

  // ------------------------------------------------------------------ проверки

  private creatureIn = (r: Rect): boolean => {
    const h = this.scene.hero;
    const hit = (x: number, y: number, rr: number) =>
      x + rr > r.x0 && x - rr < r.x1 && y + rr > r.y0 && y - rr < r.y1;
    return hit(h.pos.x, h.pos.y, 0.25) || this.scene.dummies.some((d) => d.hp > 0 && hit(d.x, d.y, d.r));
  };

  private hasItem = (id: string): boolean => this.scene.hero.inv.count(id) > 0;

  private hasHammer(): boolean {
    const reg = registry();
    const inv = this.scene.hero.inv;
    return [...inv.main.slots, ...inv.hotbar.slots].some(
      (s) => !!s && reg.items.get(s.id)?.toolType === 'hammer' && (s.durability ?? 1) > 0,
    );
  }

  private stationNear = (id: string): boolean => {
    const R = registry().build.requiresStationRadiusTiles;
    const h = this.scene.hero.pos;
    return this.scene.objectsNear(h.x, h.y, R).some((o) => o.ref.type === 'station' && o.ref.id === id);
  };

  private sources() {
    return this.scene.craftSources(null);
  }

  /** Почему нельзя — строка для панели (только понятные игроку случаи). */
  private blockText(b: BuildBlock | undefined): string {
    return b === 'no_floor' ? t('build.no_floor') : b === 'no_opening' ? t('build.no_opening') : '';
  }

  /** Цена и проверка для призрака: текст для панели. */
  private evaluate(): { ok: boolean[]; cost: ItemSet; why: string } {
    const reg = registry();
    const slots = this.slots();
    const sel = this.sel;
    const world = this.scene.world;
    if (sel.kind === 'piece') {
      const m = reg.building.materials[sel.mat]!;
      // «Экономия»: −10% стоимости построек за уровень (не меньше 1).
      const save = 1 + this.scene.progress.effect('buildCost');
      const one = Object.fromEntries(
        Object.entries(pieceCost(reg, sel.piece, sel.mat)).map(([id, n]) => [
          id,
          Math.max(1, Math.round(n * save)),
        ]),
      );
      const blocks = slots.map((sl) => canBuild(world, sel.piece, sl, this.creatureIn));
      const ok = blocks.map((b) => b === null);
      const n = ok.filter(Boolean).length;
      const cost: Record<string, number> = {};
      for (const [id, k] of Object.entries(one)) cost[id] = k * Math.max(1, n);
      let why = '';
      if (sel.piece !== 'door' && !requirementMet(reg, m, this.hasItem, this.stationNear))
        why = t('build.need', {
          what: reg.items.get(m.requires)?.name_ru ?? reg.stations.get(m.requires)?.name_ru ?? m.requires,
        });
      else if (n === 0)
        why = this.blockText(blocks.find((b) => b === 'no_floor' || b === 'no_opening') ?? undefined);
      if (!why && Object.keys(missingFor(this.sources(), cost)).length) why = t('build.no_res');
      return { ok, cost, why };
    }
    if (sel.kind === 'object') {
      const fp = this.footprint(sel.id);
      const { tx: x, ty: y } = slots[0]!;
      let free = world.canOccupy(x, y, fp[0], fp[1]);
      for (let yy = 0; yy < fp[1] && free; yy++)
        for (let xx = 0; xx < fp[0]; xx++)
          if (cellFree(world, x + xx, y + yy, this.creatureIn) !== null) free = false;
      let why = this.hasItem(sel.id) ? '' : t('build.no_item');
      if (!why && sel.id === 'base_core' && this.scene.baseCore()) why = t('build.one_core');
      if (!why && sel.id === 'outpost_beacon' && this.scene.outposts().length >= reg.build.base.maxOutposts)
        why = t('build.max_outposts', { n: reg.build.base.maxOutposts });
      return { ok: [free], cost: {}, why };
    }
    // Инструменты молотка: по стене игрока на ребре (разбор — ещё пол и объекты в клетке).
    const sl = slots[0]!;
    if (!this.hasHammer()) return { ok: [false], cost: {}, why: t('build.need_hammer') };
    if (sel.tool === 'disassemble') {
      if (sl.side === 'c' && this.objectAt(sl.tx, sl.ty)) return { ok: [true], cost: {}, why: '' };
      if (
        sl.side === 'c' &&
        world.builtAt(sl.tx, sl.ty)?.floor !== undefined &&
        floorHoldsWalls(world, sl.tx, sl.ty)
      )
        return { ok: [false], cost: {}, why: t('build.floor_holds') };
      const d = disassembleSlot(reg, world, sl);
      return { ok: [!!d], cost: {}, why: d ? '' : t('build.not_built') };
    }
    const w = sl.side === 'c' ? null : world.edgeAt({ tx: sl.tx, ty: sl.ty, side: sl.side });
    if (!w) return { ok: [false], cost: {}, why: t('build.not_built') };
    if (sel.tool === 'upgrade') {
      const u = upgradeEdge(reg, w);
      if (!u) return { ok: [false], cost: {}, why: t('build.max_level') };
      const m = reg.building.materials[u.wall.mat]!;
      const why = !requirementMet(reg, m, this.hasItem, this.stationNear)
        ? t('build.need', {
            what: reg.items.get(m.requires)?.name_ru ?? reg.stations.get(m.requires)?.name_ru ?? m.requires,
          })
        : Object.keys(missingFor(this.sources(), u.cost)).length
          ? t('build.no_res')
          : '';
      return { ok: [true], cost: u.cost, why };
    }
    const r = repairEdge(reg, w);
    if (!r) return { ok: [false], cost: {}, why: t('build.full_hp') };
    return {
      ok: [true],
      cost: r.cost,
      why: Object.keys(missingFor(this.sources(), r.cost)).length ? t('build.no_res') : '',
    };
  }

  private footprint(id: string): [number, number] {
    const reg = registry();
    const st = reg.stations.get(id);
    return st ? [st.footprintTiles[0], st.footprintTiles[1]] : [1, 1];
  }

  // ------------------------------------------------------------------ кадр

  /** Призраки, рамка инструмента, граница базы, удержание «Разобрать». */
  update(time: number, dt: number): void {
    if (!this.active) return;
    const reg = registry();
    // Проверка (ресурсы, сундуки рядом, допустимость клеток) — не чаще раза в EVAL_MS или при смене клетки.
    const key = `${JSON.stringify(this.sel)}|${JSON.stringify(this.slots())}`;
    if (!this.lastEval || key !== this.evalKey || time - this.evalAt > EVAL_MS) {
      this.evalKey = key;
      this.evalAt = time;
      const ev = this.evaluate();
      const src = this.sources();
      const costText = Object.entries(ev.cost)
        .map(([id, n]) => {
          const have = src.reduce((a, s) => a + s.count(id), 0);
          return `${reg.items.get(id)?.name_ru ?? id} ${Math.min(have, 999)}/${n}`;
        })
        .join(' · ');
      this.status = ev.why || costText;
      this.statusOk = !ev.why;
      this.lastEval = ev;
    }
    this.drawGhosts(this.lastEval.ok, time);
    this.drawBaseRing(time);
    if (this.hold) {
      this.hold.t += dt;
      const p = Math.min(1, this.hold.t / reg.build.disassembleHoldSec);
      const { tx, ty } = this.hold.slot;
      this.toolBox.fillStyle(0xff6040, 0.35).fillRect(tx * TILE, (ty + 1) * TILE - 6, TILE * p, 6);
      if (p >= 1) {
        const h = this.hold;
        this.hold = null;
        this.disassemble(h.slot);
      }
    }
  }

  private clearGhosts(): void {
    for (const g of this.ghosts) g.destroy();
    this.ghosts = [];
  }

  /** Высота лица стены, px (как у стен на рёбрах в ChunkView). */
  private faceH(mat: number): number {
    return getAssetInfo(registry().building.materials[mat]!.sprites.face)?.size[1] ?? TILE * 0.75;
  }

  /** Рамка места: клетка или стена на ребре (полоса на земле + высота лица). */
  private strokeSlot(sl: BuildSlot, color: number, alpha: number, mat = 0): void {
    const g = this.toolBox;
    if (sl.side === 'c') {
      g.lineStyle(3, color, alpha).strokeRect(sl.tx * TILE, sl.ty * TILE, TILE, TILE);
      return;
    }
    const r = edgeRect(sl.tx, sl.ty, sl.side);
    const H = this.faceH(mat);
    g.fillStyle(color, alpha * 0.6).fillRect(
      r.x0 * TILE,
      r.y0 * TILE,
      (r.x1 - r.x0) * TILE,
      (r.y1 - r.y0) * TILE,
    );
    g.lineStyle(2, color, alpha).strokeRect(
      r.x0 * TILE,
      r.y0 * TILE - H,
      (r.x1 - r.x0) * TILE,
      (r.y1 - r.y0) * TILE + H,
    );
  }

  private drawGhosts(ok: boolean[], time: number): void {
    const reg = registry();
    const slots = this.slots();
    const sel = this.sel;
    this.toolBox.clear();
    const pulse = 0.55 + 0.2 * Math.sin((time / GHOST_PULSE) * Math.PI * 2);
    if (sel.kind === 'tool') {
      this.clearGhosts();
      const sl = slots[0]!;
      const mat =
        sl.side === 'c' ? 0 : (this.scene.world.edgeAt({ tx: sl.tx, ty: sl.ty, side: sl.side })?.mat ?? 0);
      this.strokeSlot(sl, ok[0] && this.statusOk ? GHOST_OK : GHOST_BAD, pulse + 0.2, mat);
      return;
    }
    const side = slots[0]!.side;
    const m = sel.kind === 'piece' ? reg.building.materials[sel.mat]! : null;
    const sprite =
      sel.kind === 'object'
        ? (reg.stations.get(sel.id)?.sprite ?? reg.defense.get(sel.id)?.sprite ?? '')
        : sel.piece === 'floor'
          ? m!.sprites.floor
          : sel.piece === 'door'
            ? m!.sprites.door
            : sel.piece === 'fence'
              ? m!.sprites.fence
              : side === 'w'
                ? m!.sprites.top_cap
                : m!.sprites[sel.piece === 'wall' ? 'face' : sel.piece];
    const id = `${sprite}|${side}`;
    const need = sel.kind === 'object' ? 1 : slots.length;
    if (this.ghosts.length !== need || this.ghosts[0]?.getData('id') !== id) {
      this.clearGhosts();
      if (!getAssetInfo(sprite)) return;
      for (let i = 0; i < need; i++)
        this.ghosts.push(spawnSprite(this.scene, 0, 0, sprite, { depth: DEPTH.debug - 3 }).setData('id', id));
    }
    const T = EDGE_T * TILE;
    slots.slice(0, need).forEach((sl, i) => {
      const g = this.ghosts[i]!;
      const good = ok[i] && this.statusOk;
      const color = good ? GHOST_OK : GHOST_BAD;
      g.setTint(color).setAlpha(pulse);
      const X = sl.tx * TILE;
      const Y = sl.ty * TILE;
      if (sel.kind === 'object') {
        const [fw, fh] = this.footprint(sel.id);
        g.setPosition((sl.tx + fw / 2) * TILE, (sl.ty + fh) * TILE);
        return;
      }
      if (sl.side === 'c') {
        g.setPosition(X, Y);
        return;
      }
      // Стена на ребре: лицо над северным ребром, узкая полоса вдоль западного.
      const H = this.faceH(sel.mat);
      g.setOrigin(0, 0);
      if (sl.side === 'n') {
        const h = sel.piece === 'fence' ? (getAssetInfo(sprite)?.size[1] ?? H) : H;
        if (sel.piece === 'door') g.setDisplaySize(H * 0.94 * (g.frame.width / g.frame.height), H * 0.94);
        else g.setDisplaySize(TILE, h);
        g.setPosition(
          sel.piece === 'door' ? X + (TILE - g.displayWidth) / 2 : X,
          Y + T / 2 - g.displayHeight,
        );
      } else {
        g.setDisplaySize(T, TILE + T).setPosition(
          X - T / 2,
          Y - T / 2 - (sel.piece === 'fence' ? TILE * 0.3 : H),
        );
      }
      this.strokeSlot(sl, color, pulse, sel.mat);
    });
  }

  /** Граница базы — пунктир радиусом тотема (только в режиме строительства). */
  private drawBaseRing(time: number): void {
    this.ring.clear();
    const core = this.scene.baseCore();
    if (!core) return;
    const reg = registry();
    const r = this.scene.baseRadius() * TILE;
    const [dash, gap] = reg.build.base.ringDash;
    const circ = Math.PI * 2 * r;
    const n = Math.floor(circ / (dash + gap));
    const off = (time / 4000) % 1;
    this.ring.lineStyle(3, 0xff5040, 0.75);
    for (let i = 0; i < n; i++) {
      const a0 = ((i + off) / n) * Math.PI * 2;
      const a1 = a0 + (dash / circ) * Math.PI * 2;
      this.ring.beginPath();
      this.ring.arc(core.x * TILE, core.y * TILE, r, a0, a1);
      this.ring.strokePath();
    }
  }

  // ------------------------------------------------------------------ действия

  beginHold(): void {
    if (this.sel.kind !== 'tool' || this.sel.tool !== 'disassemble') return;
    const slot = this.slots()[0]!;
    const ev = this.evaluate();
    if (!ev.ok[0]) {
      this.toast(ev.why);
      return;
    }
    this.hold = { t: 0, slot };
  }

  endHold(): void {
    this.hold = null;
  }

  private toast(s: string): void {
    if (s) this.scene.game.events.emit(TOAST, s);
  }

  /** Подтвердить: поставить линию/деталь/объект или применить инструмент. */
  confirm(): void {
    this.lastEval = null;
    const reg = registry();
    const sel = this.sel;
    if (sel.kind === 'tool' && sel.tool === 'disassemble') return; // только удержанием
    const ev = this.evaluate();
    if (ev.why) {
      this.toast(ev.why);
      return;
    }
    const slots = this.slots();
    const world = this.scene.world;
    if (sel.kind === 'piece') {
      const okSlots = slots.filter((_, i) => ev.ok[i]);
      if (okSlots.length === 0) {
        this.toast(t('place.bad'));
        return;
      }
      if (!consumeFrom(this.sources(), ev.cost)) {
        this.toast(t('build.no_res'));
        return;
      }
      const undo: UndoEntry = { at: this.scene.time.now, cells: [], objects: [], paid: ev.cost, items: [] };
      for (const sl of okSlots) {
        const before = world.builtAt(sl.tx, sl.ty);
        undo.cells.push({ tx: sl.tx, ty: sl.ty, before });
        world.setBuilt(sl.tx, sl.ty, placePiece(reg, before, sel.piece, sel.mat, sl));
        this.scene.progress.count('built');
      }
      this.undoStack = undo;
      this.scene.onBuilt(okSlots, 'place');
      this.dragFrom = null;
      return;
    }
    if (sel.kind === 'object') {
      if (!ev.ok[0]) {
        this.toast(t('place.bad'));
        return;
      }
      const { tx, ty } = slots[0]!;
      const o = this.placeObject(sel.id, tx, ty);
      if (!o) return;
      this.undoStack = { at: this.scene.time.now, cells: [], objects: [o], paid: {}, items: [sel.id] };
      return;
    }
    const sl = slots[0]!;
    if (sl.side === 'c') return;
    const e: EdgeRef = { tx: sl.tx, ty: sl.ty, side: sl.side };
    const w = world.edgeAt(e);
    const r = w ? (sel.tool === 'upgrade' ? upgradeEdge(reg, w) : repairEdge(reg, w)) : null;
    if (!r || !consumeFrom(this.sources(), r.cost)) return;
    const before = world.builtAt(e.tx, e.ty);
    world.setEdge(e, r.wall);
    this.undoStack = {
      at: this.scene.time.now,
      cells: [{ tx: e.tx, ty: e.ty, before }],
      objects: [],
      paid: r.cost,
      items: [],
    };
    this.scene.onBuilt([e], sel.tool);
  }

  private objectAt(x: number, y: number): WorldObject | null {
    return (
      this.scene.world
        .objectsAt(x, y)
        .find((o) => (o.ref.type === 'station' || o.ref.type === 'defense') && o.uid.startsWith('pl')) ?? null
    );
  }

  /** Станок или защита из инвентаря. */
  private placeObject(id: string, tx: number, ty: number): WorldObject | null {
    const reg = registry();
    if (!this.scene.hero.inv.consume({ [id]: 1 })) return null;
    const st = reg.stations.get(id);
    const def = reg.defense.get(id);
    const [fw, fh] = this.footprint(id);
    const x = tx + fw / 2;
    const y = ty + fh;
    const w = this.scene.world;
    let o: WorldObject;
    if (st) {
      o = w.placeObject({
        ref: { type: 'station', id },
        kind: 'station',
        sprite: st.sprite,
        x,
        y,
        biome: w.layout.biomeAt(x, y),
      });
    } else {
      const init = initDefense(def!);
      const solid = reg.build.defense.solid.includes(id);
      o = w.placeObject({
        ref: { type: 'defense', id },
        kind: solid ? 'defense' : 'trap',
        sprite: def!.sprite,
        x,
        y: ty + 0.85,
        biome: w.layout.biomeAt(x, y),
      });
      o.hp = init.hp;
      o.data = init.data;
      void effectOf;
    }
    this.scene.onObjectPlaced(o);
    return o;
  }

  private disassemble(slot: BuildSlot): void {
    const reg = registry();
    const obj = slot.side === 'c' ? this.objectAt(slot.tx, slot.ty) : null;
    if (obj) {
      this.scene.disassembleObject(obj);
      return;
    }
    const d = disassembleSlot(reg, this.scene.world, slot);
    if (!d) return;
    this.scene.world.setBuilt(slot.tx, slot.ty, d.cell);
    for (const [id, n] of Object.entries(d.refund)) this.scene.give({ id, count: n });
    this.undoStack = null;
    this.scene.onBuilt([slot], 'disassemble');
  }

  /** Отмена последнего действия в течение undoSec — ресурсы возвращаются полностью. */
  undo(): void {
    const u = this.undoStack;
    const reg = registry();
    if (!u || this.scene.time.now - u.at > reg.build.undoSec * 1000) {
      this.toast(t('build.undo_none'));
      return;
    }
    this.undoStack = null;
    // С конца: несколько мест в одной клетке восстанавливаются до самого первого состояния.
    for (const c of [...u.cells].reverse()) this.scene.world.setBuilt(c.tx, c.ty, c.before);
    for (const o of u.objects) this.scene.removePlaced(o);
    for (const [id, n] of Object.entries(u.paid)) this.scene.give({ id, count: n });
    for (const id of u.items) this.scene.give({ id, count: 1 });
    this.scene.onBuilt(
      u.cells.map((c) => ({ tx: c.tx, ty: c.ty, side: 'c' as const })),
      'undo',
    );
    this.toast(t('build.undone'));
  }

  get canUndo(): boolean {
    const u = this.undoStack;
    return !!u && this.scene.time.now - u.at <= registry().build.undoSec * 1000;
  }
}
