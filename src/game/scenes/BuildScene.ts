import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import type { BuildPiece } from '../../core/world';
import type { BuildSel } from '../build/BuildController';
import { getAssetInfo } from '../assets/AssetIndex';
import { spawnSprite } from '../assets/spawnSprite';
import { registry } from '../GameContext';
import { SceneKeys } from '../SceneKeys';
import { UI_FONT } from '../ui/BitmapFont';
import { Button } from '../ui/Button';
import { COLORS, FONT, TEXT_RES, uiScale } from '../ui/layout';
import type { WorldScene } from './WorldScene';

type Tab = 'walls' | 'floors' | 'doors' | 'fences' | 'defense' | 'stations' | 'base' | 'hammer';
const TABS: Tab[] = ['walls', 'floors', 'doors', 'fences', 'defense', 'stations', 'base', 'hammer'];
const BASE_IDS = ['base_core', 'outpost_beacon', 'bed_pallets', 'sleeping_bag'];
const DOOR_PIECES: BuildPiece[] = ['window', 'window_boarded', 'door_opening', 'door'];
const PANEL_MS = 180;

interface Entry {
  sel: BuildSel;
  icon: string;
  label: string;
  count?: number;
}

/**
 * Режим строительства (TZ 7.3): нижняя панель с вкладками, иконки — уменьшенные спрайты деталей,
 * над панелью — цена и наличие ресурсов; ✓ — поставить (телефон), отмена последнего действия, выход.
 * Мир не на паузе: герой ходит, призрак и протяжка — в BuildController.
 */
export class BuildScene extends Phaser.Scene {
  private tab: Tab = 'walls';
  private mat = 0;
  private k = 1;
  private root!: Phaser.GameObjects.Container;
  private status!: Phaser.GameObjects.BitmapText;
  private undoBtn!: Button;
  private okBtn: Button | null = null;
  private panelTop = 0;

  constructor() {
    super(SceneKeys.Build);
  }

  private get world(): WorldScene {
    return this.scene.get(SceneKeys.World) as WorldScene;
  }

  private get touch(): boolean {
    return this.sys.game.device.input.touch && !this.sys.game.device.os.desktop;
  }

  init(data: { tab?: Tab }): void {
    const sel = this.world.build.sel;
    if (data.tab) this.tab = data.tab;
    else if (sel.kind === 'object') this.tab = this.tabOfObject(sel.id);
    if (sel.kind === 'piece') this.mat = sel.mat;
  }

  private tabOfObject(id: string): Tab {
    if (BASE_IDS.includes(id)) return 'base';
    return registry().defense.has(id) ? 'defense' : 'stations';
  }

