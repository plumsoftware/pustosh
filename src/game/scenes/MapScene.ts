import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import { revealedBosses } from '../../core/systems/Quests';
import { getAssetInfo } from '../assets/AssetIndex';
import { spawnSprite } from '../assets/spawnSprite';
import { ctx, registry } from '../GameContext';
import { SceneKeys } from '../SceneKeys';
import { Button } from '../ui/Button';
import { COLORS, uiScale } from '../ui/layout';
import { chip, iconButton, panel, rowFrame, titleText, uiText } from '../ui/Styled';
import { promptText } from '../ui/Dialogs';
import type { MapPin, PinType } from '../progress/GameProgress';
import type { MenuData, MenuItem } from './MenuScene';
import { ensureWorldMapTexture } from './WorldMapScene';
import { TOAST, type WorldScene } from './WorldScene';

/** Зум карты: 1 — вся карта на экране. */
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
/** Сдвиг пальца, после которого касание — перетаскивание, а не тап по метке, px. */
const DRAG_PX = 8;

/**
 * Карта игрока (TZ 9.6) на весь экран: туман войны по посещённым чанкам, биомы цветом, метки —
 * тотем, аванпосты, места смерти, арены боссов (из записок или увиденные), найденные места.
 * Перетаскивание — прокрутка, колесо / щипок / «+» «−» — зум вокруг точки; тап по тотему или
 * аванпосту — телепорт. Открывается из меню паузы, клавишей M и тапом по мини-карте.
 */
