import type { AssetId } from '../../core/data/schemas';

/** Запись public/atlases/asset_index.json. */
export interface AssetInfo {
  group: string;
  frame: string;
  origin: [number, number];
  /** Логический размер (1x) в пикселях. */
  size: [number, number];
  rig?: true;
}

export interface AtlasGroupInfo {
  load: 'start' | 'lazy';
  type: 'atlas' | 'multiatlas';
  json: string;
  images: string[];
  bytes: number;
  frames: number;
}

export interface AtlasGroups {
  scale: number;
  groups: Record<string, AtlasGroupInfo>;
}

let index: Readonly<Record<AssetId, AssetInfo>> = {};
let groups: AtlasGroups = { scale: 2, groups: {} };

export function setAssetIndex(i: Record<AssetId, AssetInfo>, g: AtlasGroups): void {
  index = i;
  groups = g;
}

export function getAssetInfo(assetId: AssetId): AssetInfo | undefined {
  return index[assetId];
}

export function allAssetIds(): AssetId[] {
  return Object.keys(index);
}

export function atlasGroups(): AtlasGroups {
  return groups;
}

export function assetIdsInGroup(group: string): AssetId[] {
  return Object.keys(index).filter((id) => index[id]!.group === group);
}