  create(): void {
    this.k = uiScale(this);
    this.root = this.add.container(0, 0);
    this.build();
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) this.world.build.undo();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => (this.world.build.blockRect = { y: Infinity }));
  }

  private entries(): Entry[] {
    const reg = registry();
    const mats = reg.building.materials;
    const inv = this.world.hero.inv;
    const fromInv = (ids: string[]): Entry[] =>
      ids
        .filter((id) => inv.count(id) > 0)
        .map((id) => ({
          sel: { kind: 'object', id },
          icon: reg.items.get(id)!.icon,
          label: reg.items.get(id)!.name_ru,
          count: inv.count(id),
        }));
    switch (this.tab) {
      case 'walls':
        return mats.map((m, i) => ({
          sel: { kind: 'piece', piece: 'wall', mat: i },
          icon: m.sprites.face,
          label: m.name_ru,
        }));
      case 'floors':
        return mats.map((m, i) => ({
          sel: { kind: 'piece', piece: 'floor', mat: i },
          icon: m.sprites.floor,
          label: m.name_ru,
        }));
      case 'fences':
        return mats.map((m, i) => ({
          sel: { kind: 'piece', piece: 'fence', mat: i },
          icon: m.sprites.fence,
          label: m.name_ru,
        }));
      case 'doors': {
        const m = mats[this.mat]!;
        return DOOR_PIECES.map((p) => ({
          sel: { kind: 'piece', piece: p, mat: this.mat },
          icon: m.sprites[p as 'window' | 'window_boarded' | 'door_opening' | 'door'],
          label: t(`build.piece.${p}`),
        }));
      }
      case 'defense':
        return fromInv(reg.defense.all.map((d) => d.id));
      case 'stations':
        return fromInv(
          reg.stations.all.map((s) => s.id).filter((id) => id !== 'hands' && !BASE_IDS.includes(id)),
        );
      case 'base':
        return fromInv(BASE_IDS);
      case 'hammer':
        return (['upgrade', 'repair', 'disassemble'] as const).map((tool) => ({
          sel: { kind: 'tool', tool },
          icon: 'icons.tools.hammer_builder',
          label: t(`build.tool.${tool}`),
        }));
    }
  }

  private build(): void {
    this.root.removeAll(true);
    const reg = registry();
    const k = this.k;
    const { width, height } = this.scale;
    const ph = Math.round(118 * k);
    const py = height - ph;
    this.panelTop = py;
    this.root.add(this.add.rectangle(0, py, width, ph, 0x15120f, 0.92).setOrigin(0).setInteractive());
    this.root.add(this.add.rectangle(0, py, width, 2, 0x5a4a35).setOrigin(0));
    // Вкладки.
    const th = Math.round(28 * k);
    let x = 10;
    for (const tab of TABS) {
      const on = tab === this.tab;
      const txt = this.add.text(0, 0, t(`build.tab.${tab}`), {
        fontFamily: FONT,
        resolution: TEXT_RES,
        fontSize: `${Math.round(12 * k + 2)}px`,
        color: on ? '#1d1a16' : COLORS.text,
        fontStyle: '600',
      });
      const w = txt.width + 14 * k;
      const r = this.add
        .rectangle(x, py + 6 * k, w, th, on ? COLORS.accent : 0x2a251f)
        .setOrigin(0)
        .setStrokeStyle(1, 0x5a4a35)
        .setInteractive({ useHandCursor: true });
      r.on('pointerup', () => {
        this.tab = tab;
        const first = this.entries()[0];
        if (first) this.select(first.sel);
        this.build();
      });
      txt.setPosition(x + 7 * k, py + 6 * k + th / 2).setOrigin(0, 0.5);
      this.root.add([r, txt]);
      x += w + 4 * k;
    }
    // Детали вкладки.
    const cell = Math.round(58 * k);
    const iy = py + 6 * k + th + 8 * k + cell / 2;
    const entries = this.entries();
    const sel = this.world.build.sel;
    entries.forEach((e, i) => {
      const cx = 10 + cell / 2 + i * (cell + 6 * k);
      const chosen = JSON.stringify(e.sel) === JSON.stringify(sel);
      const bg = spawnSprite(this, cx, iy, chosen ? 'ui.slot_selected' : 'ui.slot', { depth: false })
        .setDisplaySize(cell, cell)
        .setInteractive({ useHandCursor: true });
      bg.on('pointerup', () => {
        this.select(e.sel);
        this.build();
      });
      this.root.add(bg);
      if (getAssetInfo(e.icon)) {
        const ic = spawnSprite(this, cx, iy, e.icon, { depth: false }).setOrigin(0.5);
        ic.setScale((cell * 0.78) / Math.max(ic.frame.width, ic.frame.height));
        this.root.add(ic);
      }
      if (e.count !== undefined)
        this.root.add(
          this.add
            .bitmapText(
              cx + cell / 2 - 3,
              iy + cell / 2 - 2,
              UI_FONT,
              String(e.count),
              Math.round(11 * k + 3),
            )
            .setOrigin(1, 1),
        );
      if (chosen)
        this.root.add(
          this.add
            .text(cx - cell / 2, iy - cell / 2 - 2, e.label, {
              fontFamily: FONT,
              resolution: TEXT_RES,
              fontSize: `${Math.round(10 * k + 2)}px`,
              color: COLORS.text,
            })
            .setOrigin(0, 1),
        );
    });
    if (entries.length === 0) {
      const hint =
        this.tab === 'defense' || this.tab === 'stations' || this.tab === 'base'
          ? t('build.craft_first')
          : '';
      this.root.add(
        this.add
          .text(14, iy, hint, {
            fontFamily: FONT,
            resolution: TEXT_RES,
            fontSize: `${Math.round(13 * k + 2)}px`,
            color: COLORS.textDim,
          })
          .setOrigin(0, 0.5),
      );
    }
    if (this.tab === 'doors') {
      const lx = 10 + entries.length * (cell + 6 * k) + 12 * k;
      const m = reg.building.materials[this.mat]!;
      const b = new Button(
        this,
        lx + 80 * k,
        iy,
        `◀ ${m.name_ru} ▶`,
        () => {
          this.mat = (this.mat + 1) % reg.building.materials.length;
          const cur = this.world.build.sel;
          if (cur.kind === 'piece') this.select({ ...cur, mat: this.mat });
          this.build();
        },
        160 * k,
        34 * k,
      );
      this.root.add(b);
    }
    if (this.tab === 'base' && this.world.baseCore()) {
      this.root.add(
        new Button(
          this,
          width - 330 * k,
          iy,
          t('build.repair_base'),
          () => this.world.repairBase(),
          200 * k,
          34 * k,
        ),
      );
    }
    // Справа: ✓ (телефон), отмена, выход.
    const bs = Math.round(46 * k);
    const rx = width - bs / 2 - 10;
    const exit = new Button(this, rx, iy, '✕', () => this.world.exitBuild(), bs, bs);
    this.undoBtn = new Button(this, rx - bs - 8 * k, iy, '↶', () => this.world.build.undo(), bs, bs);
    this.root.add([exit, this.undoBtn]);
    this.okBtn = null;
    if (this.touch) {
      const ok = new Button(this, rx - 2 * (bs + 8 * k), iy, '✓', () => {}, bs, bs);
      // ✓: отпускание — поставить; «Разобрать» — удержание 1 с.
      ok.on('pointerdown', () => this.world.build.beginHold());
      ok.on('pointerup', () => {
        this.world.build.endHold();
        this.world.build.confirm();
      });
      ok.on('pointerout', () => this.world.build.endHold());
      this.okBtn = ok;
      this.root.add(ok);
    }
    // Статус: цена и наличие.
    this.status = this.add.bitmapText(10, py - 6 * k, UI_FONT, '', Math.round(13 * k + 3)).setOrigin(0, 1);
    this.root.add(this.status);
    this.world.build.blockRect = { y: py - 24 * k };
  }

  private select(sel: BuildSel): void {
    if (sel.kind === 'piece') this.mat = sel.mat;
    this.world.build.setSel(sel);
  }

  /** Открыть с анимацией (ANIMATIONS §11). */
  override update(): void {
    const b = this.world.build;
    if (this.status.text !== b.status) this.status.setText(b.status);
    this.status.setTint(b.statusOk ? 0xf2e6c9 : 0xff7060);
    this.undoBtn.setAlpha(b.canUndo ? 1 : 0.4);
    void PANEL_MS;
    void this.panelTop;
  }
}