export class MapScene extends Phaser.Scene {
  private zoom = 2;
  /** Центр экрана — в клетках мира. */
  private cx = 0;
  private cy = 0;
  private root!: Phaser.GameObjects.Container;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private pinch: { d: number; zoom: number } | null = null;
  private pinchAt = 0;
  private picker: Phaser.GameObjects.Container | null = null;
  private filterObjs: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super(SceneKeys.Map);
  }

  private get world(): WorldScene {
    return this.scene.get(SceneKeys.World) as WorldScene;
  }

  /** Сколько экранных px в клетке мира при текущем зуме. */
  private get pxPerTile(): number {
    const k = uiScale(this);
    const { width, height } = this.scale;
    return ((Math.min(width, height) - 40 * k) * this.zoom) / this.world.world.size;
  }

  create(): void {
    ctx().clock.pause('DIALOG');
    const w = this.world;
    w.controls.enabled = false;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      ctx().clock.resume('DIALOG');
      w.controls.clear();
      w.controls.enabled = true;
    });
    this.zoom = 2;
    this.picker = null;
    this.filterObjs = [];
    this.cx = w.hero.pos.x;
    this.cy = w.hero.pos.y;
    this.input.addPointer(1);
    this.buildChrome();
    this.draw();
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyM') this.scene.stop();
    });
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) =>
        this.zoomAt(this.zoom * (dy > 0 ? 0.85 : 1.18), p.x, p.y),
    );
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      if (this.pinchPointers().length === 2) this.startPinch();
      else this.drag = { x: p.x, y: p.y, moved: false };
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      if (this.pinch) return this.movePinch();
      if (!this.drag || !p.isDown) return;
      const dx = p.x - this.drag.x;
      const dy = p.y - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) < DRAG_PX) return;
      this.drag.moved = true;
      this.drag.x = p.x;
      this.drag.y = p.y;
      this.panBy(dx, dy);
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer) => {
      if (this.pinch && this.pinchPointers().length < 2) this.pinch = null;
      else this.onTap(p);
      // Тап по метке после перетаскивания не срабатывает: флаг сбрасывается на следующем кадре.
      this.time.delayedCall(0, () => (this.drag = null));
    });
  }

  // ------------------------------------------------------------------ прокрутка и зум

  private pinchPointers(): Phaser.Input.Pointer[] {
    return [this.input.pointer1, this.input.pointer2].filter((p) => p?.isDown);
  }

  private startPinch(): void {
    const [a, b] = this.pinchPointers();
    if (!a || !b) return;
    this.pinch = { d: Math.max(1, Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y)), zoom: this.zoom };
    if (this.drag) this.drag.moved = true;
  }

  private movePinch(): void {
    const [a, b] = this.pinchPointers();
    if (!a || !b || !this.pinch) return;
    const d = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
    // Перерисовка не чаще раза в 80 мс.
    if (this.time.now < this.pinchAt) return;
    this.pinchAt = this.time.now + 80;
    this.zoomAt(this.pinch.zoom * (d / this.pinch.d), (a.x + b.x) / 2, (a.y + b.y) / 2);
  }

  /** Сдвинуть карту на dx, dy экранных px (без перерисовки — двигается контейнер). */
  private panBy(dx: number, dy: number): void {
    const s = this.pxPerTile;
    const N = this.world.world.size;
    const nx = Phaser.Math.Clamp(this.cx - dx / s, 0, N);
    const ny = Phaser.Math.Clamp(this.cy - dy / s, 0, N);
    this.root.x += (this.cx - nx) * s;
    this.root.y += (this.cy - ny) * s;
    this.cx = nx;
    this.cy = ny;
  }

  /** Новый зум; точка под (sx, sy) остаётся на месте. */
  private zoomAt(zoom: number, sx: number, sy: number): void {
    const z = Phaser.Math.Clamp(zoom, ZOOM_MIN, ZOOM_MAX);
    if (z === this.zoom) return;
    const { width, height } = this.scale;
    const s0 = this.pxPerTile;
    // Клетка под пальцем до зума остаётся под пальцем.
    const tx = this.cx + (sx - width / 2) / s0;
    const ty = this.cy + (sy - height / 2) / s0;
    this.zoom = z;
    const s1 = this.pxPerTile;
    const N = this.world.world.size;
    this.cx = Phaser.Math.Clamp(tx - (sx - width / 2) / s1, 0, N);
    this.cy = Phaser.Math.Clamp(ty - (sy - height / 2) / s1, 0, N);
    this.draw();
  }

  // ------------------------------------------------------------------ отрисовка

  /** Неподвижная часть: фон, заголовок, легенда, кнопки. */
  private buildChrome(): void {
    const k = uiScale(this);
    const { width, height } = this.scale;
    this.add
      .rectangle(0, 0, width, height, 0x0b0a08, 1)
      .setOrigin(0)
      .setInteractive()
      .setDepth(-1)
      .setName('bg');
    const lw = Math.max(230 * k, 220);
    const title = titleText(this, 24 * k, 20 * k, t('map.title'), Math.max(20, 22 * k)).setDepth(11);
    const legend = uiText(this, 24 * k, title.y + title.height + 2, t('map.legend'), 12, {
      color: COLORS.textDim,
      wrap: lw - 24 * k,
    }).setDepth(11);
    const lh = legend.y + legend.height + 10 - 12 * k;
    panel(this, 12 * k + lw / 2, 12 * k + lh / 2, lw, lh).setDepth(10);
    const b = 46 * k;
    const bx = width - b / 2 - 12 * k;
    // Круглые кнопки кита (s34); без кита — обычные кнопки с символами.
    const round = (id: string, sym: string, y: number, fn: () => void) =>
      (iconButton(this, bx, y, id, b, fn) ?? new Button(this, bx, y, sym, fn, b, b)).setDepth(11);
    round('ui.btn_close', '✕', 12 * k + b / 2, () => this.scene.stop());
    round('ui.kit.btn_round_plus', '+', 12 * k + b * 1.65, () =>
      this.zoomAt(this.zoom * 1.5, width / 2, height / 2),
    );
    round('ui.kit.btn_round_minus', '−', 12 * k + b * 2.8, () =>
      this.zoomAt(this.zoom / 1.5, width / 2, height / 2),
    );
    // К герою.
    round('ui.kit.btn_round_home', '◎', 12 * k + b * 3.95, () => {
      this.cx = this.world.hero.pos.x;
      this.cy = this.world.hero.pos.y;
      this.draw();
    });
    // Метка там, где стоит герой.
    round('ui.marker_pin', '📍', 12 * k + b * 5.1, () =>
      this.openPicker(this.world.hero.pos.x, this.world.hero.pos.y),
    );
    this.buildFilters();
  }

  /** Экранная точка → клетка мира. */
  private toWorld(sx: number, sy: number): { x: number; y: number } {
    const { width, height } = this.scale;
    const s = this.pxPerTile;
    return { x: this.cx + (sx - width / 2) / s, y: this.cy + (sy - height / 2) / s };
  }

  /** Тап по пустому месту карты (не перетаскивание, не по метке и не по кнопке) — новая метка. */
  private onTap(p: Phaser.Input.Pointer): void {
    if (this.drag?.moved || this.pinch || this.picker) return;
    const hits = this.input.hitTestPointer(p).filter((o) => o.name !== 'bg');
    if (hits.length) return;
    const pt = this.toWorld(p.x, p.y);
    const N = this.world.world.size;
    if (pt.x < 0 || pt.y < 0 || pt.x > N || pt.y > N) return;
    this.openPicker(pt.x, pt.y);
  }

  /** Выбор типа метки: сетка значков, затем имя (необязательно). */
  private openPicker(x: number, y: number, edit?: MapPin): void {
    this.picker?.destroy();
    const k = uiScale(this);
    const { width, height } = this.scale;
    const g = this.world.progress;
    const types = Object.entries(g.pinTypes);
    const c = this.add.container(0, 0).setDepth(50);
    this.picker = c;
    const shade = this.add.rectangle(0, 0, width, height, 0x000000, 0.5).setOrigin(0).setInteractive();
    shade.on('pointerup', () => this.closePicker());
    const cols = 5;
    const cell = Math.max(54, 64 * k);
    const pw = cols * (cell + 10) + 30;
    const ph = Math.ceil(types.length / cols) * (cell + 26) + 90;
    const px = width / 2 - pw / 2;
    const py = height / 2 - ph / 2;
    c.add([shade, panel(this, width / 2, height / 2, pw, ph, true)]);
    c.add(
      uiText(this, width / 2, py + 14, t(edit ? 'pin.edit' : 'pin.new'), 17, { color: '#f0c070' }).setOrigin(
        0.5,
        0,
      ),
    );
    types.forEach(([id, def], i) => {
      const cx = px + 20 + (i % cols) * (cell + 10) + cell / 2;
      const cy = py + 48 + Math.floor(i / cols) * (cell + 26) + cell / 2;
      const sel = edit?.type === id;
      const bg = rowFrame(this, cx - cell / 2, cy - cell / 2, cell, cell, sel)
        .setOrigin(0)
        .setInteractive({ useHandCursor: true });
      const ic = spawnSprite(this, cx, cy, def.icon, { depth: false });
      ic.setScale((cell * 0.72) / Math.max(ic.frame.width, ic.frame.height));
      const lb = uiText(this, cx, cy + cell / 2 + 2, def.name_ru, 13, { color: def.color }).setOrigin(0.5, 0);
      bg.on('pointerup', () => void this.pickType(x, y, id, def, edit));
      c.add([bg, ic, lb]);
    });
  }

  private closePicker(): void {
    this.picker?.destroy();
    this.picker = null;
  }

  private async pickType(x: number, y: number, type: string, def: PinType, edit?: MapPin): Promise<void> {
    this.closePicker();
    const g = this.world.progress;
    const label = await promptText(this.game, {
      title: t('pin.name'),
      value: edit?.label ?? def.name_ru,
      maxLength: 24,
      validate: () => Promise.resolve(null),
    });
    if (label === null) return;
    if (edit) {
      edit.type = type;
      edit.label = label.trim() || def.name_ru;
      g.setTracked(g.map.tracked ?? null);
    } else if (!g.addPin(x, y, type, label.trim() || def.name_ru))
      this.world.game.events.emit(TOAST, t('pin.full'));
    this.draw();
  }

  /** Меню метки: вести сюда / перестать, телепорт (тотем, аванпост), изменить и удалить (метка игрока). */
  private markerMenu(
    title: string,
    x: number,
    y: number,
    color: string,
    extra: MenuItem[] = [],
    pin?: MapPin,
  ): void {
    if (this.drag?.moved) return;
    const g = this.world.progress;
    const tr = g.map.tracked;
    const tracking = !!tr && Math.abs(tr.x - x) < 0.01 && Math.abs(tr.y - y) < 0.01;
    const d = Math.round(Math.hypot(x - this.world.hero.pos.x, y - this.world.hero.pos.y));
    const items: MenuItem[] = [
      tracking
        ? { label: t('pin.untrack'), fn: () => g.setTracked(null), icon: 'ui.icon_map' }
        : {
            label: t('pin.track'),
            fn: () => g.setTracked({ x, y, label: title, color }),
            icon: 'ui.icon_map',
          },
      ...extra,
    ];
    if (pin) {
      items.push({ label: t('pin.edit'), fn: () => this.openPicker(pin.x, pin.y, pin) });
      items.push({ label: t('pin.delete'), fn: () => g.removePin(pin.id) });
    }
    this.scene.launch(SceneKeys.Menu, { title, subtitle: t('pin.dist', { n: d }), items } satisfies MenuData);
    this.scene.bringToTop(SceneKeys.Menu);
    this.scene.get(SceneKeys.Menu).events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.scene.isActive()) this.draw();
    });
  }

  /** Фильтры групп меток внизу слева: мои метки, база, транспорт, находки. */
  private buildFilters(): void {
    for (const o of this.filterObjs) o.destroy();
    this.filterObjs = [];
    const k = uiScale(this);
    const { height } = this.scale;
    const fh = Math.max(28, 30 * k);
    let fx = 12 * k;
    const fy = height - fh - 10;
    const g = this.world.progress;
    for (const grp of ['pins', 'base', 'vehicles', 'finds']) {
      const c = chip(this, fx, fy, t(`map.filter.${grp}`), !g.isHidden(grp), fh, () => {
        g.toggleHidden(grp);
        this.buildFilters();
        this.draw();
      });
      c.objs.forEach((o, i) => (o as unknown as Phaser.GameObjects.Components.Depth).setDepth(i ? 12 : 11));
      this.filterObjs.push(...c.objs);
      fx += c.width + 6;
    }
  }

  /** Содержимое карты в контейнере вокруг центра (cx, cy). */
  private draw(): void {
    this.root?.destroy();
    const reg = registry();
    const w = this.world;
    const g = w.progress;
    const k = uiScale(this);
    const { width, height } = this.scale;
    const N = w.world.size;
    const s = this.pxPerTile;
    const ox = width / 2 - this.cx * s;
    const oy = height / 2 - this.cy * s;
    const root = this.add.container(0, 0).setDepth(0);
    this.root = root;
    const key = ensureWorldMapTexture(this, w.world);
    root.add(
      this.add
        .image(ox, oy, key)
        .setOrigin(0)
        .setScale((N * s) / this.textures.get(key).getSourceImage().width),
    );
    // Туман войны: непосещённые чанки закрыты.
    const fog = this.add.graphics();
    const n = w.world.chunkTiles;
    const cps = w.world.chunksPerSide;
    fog.fillStyle(0x0b0a08, 1);
    for (let cy = 0; cy < cps; cy++)
      for (let cx = 0; cx < cps; cx++)
        if (!g.isVisited(cx, cy))
          fog.fillRect(ox + cx * n * s - 0.5, oy + cy * n * s - 0.5, n * s + 1, n * s + 1);
    root.add(fog);
    const show = (group: string) => !g.isHidden(group);
    // Мои постройки — оранжевым (стены, пол, заборы игрока).
    if (show('base')) {
      const b = this.add.graphics().fillStyle(0xff8a3d, 0.9);
      const px = Math.max(1.5, s);
      for (const { tx, ty } of w.world.builtCells()) b.fillRect(ox + tx * s, oy + ty * s, px, px);
      root.add(b);
    }
    // Значок метки — постоянного экранного размера; тап — меню.
    const marker = (
      id: string,
      x: number,
      y: number,
      tint: number | null,
      sz: number,
      onTap?: () => void,
      ring?: number,
    ) => {
      if (!getAssetInfo(id)) return null;
      const sx = ox + x * s;
      const sy = oy + y * s;
      if (sx < -40 || sy < -40 || sx > width + 40 || sy > height + 40) return null;
      if (ring !== undefined)
        root.add(
          this.add.circle(sx, sy - (sz * k) / 2, (sz * k) / 2 + 3, 0x14100b, 0.85).setStrokeStyle(2, ring),
        );
      const m = spawnSprite(this, sx, sy, id, { depth: false }).setOrigin(0.5, ring !== undefined ? 0.5 : 1);
      if (ring !== undefined) m.setY(sy - (sz * k) / 2);
      if (tint !== null) m.setTint(tint);
      m.setScale(((ring !== undefined ? 0.8 : 1) * sz * k) / Math.max(m.frame.width, m.frame.height));
      root.add(m);
      if (onTap) m.setInteractive({ useHandCursor: true }).on('pointerup', onTap);
      return m;
    };
    const label = (text: string, x: number, y: number, color: string) =>
      root.add(uiText(this, ox + x * s, oy + y * s + 2, text, 12, { color }).setOrigin(0.5, 0));
    // Находки: арены, руины, места смерти.
    if (show('finds')) {
      const bosses = revealedBosses(reg, g.quests);
      for (const p of w.world.layout.prefabs) {
        const pcx = Math.floor(p.x / n);
        const pcy = Math.floor(p.y / n);
        if (p.kind === 'arena') {
          const b = reg.bosses.byBiome(p.biome);
          if (!b || (!bosses.has(b.id) && !g.isVisited(pcx, pcy))) continue;
          marker('ui.marker_boss', p.x, p.y, g.bosses.has(b.id) ? 0x777777 : null, 26, () =>
            this.markerMenu(b.name_ru, p.x, p.y, '#ff4040'),
          );
        } else if (p.kind === 'ruin' && g.poiSet.has(`ruin_${Math.round(p.x)}_${Math.round(p.y)}`))
          marker('ui.marker_pin', p.x, p.y, 0xd0c090, 16, () =>
            this.markerMenu(t('poi.ruin'), p.x, p.y, '#d0c090'),
          );
      }
      for (const [x, y] of g.map.deaths) {
        root.add(uiText(this, ox + x * s, oy + y * s, '✕', 18 * k, { color: '#ff4040' }).setOrigin(0.5));
        const hit = this.add.zone(ox + x * s, oy + y * s, 28, 28).setInteractive({ useHandCursor: true });
        hit.on('pointerup', () => this.markerMenu(t('map.death'), x, y, '#ff4040'));
        root.add(hit);
      }
    }
    // База: тотем, аванпосты (телепорт), точка возрождения.
    if (show('base')) {
      const tp = (x: number, y: number): MenuItem => ({
        label: t('base.teleport'),
        fn: () => {
          this.scene.stop();
          void w.teleportTo(x, y + 1);
        },
        icon: 'ui.btn_teleport',
      });
      const core = w.baseCore();
      if (core) {
        marker('ui.marker_pin', core.x, core.y, 0xff5040, 30, () =>
          this.markerMenu(t('map.home'), core.x, core.y, '#ff5040', [tp(core.x, core.y)]),
        );
        label(t('map.home'), core.x, core.y, '#ffb090');
      }
      w.outposts().forEach((o, i) =>
        marker('ui.marker_pin', o.x, o.y, 0x40c0ff, 24, () =>
          this.markerMenu(t('base.tp_outpost', { n: i + 1 }), o.x, o.y, '#40c0ff', [tp(o.x, o.y)]),
        ),
      );
      const r = w.hero.respawn;
      if (r)
        marker(
          'world.interior.bed_pallets',
          r.x,
          r.y,
          null,
          22,
          () => this.markerMenu(t('map.respawn'), r.x, r.y, '#e0c060'),
          0xe0c060,
        );
    }
    // Транспорт там, где оставлен.
    if (show('vehicles'))
      for (const v of w.vehicles.list) {
        if (v === w.vehicles.driving) continue;
        marker(
          `icons.vehicles.icon_${v.def.id}`,
          v.s.x,
          v.s.y,
          null,
          24,
          () => this.markerMenu(v.def.name_ru, v.s.x, v.s.y, '#9ad0ff'),
          0x9ad0ff,
        );
      }
    // Метки игрока: значок в кружке цвета типа и подпись.
    if (show('pins')) {
      const types = g.pinTypes;
      for (const p of g.pins) {
        const def = types[p.type];
        if (!def) continue;
        const col = Phaser.Display.Color.HexStringToColor(def.color).color;
        marker(def.icon, p.x, p.y, null, 26, () => this.markerMenu(p.label, p.x, p.y, def.color, [], p), col);
        label(p.label, p.x, p.y, def.color);
      }
    }
    // Отслеживаемая точка — пульсирующее кольцо.
    const tr = g.map.tracked;
    if (tr) {
      const ring = this.add
        .circle(ox + tr.x * s, oy + tr.y * s - 13 * k, 20 * k)
        .setStrokeStyle(3, 0xffffff, 0.9);
      this.tweens.add({ targets: ring, scale: 1.4, alpha: 0.2, duration: 700, yoyo: true, repeat: -1 });
      root.add(ring);
    }
    const h = w.hero.pos;
    root.add(this.add.circle(ox + h.x * s, oy + h.y * s, 6 * k, 0x00e5ff).setStrokeStyle(2, 0x000000));
  }
}
