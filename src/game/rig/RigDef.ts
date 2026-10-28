import type { Registry } from '../../core/data/Registry';
import type { AssetId } from '../../core/data/schemas';
import { getAssetInfo } from '../assets/AssetIndex';

/**
 * Описание персонажа на риге: скелет из rigs.json (humanoid / quadruped) + части персонажа + калибровка
 * из data/rigs_tuned/<id>.json (её пишет редактор рига, F6).
 */
export type Vec2 = [number, number];

export interface BoneTuning {
  pivot?: Vec2;
  attach?: Vec2;
  /** Множитель к масштабу по формуле partLengthFrac. */
  scale?: number;
  /** Поворот покоя, градусы. */
  rest?: number;
  /** Порядок отрисовки (переопределяет z из rigs.json). */
  z?: number;
}

export interface RigTuning {
  id: string;
  skeleton: 'humanoid' | 'quadruped';
  /** Рост/длина персонажа на экране, px (по умолчанию bodyHeightPx / bodyLengthPx). */
  height?: number;
  bones: Record<string, BoneTuning>;
}

export interface ResolvedBone {
  id: string;
  parent: string | null;
  /** Имя части (head, torso…), null — кость без картинки (root). */
  part: string | null;
  pivot: Vec2;
  attach: Vec2;
  z: number;
  tint?: number;
  optional: boolean;
  /** Масштаб картинки: пикселей экрана на пиксель кадра атласа. */
  scale: number;
  rest: number;
}

export interface CharacterDef {
  id: string;
  name: string;
  skeleton: 'humanoid' | 'quadruped';
  /** Рост (гуманоид) или длина тела (зверь) на экране, px. */
  height: number;
  /** Часть → assetId. */
  parts: Record<string, AssetId>;
  /** Эталон для наложения в редакторе и запасного режима. */
  ref?: AssetId;
  refWalk?: AssetId;
  bones: ResolvedBone[];
  /** Есть ли калибровка (rigs_tuned). */
  tuned: boolean;
}

/** Калибровки, загруженные из data/rigs_tuned (PreloadScene) и сохранённые редактором. */
const tunings = new Map<string, RigTuning>();
export function setRigTuning(t: RigTuning): void {
  tunings.set(t.id, t);
}
export function getRigTuning(id: string): RigTuning | undefined {
  return tunings.get(id);
}

/** Длинная сторона кадра части в пикселях атласа (части рига хранятся без ресайза). */
function frameLongSide(assetId: AssetId): number {
  const info = getAssetInfo(assetId);
  if (!info) return 1;
  // Логический размер = кадр / 2 (атласы 2x).
  return Math.max(info.size[0], info.size[1]) * 2;
}

interface SkeletonJson {
  bodyHeightPx?: number;
  bodyLengthPx?: number;
  partLengthFrac: Record<string, number>;
  bones: {
    id: string;
    parent: string | null;
    sprite?: string;
    pivot?: Vec2;
    attach?: Vec2;
    z?: number;
    tint?: string;
    optional?: boolean;
  }[];
}

/** Части героя: имя части рига → спрайт. */
export const HERO_PARTS: Record<string, AssetId> = {
  pelvis: 'characters.hero.pelvis',
  torso: 'characters.hero.torso',
  head: 'characters.hero.head_neutral',
  upper_arm: 'characters.hero.upper_arm',
  forearm: 'characters.hero.forearm_open',
  thigh: 'characters.hero.thigh',
  shin: 'characters.hero.shin_boot',
  backpack: 'characters.hero.backpack',
};

/** Все персонажи с ригом: герой, враги (гуманоиды) и звери (четвероногие). */
export function listCharacters(reg: Registry): { id: string; name: string }[] {
  return [{ id: 'hero', name: 'Герой' }, ...reg.enemies.all.map((e) => ({ id: e.id, name: e.name_ru }))];
}

export function resolveCharacter(reg: Registry, id: string): CharacterDef {
  let skeleton: 'humanoid' | 'quadruped' = 'humanoid';
  let parts: Record<string, AssetId>;
  let ref: AssetId | undefined;
  let refWalk: AssetId | undefined;
  let name: string;
  if (id === 'hero') {
    parts = { ...HERO_PARTS };
    ref = 'characters.hero.ref_idle';
    refWalk = 'characters.hero.ref_walk';
    name = 'Герой';
  } else {
    const e = reg.enemies.require(id);
    skeleton = e.rig === 'quadruped' ? 'quadruped' : 'humanoid';
    parts = { ...e.parts };
    ref = parts['idle'];
    name = e.name_ru;
    // Ползун без ног: тряпьё вместо бедра (rigs.json → usage).
    if (id === 'crawler' && parts['rags'] && !parts['thigh']) parts['thigh'] = parts['rags'];
  }
  const sk = reg.rigs[skeleton] as unknown as SkeletonJson;
  const tuning = tunings.get(id);
  const height = tuning?.height ?? sk.bodyHeightPx ?? sk.bodyLengthPx ?? 96;
  const bones: ResolvedBone[] = [];
  for (const b of sk.bones) {
    const part = b.sprite && !b.sprite.startsWith('<') ? b.sprite : null;
    if (part && !parts[part] && b.id !== 'held_item') {
      // Части нет (у врага нет рюкзака, у ползуна — голени) — кость пропускается, дети тоже.
      continue;
    }
    if (b.parent && !bones.some((x) => x.id === b.parent)) continue;
    const t = tuning?.bones[b.id] ?? {};
    const frac = part ? (sk.partLengthFrac[part] ?? 0.25) : 0;
    const base = part ? (frac * height) / frameLongSide(parts[part]!) : 1;
    bones.push({
      id: b.id,
      parent: b.parent,
      part: b.id === 'held_item' ? 'held_item' : part,
      pivot: t.pivot ?? b.pivot ?? [0.5, 0.5],
      attach: t.attach ?? b.attach ?? [0, 0],
      z: t.z ?? b.z ?? 0,
      tint: b.tint ? parseInt(b.tint.slice(1), 16) : undefined,
      optional: b.optional ?? false,
      scale: base * (t.scale ?? 1),
      rest: t.rest ?? 0,
    });
  }
  return { id, name, skeleton, height, parts, ref, refWalk, bones, tuned: !!tuning };
}

/** Калибровка из текущих костей (для сохранения редактором). */
export function tuningOf(def: CharacterDef, reg: Registry): RigTuning {
  const base = resolveCharacterUntuned(reg, def.id);
  const bones: Record<string, BoneTuning> = {};
  for (const b of def.bones) {
    const o = base.bones.find((x) => x.id === b.id);
    bones[b.id] = {
      pivot: [round(b.pivot[0]), round(b.pivot[1])],
      attach: [round(b.attach[0]), round(b.attach[1])],
      scale: round(o && o.scale > 0 ? b.scale / o.scale : 1),
      rest: round(b.rest, 1),
      ...(o && o.z !== b.z ? { z: b.z } : {}),
    };
  }
  return { id: def.id, skeleton: def.skeleton, height: def.height, bones };
}

function resolveCharacterUntuned(reg: Registry, id: string): CharacterDef {
  const saved = tunings.get(id);
  tunings.delete(id);
  try {
    return resolveCharacter(reg, id);
  } finally {
    if (saved) tunings.set(id, saved);
  }
}

function round(v: number, digits = 3): number {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}
