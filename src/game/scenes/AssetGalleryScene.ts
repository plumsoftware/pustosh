import Phaser from 'phaser';
import type { WallPiece } from '../../core/data/schemas';
import { t } from '../../core/i18n/i18n';
import { assetIdsInGroup, atlasGroups, getAssetInfo } from '../assets/AssetIndex';
import { AssetLoader } from '../assets/AssetLoader';
import { spawnSprite } from '../assets/spawnSprite';
import { ctx, registry } from '../GameContext';
import { SceneKeys } from '../SceneKeys';
import { COLORS, FONT, TEXT_RES } from '../ui/layout';

type Bg = 'grass' | 'dark' | 'checker';
const BGS: Bg[] = ['grass', 'dark', 'checker'];
const REF_ID = 'characters.hero.ref_idle';
/** Рост эталона героя в галерее — bodyHeightPx рига гуманоида. */
const refHeight = () => registry().rigs.humanoid['bodyHeightPx'] as number;

const SPECIAL_TABS = ['tiles', 'walls', 'items'] as const;
type Tab = string;

const PAD = 16;
const LABEL_H = 26;
const MIN_CELL_W = 96;
const TOP_BAR_H = 92;

/**
 * Отладочная галерея ассетов (F2): вкладки по группам атласов, спрайты в логическом размере
 * с подписью и точкой привязки, фоны, эталон героя, тайлы 4×4, комнаты из стен, все предметы.
 * Адрес ?gallery=<вкладка>&bg=<фон>&ref=<assetId> открывает сразу нужный вид.
 */
export class AssetGalleryScene extends Phaser.Scene {
  private tab: Tab = 'icons';
  private bg: Bg = 'dark';
  private showRef = false;
  private selected: string | null = null;
  private content!: Phaser.GameObjects.Container;
  private bar!: Phaser.GameObjects.Container;
  private bgLayer!: Phaser.GameObjects.Container;
  private contentH = 0;
  private scrollY = 0;
  private buildToken = 0;
  private status!: Phaser.GameObjects.Text;

  constructor() {
    super(SceneKeys.Gallery);
  }

  create(): void {
    const { params, clock } = ctx();
    clock.pause('DIALOG');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => clock.resume('DIALOG'));

    const p = params.get('gallery');
    if (p && (p in atlasGroups().groups || (SPECIAL_TABS as readonly string[]).includes(p))) this.tab = p;
    const bg = params.get('bg') as Bg | null;
    if (bg && BGS.includes(bg)) this.bg = bg;
    const ref = params.get('ref');
    if (ref) {
      this.showRef = true;
      this.selected = ref;
    }

    this.bgLayer = this.add.container(0, 0).setDepth(-10);
    this.content = this.add.container(0, 0);
    this.bar = this.add.container(0, 0).setDepth(10);
    this.status = this.add.text(0, 0, '', {
      fontFamily: FONT,
      resolution: TEXT_RES,
      fontSize: '13px',
      color: COLORS.text,
    });

