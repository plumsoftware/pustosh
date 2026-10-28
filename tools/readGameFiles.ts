/** Чтение данных и каталога спрайтов с диска (для валидатора и тестов; игра грузит их через Phaser). */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DATA_FILE_NAMES, pathToAssetId, prefabIdsOf, type AssetCatalog } from '../src/core/data';

export const ROOT = resolve(import.meta.dirname, '..');

export function readRawData(dir = join(ROOT, 'public/data')): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const name of DATA_FILE_NAMES) {
    const p = join(dir, `${name}.json`);
    if (existsSync(p)) raw[name] = JSON.parse(readFileSync(p, 'utf8'));
  }
  const prefabs: Record<string, unknown> = {};
  for (const id of prefabIdsOf(raw['worldgen'])) {
    const p = join(dir, 'world/prefabs', `${id}.json`);
    if (existsSync(p)) prefabs[id] = JSON.parse(readFileSync(p, 'utf8'));
  }
  raw['prefabs'] = prefabs;
  return raw;
}

/** id из public/atlases/asset_index.json + id со статусом replaced из art/assets_manifest.json. */
export function readAssetCatalog(): AssetCatalog | undefined {
  const indexPath = join(ROOT, 'public/atlases/asset_index.json');
  if (!existsSync(indexPath)) return undefined;
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as Record<string, unknown>;
  const replaced = new Set<string>();
  const manifestPath = join(ROOT, 'art/assets_manifest.json');
  if (existsSync(manifestPath)) {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      assets: { path: string; status: string }[];
    };
    for (const e of m.assets) if (e.status === 'replaced') replaced.add(pathToAssetId(e.path));
  }
  return { ids: new Set(Object.keys(index)), replaced };
}
