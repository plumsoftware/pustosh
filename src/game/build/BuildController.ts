import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import type { ItemSet } from '../../core/inventory/Inventory';
import { consumeFrom, missingFor } from '../../core/systems/Craft';
import { effectOf, initDefense } from '../../core/systems/Defense';
import {
  canBuild,
  disassembleCell,
  lineCells,
  pieceCost,
  placePiece,
  repairCell,
  requirementMet,
  upgradeCell,
  type BuildCell,
  type BuildPiece,
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

/**
 * Режим строительства в мире (TZ 7.3): призрак детали под курсором/пальцем на сетке, зелёный/красный,
 * протяжка ставит линию; инструменты молотка: улучшить, починить, разобрать (удержание 1 с); отмена.
 */
export class BuildController {
  active = false;
  sel: BuildSel = { kind: 'piece', piece: 'wall', mat: 0 };
  /** Клетка под курсором и линия протяжки. */
  private cursor: { tx: number; ty: number } | null = null;
  private dragFrom: { tx: number; ty: number } | null = null;
  private ghosts: Phaser.GameObjects.Image[] = [];
  private toolBox: Phaser.GameObjects.Graphics;
  private ring: Phaser.GameObjects.Graphics;
  private undoStack: UndoEntry | null = null;
  private hold: { t: number; tx: number; ty: number } | null = null;
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

  private cellOf(p: Phaser.Input.Pointer): { tx: number; ty: number } | null {
    if (p.y >= this.blockRect.y) return null;
    // Левая половина на телефоне — стик.
    if (this.touch && p.x < this.scene.scale.width * 0.45) return null;
    const w = p.positionToCamera(this.scene.cameras.main) as Phaser.Math.Vector2;
    return { tx: Math.floor(w.x / TILE), ty: Math.floor(w.y / TILE) };
  }

  private down(p: Phaser.Input.Pointer): void {
    if (!this.active) return;
    const c = this.cellOf(p);
    if (!c) return;
    this.cursor = c;
    if (this.sel.kind === 'piece' && this.sel.piece !== 'door') this.dragFrom = c;
    if (!this.touch && this.sel.kind === 'tool' && this.sel.tool === 'disassemble') this.beginHold();
  }

  private move(p: Phaser.Input.Pointer): void {
    if (!this.active) return;
    const c = this.cellOf(p);
    if (c) this.cursor = c;
  }

  private up(p: Phaser.Input.Pointer): void {
    if (!this.active) return;
    if (this.cellOf(p) === null && !this.dragFrom) return;
    // ПК: клик/протяжка ставит сразу; телефон — подтверждение кнопкой ✓.
    if (!this.touch) {
      if (this.sel.kind === 'tool' && this.sel.tool === 'disassemble') this.endHold();
      else this.confirm();
      this.dragFrom = null;
    }
  }

  /** Клетка по умолчанию: перед героем (телефон без касания, клавиатура). */
  private target(): { tx: number; ty: number } {
    if (this.cursor) return this.cursor;
    const h = this.scene.hero;
    return { tx: Math.floor(h.pos.x + h.move.faceX * 1.5), ty: Math.floor(h.pos.y + h.move.faceY * 1.5) };
  }

  /** Клетки текущего действия: линия протяжки или одна клетка. */
  private cells(): [number, number][] {
    const c = this.target();
    if (this.sel.kind === 'piece' && this.dragFrom && this.sel.piece !== 'door')
      return lineCells(this.dragFrom.tx, this.dragFrom.ty, c.tx, c.ty, registry().build.lineMaxCells);
    return [[c.tx, c.ty]];
  }

  // ------------------------------------------------------------------ проверки

  private creatureAt = (tx: number, ty: number): boolean => {
    const h = this.scene.hero;
    const r = 0.25;
    const hit = (x: number, y: number, rr: number) =>
      x + rr > tx && x - rr < tx + 1 && y + rr > ty && y - rr < ty + 1;
    return hit(h.pos.x, h.pos.y, r) || this.scene.dummies.some((d) => d.hp > 0 && hit(d.x, d.y, d.r));
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

  /** Цена и проверка для призрака: текст для панели. */
  private evaluate(): { ok: boolean[]; cost: ItemSet; why: string } {
    const reg = registry();
    const cells = this.cells();
    const sel = this.sel;
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
      const ok = cells.map(([x, y]) => canBuild(this.scene.world, sel.piece, x, y, this.creatureAt) === null);
      const n = ok.filter(Boolean).length;
      const cost: Record<string, number> = {};
      for (const [id, k] of Object.entries(one)) cost[id] = k * Math.max(1, n);
      let why = '';
      if (sel.piece !== 'door' && !requirementMet(reg, m, this.hasItem, this.stationNear))
        why = t('build.need', {
          what: reg.items.get(m.requires)?.name_ru ?? reg.stations.get(m.requires)?.name_ru ?? m.requires,
        });
      else if (Object.keys(missingFor(this.sources(), cost)).length) why = t('build.no_res');
      return { ok, cost, why };
    }
    if (sel.kind === 'object') {
      const fp = this.footprint(sel.id);
      const [x, y] = cells[0]!;
      let free = true;
      for (let yy = 0; yy < fp[1]; yy++)
        for (let xx = 0; xx < fp[0]; xx++)
          if (canBuild(this.scene.world, 'wall', x + xx, y + yy, this.creatureAt) !== null) free = false;
      let why = this.hasItem(sel.id) ? '' : t('build.no_item');
      if (!why && sel.id === 'base_core' && this.scene.baseCore()) why = t('build.one_core');
      if (!why && sel.id === 'outpost_beacon' && this.scene.outposts().length >= reg.build.base.maxOutposts)
        why = t('build.max_outposts', { n: reg.build.base.maxOutposts });
      return { ok: [free], cost: {}, why };
    }
    // Инструменты молотка: по стене игрока.
    const [x, y] = cells[0]!;
    const b = this.scene.world.builtAt(x, y);
    if (!this.hasHammer()) return { ok: [false], cost: {}, why: t('build.need_hammer') };
    if (!b) return { ok: [false], cost: {}, why: t('build.not_built') };
    if (sel.tool === 'upgrade') {
      const u = upgradeCell(reg, b);
      if (!u) return { ok: [false], cost: {}, why: t('build.max_level') };
      const m = reg.building.materials[u.cell.wall!]!;
      const why = !requirementMet(reg, m, this.hasItem, this.stationNear)
        ? t('build.need', {
            what: reg.items.get(m.requires)?.name_ru ?? reg.stations.get(m.requires)?.name_ru ?? m.requires,
          })
        : Object.keys(missingFor(this.sources(), u.cost)).length
          ? t('build.no_res')
          : '';
      return { ok: [true], cost: u.cost, why };
    }
    if (sel.tool === 'repair') {
      const r = repairCell(reg, b);
      if (!r) return { ok: [false], cost: {}, why: t('build.full_hp') };
      return {
        ok: [true],
        cost: r.cost,
        why: Object.keys(missingFor(this.sources(), r.cost)).length ? t('build.no_res') : '',
      };
    }
    const d = disassembleCell(reg, b);
    return { ok: [!!d], cost: {}, why: d ? '' : t('build.not_built') };
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
    const key = `${JSON.stringify(this.sel)}|${JSON.stringify(this.cells())}`;
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
      this.toolBox
        .fillStyle(0xff6040, 0.35)
        .fillRect(this.hold.tx * TILE, (this.hold.ty + 1) * TILE - 6, TILE * p, 6);
      if (p >= 1) {
        const h = this.hold;
        this.hold = null;
        this.disassemble(h.tx, h.ty);
      }
    }
  }

  private clearGhosts(): void {
    for (const g of this.ghosts) g.destroy();
    this.ghosts = [];
  }

  private drawGhosts(ok: boolean[], time: number): void {
    const reg = registry();
    const cells = this.cells();
    const sel = this.sel;
    this.toolBox.clear();
    const pulse = 0.55 + 0.2 * Math.sin((time / GHOST_PULSE) * Math.PI * 2);
    if (sel.kind === 'tool') {
      this.clearGhosts();
      const [x, y] = cells[0]!;
      this.toolBox
        .lineStyle(3, ok[0] && this.statusOk ? GHOST_OK : GHOST_BAD, pulse + 0.2)
        .strokeRect(x * TILE, y * TILE, TILE, TILE * 1.75);
      return;
    }
    const sprite =
      sel.kind === 'object'
        ? (reg.stations.get(sel.id)?.sprite ?? reg.defense.get(sel.id)?.sprite ?? '')
        : reg.building.materials[sel.mat]!.sprites[
            sel.piece === 'floor'
              ? 'floor'
              : sel.piece === 'door'
                ? 'door'
                : sel.piece === 'fence'
                  ? 'fence'
                  : 'top_cap'
          ];
    const need = sel.kind === 'object' ? 1 : cells.length;
    if (this.ghosts.length !== need || this.ghosts[0]?.getData('id') !== sprite) {
      this.clearGhosts();
      if (!getAssetInfo(sprite)) return;
      for (let i = 0; i < need; i++)
        this.ghosts.push(
          spawnSprite(this.scene, 0, 0, sprite, { depth: DEPTH.debug - 3 }).setData('id', sprite),
        );
    }
    cells.slice(0, need).forEach(([x, y], i) => {
      const g = this.ghosts[i]!;
      const good = ok[i] && this.statusOk;
      g.setTint(good ? GHOST_OK : GHOST_BAD).setAlpha(pulse);
      if (sel.kind === 'object') {
        const [fw, fh] = this.footprint(sel.id);
        g.setPosition((x + fw / 2) * TILE, (y + fh) * TILE);
      } else if (sel.piece === 'door') g.setPosition(x * TILE, (y + 1) * TILE);
      else g.setPosition(x * TILE, y * TILE);
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
    const [x, y] = this.cells()[0]!;
    const ev = this.evaluate();
    const obj = this.objectAt(x, y);
    if (!ev.ok[0] && !obj) {
      this.toast(ev.why);
      return;
    }
    this.hold = { t: 0, tx: x, ty: y };
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
    const cells = this.cells();
    if (sel.kind === 'piece') {
      const okCells = cells.filter((_, i) => ev.ok[i]);
      if (okCells.length === 0) {
        this.toast(t('place.bad'));
        return;
      }
      if (!consumeFrom(this.sources(), ev.cost)) {
        this.toast(t('build.no_res'));
        return;
      }
      const undo: UndoEntry = { at: this.scene.time.now, cells: [], objects: [], paid: ev.cost, items: [] };
      for (const [x, y] of okCells) {
        const before = this.scene.world.builtAt(x, y);
        undo.cells.push({ tx: x, ty: y, before });
        this.scene.world.setBuilt(x, y, placePiece(reg, before, sel.piece, sel.mat));
      }
      this.undoStack = undo;
      this.scene.onBuilt(okCells, 'place');
      this.dragFrom = null;
      return;
    }
    if (sel.kind === 'object') {
      if (!ev.ok[0]) {
        this.toast(t('place.bad'));
        return;
      }
      const [x, y] = cells[0]!;
      const o = this.placeObject(sel.id, x, y);
      if (!o) return;
      this.undoStack = { at: this.scene.time.now, cells: [], objects: [o], paid: {}, items: [sel.id] };
      return;
    }
    const [x, y] = cells[0]!;
    const b = this.scene.world.builtAt(x, y)!;
    const r = sel.tool === 'upgrade' ? upgradeCell(reg, b) : repairCell(reg, b);
    if (!r || !consumeFrom(this.sources(), r.cost)) return;
    this.scene.world.setBuilt(x, y, r.cell);
    this.undoStack = {
      at: this.scene.time.now,
      cells: [{ tx: x, ty: y, before: b }],
      objects: [],
      paid: r.cost,
      items: [],
    };
    this.scene.onBuilt([[x, y]], sel.tool);
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

  private disassemble(tx: number, ty: number): void {
    const reg = registry();
    const obj = this.objectAt(tx, ty);
    if (obj) {
      this.scene.disassembleObject(obj);
      return;
    }
    const b = this.scene.world.builtAt(tx, ty);
    const d = b ? disassembleCell(reg, b) : null;
    if (!b || !d) return;
    this.scene.world.setBuilt(tx, ty, d.cell);
    for (const [id, n] of Object.entries(d.refund)) this.scene.give({ id, count: n });
    this.undoStack = null;
    this.scene.onBuilt([[tx, ty]], 'disassemble');
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
    for (const c of u.cells) this.scene.world.setBuilt(c.tx, c.ty, c.before);
    for (const o of u.objects) this.scene.removePlaced(o);
    for (const [id, n] of Object.entries(u.paid)) this.scene.give({ id, count: n });
    for (const id of u.items) this.scene.give({ id, count: 1 });
    this.scene.onBuilt(
      u.cells.map((c) => [c.tx, c.ty]),
      'undo',
    );
    this.toast(t('build.undone'));
  }

  get canUndo(): boolean {
    const u = this.undoStack;
    return !!u && this.scene.time.now - u.at <= registry().build.undoSec * 1000;
  }
}
