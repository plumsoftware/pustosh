import Phaser from 'phaser';
import type { AssetId } from '../../core/data/schemas';
import { registry } from '../GameContext';
import { getAssetInfo } from '../assets/AssetIndex';
import type { CharacterDef, ResolvedBone } from './RigDef';
import { EMPTY_POSE, type Pose } from './Pose';

/** Предмет в руке — масштаб от роста (rigs.json → held_item: «~0.45 bodyHeight»). */
const HELD_ITEM_FRAC = 0.45;

interface BoneNode {
  bone: ResolvedBone;
  img: Phaser.GameObjects.Image | null;
  /** Текущий спрайт части (с учётом замен). */
  asset: AssetId | null;
  /** Мировые (в контейнере) координаты точки pivot и поворот, радианы. */
  x: number;
  y: number;
  rot: number;
}

export interface BoneWorld {
  x: number;
  y: number;
  rot: number;
}

/**
 * Персонаж из частей: Container с картинками костей (порядок по z), иерархия поворотов,
 * поза добавляется к покою. Разворот влево — scaleX = -1 у контейнера.
 */
/**
 * Части, нарисованные зеркально к ригу: у рюкзака лямки слева на картинке, а на спине героя (риг смотрит
 * вправо, рюкзак — слева от торса) они должны прилегать к спине.
 */
const MIRRORED_PARTS = new Set(['backpack']);

export class RigInstance {
  readonly container: Phaser.GameObjects.Container;
  private nodes: BoneNode[] = [];
  private byId = new Map<string, BoneNode>();
  private swapParts: Record<string, AssetId> = {};
  private facing = 1;
  /** Тинт поверх всех частей (урон, холод); у дальних конечностей умножается на их тинт. */
  private tintAll: number | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    public def: CharacterDef,
    x: number,
    y: number,
  ) {
    this.container = scene.add.container(x, y);
    this.build();
  }

  /** Пересобрать (после калибровки в редакторе). */
  rebuild(def: CharacterDef): void {
    this.def = def;
    this.container.removeAll(true);
    this.build();
  }

  private build(): void {
    this.nodes = [];
    this.byId.clear();
    for (const bone of this.def.bones) {
      const asset = bone.part && bone.part !== 'held_item' ? (this.def.parts[bone.part] ?? null) : null;
      const node: BoneNode = { bone, img: null, asset, x: 0, y: 0, rot: 0 };
      if (asset) node.img = this.makeImage(asset, bone);
      this.nodes.push(node);
      this.byId.set(bone.id, node);
    }
    this.sortZ();
    this.apply(EMPTY_POSE);
  }

  private makeImage(asset: AssetId, bone: ResolvedBone): Phaser.GameObjects.Image | null {
    const info = getAssetInfo(asset);
    if (!info || !this.scene.textures.exists(info.group)) return null;
    const img = this.scene.make.image({ key: info.group, frame: info.frame, add: false });
    img.setOrigin(bone.pivot[0], bone.pivot[1]);
    if (bone.part && MIRRORED_PARTS.has(bone.part)) img.setFlipX(true);
    if (bone.tint !== undefined) img.setTint(bone.tint);
    return img;
  }

  private sortZ(): void {
    this.container.removeAll(false);
    const ordered = this.nodes.map((n, i) => ({ n, i })).sort((a, b) => a.n.bone.z - b.n.bone.z || a.i - b.i);
    for (const { n } of ordered) if (n.img) this.container.add(n.img);
  }

  /** Сменить часть кости (голова: гримаса, моргание, головной убор). null — исходная часть. */
  setPart(part: string, asset: AssetId | null): void {
    if (asset) this.swapParts[part] = asset;
    else delete this.swapParts[part];
  }

  /** Предмет в руке — иконка на кости held_item. */
  setHeldItem(icon: AssetId | null): void {
    const n = this.byId.get('held_item');
    if (!n) return;
    if (n.asset === icon) return;
    n.img?.destroy();
    n.img = null;
    n.asset = icon;
    if (icon) {
      n.img = this.makeImage(icon, n.bone);
      if (n.img) {
        const held = heldCfg(icon);
        if (held.mirror) n.img.setTexture(mirroredTexture(this.scene, icon));
        const k =
          ((held.frac ?? HELD_ITEM_FRAC) * this.def.height) / Math.max(n.img.frame.width, n.img.frame.height);
        n.bone = { ...n.bone, scale: k };
      }
    }
    this.sortZ();
  }

  setFacing(dir: 1 | -1): void {
    this.facing = dir;
    this.container.scaleX = dir * Math.abs(this.container.scaleY || 1);
  }

  get facingDir(): number {
    return this.facing;
  }

  setTintAll(color: number | null): void {
    this.tintAll = color;
  }

  /** Постоянный тинт части (торс под цвет одежды — шаг 8). */
  private partTint: Record<string, number> = {};

  setPartTint(part: string, color: number | null): void {
    if (color === null) delete this.partTint[part];
    else this.partTint[part] = color;
  }

  setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
  }

  /**
   * Применяет позу: корень → кости по порядку rigs.json (родитель раньше ребёнка).
   * attach — смещение от pivot родителя в долях роста, поворачивается вместе с родителем.
   */
  apply(pose: Pose): void {
    const H = this.def.height;
    const root = pose.root ?? {};
    const rootRot = Phaser.Math.DegToRad(root.rot ?? 0);
    // Поворот корня вокруг точки на высоте pivotY (кувырок — вокруг центра тела).
    const py = (root.pivotY ?? 0) * H;
    const rx = (root.dx ?? 0) * H - Math.sin(rootRot) * -py * 1;
    const ry = (root.dy ?? 0) * H + py - Math.cos(rootRot) * py;
    for (const n of this.nodes) {
      const b = n.bone;
      const p = pose.bones[b.id] ?? {};
      const parent = b.parent ? this.byId.get(b.parent) : null;
      const prot = parent ? parent.rot : rootRot;
      const px0 = parent ? parent.x : rx;
      const py0 = parent ? parent.y : ry;
      const ax = (b.attach[0] + (p.dx ?? 0)) * H;
      const ay = (b.attach[1] + (p.dy ?? 0)) * H;
      const c = Math.cos(prot);
      const s = Math.sin(prot);
      n.x = px0 + ax * c - ay * s;
      n.y = py0 + ax * s + ay * c;
      n.rot = prot + Phaser.Math.DegToRad(b.rest + (p.rot ?? 0));
      if (!b.parent) n.rot = rootRot + Phaser.Math.DegToRad(p.rot ?? 0);
      // Замена части (поза — swaps по имени части, setPart — постоянная).
      if (b.part && b.part !== 'held_item') {
        const swapKey = pose.swaps?.[b.part];
        const want = this.resolveSwap(b.part, swapKey) ?? this.def.parts[b.part] ?? null;
        if (want && want !== n.asset) this.swapImage(n, want);
      }
      if (n.img) {
        n.img.setPosition(n.x, n.y);
        n.img.setRotation(n.rot);
        n.img.setScale(b.scale, b.scale * (p.sy ?? 1));
        const pt = b.part ? this.partTint[b.part] : undefined;
        const base = pt !== undefined ? (b.tint !== undefined ? mulColor(b.tint, pt) : pt) : b.tint;
        if (this.tintAll !== null)
          n.img.setTint(base !== undefined ? mulColor(base, this.tintAll) : this.tintAll);
        else if (base !== undefined) n.img.setTint(base);
        else n.img.clearTint();
      }
    }
  }

  /** Имя замены из позы (hurt, blink, fist) → спрайт. Постоянные замены (головной убор) — в setPart. */
  private resolveSwap(part: string, key: string | undefined): AssetId | null {
    // Головной убор (постоянная замена) важнее гримасы и моргания.
    if (this.swapParts[part]) return this.swapParts[part]!;
    if (key) {
      const base = this.def.parts[part];
      if (base) {
        const candidate = base.replace(/_[a-z]+$/, `_${key}`);
        if (getAssetInfo(candidate)) return candidate;
      }
    }
    return null;
  }

  private swapImage(n: BoneNode, asset: AssetId): void {
    const info = getAssetInfo(asset);
    if (!info || !n.img) return;
    n.img.setTexture(info.group, info.frame);
    n.asset = asset;
  }

  /** Положение кости в мире (для вспышки выстрела, следа удара, предмета). */
  boneWorld(id: string): BoneWorld | null {
    const n = this.byId.get(id);
    if (!n) return null;
    const c = this.container;
    return { x: c.x + n.x * c.scaleX, y: c.y + n.y * c.scaleY, rot: n.rot * Math.sign(c.scaleX) };
  }

  /** Картинки частей (для редактора). */
  boneImage(id: string): Phaser.GameObjects.Image | null {
    return this.byId.get(id)?.img ?? null;
  }

  bonePoint(id: string): { x: number; y: number } | null {
    const n = this.byId.get(id);
    return n ? { x: n.x, y: n.y } : null;
  }

  destroy(): void {
    this.container.destroy();
  }
}

