import { log } from '../util/Log';
import {
  parseSave,
  SAVE_VERSION,
  SaveError,
  SaveIndex,
  slotMetaOf,
  type SaveGame,
  type SlotMeta,
} from './SaveModel';

/** Хранилище площадки (совпадает с PlatformServices.saves; core не импортирует platform). */
export interface SlotStorage {
  load(slot: string): Promise<string | null>;
  save(slot: string, json: string): Promise<boolean>;
}

export interface SaveRules {
  maxSlots: number;
  nameMaxLength: number;
  fullDaySec: number;
}

/** Начальное состояние новой игры (мир — по сиду, без изменений). */
export interface NewGameState {
  seed: number;
  hero: { x: number; y: number };
  worldSec: number;
  /** Размер мира в клетках (balance.json → world.sizeTiles). */
  size: number;
}

/** Кодек сжатия сохранений: строка JSON ↔ строка хранилища. */
export interface SaveCodec {
  encode(json: string): Promise<string>;
  decode(data: string): Promise<string>;
}

export const GZ_PREFIX = 'gz1:';

const INDEX_KEY = 'index';
const slotKey = (id: string) => `slot.${id}`;

/** Ошибка, которую можно показать игроку (имя занято, слотов нет…). */
export class SaveUserError extends Error {
  constructor(readonly code: 'name_empty' | 'name_taken' | 'slots_full' | 'not_found' | 'write_failed') {
    super(code);
  }
}

/**
 * Несколько именованных сохранений: у каждого свой мир и прогресс.
 * В хранилище площадки: «index» — список слотов, «slot.<id>» — сама игра.
 * Время (now, мс) передаёт игра — core системное время не читает.
 */
export class SaveManager {
  private index: SaveIndex | null = null;

  constructor(
    private readonly storage: SlotStorage,
    private readonly rules: SaveRules,
    private readonly codec: SaveCodec | null = null,
  ) {}

  /** Сжатие (TZ 9.7.2): «gz1:» + base64(gzip(JSON)); без кодека или старый JSON — как есть. */
  private encode(json: string): Promise<string> {
    return this.codec ? this.codec.encode(json) : Promise.resolve(json);
  }

  private decode(data: string): Promise<string> {
    if (data.startsWith(GZ_PREFIX)) {
      if (!this.codec) throw new SaveError('сжатое сохранение без кодека');
      return this.codec.decode(data);
    }
    return Promise.resolve(data);
  }

  /** Список сохранений, свежие сверху. */
  async list(): Promise<SlotMeta[]> {
    const idx = await this.loadIndex();
    return [...idx.slots].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Имя без лишних пробелов, не длиннее лимита. */
  normalizeName(name: string): string {
    return name.replace(/\s+/g, ' ').trim().slice(0, this.rules.nameMaxLength);
  }

  private async checkName(name: string, exceptId?: string): Promise<string> {
    const n = this.normalizeName(name);
    if (!n) throw new SaveUserError('name_empty');
    const idx = await this.loadIndex();
    if (
      idx.slots.some((s) => s.id !== exceptId && s.name.toLocaleLowerCase('ru') === n.toLocaleLowerCase('ru'))
    ) {
      throw new SaveUserError('name_taken');
    }
    return n;
  }

  /** Новая игра в новом слоте. */
  async create(name: string, start: NewGameState, now: number): Promise<SaveGame> {
    const idx = await this.loadIndex();
    if (idx.slots.length >= this.rules.maxSlots) throw new SaveUserError('slots_full');
    const n = await this.checkName(name);
    const save: SaveGame = {
      saveVersion: SAVE_VERSION,
      id: `s${idx.nextId}`,
      name: n,
      createdAt: now,
      updatedAt: now,
      worldSec: start.worldSec,
      playTimeSec: 0,
      hero: { ...start.hero },
      progress: { level: 1, xp: 0, maxBiome: 1, skills: {} },
      world: { seed: start.seed, chunks: {}, size: start.size },
      quests: { day: -1, daily: [], extraTaken: false, notesRead: [] },
      tutorial: { step: 0, count: 0, done: false },
      vehicles: [],
      bosses: [],
      map: { visited: [], deaths: [], pois: [] },
      stats: {},
    };
    idx.nextId++;
    await this.write(save, now);
    return save;
  }

  /** Загрузить игру. */
  async load(id: string): Promise<SaveGame> {
    const json = await this.storage.load(slotKey(id));
    if (!json) throw new SaveUserError('not_found');
    return parseSave(JSON.parse(await this.decode(json)));
  }

  /** Записать игру и обновить сводку в списке. */
  async write(save: SaveGame, now: number): Promise<void> {
    const s: SaveGame = { ...save, saveVersion: SAVE_VERSION, updatedAt: now };
    if (!(await this.storage.save(slotKey(s.id), await this.encode(JSON.stringify(s)))))
      throw new SaveUserError('write_failed');
    const idx = await this.loadIndex();
    const meta = slotMetaOf(s, this.rules.fullDaySec);
    const i = idx.slots.findIndex((x) => x.id === s.id);
    if (i >= 0) idx.slots[i] = meta;
    else idx.slots.push(meta);
    await this.saveIndex();
  }

  async rename(id: string, name: string, now: number): Promise<void> {
    const n = await this.checkName(name, id);
    const save = await this.load(id);
    save.name = n;
    await this.write(save, now);
  }

  async remove(id: string): Promise<void> {
    const idx = await this.loadIndex();
    if (!idx.slots.some((s) => s.id === id)) throw new SaveUserError('not_found');
    // Удаления в SaveService нет — слот затирается пустой строкой.
    await this.storage.save(slotKey(id), '');
    idx.slots = idx.slots.filter((s) => s.id !== id);
    await this.saveIndex();
  }

  private async loadIndex(): Promise<SaveIndex> {
    if (this.index) return this.index;
    const json = await this.storage.load(INDEX_KEY);
    let idx: SaveIndex = { saveVersion: SAVE_VERSION, nextId: 1, slots: [] };
    if (json) {
      try {
        const res = SaveIndex.safeParse(JSON.parse(json));
        if (res.success) idx = res.data;
        else log.warn('saves: список сохранений повреждён, начинаем заново', res.error.issues[0]);
      } catch (e) {
        log.warn('saves: список сохранений не читается', e);
      }
    }
    this.index = idx;
    return idx;
  }

  private async saveIndex(): Promise<void> {
    if (!this.index) return;
    if (!(await this.storage.save(INDEX_KEY, JSON.stringify(this.index))))
      throw new SaveUserError('write_failed');
  }
}

export { SaveError };
