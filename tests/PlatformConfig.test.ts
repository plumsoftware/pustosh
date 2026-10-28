import { describe, expect, it } from 'vitest';
import { createPlatformConfig, MVP_BIOME_LIMIT } from '../src/core/config/PlatformConfig';
import { BalanceDef } from '../src/core/data/schemas';
import { readRawData } from '../tools/readGameFiles';

const balance = BalanceDef.parse(readRawData().balance);

describe('PlatformConfig', () => {
  it('Яндекс и dev берут ветку yandex', () => {
    for (const p of ['yandex', 'dev']) {
      const c = createPlatformConfig(balance, p, false);
      expect(c.balanceKey).toBe('yandex');
      expect(c.ads.interstitialMinIntervalSec).toBe(180);
      expect(c.survival.hungerPerMin).toBe(0.7);
    }
  });

  it('android — RuStore, «rewarded: as yandex» разворачивается', () => {
    const c = createPlatformConfig(balance, 'android', false);
    const y = createPlatformConfig(balance, 'yandex', false);
    expect(c.balanceKey).toBe('rustore');
    expect(c.ads.interstitialMinIntervalSec).toBe(240);
    expect(c.ads.rewarded).toEqual(y.ads.rewarded);
    expect(c.ads.rewarded.length).toBeGreaterThan(0);
    expect(c.mvpBiomeLimit).toBe(MVP_BIOME_LIMIT);
  });

  it('циклическая ссылка «as» — понятная ошибка', () => {
    const bad = { ...balance, ads: { yandex: 'as rustore', rustore: 'as yandex' } } as unknown as BalanceDef;
    expect(() => createPlatformConfig(bad, 'yandex', false)).toThrow(/циклическая/);
  });
});
