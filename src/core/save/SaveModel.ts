import { z } from 'zod';

/**
 * Модель сохранения. Каждое сохранение — отдельная игра со своим прогрессом: изменения мира,
 * позиция героя, время суток, уровень. Миграций пока нет (выпущенных сохранений не было);
 * saveVersion пишется, чтобы сохранение из более новой версии игры не было испорчено.
 */
export const SAVE_VERSION = 2;

/** Прогресс героя. Уровень и опыт заполняются с шага 9 (навыки); пока — начальные значения. */
export const ProgressV1 = z.looseObject({
  level: z.number().int().min(1),
  xp: z.number().min(0),
  /** Самый дальний биом, куда дошёл герой (1…6). */
  maxBiome: z.number().int().min(1).max(6),
});
export const ProgressV2 = ProgressV1.extend({ skills: z.record(z.string(), z.number().int().min(0)) });
export type Progress = z.infer<typeof ProgressV2>;

export const SaveGameV1 = z.looseObject({
  saveVersion: z.union([z.literal(1), z.literal(2)]),
  id: z.string().min(1),
  name: z.string().min(1),
  /** Время создания и последнего сохранения — мс эпохи (даёт игра, не core). */
  createdAt: z.number(),
  updatedAt: z.number(),
  /** Сколько игровых секунд прошло в этой игре (время суток и номер дня). */
  worldSec: z.number().min(0),
  /** Сколько реального времени наиграно, с. */
  playTimeSec: z.number().min(0),
  hero: z.looseObject({ x: z.number(), y: z.number() }),
  progress: ProgressV1,
  /** Изменения мира относительно генерации (World.exportDelta). */
  world: z.object({
    seed: z.number(),
    chunks: z.record(z.string(), z.unknown()),
    nextDropId: z.number().int().optional(),
    size: z.number().int().optional(),
  }),
  /** Крафт (шаг 6): известные рецепты и станки (очереди, выход, топливо — Stations.toJSON). */
  craft: z
    .looseObject({
      known: z.array(z.string()),
      stations: z.looseObject({ list: z.array(z.unknown()), hands: z.array(z.unknown()) }),
    })
    .optional(),
});
export type SaveGameV1Type = z.infer<typeof SaveGameV1>;

/**
 * Формат 2 (шаг 9): навыки в прогрессе, задания и записки, обучение, транспорт, побеждённые боссы,
 * открытые ворота (в дельте мира), карта (посещённые чанки, места смерти), статистика.
 */
export const SaveGameV2 = SaveGameV1.extend({
  saveVersion: z.literal(2),
  progress: ProgressV2,
  quests: z.looseObject({
    day: z.number(),
    daily: z.array(z.unknown()),
    extraTaken: z.boolean(),
    notesRead: z.array(z.string()),
  }),
  tutorial: z.looseObject({ step: z.number().int(), count: z.number(), done: z.boolean() }),
  vehicles: z.array(z.unknown()),
  bosses: z.array(z.string()),
  map: z.looseObject({
    visited: z.array(z.string()),
    deaths: z.array(z.tuple([z.number(), z.number()])),
    pois: z.array(z.string()),
  }),
  stats: z.record(z.string(), z.number()),
});

/** Миграции по версии: 1 → 2 — новые поля по умолчанию (обучение считается пройденным). */
export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw };
  if (out['saveVersion'] === 1) {
    const progress = { ...(out['progress'] as object), skills: {} };
    Object.assign(out, {
      saveVersion: 2,
      progress,
      quests: { day: -1, daily: [], extraTaken: false, notesRead: [] },
      tutorial: { step: 0, count: 0, done: true },
      vehicles: [],
      bosses: [],
      map: { visited: [], deaths: [], pois: [] },
      stats: {},
    });
  }
  return out;
}

export type SaveGame = z.infer<typeof SaveGameV2>;

/** Краткая информация о слоте для списка сохранений (без тяжёлых данных мира). */
export const SlotMeta = z.looseObject({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  day: z.number().int().min(1),
  level: z.number().int().min(1),
  maxBiome: z.number().int().min(1).max(6),
  playTimeSec: z.number().min(0),
});
export type SlotMeta = z.infer<typeof SlotMeta>;

export const SaveIndex = z.looseObject({
  saveVersion: z.number().int().min(1),
  /** Счётчик для id новых слотов. */
  nextId: z.number().int().min(1),
  slots: z.array(SlotMeta),
});
export type SaveIndex = z.infer<typeof SaveIndex>;

export class SaveError extends Error {}

/** Проверяет загруженное сохранение. */
export function parseSave(raw: unknown): SaveGame {
  if (!raw || typeof raw !== 'object') throw new SaveError('сохранение повреждено: не объект');
  const v = (raw as Record<string, unknown>)['saveVersion'];
  if (typeof v === 'number' && v > SAVE_VERSION) {
    throw new SaveError(`сохранение из более новой версии игры (формат ${v}, игра знает ${SAVE_VERSION})`);
  }
  const res = SaveGameV2.safeParse(migrate(raw as Record<string, unknown>));
  if (!res.success) {
    const i = res.error.issues[0]!;
    throw new SaveError(`сохранение повреждено: ${i.path.join('.') || '(корень)'} — ${i.message}`);
  }
  return res.data;
}

/** Сводка слота из сохранения. */
export function slotMetaOf(save: SaveGame, fullDaySec: number): SlotMeta {
  return {
    id: save.id,
    name: save.name,
    createdAt: save.createdAt,
    updatedAt: save.updatedAt,
    day: Math.floor(save.worldSec / fullDaySec) + 1,
    level: save.progress.level,
    maxBiome: save.progress.maxBiome,
    playTimeSec: save.playTimeSec,
  };
}
