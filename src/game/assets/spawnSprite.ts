import type Phaser from 'phaser';
import type { AssetId } from '../../core/data/schemas';
import { registry } from '../GameContext';
import { getAssetInfo } from './AssetIndex';

export interface SpawnOptions {
  /** 'y' — Y-сортировка объектов мира (по умолчанию); число — явная глубина; false — не трогать. */
  depth?: 'y' | number | false;
  /** Доп. множитель к логическому размеру. */
  scale?: number;
}

/**
 * Создаёт спрайт по assetId: текстура group/frame, точка привязки из индекса,
 * масштаб = логический размер / размер кадра (0.5 для атласов 2x), depth = y.
 */
export function spawnSprite(
  scene: Phaser.Scene,
  x: number,
  y: number,
  assetId: AssetId,
  opts: SpawnOptions = {},
): Phaser.GameObjects.Image {
  const info = getAssetInfo(assetId);
  if (!info) throw new Error(`spawnSprite: нет «${assetId}» в asset_index.json`);
  if (!scene.textures.exists(info.group)) {
    throw new Error(
      `spawnSprite: группа атласа «${info.group}» для «${assetId}» не загружена — AssetLoader.ensureGroup`,
    );
  }
  const img = scene.add.image(x, y, info.group, info.frame);
  img.setOrigin(info.origin[0], info.origin[1]);
  const k = opts.scale ?? 1;
  img.setScale((info.size[0] / img.frame.width) * k, (info.size[1] / img.frame.height) * k);
  const depth = opts.depth ?? 'y';
  if (depth === 'y') img.setDepth(y);
  else if (depth !== false) img.setDepth(depth);
  return img;
}

/** assetId иконки предмета по items.json. */
export function iconFor(itemId: string): AssetId {
  const item = registry().items.get(itemId);
  if (!item) throw new Error(`iconFor: нет предмета «${itemId}»`);
  return item.icon;
}
