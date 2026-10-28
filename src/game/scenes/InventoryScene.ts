import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import { log } from '../../core/util/Log';
import { Inventory, makeStack, maxStack, type ItemStack } from '../../core/inventory';
import { EQUIP_SLOTS, type EquipSlot } from '../../core/inventory/PlayerInventory';
import { useItem } from '../../core/systems/Consumables';
import { canAttachMod } from '../../core/systems/Combat';
import { containerInfo, rollLoot, type ContainerInfo } from '../../core/systems/Loot';
import { Rng } from '../../core/util/rng';
import type { WorldObject } from '../../core/world';
import { AdsController } from '../AdsController';
import { getAssetInfo } from '../assets/AssetIndex';
import { spawnSprite } from '../assets/spawnSprite';
import { ctx, registry } from '../GameContext';
import { AnimationPlayer } from '../rig/AnimationPlayer';
import { humanoidAnims } from '../rig/Animations';
import { RigInstance } from '../rig/RigInstance';
import { SceneKeys } from '../SceneKeys';
import { UI_FONT } from '../ui/BitmapFont';
import { Button } from '../ui/Button';
import { COLORS, FONT, TEXT_RES, uiScale } from '../ui/layout';
import { rarityColor, raritySlot } from '../world/rarity';
import { TOAST, type WorldScene } from './WorldScene';

/** Анимации интерфейса (ANIMATIONS §11): панель 0.18 с, содержимое по одному слоту 50 мс, перетаскивание ×1.1. */
const PANEL_MS = 180;
const SLOT_STAGGER_MS = 50;
const DRAG_SCALE = 1.1;
const DRAG_THRESHOLD = 8;
const LONG_PRESS_MS = 450;

type SlotRef = { inv: 'main' | 'hotbar' | 'container'; index: number } | { inv: 'equip'; slot: EquipSlot };

interface SlotView {
  ref: SlotRef;
  x: number;
  y: number;
  size: number;
  bg: Phaser.GameObjects.Image;
  icon: Phaser.GameObjects.Image | null;
  count: Phaser.GameObjects.BitmapText | null;
  bar: Phaser.GameObjects.Graphics | null;
}

export interface InventoryData {
  mode: 'player' | 'container';
  obj?: WorldObject;
  /** Своё хранилище вместо контейнера мира (багажник машины): название и слоты, изменяются на месте. */
  storage?: { title: string; inv: Inventory };
}

/** Время последней рекламы «×2 лут» — не чаще doubleLootCooldownSec. */
let lastDoubleLootAt = -Infinity;

/**
 * Экран инвентаря (TZ 5.6): игрок — манекен со слотами экипировки, сетка, пояс;
 * контейнер — два окна (игрок ↔ контейнер), «Взять всё», «Сложить похожее», «×2 (реклама)».
 */
export class InventoryScene extends Phaser.Scene {
  private mode: 'player' | 'container' = 'player';
  private obj: WorldObject | null = null;
  private info: ContainerInfo | null = null;
  private cont: Inventory | null = null;
  private root!: Phaser.GameObjects.Container;
  private slots: SlotView[] = [];
  private k = 1;
  private selected: SlotRef | null = null;
  private details!: Phaser.GameObjects.Container;
  private press: { ref: SlotRef; x: number; y: number; at: number; dragging: boolean; long: boolean } | null =
    null;
  private ghost: Phaser.GameObjects.Image | null = null;
  private hover: Phaser.GameObjects.Image | null = null;
  private panel = { x: 0, y: 0, w: 0, h: 0 };
  private mannequin: RigInstance | null = null;
  private manPlayer: AnimationPlayer | null = null;
  private stagger = false;

  constructor() {
    super(SceneKeys.Inventory);
  }

  private get world(): WorldScene {
    return this.scene.get(SceneKeys.World) as WorldScene;
  }

  private get pi() {
    return this.world.hero.inv;
  }

  private storage: { title: string; inv: Inventory } | null = null;

  init(data: InventoryData): void {
    this.mode = data.mode;
    this.obj = data.obj ?? null;
    this.storage = data.storage ?? null;
  }

