import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../tools/readGameFiles';

interface Entry {
  group: string;
  frame: string;
  origin: [number, number];
  size: [number, number];
}
const index = JSON.parse(readFileSync(join(ROOT, 'public/atlases/asset_index.json'), 'utf8')) as Record<
  string,
  Entry
>;
const manifest = JSON.parse(readFileSync(join(ROOT, 'art/assets_manifest.json'), 'utf8')) as {
  assets: { id: string; status: string }[];
};

describe('asset_index.json', () => {
  it('нет ни одного replaced', () => {
    const replaced = manifest.assets.filter((a) => a.status === 'replaced').map((a) => a.id);
    expect(replaced.length).toBeGreaterThan(0);
    for (const id of replaced) expect(index[id], id).toBeUndefined();
  });

  it('у жабы есть исходный кадр и две разрезанные части', () => {
    for (const id of ['toad_tongue_and_sac', 'toad_tongue', 'toad_sac']) {
      expect(index[`characters.animals.${id}`], id).toBeDefined();
    }
  });

  it('точки привязки и логический размер', () => {
    expect(index['world.biome1_suburb.pine']).toMatchObject({ group: 'biome1', origin: [0.5, 1] });
    expect(index['world.biome1_suburb.pine']!.size[1]).toBe(192);
    expect(index['icons.base.planks']?.origin).toEqual([0.5, 0.5]);
    expect(index['tiles.grass']).toMatchObject({ origin: [0, 0], size: [64, 64] });
    expect(index['building.walls.wood_top_cap']?.size).toEqual([64, 64]);
    expect(index['building.walls.wood_face']?.size[0]).toBe(64);
  });
});