    this.input.on(Phaser.Input.Events.POINTER_WHEEL, (_p: unknown, _o: unknown, _dx: number, dy: number) =>
      this.scrollBy(dy),
    );
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (ptr: Phaser.Input.Pointer) => {
      if (ptr.isDown && ptr.y > TOP_BAR_H) this.scrollBy(-(ptr.y - ptr.prevPosition.y));
    });
    this.input.keyboard?.on('keydown-ESC', () => this.scene.stop());
    this.scale.on(Phaser.Scale.Events.RESIZE, this.rebuild, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.scale.off(Phaser.Scale.Events.RESIZE, this.rebuild, this),
    );
    this.rebuild();
  }

  private scrollBy(dy: number): void {
    const maxScroll = Math.max(0, this.contentH - (this.scale.height - TOP_BAR_H));
    this.scrollY = Phaser.Math.Clamp(this.scrollY + dy, 0, maxScroll);
    this.content.y = TOP_BAR_H - this.scrollY;
  }

  private rebuild(): void {
    this.drawBackground();
    this.drawBar();
    void this.drawContent();
  }

  // ------------------------------------------------------------------ фон и панель

  private drawBackground(): void {
    this.bgLayer.removeAll(true);
    const { width, height } = this.scale;
    if (this.bg === 'dark') {
      this.bgLayer.add(this.add.rectangle(0, 0, width, height, 0x1b1d22).setOrigin(0));
    } else if (this.bg === 'checker') {
      const key = 'gallery-checker';
      if (!this.textures.exists(key)) {
        const g = this.make.graphics({}, false);
        g.fillStyle(0xffffff)
          .fillRect(0, 0, 32, 32)
          .fillStyle(0xcccccc)
          .fillRect(0, 0, 16, 16)
          .fillRect(16, 16, 16, 16);
        g.generateTexture(key, 32, 32);
        g.destroy();
      }
      this.bgLayer.add(this.add.tileSprite(0, 0, width, height, key).setOrigin(0));
    } else {
      const info = getAssetInfo('tiles.grass')!;
      const ts = this.add.tileSprite(0, 0, width, height, info.group, info.frame).setOrigin(0);
      ts.setTileScale(info.size[0] / ts.frame.width);
      this.bgLayer.add(ts);
    }
  }

  private drawBar(): void {
    this.bar.removeAll(true);
    const { width } = this.scale;
    this.bar.add(this.add.rectangle(0, 0, width, TOP_BAR_H, 0x000000, 0.82).setOrigin(0));
    const tabs: Tab[] = [
      ...Object.keys(atlasGroups().groups).filter((g) => g !== 'tiles' && g !== 'walls'),
      ...SPECIAL_TABS,
    ];
    let x = 8;
    let y = 6;
    const tabLabel = (tab: Tab) =>
      tab === 'tiles' || tab === 'walls' || tab === 'items' ? t(`gallery.tab.${tab}`) : tab;
    for (const tab of tabs) {
      const txt = this.add
        .text(x, y, tabLabel(tab), {
          fontFamily: FONT,
          resolution: TEXT_RES,
          fontSize: '14px',
          color: tab === this.tab ? '#000' : COLORS.text,
          backgroundColor: tab === this.tab ? '#e08a37' : '#3a332a',
          padding: { x: 8, y: 4 },
        })
        .setInteractive({ useHandCursor: true })
        .on('pointerup', () => {
          this.tab = tab;
          this.scrollY = 0;
          this.rebuild();
        });
      if (x + txt.width > width - 8) {
        x = 8;
        y += 28;
        txt.setPosition(x, y);
      }
      x += txt.width + 4;
      this.bar.add(txt);
    }
    y += 32;
    const button = (label: string, active: boolean, onClick: () => void) => {
      const b = this.add
        .text(x, y, label, {
          fontFamily: FONT,
          resolution: TEXT_RES,
          fontSize: '14px',
          color: active ? '#000' : COLORS.text,
          backgroundColor: active ? '#9fd36b' : '#3a332a',
          padding: { x: 8, y: 4 },
        })
        .setInteractive({ useHandCursor: true })
        .on('pointerup', onClick);
      x += b.width + 6;
      this.bar.add(b);
    };
    x = 8;
    button(t('gallery.bg', { bg: t(`gallery.bg.${this.bg}`) }), false, () => {
      this.bg = BGS[(BGS.indexOf(this.bg) + 1) % BGS.length]!;
      this.rebuild();
    });
    button(t('gallery.ref'), this.showRef, () => {
      this.showRef = !this.showRef;
      void this.drawContent();
    });
    button('×', false, () => this.scene.stop());
    this.status.setPosition(x + 8, y + 4);
    this.status.setText(this.selected ? `▶ ${this.selected}` : t('gallery.title'));
    this.bar.add(this.status);
  }

  // ------------------------------------------------------------------ содержимое

  private async drawContent(): Promise<void> {
    const token = ++this.buildToken;
    this.content.removeAll(true);
    this.content.y = TOP_BAR_H - this.scrollY;

    if (this.tab === 'items') return this.finish(this.drawItems());
    if (this.tab === 'tiles') return this.finish(this.drawTiles());
    if (this.tab === 'walls') return this.finish(this.drawWalls());

    if (!AssetLoader.isLoaded(this, this.tab)) {
      this.content.add(
        this.add.text(PAD, PAD, t('gallery.loading'), {
          fontFamily: FONT,
          resolution: TEXT_RES,
          fontSize: '16px',
          color: COLORS.text,
        }),
      );
      await AssetLoader.ensureGroup(this, this.tab);
      if (token !== this.buildToken || !this.scene.isActive()) return;
      this.content.removeAll(true);
    }
    this.finish(this.drawGroup(this.tab));
  }

  private finish(height: number): void {
    this.contentH = height;
    this.scrollBy(0);
  }

  /** Сетка спрайтов группы в логическом размере: подпись, точка привязки, эталон героя. */
  private drawGroup(group: string): number {
    const ids = assetIdsInGroup(group).sort();
    const maxW = this.scale.width - PAD * 2;
    let x = PAD;
    let y = PAD;
    let rowH = 0;
    const refInfo = getAssetInfo(REF_ID)!;
    const refW = (refInfo.size[0] / refInfo.size[1]) * refHeight();

    for (const id of ids) {
      const info = getAssetInfo(id)!;
      const [w, h] = this.displaySize(id);
      const withRef = this.showRef && this.selected === id;
      const cellW = Math.max(MIN_CELL_W, w + (withRef ? refW + 12 : 0)) + PAD;
      const cellH = h + LABEL_H + PAD;
      if (x + cellW > maxW + PAD && x > PAD) {
        x = PAD;
        y += rowH;
        rowH = 0;
      }
      // Позиция спрайта = точка привязки внутри ячейки.
      const sx = x + info.origin[0] * w;
      const sy = y + info.origin[1] * h;
      const img = spawnSprite(this, sx, sy, id, { depth: false });
      img.setInteractive({ useHandCursor: true }).on('pointerup', () => {
        this.selected = id;
        this.drawBar();
        void this.drawContent();
      });
      this.content.add(img);
      if (withRef) {
        const ref = spawnSprite(this, x + w + 12 + refW / 2, y + h, REF_ID, { depth: false }).setOrigin(
          0.5,
          1,
        );
        ref.setScale(refHeight() / ref.frame.height);
        this.content.add(ref);
        const frame = this.add.rectangle(x, y, w, h).setOrigin(0).setStrokeStyle(1, 0x9fd36b);
        this.content.add(frame);
      }
      this.content.add(this.cross(sx, sy));
      this.content.add(
        this.add.text(x, y + h + 4, id.slice(id.indexOf('.') + 1), {
          fontFamily: FONT,
          resolution: TEXT_RES,
          fontSize: '11px',
          color: this.bg === 'checker' ? '#111' : COLORS.text,
          wordWrap: { width: cellW - 6, useAdvancedWrap: true },
        }),
      );
      x += cellW;
      rowH = Math.max(rowH, cellH);
    }
    return y + rowH + PAD;
  }

  /** Логический размер в галерее; части рига — в масштабе героя по высоте исходника (2x → 1x). */
  private displaySize(id: string): [number, number] {
    const info = getAssetInfo(id)!;
    return info.size;
  }

  private cross(x: number, y: number): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    g.lineStyle(2, 0xff2a2a, 1);
    g.lineBetween(x - 6, y, x + 6, y);
    g.lineBetween(x, y - 6, x, y + 6);
    return g;
  }

  /** Каждый тайл повторён 4×4 — видно швы. */
  private drawTiles(): number {
    const ids = assetIdsInGroup('tiles').sort();
    const tile = getAssetInfo(ids[0]!)!.size[0];
    const block = tile * 4;
    let x = PAD;
    let y = PAD;
    for (const id of ids) {
      if (x + block > this.scale.width - PAD && x > PAD) {
        x = PAD;
        y += block + LABEL_H + PAD;
      }
      for (let ty = 0; ty < 4; ty++)
        for (let tx = 0; tx < 4; tx++)
          this.content.add(spawnSprite(this, x + tx * tile, y + ty * tile, id, { depth: false }));
      this.content.add(this.label(x, y + block + 4, id));
      x += block + PAD;
    }
    return y + block + LABEL_H + PAD;
  }

  /**
   * Комната 4×3 из каждого материала по building.json → assembly_rules (упрощённо):
   * стена = top_cap в клетке + лицо под ней, если южнее не стена; дверь = door_opening + door.
   */
  private drawWalls(): number {
    const b = registry().building;
    const cell = b.def.gridTile;
    // Комната с полом 4×3 внутри стен: # стена, . пол, D дверь, O окно (лицо окна вместо обычного).
    const plan = ['##O###', '#....#', '#....#', '#....#', '##D###'];
    const W = plan[0]!.length;
    const H = plan.length;
    const kind = (x: number, y: number) => plan[y]?.[x] ?? ' ';
    const isWall = (x: number, y: number) => '#DO'.includes(kind(x, y)) && kind(x, y) !== ' ';
    const roomW = W * cell;
    const roomH = (H + 1) * cell;
    let ox = PAD;
    let oy = PAD;
    for (const m of b.materials) {
      if (ox + roomW > this.scale.width - PAD && ox > PAD) {
        ox = PAD;
        oy += roomH + LABEL_H + PAD * 2;
      }
      const piece = (p: WallPiece, x: number, y: number) =>
        this.content.add(spawnSprite(this, ox + x, oy + y, m.sprites[p], { depth: false }));
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) if (kind(x, y) === '.') piece('floor', x * cell, y * cell);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!isWall(x, y)) continue;
          piece('top_cap', x * cell, y * cell);
          if (!isWall(x, y + 1) || kind(x, y) === 'D') {
            const face: WallPiece =
              kind(x, y) === 'O' ? 'window' : kind(x, y) === 'D' ? 'door_opening' : 'face';
            piece(face, x * cell, (y + 1) * cell);
            if (kind(x, y) === 'D') piece('door', x * cell, (y + 1) * cell);
          }
        }
      }
      this.content.add(this.label(ox, oy + roomH + 4, `${m.id} — ${m.name_ru}`));
      ox += roomW + PAD * 2;
    }
    return oy + roomH + LABEL_H + PAD * 2;
  }

  /** Все предметы иконками с названием и тиром. */
  private drawItems(): number {
    const items = registry().items.all;
    const cellW = 132;
    const cellH = 64 + 40 + 8;
    const perRow = Math.max(1, Math.floor((this.scale.width - PAD) / cellW));
    let missing = 0;
    items.forEach((it, i) => {
      const x = PAD + (i % perRow) * cellW;
      const y = PAD + Math.floor(i / perRow) * cellH;
      if (getAssetInfo(it.icon) && this.textures.exists(getAssetInfo(it.icon)!.group)) {
        this.content.add(spawnSprite(this, x + cellW / 2 - 8, y + 32, it.icon, { depth: false }));
      } else {
        missing++;
        this.content.add(this.add.rectangle(x + cellW / 2 - 8, y + 32, 60, 60, 0xff0000, 0.5));
      }
      this.content.add(
        this.add
          .text(x + cellW / 2 - 8, y + 68, `${it.name_ru}\nT${it.tier} · ${it.id}`, {
            fontFamily: FONT,
            resolution: TEXT_RES,
            fontSize: '11px',
            color: this.bg === 'checker' ? '#111' : COLORS.text,
            align: 'center',
            wordWrap: { width: cellW - 12, useAdvancedWrap: true },
          })
          .setOrigin(0.5, 0),
      );
    });
    this.status.setText(
      `${t('gallery.tab.items')}: ${items.length} · ${t('gallery.items_missing', { count: missing })}`,
    );
    return PAD + Math.ceil(items.length / perRow) * cellH + PAD;
  }

  private label(x: number, y: number, text: string): Phaser.GameObjects.Text {
    return this.add.text(x, y, text, {
      fontFamily: FONT,
      resolution: TEXT_RES,
      fontSize: '12px',
      color: this.bg === 'checker' ? '#111' : COLORS.text,
    });
  }
}
