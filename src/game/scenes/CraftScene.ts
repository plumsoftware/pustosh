import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import type { RecipeDef } from '../../core/data/schemas';
import {
  consumeFrom,
  disassembleReturn,
  fuelValue,
  HANDS,
  hasSkill,
  inputsOf,
  isKnown,
  maxCraftable,
  needsFuel,
  noticeItems,
  recipeStatus,
  requiredSkill,
  skillLevelNeeded,
  totalCount,
  whereToGet,
  type CraftSource,
  type RecipeStatus,
  type StationState,
} from '../../core/systems/Craft';
import type { WorldObject } from '../../core/world';
import { AdsController } from '../AdsController';
import { getAssetInfo } from '../assets/AssetIndex';
import { spawnSprite } from '../assets/spawnSprite';
import { registry } from '../GameContext';
import { SceneKeys } from '../SceneKeys';
import { UI_FONT } from '../ui/BitmapFont';
import { chip as styledChip } from '../ui/Styled';
import { rowFrame } from '../ui/Styled';
import { panel as stylePanel } from '../ui/Styled';
import { Button } from '../ui/Button';
import { promptText } from '../ui/Dialogs';
import { COLORS, FONT, TEXT_RES, uiScale } from '../ui/layout';
import { rarityColor, raritySlot } from '../world/rarity';
import { TOAST, type WorldScene } from './WorldScene';

/** Открытие панели (ANIMATIONS §11). */
const PANEL_MS = 180;
/** Порог прокрутки списка пальцем, px. */
const SCROLL_THRESHOLD = 8;
/** «Макс» руками — не больше стольких заданий за раз. */
const HANDS_MAX_BATCH = 10;
const RED = '#e05a4a';
const GREEN = '#8fd46a';

export interface CraftData {
  /** Станок, у которого открыли книгу (его вкладка и панель очереди). */
  station: WorldObject | null;
}

type Filter = { ready: boolean; cat: string | null; search: string };

/**
 * Книга крафтов (TZ 6.4): вкладки «Руки» + увиденные станки, фильтры, рецепты в трёх состояниях,
 * «где добыть» по тапу на недостающий ресурс; у станка — очередь, выход, топливо, реклама instant_craft.
 * Мир не на паузе: станки и крафт руками идут, пока окно открыто (ввод героя выключен).
 */
export class CraftScene extends Phaser.Scene {
  private station: WorldObject | null = null;
  private tab = HANDS;
  private filter: Filter = { ready: false, cat: null, search: '' };
  private selected: string | null = null;
  private k = 1;
  private root!: Phaser.GameObjects.Container;
  private list!: Phaser.GameObjects.Container;
  private details!: Phaser.GameObjects.Container;
  private stationBox!: Phaser.GameObjects.Container;
  private popup!: Phaser.GameObjects.Container;
  private listArea = { x: 0, y: 0, w: 0, h: 0 };
  private scrollY = 0;
  private contentH = 0;
  private drag: { y: number; scroll: number; moved: boolean } | null = null;
  private stationSig = '';
  private detailsSig = '';

  constructor() {
    super(SceneKeys.Craft);
  }

  private get world(): WorldScene {
    return this.scene.get(SceneKeys.World) as WorldScene;
  }

  init(data: CraftData): void {
    this.station = data.station ?? null;
    this.tab = this.station?.ref.id ?? HANDS;
    if (this.station && registry().recipes.byStation(this.tab).length === 0) this.tab = HANDS;
    this.selected = null;
    this.scrollY = 0;
  }

