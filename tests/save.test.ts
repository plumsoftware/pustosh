import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadGameData } from '../src/core/data';
import {
  gzipCodec,
  migrate,
  parseSave,
  SaveManager,
  SaveUserError,
  type SlotStorage,
} from '../src/core/save';
import { PlayerInventory } from '../src/core/inventory';
import { Stations } from '../src/core/systems/Craft';
import { placePiece } from '../src/core/world';
import { World } from '../src/core/world';
import { readAssetCatalog, readRawData, ROOT } from '../tools/readGameFiles';

const reg = loadGameData(readRawData(), readAssetCatalog()).registry!;
const index = JSON.parse(readFileSync(join(ROOT, 'public/atlases/asset_index.json'), 'utf8')) as Record<
  string,
  { size: [number, number] }
>;
const sizeOf = (id: string) => {
  const s = index[id]?.size;
  return s ? ([s[0] / 64, s[1] / 64] as const) : undefined;
};

class MemStorage implements SlotStorage {
  data = new Map<string, string>();
  async load(slot: string) {
    return this.data.get(slot) ?? null;
  }
  async save(slot: string, json: string) {
    this.data.set(slot, json);
    return true;
  }
}

const rules = { maxSlots: 3, nameMaxLength: 24, fullDaySec: 720 };
const start = {
  seed: reg.balance.world.seed,
  hero: { x: 512.5, y: 976.5 },
  worldSec: 60,
  size: reg.balance.world.sizeTiles[0],
};
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof SaveUserError ? e.code : String(e);
  }
};