  create(): void {
    const { clock } = ctx();
    clock.pause('DIALOG');
    // Пока окно открыто, ввод игры выключен (иначе Esc/Tab дойдут и до мира: пауза, повторное открытие).
    this.world.controls.clear();
    this.world.controls.enabled = false;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.onClose());
    this.k = uiScale(this);
    this.selected = null;
    this.slots = [];
    this.cont = null;
    this.info = null;
    if (this.mode === 'container' && this.obj) this.openContainerData(this.obj);
    if (this.mode === 'container' && this.storage) {
      this.cont = this.storage.inv;
      this.info = { type: 'storage', slots: this.storage.inv.size };
    }

    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x000000, 0.55).setOrigin(0).setInteractive();
    this.root = this.add.container(0, 0);
    this.details = this.add.container(0, 0).setDepth(20);
    this.stagger = this.mode === 'container';
    this.build();
    // Открытие панели: масштаб 0.9 → 1 и альфа (0.18 с).
    this.root
      .setScale(0.9)
      .setAlpha(0)
      .setPosition(width * 0.05, height * 0.05);
    this.tweens.add({
      targets: this.root,
      scale: 1,
      alpha: 1,
      x: 0,
      y: 0,
      duration: PANEL_MS,
      ease: 'Quad.Out',
    });

    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'Tab' || e.code === 'KeyI') {
        e.preventDefault();
        this.close();
      }
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => this.onMove(p));
    this.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer) => this.onUp(p));
  }

  // ------------------------------------------------------------------ данные контейнера

  /** Первое открытие лут-контейнера — содержимое по таблице; дальше — сохранённое; сундук — хранилище. */
  private openContainerData(o: WorldObject): void {
    const reg = registry();
    const w = this.world.world;
    this.info = containerInfo(reg, o);
    if (!this.info) return;
    const info = this.info;
    let items: ItemStack[];
    if (info.type === 'storage') items = w.containerContents(o) ?? [];
    else {
      const wasIntact = o.state === 'intact';
      items = w.openContainer(o, this.world.dayNight.seconds, () =>
        rollLoot(
          reg,
          info.table!,
          Math.max(1, o.biome),
          info.slots,
          new Rng((Math.random() * 2 ** 32) >>> 0),
        ),
      );
      if (wasIntact) this.world.containerOpened(o);
    }
    this.cont = new Inventory(reg, Math.max(info.slots, items.length), items);
  }

  private onClose(): void {
    ctx().clock.resume('DIALOG');
    this.world.controls.clear();
    this.world.controls.enabled = true;
    if (this.obj && this.cont) {
      this.world.world.setContainerContents(
        this.obj,
        this.cont.slots.filter((s): s is ItemStack => !!s),
      );
      this.world.containerClosed(this.obj);
    }
    this.mannequin?.destroy();
    this.mannequin = null;
  }

  close(): void {
    this.tweens.add({
      targets: this.root,
      scale: 0.9,
      alpha: 0,
      duration: PANEL_MS,
      onComplete: () => this.scene.stop(),
    });
    this.details.setVisible(false);
  }

  // ------------------------------------------------------------------ разметка

  private build(): void {
    this.root.removeAll(true);
    this.slots = [];
    this.mannequin?.destroy();
    this.mannequin = null;
    const { width, height } = this.scale;
    const k = this.k;
    const pw = Math.min(width - 20, 1180 * k);
    const ph = height - 20;
    const px = (width - pw) / 2;
    const py = 10;
    this.panel = { x: px, y: py, w: pw, h: ph };
    const panelInfo = getAssetInfo('ui.panel_9slice')!;
    const slice = 22;
    const bg = this.add.nineslice(
      px + pw / 2,
      py + ph / 2,
      panelInfo.group,
      panelInfo.frame,
      pw,
      ph,
      slice,
      slice,
      slice,
      slice,
    );
    this.root.add(bg);
    const close = spawnSprite(this, px + pw - 30 * k, py + 30 * k, 'ui.btn_close', {
      depth: false,
    }).setInteractive({ useHandCursor: true });
    close.setScale((40 * k) / Math.max(close.frame.width, close.frame.height));
    close.on('pointerup', () => this.close());
    this.root.add(close);

    const cell = Math.round(52 * k);
    if (this.mode === 'player') this.buildPlayer(px, py, pw, ph, cell);
    else this.buildContainer(px, py, pw, ph, cell);
  }

  private title(x: number, y: number, text: string): void {
    this.root.add(
      this.add.text(x, y, text, {
        fontFamily: FONT,
        resolution: TEXT_RES,
        fontSize: `${Math.round(20 * this.k + 2)}px`,
        color: COLORS.text,
        fontStyle: '700',
      }),
    );
  }

  private buildPlayer(px: number, py: number, pw: number, ph: number, cell: number): void {
    const k = this.k;
    this.title(px + 24 * k, py + 16 * k, t('inv.title'));
    // Манекен героя (риг в позе idle) и слоты экипировки слева.
    const mx = px + 150 * k;
    const my = py + ph * 0.62;
    this.mannequin = new RigInstance(this, this.world.hero.view.def, mx + 30 * k, my);
    this.mannequin.container.setScale(1.7 * k);
    const head = this.pi.equip.head ? registry().items.get(this.pi.equip.head.id)?.heroHead : undefined;
    if (head) this.mannequin.setPart('head', head);
    this.manPlayer = new AnimationPlayer(
      humanoidAnims(registry().rigs.humanoid['animations'] as Record<string, { loopSec?: number }>),
    );
    this.root.add(this.mannequin.container);
    EQUIP_SLOTS.forEach((es, i) => {
      const y = py + 70 * k + i * (cell + 18 * k);
      this.root.add(
        this.add
          .bitmapText(px + 24 * k, y - 14 * k, UI_FONT, t(`inv.equip.${es}`), Math.round(11 * k + 3))
          .setTint(0xb7a98a),
      );
      this.addSlot({ inv: 'equip', slot: es }, px + 24 * k + cell / 2, y + cell / 2, cell);
    });
    // Сетка рюкзака
    const gx = px + 300 * k;
    const gw = pw - (gx - px) - 24 * k;
    const cols = Math.max(4, Math.floor(gw / (cell + 6)));
    this.grid('main', this.pi.main, gx, py + 64 * k, cols, cell);
    // Пояс снизу
    const rows = Math.ceil(this.pi.main.size / cols);
    const hy = Math.min(py + ph - cell - 70 * k, py + 64 * k + rows * (cell + 6) + 30 * k);
    this.root.add(
      this.add
        .bitmapText(gx, hy - 18 * k, UI_FONT, t('inv.hotbar'), Math.round(12 * k + 3))
        .setTint(0xb7a98a),
    );
    this.grid('hotbar', this.pi.hotbar, gx, hy, 6, cell);
    const bh = 44 * k;
    new Button(
      this,
      px + pw - 400 * k,
      py + ph - bh / 2 - 14 * k,
      t('inv.craft'),
      () => this.world.openCraft(null),
      140 * k,
      bh,
    ).setDepth(5);
    new Button(
      this,
      px + pw - 170 * k,
      py + ph - bh / 2 - 14 * k,
      t('inv.repair_all_ad'),
      () => void this.repairAll(),
      300 * k,
      bh,
    ).setDepth(5);
  }

  private buildContainer(px: number, py: number, pw: number, ph: number, cell: number): void {
    const k = this.k;
    const half = pw / 2;
    this.title(px + 24 * k, py + 16 * k, t('inv.title'));
    const name = this.storage ? this.storage.title : this.obj ? this.containerName(this.obj) : '';
    this.title(px + half + 16 * k, py + 16 * k, name);
    const cols = Math.max(4, Math.floor((half - 40 * k) / (cell + 6)));
    this.grid('main', this.pi.main, px + 24 * k, py + 64 * k, cols, cell);
    const rows = Math.ceil(this.pi.main.size / cols);
    const hy = Math.min(py + ph - cell - 20 * k, py + 64 * k + rows * (cell + 6) + 24 * k);
    this.grid('hotbar', this.pi.hotbar, px + 24 * k, hy, 6, cell);
    if (this.cont) this.grid('container', this.cont, px + half + 16 * k, py + 64 * k, cols, cell);
    const bh = 44 * k;
    const by = py + ph - bh / 2 - 14 * k;
    const bx = px + half + 16 * k;
    new Button(this, bx + 90 * k, by, t('inv.take_all'), () => this.takeAll(), 170 * k, bh).setDepth(5);
    new Button(
      this,
      bx + 280 * k,
      by,
      t('inv.stack_similar'),
      () => this.stackSimilar(),
      200 * k,
      bh,
    ).setDepth(5);
    if (this.info?.type === 'loot')
      new Button(
        this,
        bx + 475 * k,
        by,
        t('inv.double_ad'),
        () => void this.doubleLoot(),
        180 * k,
        bh,
      ).setDepth(5);
  }

  private containerName(o: WorldObject): string {
    const reg = registry();
    if (o.ref.type === 'station') return reg.stations.get(o.ref.id)?.name_ru ?? '';
    if (o.ref.type === 'container') return t(`container.${o.ref.id}`);
    return t(`container.${o.ref.type === 'biome' ? o.ref.id : 'box'}`);
  }

  private grid(
    inv: 'main' | 'hotbar' | 'container',
    data: Inventory,
    x: number,
    y: number,
    cols: number,
    cell: number,
  ): void {
    for (let i = 0; i < data.size; i++) {
      const cx = x + (i % cols) * (cell + 6) + cell / 2;
      const cy = y + Math.floor(i / cols) * (cell + 6) + cell / 2;
      this.addSlot({ inv, index: i }, cx, cy, cell, inv === 'container' && this.stagger ? i : -1);
    }
  }

  private stackAt(ref: SlotRef): ItemStack | null {
    if (ref.inv === 'equip') return this.pi.equip[ref.slot];
    return this.invOf(ref.inv).slots[ref.index] ?? null;
  }

  private invOf(inv: 'main' | 'hotbar' | 'container'): Inventory {
    return inv === 'main' ? this.pi.main : inv === 'hotbar' ? this.pi.hotbar : this.cont!;
  }

  private addSlot(ref: SlotRef, x: number, y: number, size: number, staggerIndex = -1): void {
    const s = this.stackAt(ref);
    const tier = s ? (registry().items.get(s.id)?.tier ?? 0) : 0;
    const bg = spawnSprite(this, x, y, s ? raritySlot(tier) : 'ui.slot', { depth: false });
    bg.setDisplaySize(size, size).setInteractive();
    const sv: SlotView = { ref, x, y, size, bg, icon: null, count: null, bar: null };
    this.root.add(bg);
    if (ref.inv === 'hotbar' && ref.index === this.pi.selected) {
      this.root.add(spawnSprite(this, x, y, 'ui.slot_selected', { depth: false }).setDisplaySize(size, size));
    }
    if (s) this.drawStack(sv, s, staggerIndex);
    bg.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.press = { ref, x: p.x, y: p.y, at: p.downTime, dragging: false, long: false };
      if (p.rightButtonDown()) {
        this.press = null;
        this.select(ref);
      }
    });
    this.slots.push(sv);
  }

  private drawStack(sv: SlotView, s: ItemStack, staggerIndex: number): void {
    const reg = registry();
    const def = reg.items.get(s.id);
    if (!def) return;
    const icon = spawnSprite(this, sv.x, sv.y, def.icon, { depth: false });
    icon.setScale((sv.size * 0.78) / Math.max(icon.frame.width, icon.frame.height));
    if (def.iconTint) icon.setTint(parseInt(def.iconTint.slice(1), 16));
    sv.icon = icon;
    this.root.add(icon);
    if (s.count > 1) {
      sv.count = this.add
        .bitmapText(
          sv.x + sv.size / 2 - 4,
          sv.y + sv.size / 2 - 2,
          UI_FONT,
          String(s.count),
          Math.round(12 * this.k + 3),
        )
        .setOrigin(1, 1);
      this.root.add(sv.count);
    }
    if (s.durability !== undefined && def.durability) {
      const g = this.add.graphics();
      const w = sv.size * 0.7;
      const frac = s.durability / def.durability;
      g.fillStyle(0x000000, 0.6).fillRect(sv.x - w / 2, sv.y + sv.size / 2 - 7, w, 4);
      g.fillStyle(frac > 0.5 ? 0x7ad04a : frac > 0.2 ? 0xe0c040 : 0xd04030, 1).fillRect(
        sv.x - w / 2,
        sv.y + sv.size / 2 - 7,
        w * frac,
        4,
      );
      if (s.durability === 0) {
        // Значок поломки
        g.lineStyle(3, 0xd02a20, 1).lineBetween(
          sv.x - sv.size * 0.3,
          sv.y - sv.size * 0.3,
          sv.x + sv.size * 0.3,
          sv.y + sv.size * 0.3,
        );
        icon.setAlpha(0.6);
      }
      sv.bar = g;
      this.root.add(g);
    }
    // Содержимое контейнера появляется по одному слоту (50 мс).
    if (staggerIndex >= 0) {
      const parts = [icon, sv.count, sv.bar].filter((x): x is NonNullable<typeof x> => !!x);
      for (const p of parts) p.setAlpha(0);
      this.tweens.add({ targets: parts, alpha: 1, delay: staggerIndex * SLOT_STAGGER_MS, duration: 120 });
      const sc = icon.scale;
      icon.setScale(sc * 0.6);
      this.tweens.add({
        targets: icon,
        scale: sc,
        delay: staggerIndex * SLOT_STAGGER_MS,
        duration: 160,
        ease: 'Back.Out',
      });
    }
  }

  private refresh(): void {
    this.stagger = false;
    const sel = this.selected;
    this.build();
    if (sel && this.stackAt(sel)) this.select(sel);
    else this.details.removeAll(true);
  }

  // ------------------------------------------------------------------ перетаскивание и выбор

  private slotUnder(x: number, y: number): SlotView | null {
    return this.slots.find((s) => Math.abs(s.x - x) <= s.size / 2 && Math.abs(s.y - y) <= s.size / 2) ?? null;
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const pr = this.press;
    if (!pr || !p.isDown) return;
    if (!pr.dragging && Math.hypot(p.x - pr.x, p.y - pr.y) > DRAG_THRESHOLD) {
      const s = this.stackAt(pr.ref);
      if (!s) {
        this.press = null;
        return;
      }
      pr.dragging = true;
      const def = registry().items.get(s.id)!;
      const sv = this.slots.find((x) => sameRef(x.ref, pr.ref));
      sv?.icon?.setAlpha(0.35);
      this.ghost = spawnSprite(this, p.x, p.y, def.icon, { depth: 100 });
      this.ghost.setScale(
        ((sv?.size ?? 52) * 0.78 * DRAG_SCALE) / Math.max(this.ghost.frame.width, this.ghost.frame.height),
      );
    }
    if (pr.dragging && this.ghost) {
      this.ghost.setPosition(p.x, p.y);
      const target = this.slotUnder(p.x, p.y);
      if (target) {
        if (!this.hover) this.hover = spawnSprite(this, 0, 0, 'ui.slot_selected', { depth: 99 });
        this.hover.setPosition(target.x, target.y).setDisplaySize(target.size, target.size).setVisible(true);
      } else this.hover?.setVisible(false);
    }
  }

  private onUp(p: Phaser.Input.Pointer): void {
    const pr = this.press;
    this.press = null;
    this.hover?.setVisible(false);
    if (!pr) return;
    if (!pr.dragging) {
      // Тап: выбрать слот (на поясе — взять в руку) и показать карточку предмета.
      if (pr.ref.inv === 'hotbar') this.pi.selected = pr.ref.index;
      this.select(pr.ref);
      if (pr.ref.inv === 'hotbar') this.refresh();
      return;
    }
    this.ghost?.destroy();
    this.ghost = null;
    const target = this.slotUnder(p.x, p.y);
    const inPanel =
      p.x >= this.panel.x &&
      p.x <= this.panel.x + this.panel.w &&
      p.y >= this.panel.y &&
      p.y <= this.panel.y + this.panel.h;
    if (target) this.moveStack(pr.ref, target.ref);
    else if (!inPanel) this.dropRef(pr.ref);
    this.refresh();
  }

  private moveStack(from: SlotRef, to: SlotRef): void {
    if (sameRef(from, to)) return;
    const pi = this.pi;
    // Мод на предмет (TZ 8.2): перетаскивание мода на оружие/одежду со свободным слотом.
    const fromStack = this.stackAt(from);
    const toStack = this.stackAt(to);
    if (fromStack && toStack && from.inv !== 'equip' && canAttachMod(registry(), fromStack.id, toStack)) {
      toStack.mods = [...(toStack.mods ?? []), fromStack.id];
      this.invOf(from.inv).take(from.index, 1);
      this.world.game.events.emit(
        TOAST,
        t('inv.mod_attached', { name: registry().items.require(fromStack.id).name_ru }),
      );
      return;
    }
    if (from.inv !== 'equip' && to.inv !== 'equip') {
      this.invOf(from.inv).move(from.index, this.invOf(to.inv), to.index);
      return;
    }
    if (from.inv !== 'equip' && to.inv === 'equip') {
      const s = this.invOf(from.inv).slots[from.index];
      if (s && pi.slotFor(s.id) === to.slot) pi.equipFrom(this.invOf(from.inv), from.index);
      return;
    }
    if (from.inv === 'equip' && to.inv !== 'equip') {
      const inv = this.invOf(to.inv);
      if (from.slot === 'backpack') {
        pi.unequip('backpack');
        return;
      }
      const s = pi.equip[from.slot];
      const target = inv.slots[to.index];
      if (!s) return;
      if (!target) {
        inv.slots[to.index] = s;
        pi.equip[from.slot] = null;
      } else if (pi.slotFor(target.id) === from.slot) pi.equipFrom(inv, to.index);
    }
  }

  private dropRef(ref: SlotRef): void {
    let s: ItemStack | null;
    if (ref.inv === 'equip') {
      if (
        ref.slot === 'backpack' &&
        this.pi.main.slots.slice(registry().balance.player.inventorySlots).some((x) => x)
      )
        return;
      s = this.pi.equip[ref.slot];
      if (ref.slot === 'backpack') this.pi.main.resize(registry().balance.player.inventorySlots);
      this.pi.equip[ref.slot] = null;
    } else s = this.invOf(ref.inv).take(ref.index);
    if (s) this.world.dropStack(s);
  }

  // ------------------------------------------------------------------ карточка предмета

  private select(ref: SlotRef): void {
    this.selected = ref;
    this.details.removeAll(true);
    const s = this.stackAt(ref);
    if (!s) return;
    const reg = registry();
    const def = reg.items.get(s.id);
    if (!def) return;
    const k = this.k;
    const lines: string[] = [t(`inv.cat.${def.category}`), t('inv.tier', { tier: def.tier })];
    const num = (key: string) => (typeof def[key] === 'number' ? (def[key] as number) : undefined);
    for (const key of [
      'damage',
      'hunger',
      'thirst',
      'health',
      'armor',
      'coldRes',
      'heatRes',
      'radRes',
      'extraSlots',
    ]) {
      const v = num(key);
      if (v) lines.push(t(`inv.stat.${key}`, { v }));
    }
    if (def.toolType && def.harvestTier !== undefined)
      lines.push(t('inv.stat.harvestTier', { tool: t(`tool.${def.toolType}`), v: def.harvestTier }));
    const slots = (def['modSlots'] as number | undefined) ?? 0;
    if (slots > 0)
      lines.push(
        t('inv.mods', {
          n: s.mods?.length ?? 0,
          max: slots,
          list: (s.mods ?? []).map((m) => reg.items.get(m)?.name_ru ?? m).join(', ') || '—',
        }),
      );
    if (s.durability !== undefined && def.durability) {
      lines.push(t('inv.durability', { cur: Math.round(s.durability), max: def.durability }));
      if (s.durability === 0) lines.push(t('inv.broken'));
    }
    const w = 300 * k;
    const sv = this.slots.find((x) => sameRef(x.ref, ref));
    const x = Math.min((sv?.x ?? 0) + (sv?.size ?? 0) / 2 + 8, this.scale.width - w - 10);
    const y = Math.min(Math.max(10, (sv?.y ?? 0) - 40 * k), this.scale.height - 260 * k);
    const title = this.add.text(x + 12, y + 10, def.name_ru, {
      fontFamily: FONT,
      resolution: TEXT_RES,
      fontSize: `${Math.round(17 * k + 2)}px`,
      color: '#' + rarityColor(def.tier).toString(16).padStart(6, '0'),
      fontStyle: '700',
      wordWrap: { width: w - 24 },
    });
    const body = this.add.text(x + 12, y + 14 + title.height, lines.join('\n'), {
      fontFamily: FONT,
      resolution: TEXT_RES,
      fontSize: `${Math.round(13 * k + 2)}px`,
      color: COLORS.text,
      lineSpacing: 2,
    });
    const actions = this.actionsFor(ref, s);
    const bh = 36 * k;
    const h = 24 + title.height + body.height + actions.length * (bh + 6) + 10;
    const bg = this.add.rectangle(x, y, w, h, 0x1d1a16, 0.96).setOrigin(0).setStrokeStyle(2, 0x5a4a35);
    this.details.add([bg, title, body]);
    actions.forEach(([label, fn], i) => {
      const b = new Button(
        this,
        x + w / 2,
        y + 18 + title.height + body.height + i * (bh + 6) + bh / 2,
        label,
        fn,
        w - 24,
        bh,
      );
      this.details.add(b);
    });
  }

  private actionsFor(ref: SlotRef, s: ItemStack): [string, () => void][] {
    const reg = registry();
    const def = reg.items.require(s.id);
    const out: [string, () => void][] = [];
    if (def.category === 'food' || def.category === 'medicine') out.push([t('inv.use'), () => this.use(ref)]);
    if ((def.category === 'placeable' || def.category === 'defense') && ref.inv !== 'container')
      out.push([t('inv.place'), () => this.world.startPlacing(s.id)]);
    if (def.category === 'vehicle' && ref.inv !== 'container')
      out.push([
        t('inv.place'),
        () => {
          if (this.world.vehicles.place(s.id)) this.close();
        },
      ]);
    if (ref.inv === 'equip') out.push([t('inv.unequip'), () => this.unequip(ref.slot)]);
    else if (this.pi.slotFor(s.id) && ref.inv !== 'container')
      out.push([t('inv.equip'), () => this.equip(ref)]);
    if (s.count > 1 && ref.inv !== 'equip') out.push([t('inv.split'), () => this.split(ref)]);
    if (s.durability !== undefined && def.durability && s.durability < def.durability)
      out.push([t('inv.repair'), () => this.repair(ref)]);
    out.push([t('inv.drop'), () => this.dropSelected(ref)]);
    return out;
  }

  private use(ref: SlotRef): void {
    if (ref.inv === 'equip') return;
    const inv = this.invOf(ref.inv);
    const s = inv.slots[ref.index];
    if (!s) return;
    const hero = this.world.hero;
    if (
      useItem(registry(), s.id, hero.vitals, hero.move, new Rng((Math.random() * 2 ** 32) >>> 0)) === 'used'
    )
      inv.take(ref.index, 1);
    this.refresh();
  }

  private equip(ref: SlotRef): void {
    if (ref.inv !== 'equip') this.pi.equipFrom(this.invOf(ref.inv), ref.index);
    this.refresh();
  }

  private unequip(slot: EquipSlot): void {
    if (!this.pi.unequip(slot)) this.world.game.events.emit(TOAST, t('hint.no_room'));
    this.selected = null;
    this.refresh();
  }

  private split(ref: SlotRef): void {
    if (ref.inv !== 'equip') this.invOf(ref.inv).split(ref.index);
    this.refresh();
  }

  private dropSelected(ref: SlotRef): void {
    this.dropRef(ref);
    this.selected = null;
    this.refresh();
  }

  /** Ремкомплект на верстаке: +repairPercent прочности (TZ 5.4). */
  private repair(ref: SlotRef): void {
    const reg = registry();
    const s = this.stackAt(ref);
    const def = s ? reg.items.get(s.id) : undefined;
    if (!s || !def?.durability) return;
    if (!this.pi.has({ repair_kit: 1 }) || !this.nearRepairStation()) {
      this.world.game.events.emit(TOAST, t('hint.repair_needs_kit'));
      return;
    }
    const pct =
      (reg.items.require('repair_kit')['effect'] as { repairPercent?: number } | undefined)?.repairPercent ??
      50;
    this.pi.consume({ repair_kit: 1 });
    s.durability = Math.min(def.durability, (s.durability ?? 0) + (def.durability * pct) / 100);
    this.world.game.events.emit(TOAST, t('hint.repaired'));
    this.refresh();
  }

  private nearRepairStation(): boolean {
    const reg = registry();
    const r = reg.harvest.repair;
    const { x, y } = this.world.hero.pos;
    for (let ty = Math.floor(y - r.radiusTiles); ty <= Math.floor(y + r.radiusTiles); ty++)
      for (let tx = Math.floor(x - r.radiusTiles); tx <= Math.floor(x + r.radiusTiles); tx++)
        for (const o of this.world.world.objectsAt(tx, ty))
          if (
            o.ref.type === 'station' &&
            r.stations.includes(o.ref.id) &&
            Math.hypot(o.x - x, o.y - y) <= r.radiusTiles
          )
            return true;
    return false;
  }

  // ------------------------------------------------------------------ кнопки

  private takeAll(): void {
    if (!this.cont) return;
    for (let i = 0; i < this.cont.size; i++) {
      const s = this.cont.slots[i];
      if (!s) continue;
      const left = this.pi.add(s);
      if (left === 0) this.cont.slots[i] = null;
      else s.count = left;
    }
    if (!this.cont.isEmpty()) this.world.game.events.emit(TOAST, t('hint.no_room'));
    this.refresh();
  }

  private stackSimilar(): void {
    if (!this.cont) return;
    this.pi.main.transferSimilar(this.cont);
    this.pi.hotbar.transferSimilar(this.cont);
    this.refresh();
  }

  /** Реклама за награду double_loot: содержимое контейнера ×2, не чаще раза в 5 минут. */
  private async doubleLoot(): Promise<void> {
    const reg = registry();
    if (!this.cont) return;
    const left = lastDoubleLootAt + reg.loot.doubleLootCooldownSec * 1000 - Date.now();
    if (left > 0) {
      this.world.game.events.emit(TOAST, t('hint.ad_cooldown', { sec: Math.ceil(left / 1000) }));
      return;
    }
    const r = await AdsController.rewarded('double_loot');
    if (r !== 'rewarded') return;
    lastDoubleLootAt = Date.now();
    const items = this.cont.slots.filter((s): s is ItemStack => !!s);
    const extra: ItemStack[] = [];
    for (const s of items) {
      const max = maxStack(reg, s.id);
      const add = s.count;
      const fit = Math.min(add, max - s.count);
      s.count += fit;
      for (let rest = add - fit; rest > 0; rest -= max)
        extra.push(
          s.durability !== undefined ? makeStack(reg, s.id, 1) : { id: s.id, count: Math.min(rest, max) },
        );
    }
    for (const e of extra) {
      // Не влезло — контейнер временно растёт, чтобы награда не пропала.
      let left = this.cont.add(e);
      while (left > 0) {
        this.cont.resize(this.cont.size + 1);
        left = this.cont.add({ ...e, count: left });
      }
    }
    this.stagger = true;
    this.refresh();
  }

  /** Реклама за награду repair_all: всё снаряжение — полная прочность. */
  private async repairAll(): Promise<void> {
    const r = await AdsController.rewarded('repair_all');
    if (r !== 'rewarded') return;
    const reg = registry();
    const fix = (s: ItemStack | null) => {
      const max = s ? reg.items.get(s.id)?.durability : undefined;
      if (s && max !== undefined && s.durability !== undefined) s.durability = max;
    };
    this.pi.main.slots.forEach(fix);
    this.pi.hotbar.slots.forEach(fix);
    for (const es of EQUIP_SLOTS) fix(this.pi.equip[es]);
    this.world.game.events.emit(TOAST, t('hint.repaired_all'));
    log.debug('repair_all');
    this.refresh();
  }

  override update(_t: number, delta: number): void {
    if (this.mannequin && this.manPlayer) this.mannequin.apply(this.manPlayer.update(delta / 1000));
    // Долгий тап — карточка предмета.
    const pr = this.press;
    if (pr && !pr.dragging && !pr.long && this.time.now - pr.at >= LONG_PRESS_MS) {
      pr.long = true;
      this.select(pr.ref);
    }
  }
}

function sameRef(a: SlotRef, b: SlotRef): boolean {
  if (a.inv === 'equip' || b.inv === 'equip')
    return a.inv === 'equip' && b.inv === 'equip' && a.slot === b.slot;
  return a.inv === b.inv && a.index === b.index;
}