  create(): void {
    this.world.controls.clear();
    this.world.controls.enabled = false;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.world.controls.clear();
      this.world.controls.enabled = true;
    });
    this.k = uiScale(this);
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x000000, 0.55).setOrigin(0).setInteractive();
    this.root = this.add.container(0, 0);
    this.list = this.add.container(0, 0).setDepth(2);
    this.details = this.add.container(0, 0).setDepth(3);
    this.stationBox = this.add.container(0, 0).setDepth(3);
    this.popup = this.add.container(0, 0).setDepth(30);
    this.build();
    for (const c of [this.root, this.list, this.details, this.stationBox]) {
      c.setScale(0.9)
        .setAlpha(0)
        .setPosition(width * 0.05, height * 0.05);
      this.tweens.add({ targets: c, scale: 1, alpha: 1, x: 0, y: 0, duration: PANEL_MS, ease: 'Quad.Out' });
    }
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyC' || e.code === 'Tab') {
        e.preventDefault();
        this.close();
      }
    });
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, (_p: unknown, _o: unknown, _dx: number, dy: number) =>
      this.scrollTo(this.scrollY + dy),
    );
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      const a = this.listArea;
      if (p.x >= a.x && p.x <= a.x + a.w && p.y >= a.y && p.y <= a.y + a.h)
        this.drag = { y: p.y, scroll: this.scrollY, moved: false };
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      const d = this.drag;
      if (!d || !p.isDown) return;
      if (Math.abs(p.y - d.y) > SCROLL_THRESHOLD) d.moved = true;
      if (d.moved) this.scrollTo(d.scroll - (p.y - d.y));
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, () => {
      // Отпускание после прокрутки не должно выбирать рецепт — флаг живёт до конца кадра.
      this.time.delayedCall(0, () => (this.drag = null));
    });
  }

  close(): void {
    for (const c of [this.root, this.list, this.details, this.stationBox])
      this.tweens.add({ targets: c, scale: 0.9, alpha: 0, duration: PANEL_MS });
    this.popup.removeAll(true);
    this.time.delayedCall(PANEL_MS, () => this.scene.stop());
  }

  private toast(text: string): void {
    this.world.game.events.emit(TOAST, text);
  }

  // ------------------------------------------------------------------ данные

  private get stationState(): StationState | null {
    return this.station ? (this.world.stations.get(this.station.uid) ?? null) : null;
  }

  /** Станок вкладки рядом: открыт у него или он в радиусе stationOpenRadiusTiles от героя. */
  private stationObjFor(tab: string): WorldObject | null {
    if (tab === HANDS) return null;
    if (this.station?.ref.id === tab) return this.station;
    const reg = registry();
    const { x, y } = this.world.hero.pos;
    return (
      this.world
        .objectsNear(x, y, reg.craft.stationOpenRadiusTiles)
        .find((o) => o.ref.type === 'station' && o.ref.id === tab) ?? null
    );
  }

  private sources(): CraftSource[] {
    const o = this.stationObjFor(this.tab);
    return this.world.craftSources(o ? { x: o.x, y: o.y } : null);
  }

  /** Вкладки: руки + станки, которые игрок видел (поставил, открывал) и текущий. */
  private tabs(): string[] {
    const reg = registry();
    const seen = new Set<string>();
    for (const s of this.world.stations.all) seen.add(s.id);
    for (const id of this.world.seenStations) seen.add(id);
    if (this.station) seen.add(this.station.ref.id);
    return [
      HANDS,
      ...reg.stations.all
        .map((s) => s.id)
        .filter((id) => seen.has(id) && reg.recipes.byStation(id).length > 0),
    ];
  }

  private recipes(): RecipeDef[] {
    const reg = registry();
    const src = this.sources();
    const q = this.filter.search.trim().toLowerCase();
    const cats = this.filter.cat ? (reg.craft.categories[this.filter.cat] ?? []) : null;
    const order: Record<RecipeStatus, number> = { ready: 0, missing: 1, skill: 2, unknown: 3 };
    return reg.recipes
      .byStation(this.tab)
      .filter((r) => {
        const item = reg.items.get(r.output);
        if (cats && !cats.includes(item?.category ?? '')) return false;
        if (q && !(item?.name_ru ?? '').toLowerCase().includes(q)) return false;
        if (this.filter.ready && this.status(r, src) !== 'ready') return false;
        return true;
      })
      .map((r) => ({ r, s: order[this.status(r, src)], tier: reg.items.get(r.output)?.tier ?? 0 }))
      .sort((a, b) => a.s - b.s || a.tier - b.tier)
      .map((x) => x.r);
  }

  private status(r: RecipeDef, src: CraftSource[]): RecipeStatus {
    return recipeStatus(registry(), r, this.world.known, this.world.skills, src);
  }

  // ------------------------------------------------------------------ разметка

  private build(): void {
    this.root.removeAll(true);
    const reg = registry();
    const { width, height } = this.scale;
    const k = this.k;
    const pw = Math.min(width - 20, 1180 * k);
    const ph = height - 20;
    const px = (width - pw) / 2;
    const py = 10;
    this.root.add(stylePanel(this, px + pw / 2, py + ph / 2, pw, ph));
    const close = spawnSprite(this, px + pw - 28 * k, py + 28 * k, 'ui.btn_close', { depth: false });
    close
      .setScale((38 * k) / Math.max(close.frame.width, close.frame.height))
      .setInteractive({ useHandCursor: true });
    close.on('pointerup', () => this.close());
    this.root.add(close);

    // Вкладки: иконка станка (уменьшенный спрайт), выбранная — в рамке.
    const tabSize = Math.round(Math.max(46 * k, 44));
    let tx = px + 18 * k;
    const ty = py + 16 * k;
    for (const id of this.tabs()) {
      const st = reg.stations.require(id);
      const bg = spawnSprite(
        this,
        tx + tabSize / 2,
        ty + tabSize / 2,
        id === this.tab ? 'ui.slot_selected' : 'ui.slot',
        {
          depth: false,
        },
      )
        .setDisplaySize(tabSize, tabSize)
        .setInteractive({ useHandCursor: true });
      bg.on('pointerup', () => {
        this.tab = id;
        this.selected = null;
        this.scrollY = 0;
        this.build();
      });
      const ic = spawnSprite(this, tx + tabSize / 2, ty + tabSize / 2, st.sprite, { depth: false }).setOrigin(
        0.5,
      );
      ic.setScale((tabSize * 0.72) / Math.max(ic.frame.width, ic.frame.height));
      this.root.add([bg, ic]);
      tx += tabSize + 6 * k;
    }
    const tabName = reg.stations.get(this.tab)?.name_ru ?? '';
    this.root.add(
      this.add
        .text(tx + 8 * k, ty + tabSize / 2, this.tab === HANDS ? t('craft.hands') : tabName, {
          fontFamily: FONT,
          resolution: TEXT_RES,
          fontSize: `${Math.round(18 * k + 2)}px`,
          color: COLORS.text,
          fontStyle: '700',
        })
        .setOrigin(0, 0.5),
    );

    // Фильтры: «Можно сделать», категории, поиск.
    let fy = ty + tabSize + 8 * k;
    const fh = Math.round(Math.max(28 * k, 26));
    const fx0 = px + 18 * k;
    const fxMax = px + pw - 18 * k;
    let fx = fx0;
    // Вкладки не влезают в строку — перенос на следующую.
    const chip = (label: string, on: boolean, fn: () => void) => {
      let c = styledChip(this, fx, fy, label, on, fh, fn);
      if (fx > fx0 && fx + c.width > fxMax) {
        for (const o of c.objs) o.destroy();
        fx = fx0;
        fy += fh + 4 * k;
        c = styledChip(this, fx, fy, label, on, fh, fn);
      }
      this.root.add(c.objs);
      fx += c.width + 4 * k;
    };
    chip(t('craft.filter.ready'), this.filter.ready, () => {
      this.filter.ready = !this.filter.ready;
      this.build();
    });
    chip(t('craft.filter.all'), this.filter.cat === null, () => {
      this.filter.cat = null;
      this.build();
    });
    const present = new Set<string>(
      reg.recipes.byStation(this.tab).map((r) => reg.items.get(r.output)?.category ?? ''),
    );
    for (const [cat, list] of Object.entries(reg.craft.categories)) {
      if (!list.some((c) => present.has(c))) continue;
      chip(t(`craft.cat.${cat}`), this.filter.cat === cat, () => {
        this.filter.cat = this.filter.cat === cat ? null : cat;
        this.build();
      });
    }
    chip(
      this.filter.search ? `🔍 ${this.filter.search}` : t('craft.search'),
      !!this.filter.search,
      () => void this.askSearch(),
    );

    // Тело: слева — рецепты, справа — карточка и панель станка.
    const by = fy + fh + 10 * k;
    const bh = py + ph - by - 14 * k;
    const lw = Math.round(pw * 0.5);
    this.listArea = { x: px + 18 * k, y: by, w: lw - 24 * k, h: bh };
    const rx = px + lw + 4 * k;
    const rw = pw - lw - 22 * k;
    this.root.add(this.add.rectangle(rx, by, rw, bh, 0x15120f, 0.55).setOrigin(0));
    this.buildList();
    this.detailsArea = { x: rx, y: by, w: rw, h: bh };
    this.stationSig = '';
    this.detailsSig = '';
    this.renderRight();
  }

  private detailsArea = { x: 0, y: 0, w: 0, h: 0 };

  private async askSearch(): Promise<void> {
    const v = await promptText(this.game, {
      title: t('craft.search.prompt'),
      value: this.filter.search,
      maxLength: 24,
      validate: () => Promise.resolve(null),
    });
    if (v === null) return;
    this.filter.search = v;
    this.scrollY = 0;
    this.build();
  }

  private buildList(): void {
    this.list.removeAll(true);
    const reg = registry();
    const a = this.listArea;
    const k = this.k;
    // Ячейки рецептов не меньше 64 px (на телефоне k ≈ 0.75 — было 40).
    const cell = Math.round(Math.max(54 * k, 64));
    const gap = Math.round(6 * k);
    const cols = Math.max(3, Math.floor((a.w + gap) / (cell + gap)));
    const src = this.sources();
    const recipes = this.recipes();
    const mask = this.make.graphics({}, false).fillRect(a.x, a.y, a.w, a.h).createGeometryMask();
    this.list.setMask(mask);
    recipes.forEach((r, i) => {
      const cx = a.x + (i % cols) * (cell + gap) + cell / 2;
      const cy = a.y + Math.floor(i / cols) * (cell + gap) + cell / 2;
      const status = this.status(r, src);
      const def = reg.items.get(r.output);
      const tier = def?.tier ?? 0;
      const bg = spawnSprite(this, cx, cy, status === 'unknown' ? 'ui.slot' : raritySlot(tier), {
        depth: false,
      })
        .setDisplaySize(cell, cell)
        .setInteractive({ useHandCursor: true });
      bg.on('pointerup', () => {
        if (this.drag?.moved) return;
        this.selected = r.id;
        this.detailsSig = '';
        this.buildList();
        this.renderRight();
      });
      this.list.add(bg);
      if (r.id === this.selected)
        this.list.add(
          spawnSprite(this, cx, cy, 'ui.slot_selected', { depth: false }).setDisplaySize(cell, cell),
        );
      if (def) {
        const ic = spawnSprite(this, cx, cy, def.icon, { depth: false }).setOrigin(0.5);
        ic.setScale((cell * 0.74) / Math.max(ic.frame.width, ic.frame.height));
        // Неизвестен — силуэт; не хватает — приглушён; навык — замок.
        if (status === 'unknown') ic.setTintFill(0x0d0b09).setAlpha(0.85);
        else if (status !== 'ready') ic.setAlpha(0.5);
        this.list.add(ic);
      }
      if (status === 'skill') this.list.add(this.lock(cx + cell * 0.22, cy - cell * 0.22, cell * 0.28));
      if (status === 'ready')
        this.list.add(
          this.add.circle(cx + cell * 0.32, cy - cell * 0.32, 4 * k, 0x8fd46a).setStrokeStyle(1, 0x000000),
        );
      if (r.count > 1 && status !== 'unknown')
        this.list.add(
          this.add
            .bitmapText(cx + cell / 2 - 4, cy + cell / 2 - 2, UI_FONT, `×${r.count}`, Math.round(11 * k + 3))
            .setOrigin(1, 1),
        );
    });
    this.contentH = Math.ceil(recipes.length / cols) * (cell + gap);
    this.scrollTo(this.scrollY);
  }

  /** Замок на рецепте, закрытом навыком (`ui/icon_lock`; без атласа — кодом). */
  private lock(x: number, y: number, s: number): Phaser.GameObjects.GameObject {
    if (getAssetInfo('ui.icon_lock')) {
      const icon = spawnSprite(this, x, y, 'ui.icon_lock', { depth: false });
      return icon.setScale((s * 1.1) / Math.max(icon.frame.width, icon.frame.height));
    }
    const g = this.add.graphics();
    g.lineStyle(Math.max(2, s * 0.14), 0xe0c060, 1).beginPath();
    g.arc(x, y - s * 0.12, s * 0.28, Math.PI, 0);
    g.strokePath();
    g.fillStyle(0xe0c060, 1).fillRoundedRect(x - s * 0.4, y - s * 0.12, s * 0.8, s * 0.6, 2);
    g.fillStyle(0x3a2a10, 1).fillCircle(x, y + s * 0.16, s * 0.08);
    return g;
  }

  private scrollTo(y: number): void {
    const max = Math.max(0, this.contentH - this.listArea.h);
    this.scrollY = Phaser.Math.Clamp(y, 0, max);
    // Маска не входит в контейнер и остаётся на месте — список едет под ней.
    this.list.y = -this.scrollY;
  }

  // ------------------------------------------------------------------ правая колонка

  /** Карточка рецепта и панель станка; перерисовка только при изменении данных. */
  private renderRight(): void {
    const area = this.detailsArea;
    const st = this.stationState;
    // Очередь рук видна на вкладке «Руки», пока в ней что-то есть (иначе непонятно, почему делается не то).
    const hands = this.tab === HANDS && this.world.stations.hands.length > 0;
    const stationH = (st && this.station) || hands ? Math.min(area.h * 0.5, 150 * this.k) : 0;
    const dSig = this.detailsSignature();
    if (dSig !== this.detailsSig) {
      this.detailsSig = dSig;
      this.renderDetails(area.x, area.y, area.w, area.h - stationH);
    }
    if (st && this.station) {
      const sSig = this.stationSignature(st);
      if (sSig !== this.stationSig) {
        this.stationSig = sSig;
        this.renderStation(st, area.x, area.y + area.h - stationH, area.w, stationH);
      }
    } else if (hands) {
      const hSig = this.handsSignature();
      if (hSig !== this.stationSig) {
        this.stationSig = hSig;
        this.renderHands(area.x, area.y + area.h - stationH, area.w, stationH);
      }
    } else if (this.stationBox.length) {
      this.stationBox.removeAll(true);
      this.stationSig = '';
      this.detailsSig = '';
    }
  }

  private detailsSignature(): string {
    const r = this.selected ? registry().recipes.get(this.selected) : undefined;
    if (!r) return 'none';
    const src = this.sources();
    return [r.id, this.status(r, src), ...Object.keys(r.inputs).map((id) => totalCount(src, id))].join('|');
  }

  private handsSignature(): string {
    const q = this.world.stations.hands;
    const head = q[0];
    return [
      'hands',
      q.map((j) => j.recipe).join(','),
      head ? Math.floor((1 - head.left / head.total) * 40) : -1,
    ].join('|');
  }

  /** Очередь крафта руками: задания по порядку, у первого — прогресс; тап по заданию — отменить. */
  private renderHands(x: number, y: number, w: number, h: number): void {
    this.stationBox.removeAll(true);
    const reg = registry();
    const k = this.k;
    const pad = 8 * k;
    const q = this.world.stations.hands;
    this.stationBox.add(rowFrame(this, x, y, w, h).setOrigin(0));
    const cell = Math.round(Math.max(34 * k, 44));
    const label = this.text(
      x + pad,
      y + pad,
      t('craft.hands_queue', { n: q.length }),
      11,
      COLORS.textDim,
      w - 2 * pad,
    );
    this.stationBox.add(label);
    const cy = y + pad + label.height + 2;
    const fit = Math.max(1, Math.floor((w - 2 * pad) / (cell + 4 * k)));
    q.slice(0, fit).forEach((j, i) => {
      const cx = x + pad + cell / 2 + i * (cell + 4 * k);
      const bg = spawnSprite(this, cx, cy + cell / 2, 'ui.slot', { depth: false })
        .setDisplaySize(cell, cell)
        .setInteractive({ useHandCursor: true });
      bg.on('pointerup', () => this.cancelHands(i));
      this.stationBox.add(bg);
      const r = reg.recipes.get(j.recipe);
      const def = r ? reg.items.get(r.output) : undefined;
      if (i === 0)
        this.stationBox.add(
          this.add
            .rectangle(cx - cell / 2 + 3, cy + cell - 3, (cell - 6) * (1 - j.left / j.total), 4 * k, 0x7ed957)
            .setOrigin(0, 1),
        );
      if (def) {
        const ic = spawnSprite(this, cx, cy + cell / 2, def.icon, { depth: false }).setOrigin(0.5);
        ic.setScale((cell * 0.7) / Math.max(ic.frame.width, ic.frame.height)).setAlpha(i === 0 ? 1 : 0.6);
        this.stationBox.add(ic);
      }
      // Крестик отмены в углу.
      this.stationBox.add(
        this.add
          .bitmapText(cx + cell / 2 - 3, cy + 2, UI_FONT, '×', Math.round(12 * k + 4))
          .setOrigin(1, 0)
          .setTint(0xff7060),
      );
    });
    if (q.length > fit)
      this.stationBox.add(this.text(x + pad, cy + cell + 4 * k, `+${q.length - fit}`, 11, COLORS.textDim));
    this.stationBox.add(
      this.text(x + pad, y + h - pad - 14 * k, t('craft.hands_cancel'), 10, COLORS.textDim, w - 2 * pad),
    );
  }

  /** Отменить задание рук: ингредиенты — обратно в рюкзак (не влезло — на землю). */
  private cancelHands(i: number): void {
    const r = this.world.stations.cancelJob(this.world.stations.hands, i);
    if (!r) return;
    for (const [id, n] of Object.entries(inputsOf(r))) this.world.give({ id, count: n });
    this.toast(t('craft.cancelled', { name: registry().items.get(r.output)?.name_ru ?? r.output }));
    this.stationSig = '';
    this.detailsSig = '';
    this.buildList();
    this.renderRight();
  }

  private stationSignature(s: StationState): string {
    const head = s.queue[0];
    return [
      s.queue.map((j) => j.recipe).join(','),
      head ? Math.floor((1 - head.left / head.total) * 40) : -1,
      s.output.map((o) => `${o.id}:${o.count}`).join(','),
      s.fuel ? `${s.fuel.id}:${s.fuel.count}` : '-',
      Math.ceil(s.burnLeft),
      this.world.stations.blockedBy(s) ?? '',
    ].join('|');
  }

  private text(
    x: number,
    y: number,
    s: string,
    size: number,
    color = COLORS.text,
    wrap?: number,
    bold = false,
  ) {
    return this.add.text(x, y, s, {
      fontFamily: FONT,
      resolution: TEXT_RES,
      // Текст описания крупнее на телефоне: не меньше size + 2 px.
      fontSize: `${Math.round(Math.max(size * this.k + 2, size + 2))}px`,
      color,
      fontStyle: bold ? '700' : '400',
      wordWrap: wrap ? { width: wrap } : undefined,
    });
  }

  private renderDetails(x: number, y: number, w: number, h: number): void {
    this.details.removeAll(true);
    const reg = registry();
    const k = this.k;
    const r = this.selected ? reg.recipes.get(this.selected) : undefined;
    const pad = 10 * k;
    if (!r) {
      this.details.add(this.text(x + pad, y + pad, t('craft.title'), 14, COLORS.textDim, w - 2 * pad));
      return;
    }
    const def = reg.items.get(r.output);
    const src = this.sources();
    const status = this.status(r, src);
    const known = isKnown(reg, r, this.world.known);
    const icon = Math.round(44 * k);
    if (def) {
      const bg = spawnSprite(this, x + pad + icon / 2, y + pad + icon / 2, raritySlot(def.tier), {
        depth: false,
      }).setDisplaySize(icon, icon);
      const ic = spawnSprite(this, bg.x, bg.y, def.icon, { depth: false }).setOrigin(0.5);
      ic.setScale((icon * 0.76) / Math.max(ic.frame.width, ic.frame.height));
      if (!known) ic.setTintFill(0x0d0b09);
      this.details.add([bg, ic]);
    }
    const tx = x + pad * 2 + icon;
    const name = known ? (def?.name_ru ?? r.output) : t('craft.unknown');
    const color = known && def ? '#' + rarityColor(def.tier).toString(16).padStart(6, '0') : COLORS.textDim;
    const title = this.text(tx, y + pad, name, 15, color, w - (tx - x) - pad, true);
    const sub = this.text(
      tx,
      y + pad + title.height + 2,
      `${r.count > 1 ? `×${r.count} · ` : ''}${t('craft.time', { sec: this.timeLabel(r) })}`,
      12,
      COLORS.textDim,
    );
    this.details.add([title, sub]);
    let cy = y + pad + Math.max(icon, title.height + sub.height + 4) + 6 * k;

    if (status === 'unknown') {
      this.details.add(this.text(x + pad, cy, this.unknownHint(r), 13, COLORS.textDim, w - 2 * pad));
      return;
    }
    const skill = requiredSkill(reg, r);
    if (skill && !hasSkill(reg, this.world.skills, skill)) {
      const g = this.lock(x + pad + 8 * k, cy + 9 * k, 18 * k);
      const s = this.text(
        x + pad + 22 * k,
        cy,
        t('craft.skill', { skill: `${this.skillName(skill)} (${skillLevelNeeded(reg, skill)})` }),
        13,
        '#e0c060',
        w - 2 * pad - 22 * k,
      );
      this.details.add([g, s]);
      cy += s.height + 6 * k;
    }

    // Ингредиенты: есть/нужно, недостающее красным; тап — «где добыть».
    const row = Math.round(Math.max(30 * k, 40));
    const colW = (w - 2 * pad) / 2;
    Object.entries(r.inputs).forEach(([id, need], i) => {
      const have = totalCount(src, id);
      const ix = x + pad + (i % 2) * colW;
      const iy = cy + Math.floor(i / 2) * (row + 4 * k);
      const idef = reg.items.get(id);
      const hit = this.add
        .rectangle(ix, iy, colW - 6 * k, row, 0x000000, 0.2)
        .setOrigin(0)
        .setInteractive({ useHandCursor: true });
      hit.on('pointerup', () => this.showWhere(id));
      this.details.add(hit);
      if (idef) {
        const ic = spawnSprite(this, ix + row / 2, iy + row / 2, idef.icon, { depth: false }).setOrigin(0.5);
        ic.setScale((row * 0.8) / Math.max(ic.frame.width, ic.frame.height));
        this.details.add(ic);
      }
      const label = this.text(
        ix + row + 4 * k,
        iy + row / 2,
        `${t('craft.have_need', { have: Math.min(have, 999), need })} ${idef?.name_ru ?? id}`,
        11,
        have >= need ? GREEN : RED,
        colW - row - 10 * k,
      ).setOrigin(0, 0.5);
      this.details.add(label);
    });
    cy += Math.ceil(Object.keys(r.inputs).length / 2) * (row + 4 * k) + 4 * k;
    if (src.length > 1) this.details.add(this.text(x + pad, cy, t('craft.chests'), 11, COLORS.textDim));

    // Кнопки: Создать, ×5, Макс; без станка рядом — подсказка.
    const bh = Math.round(Math.max(34 * k, 40));
    const byy = y + h - bh / 2 - 8 * k;
    const near = this.tab === HANDS || !!this.stationObjFor(this.tab);
    if (!near) {
      this.details.add(
        this.text(
          x + pad,
          byy - 8 * k,
          t('craft.open_station', { station: reg.stations.get(this.tab)?.name_ru ?? '' }),
          12,
          COLORS.textDim,
          w - 2 * pad,
        ),
      );
      return;
    }
    if (status !== 'ready') return;
    const n = maxCraftable(src, r);
    const bw = (w - 2 * pad - 12 * k) / 3;
    const btn = (i: number, label: string, count: number) => {
      const b = new Button(
        this,
        x + pad + bw / 2 + i * (bw + 6 * k),
        byy,
        label,
        () => this.craft(r, count),
        bw,
        bh,
      );
      if (count < 1) b.setAlpha(0.45).disableInteractive();
      this.details.add(b);
    };
    btn(0, t('craft.make'), 1);
    btn(1, t('craft.make5'), n >= 5 ? 5 : 0);
    btn(2, t('craft.max'), n);
  }

  private timeLabel(r: RecipeDef): string {
    const reg = registry();
    const sec = r.station === HANDS ? Math.min(reg.craft.handsMaxSec, r.timeSec) : r.timeSec;
    return sec >= 60
      ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`
      : String(Math.round(sec));
  }

  private skillName(id: string): string {
    for (const b of registry().skills.branches) for (const s of b.skills) if (s.id === id) return s.name_ru;
    return id;
  }

  /** Подсказка у неизвестного рецепта: чертёж, босс, первый подбор ресурса или обучение. */
  private unknownHint(r: RecipeDef): string {
    const reg = registry();
    const src = reg.craft.locked[r.id];
    if (src === 'blueprint') return t('craft.unknown.blueprint');
    if (src) {
      const boss = reg.bosses.all.find((b) => (b['trophy'] as { item?: string } | undefined)?.item === src);
      return t('craft.unknown.boss', { boss: boss?.name_ru ?? reg.items.get(src)?.name_ru ?? src });
    }
    if (r.unlock === 'tutorial') return t('craft.unknown.tutorial');
    const items = noticeItems(reg, r).map((id) => reg.items.get(id)?.name_ru ?? id);
    return t('craft.unknown.notice', { item: items.join(' / ') });
  }

  /** «Где добыть» (TZ 6.4.3): source предмета, объекты биомов с инструментом и тиром, станок-рецепт. */
  private showWhere(id: string): void {
    const reg = registry();
    const w = whereToGet(reg, id, Math.max(this.world.maxBiome + 1, 2));
    const lines: string[] = [];
    if (w.source) lines.push(w.source);
    for (const o of w.objects.slice(0, 5)) {
      const biome = reg.biomes.get(o.biome)?.name_ru ?? String(o.biome);
      const kind = t(`kind.${o.kind}`);
      const tool = t(`tool.${o.tool}`);
      lines.push(
        o.minTier > 1
          ? t('craft.where.biome_tier', { biome, kind, tool, tier: o.minTier })
          : t('craft.where.biome', { biome, kind, tool }),
      );
    }
    for (const r of w.recipes)
      lines.push(t('craft.where.recipe', { station: reg.stations.get(r.station)?.name_ru ?? r.station }));
    if (lines.length === 0) lines.push(t('craft.where.none'));
    this.popup.removeAll(true);
    const k = this.k;
    const a = this.detailsArea;
    const pw = a.w - 20 * k;
    const title = this.text(
      a.x + 20 * k,
      0,
      t('craft.where', { item: reg.items.get(id)?.name_ru ?? id }),
      14,
      COLORS.text,
      pw - 20 * k,
      true,
    );
    const body = this.text(
      a.x + 20 * k,
      0,
      lines.map((l) => `• ${l}`).join('\n'),
      12,
      COLORS.text,
      pw - 20 * k,
    );
    const ph = title.height + body.height + 30 * k;
    const py = Math.max(10, a.y + 10 * k);
    title.setY(py + 10 * k);
    body.setY(py + 16 * k + title.height);
    const bg = this.add
      .rectangle(a.x + 10 * k, py, pw, ph, 0x1d1a16, 0.97)
      .setOrigin(0)
      .setStrokeStyle(2, 0xc9772b);
    const shade = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0.25)
      .setOrigin(0)
      .setInteractive();
    shade.on('pointerup', () => this.popup.removeAll(true));
    bg.setInteractive().on('pointerup', () => this.popup.removeAll(true));
    this.popup.add([shade, bg, title, body]);
    this.popup.setAlpha(0);
    this.tweens.add({ targets: this.popup, alpha: 1, duration: 120 });
  }

  // ------------------------------------------------------------------ панель станка

  private renderStation(s: StationState, x: number, y: number, w: number, h: number): void {
    this.stationBox.removeAll(true);
    const reg = registry();
    const k = this.k;
    const pad = 8 * k;
    const stations = this.world.stations;
    this.stationBox.add(rowFrame(this, x, y, w, h).setOrigin(0));
    const cell = Math.round(Math.max(34 * k, 44));
    let cy = y + pad;
    // Очередь: первое задание с заливкой прогресса.
    const label = this.text(
      x + pad,
      cy,
      t('craft.queue', { n: s.queue.length, max: reg.craft.queueMax }),
      11,
      COLORS.textDim,
    );
    this.stationBox.add(label);
    cy += label.height + 2;
    for (let i = 0; i < reg.craft.queueMax; i++) {
      const cx = x + pad + cell / 2 + i * (cell + 4 * k);
      this.stationBox.add(
        spawnSprite(this, cx, cy + cell / 2, 'ui.slot', { depth: false }).setDisplaySize(cell, cell),
      );
      const j = s.queue[i];
      if (!j) continue;
      const r = reg.recipes.get(j.recipe);
      const def = r ? reg.items.get(r.output) : undefined;
      if (i === 0) {
        const p = 1 - j.left / j.total;
        this.stationBox.add(
          this.add
            .rectangle(cx - cell / 2 + 3, cy + cell - 3, (cell - 6) * p, 4 * k, 0x7ed957)
            .setOrigin(0, 1),
        );
      }
      if (def) {
        const ic = spawnSprite(this, cx, cy + cell / 2, def.icon, { depth: false }).setOrigin(0.5);
        ic.setScale((cell * 0.7) / Math.max(ic.frame.width, ic.frame.height)).setAlpha(i === 0 ? 1 : 0.6);
        this.stationBox.add(ic);
      }
    }
    // Топливо — справа от очереди.
    if (needsFuel(reg, s.id)) {
      const fx = x + pad + reg.craft.queueMax * (cell + 4 * k) + 10 * k;
      const burning = stations.burning(s) && !s.eternal;
      const fl = this.text(
        fx,
        y + pad,
        burning
          ? `${t('craft.fuel')} · ${t('craft.fuel.burning', { sec: Math.ceil(s.burnLeft) })}`
          : t('craft.fuel'),
        11,
        burning ? '#ffb040' : COLORS.textDim,
      );
      const slot = spawnSprite(this, fx + cell / 2, cy + cell / 2, 'ui.slot', {
        depth: false,
      }).setDisplaySize(cell, cell);
      this.stationBox.add([fl, slot]);
      if (s.fuel) {
        const def = reg.items.get(s.fuel.id);
        if (def) {
          const ic = spawnSprite(this, slot.x, slot.y, def.icon, { depth: false }).setOrigin(0.5);
          ic.setScale((cell * 0.7) / Math.max(ic.frame.width, ic.frame.height));
          this.stationBox.add(ic);
        }
        this.stationBox.add(
          this.add
            .bitmapText(
              slot.x + cell / 2 - 2,
              slot.y + cell / 2 - 1,
              UI_FONT,
              String(s.fuel.count),
              Math.round(10 * k + 3),
            )
            .setOrigin(1, 1),
        );
      }
      const b = new Button(
        this,
        fx + cell + 6 * k + 50 * k,
        cy + cell / 2,
        t('craft.fuel.add'),
        () => this.addFuel(s),
        100 * k,
        24 * k,
      );
      this.stationBox.add(b);
    }
    cy += cell + 6 * k;
    // Выход станка + «Забрать».
    const out = s.output;
    const oc = Math.round(Math.max(28 * k, 36));
    const ol = this.text(x + pad, cy, t('craft.output'), 11, COLORS.textDim);
    this.stationBox.add(ol);
    const ox = x + pad + ol.width + 6 * k;
    out.slice(0, 8).forEach((o, i) => {
      const def = reg.items.get(o.id);
      const cx = ox + oc / 2 + i * (oc + 3);
      this.stationBox.add(
        spawnSprite(this, cx, cy + oc / 2, def ? raritySlot(def.tier) : 'ui.slot', {
          depth: false,
        }).setDisplaySize(oc, oc),
      );
      if (def) {
        const ic = spawnSprite(this, cx, cy + oc / 2, def.icon, { depth: false }).setOrigin(0.5);
        ic.setScale((oc * 0.72) / Math.max(ic.frame.width, ic.frame.height));
        this.stationBox.add(ic);
      }
      if (o.count > 1)
        this.stationBox.add(
          this.add
            .bitmapText(cx + oc / 2 - 2, cy + oc - 1, UI_FONT, String(o.count), Math.round(10 * k + 3))
            .setOrigin(1, 1),
        );
    });
    cy += oc + 6 * k;
    // Причина простоя.
    const blocked = stations.blockedBy(s);
    if (blocked && (s.queue.length > 0 || blocked === 'power')) {
      const why =
        blocked === 'fuel'
          ? t('craft.fuel.none', {
              items: Object.keys(reg.craft.fuel[s.id]?.items ?? {})
                .map((id) => reg.items.get(id)?.name_ru ?? id)
                .join(', '),
            })
          : t(`craft.blocked.${blocked}`);
      this.stationBox.add(this.text(x + pad, cy, why, 11, RED, w - 2 * pad));
    }
    // Кнопки внизу: Забрать, реклама instant_craft, Разобрать.
    const bh = Math.round(Math.max(28 * k, 36));
    const byy = y + h - bh / 2 - 6 * k;
    const buttons: [string, () => void][] = [];
    if (out.length) buttons.push([t('craft.collect'), () => this.collect(s)]);
    if (stations.canFinishNow(s)) buttons.push([t('craft.instant_ad'), () => void this.instant(s)]);
    if (this.station && this.station.uid.startsWith('pl'))
      buttons.push([t('craft.disassemble'), () => this.disassemble()]);
    if (buttons.length) {
      const bw = (w - 2 * pad - (buttons.length - 1) * 6 * k) / buttons.length;
      buttons.forEach(([l, fn], i) =>
        this.stationBox.add(new Button(this, x + pad + bw / 2 + i * (bw + 6 * k), byy, l, fn, bw, bh)),
      );
    }
  }

  // ------------------------------------------------------------------ действия

  private craft(r: RecipeDef, count: number): void {
    const reg = registry();
    const stations = this.world.stations;
    const st = this.stationObjFor(r.station);
    const state = st ? stations.of(st, this.world.dayNight.seconds) : null;
    const name = reg.items.get(r.output)?.name_ru ?? r.output;
    if (this.status(r, this.sources()) !== 'ready') return;
    if (r.station !== HANDS && !state) {
      this.toast(t('craft.open_station', { station: reg.stations.get(r.station)?.name_ru ?? r.station }));
      return;
    }
    let made = 0;
    const limit = r.station === HANDS ? Math.min(count, HANDS_MAX_BATCH) : count;
    for (let i = 0; i < limit; i++) {
      if (state && state.queue.length >= reg.craft.queueMax) {
        if (made === 0) this.toast(t('craft.queue_full'));
        break;
      }
      if (!consumeFrom(this.sources(), inputsOf(r))) break;
      if (r.station === HANDS) stations.enqueueHands(r, this.world.skills);
      else if (state) stations.enqueue(state, r, this.world.skills);
      made++;
    }
    if (made > 0) {
      this.toast(t('craft.queued', { name: made > 1 ? `${name} ×${made}` : name }));
      this.world.progress.track({ type: 'craft', item: r.output, n: made });
      this.world.audio.play('craft', 'sfx');
    }
    this.detailsSig = '';
    this.buildList();
    this.renderRight();
  }

  private collect(s: StationState): void {
    const left = this.world.stations.collect(s, (st) => this.world.hero.inv.add(st));
    void left;
    if (s.output.length) this.toast(t('hint.no_room'));
    this.stationSig = '';
    this.renderRight();
  }

  /** Подложить топливо: первое подходящее из инвентаря, сколько влезет в слот. */
  private addFuel(s: StationState): void {
    const reg = registry();
    const inv = this.world.hero.inv;
    const allowed = Object.keys(reg.craft.fuel[s.id]?.items ?? {});
    const id = s.fuel ? s.fuel.id : allowed.find((x) => inv.count(x) > 0);
    if (!id || fuelValue(reg, s.id, id) === null || inv.count(id) === 0) {
      this.toast(
        t('craft.fuel.none', { items: allowed.map((x) => reg.items.get(x)?.name_ru ?? x).join(', ') }),
      );
      return;
    }
    const have = inv.count(id);
    const left = this.world.stations.addFuel(s, { id, count: have });
    inv.consume({ [id]: have - left });
    if (this.station) this.world.stationRefresh(this.station);
    this.stationSig = '';
    this.renderRight();
  }

  private async instant(s: StationState): Promise<void> {
    const r = await AdsController.rewarded('instant_craft');
    if (r !== 'rewarded') return;
    this.world.stations.finishNow(s);
    this.stationSig = '';
    this.renderRight();
  }

  private disassemble(): void {
    const reg = registry();
    const o = this.station;
    if (!o) return;
    const inv = this.world.hero.inv;
    const hasTool = [...inv.main.slots, ...inv.hotbar.slots].some(
      (s) => s && reg.items.get(s.id)?.toolType === reg.craft.disassembleTool && (s.durability ?? 1) > 0,
    );
    if (!hasTool) {
      this.toast(t('craft.disassemble.need'));
      return;
    }
    this.world.disassemble(o, disassembleReturn(reg, o.ref.id));
    this.close();
  }

  private nextListCheck = 0;
  private listSig = '';

  override update(time: number): void {
    // Очередь и крафт руками идут в реальном времени — обновляем панель станка и наличие ресурсов.
    if (!this.root) return;
    this.renderRight();
    if (time < this.nextListCheck) return;
    this.nextListCheck = time + 500;
    const src = this.sources();
    const sig = this.recipes()
      .map((r) => this.status(r, src)[0])
      .join('');
    if (sig !== this.listSig) {
      if (this.listSig) this.buildList();
      this.listSig = sig;
    }
  }
}