describe('Сохранения', () => {
  it('несколько именованных игр, свежие сверху', async () => {
    const st = new MemStorage();
    const m = new SaveManager(st, rules);
    const a = await m.create('  Первая   игра ', start, 1000);
    const b = await m.create('Хардкор', start, 2000);
    expect(a.name).toBe('Первая игра');
    expect(a.id).not.toBe(b.id);
    expect((await m.list()).map((s) => s.name)).toEqual(['Хардкор', 'Первая игра']);
    // Список переживает перезапуск игры (новый менеджер читает то же хранилище).
    const m2 = new SaveManager(st, rules);
    expect((await m2.list()).map((s) => s.id)).toEqual([b.id, a.id]);
  });

  it('у каждого сохранения свой прогресс и свой мир', async () => {
    const m = new SaveManager(new MemStorage(), rules);
    const a = await m.create('А', start, 1);
    const b = await m.create('Б', start, 2);

    // Игра А: день 5, герой ушёл, срубил объект, выбросил предмет, дошёл до болота.
    const wa = new World(reg, { sizeOf });
    const o = wa.getChunk(7, 14).objects[0]!;
    wa.setObjectState(o, 'harvested');
    wa.dropItem({ id: 'wood', count: 3 }, 250, 480, 4 * 720);
    await m.write(
      {
        ...a,
        worldSec: 4 * 720 + 100,
        hero: { x: 250, y: 480 },
        progress: { level: 4, xp: 120, maxBiome: 2, skills: { fighter_1: 2 } },
        world: wa.exportDelta(),
      },
      10,
    );

    const la = await m.load(a.id);
    const lb = await m.load(b.id);
    expect(la.progress).toEqual({ level: 4, xp: 120, maxBiome: 2, skills: { fighter_1: 2 } });
    expect(lb.progress).toEqual({ level: 1, xp: 0, maxBiome: 1, skills: {} });
    const wa2 = new World(reg, { sizeOf });
    wa2.importDelta(la.world as never);
    const wb2 = new World(reg, { sizeOf });
    wb2.importDelta(lb.world as never);
    expect(wa2.getChunk(7, 14).objects.find((x) => x.uid === o.uid)?.state).toBe('harvested');
    expect(wb2.getChunk(7, 14).objects.find((x) => x.uid === o.uid)?.state).toBe('intact');
    const meta = (await m.list()).find((s) => s.id === a.id)!;
    expect(meta).toMatchObject({ day: 5, level: 4, maxBiome: 2 });
  });

  it('пустое и занятое имя, лимит слотов', async () => {
    const m = new SaveManager(new MemStorage(), rules);
    await m.create('Мир', start, 1);
    expect(await code(m.create('   ', start, 2))).toBe('name_empty');
    expect(await code(m.create('мир', start, 2))).toBe('name_taken');
    await m.create('Два', start, 2);
    await m.create('Три', start, 3);
    expect(await code(m.create('Четыре', start, 4))).toBe('slots_full');
    expect(m.normalizeName('x'.repeat(40))).toHaveLength(24);
  });

  it('переименование и удаление', async () => {
    const st = new MemStorage();
    const m = new SaveManager(st, rules);
    const a = await m.create('Старое', start, 1);
    const b = await m.create('Другое', start, 2);
    expect(await code(m.rename(a.id, 'Другое', 3))).toBe('name_taken');
    await m.rename(a.id, 'Новое', 3);
    expect((await m.load(a.id)).name).toBe('Новое');
    await m.remove(b.id);
    expect((await m.list()).map((s) => s.name)).toEqual(['Новое']);
    expect(await code(m.load(b.id))).toBe('not_found');
    // id удалённого слота не переиспользуется
    expect((await m.create('Ещё', start, 4)).id).not.toBe(b.id);
  });

  it('сохранение из более новой версии и повреждённое — понятные ошибки', () => {
    expect(() => parseSave({ saveVersion: 99 })).toThrow(/более новой версии/);
    expect(() => parseSave({ saveVersion: 1, id: 'x' })).toThrow(/повреждено/);
  });

  it('повреждённый список сохранений не ломает игру', async () => {
    const st = new MemStorage();
    st.data.set('index', '{не json');
    const m = new SaveManager(st, rules);
    expect(await m.list()).toEqual([]);
    expect((await m.create('Новая', start, 1)).name).toBe('Новая');
  });

  it('сохранение → загрузка (gzip + base64) даёт то же состояние: мир, постройки, станки, инвентарь', async () => {
    const store = new MemStorage();
    const m = new SaveManager(store, rules, gzipCodec());
    const a = await m.create('Сжатая', start, 1);
    const w = new World(reg, { sizeOf });
    w.cell(500, 960);
    const floor = placePiece(reg, null, 'floor', 0, { tx: 500, ty: 960, side: 'c' });
    w.setBuilt(500, 960, placePiece(reg, floor, 'wall', 0, { tx: 500, ty: 960, side: 'n' }));
    w.dropItem({ id: 'stone', count: 5 }, 501, 961, 10);
    const st = new Stations(reg);
    const wb = {
      uid: 'pl9',
      ref: { type: 'station' as const, id: 'workbench_1' },
      kind: 'station',
      sprite: '',
      x: 502,
      y: 962,
      biome: 1,
      collider: null,
      state: 'intact' as const,
    };
    st.enqueue(st.of(wb, 0), reg.recipes.require('r_wrench'), {});
    const inv = new PlayerInventory(reg);
    inv.add({ id: 'wood', count: 17 });
    const full = {
      ...a,
      hero: { x: 501, y: 961, inventory: inv.toJSON() },
      world: w.exportDelta(),
      craft: { known: ['r_wrench'], seen: [], stations: { ...st.toJSON() } },
      bosses: ['butcher'],
      quests: { day: 3, daily: [], extraTaken: true, notesRead: ['n01', 'n02'] },
    };
    await m.write(full, 5);
    const raw = store.data.get(`slot.${a.id}`)!;
    expect(raw.startsWith('gz1:')).toBe(true);
    const back = await m.load(a.id);
    expect({ ...back, updatedAt: 0 }).toEqual({ ...full, saveVersion: 2, updatedAt: 0 });
    const w2 = new World(reg, { sizeOf });
    w2.importDelta(back.world as never);
    expect(w2.edgeBits(500, 960, 'n')).toBe(1);
    expect(w2.cell(500, 960).floor).toBe(1);
    expect(new Stations(reg, back.craft!.stations as never).get('pl9')!.queue.length).toBe(1);
    expect(new PlayerInventory(reg, back.hero['inventory'] as never).count('wood')).toBe(17);
    expect(raw.length).toBeLessThan(200 * 1024);
  });

  it('миграция с версии 1: новые поля по умолчанию, обучение пройдено', () => {
    const v1 = {
      saveVersion: 1,
      id: 's1',
      name: 'Старая',
      createdAt: 1,
      updatedAt: 1,
      worldSec: 100,
      playTimeSec: 5,
      hero: { x: 1, y: 2 },
      progress: { level: 3, xp: 10, maxBiome: 1 },
      world: { seed: 1, chunks: {}, size: 1024 },
    };
    const m = migrate(v1);
    expect(m['saveVersion']).toBe(2);
    const p = parseSave(v1);
    expect(p.progress.skills).toEqual({});
    expect(p.tutorial.done).toBe(true);
    expect(p.vehicles).toEqual([]);
  });
});