function mulColor(a: number, b: number): number {
  const r = (((a >> 16) & 255) * ((b >> 16) & 255)) / 255;
  const g = (((a >> 8) & 255) * ((b >> 8) & 255)) / 255;
  const bl = ((a & 255) * (b & 255)) / 255;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

/** combat.json → held: размер предмета в руке и отражённые иконки. */
interface HeldDef {
  defaultFrac: number;
  fracByTool: Record<string, number>;
  fracById: Record<string, number>;
  mirror: string[];
}

/** Настройка предмета в руке по его иконке (предмет — по полю icon в items.json). */
function heldCfg(icon: AssetId): { frac?: number; mirror: boolean } {
  let reg;
  try {
    reg = registry();
  } catch {
    return { mirror: false };
  }
  const H = reg.combat['held'] as HeldDef | undefined;
  const item = reg.items.all.find((i) => i.icon === icon);
  if (!H || !item) return { frac: H?.defaultFrac, mirror: false };
  const tool = typeof item['toolType'] === 'string' ? (item['toolType'] as string) : '';
  return {
    frac: H.fracById[item.id] ?? H.fracByTool[tool] ?? H.defaultFrac,
    mirror: H.mirror.includes(item.id),
  };
}

/**
 * Иконка, отражённая вдоль рукояти: зеркально по X и поворот на 90° по часовой — рукоять снова
 * внизу слева, но рабочая часть (боёк молотка) смотрит вперёд, как лезвие топора. Кэшируется.
 */
function mirroredTexture(scene: Phaser.Scene, icon: AssetId): string {
  const key = `held-mirror:${icon}`;
  if (scene.textures.exists(key)) return key;
  const info = getAssetInfo(icon)!;
  const f = scene.textures.getFrame(info.group, info.frame);
  const w = f.cutWidth;
  const h = f.cutHeight;
  const tex = scene.textures.createCanvas(key, h, w)!;
  const c = tex.context;
  c.translate(h / 2, w / 2);
  c.rotate(Math.PI / 2);
  c.scale(-1, 1);
  c.drawImage(f.source.image as CanvasImageSource, f.cutX, f.cutY, w, h, -w / 2, -h / 2, w, h);
  tex.refresh();
  return key;
}
