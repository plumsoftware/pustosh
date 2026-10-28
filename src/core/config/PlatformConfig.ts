import type { BalanceDef } from '../data/schemas';

/** Ключ площадки в balance.json (survival.<key>, ads.<key>). */
export type BalanceKey = 'yandex' | 'rustore';

/** Какую ветку balance.json берёт сборка: dev — как Яндекс, android — RuStore. */
const BALANCE_KEY_BY_BUILD: Readonly<Record<string, BalanceKey>> = {
  dev: 'yandex',
  yandex: 'yandex',
  android: 'rustore',
};

export interface AdsConfig {
  interstitialMinIntervalSec: number;
  interstitialPoints: readonly string[];
  rewarded: readonly string[];
}

export interface SurvivalConfig {
  hungerPerMin: number;
  thirstPerMin: number;
  coldDmgPerSec: number;
}

export interface PlatformConfig {
  readonly balanceKey: BalanceKey;
  readonly ads: AdsConfig;
  readonly survival: SurvivalConfig;
  /** MVP: открыты биомы и боссы 1..mvpBiomeLimit. Фичефлаг, не баланс. */
  readonly mvpBiomeLimit: number;
  readonly debug: boolean;
}

export const MVP_BIOME_LIMIT = 3;

/** Значение площадки с разворачиванием ссылок «as <другая площадка>». */
function resolve<T>(
  table: Readonly<Record<string, T | string>>,
  key: string,
  section: string,
  seen: string[] = [],
): T {
  const v = table[key];
  if (v === undefined) throw new Error(`balance.json → ${section}.${key}: нет настроек площадки`);
  if (typeof v !== 'string') return v;
  const m = /^as (\w+)$/.exec(v);
  if (!m || !m[1]) throw new Error(`balance.json → ${section}.${key}: непонятное значение «${v}»`);
  if (seen.includes(m[1]))
    throw new Error(`balance.json → ${section}: циклическая ссылка ${[...seen, key, m[1]].join(' → ')}`);
  return resolve(table, m[1], section, [...seen, key]);
}

/** Значение поля с разворачиванием «as …» на уровне отдельного поля (ads.rustore.rewarded = "as yandex"). */
function resolveField<T>(
  table: Readonly<Record<string, Record<string, unknown> | string>>,
  key: string,
  field: string,
  section: string,
): T {
  const own = resolve(table, key, section) as Record<string, unknown>;
  const v = own[field];
  if (typeof v === 'string') {
    const m = /^as (\w+)$/.exec(v);
    if (m && m[1] && m[1] !== key) return resolveField<T>(table, m[1], field, section);
  }
  if (v === undefined) throw new Error(`balance.json → ${section}.${key}.${field}: нет значения`);
  return v as T;
}

export function createPlatformConfig(
  balance: BalanceDef,
  buildPlatform: string,
  debug: boolean,
): PlatformConfig {
  const key = BALANCE_KEY_BY_BUILD[buildPlatform] ?? 'yandex';
  const ads = balance.ads as Record<string, Record<string, unknown> | string>;
  const survival = balance.survival as Record<string, Record<string, unknown> | string>;
  return {
    balanceKey: key,
    ads: {
      interstitialMinIntervalSec: resolveField<number>(ads, key, 'interstitialMinIntervalSec', 'ads'),
      interstitialPoints: resolveField<string[]>(ads, key, 'interstitialPoints', 'ads'),
      rewarded: resolveField<string[]>(ads, key, 'rewarded', 'ads'),
    },
    survival: {
      hungerPerMin: resolveField<number>(survival, key, 'hungerPerMin', 'survival'),
      thirstPerMin: resolveField<number>(survival, key, 'thirstPerMin', 'survival'),
      coldDmgPerSec: resolveField<number>(survival, key, 'coldDmgPerSec', 'survival'),
    },
    mvpBiomeLimit: MVP_BIOME_LIMIT,
    debug,
  };
}
