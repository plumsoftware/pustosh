import type { PlatformConfig } from '../core/config/PlatformConfig';
import type { Registry } from '../core/data/Registry';
import type { SaveGame, SaveManager } from '../core/save';
import { GameClock } from '../core/util/GameClock';
import type { PlatformServices } from '../platform/PlatformServices';

/** Общие объекты игры: часы, площадка, конфиг, данные. Создаётся в main.ts до запуска Phaser. */
export interface GameContext {
  readonly clock: GameClock;
  readonly platform: PlatformServices;
  readonly config: PlatformConfig;
  readonly version: string;
  readonly debug: boolean;
  /** Параметры адреса (?gallery=…, ?scene=stress) для отладки. */
  readonly params: URLSearchParams;
  /** Масштаб рендера: пикселей канваса на CSS-пиксель (1 — как CSS, 2 — физическое разрешение). */
  readonly renderScale: number;
  /** Заполняется в PreloadScene. */
  registry: Registry | null;
  /** Сохранения (создаётся в PreloadScene, когда известны правила из данных). */
  saves: SaveManager | null;
  /** Текущая игра: её загружает WorldScene и в неё же сохраняет. */
  currentSave: SaveGame | null;
}

let current: GameContext | null = null;

export function createContext(
  c: Omit<GameContext, 'clock' | 'registry' | 'saves' | 'currentSave'>,
): GameContext {
  current = { ...c, clock: new GameClock(), registry: null, saves: null, currentSave: null };
  return current;
}

export function ctx(): GameContext {
  if (!current) throw new Error('GameContext не создан');
  return current;
}

/** Registry после загрузки данных (бросает ошибку, если вызвать раньше PreloadScene). */
export function registry(): Registry {
  const r = ctx().registry;
  if (!r) throw new Error('Registry ещё не загружен (PreloadScene)');
  return r;
}
