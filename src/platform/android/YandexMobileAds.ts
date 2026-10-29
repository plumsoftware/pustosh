import { registerPlugin } from '@capacitor/core';
import { t } from '../../core/i18n/i18n';
import { log } from '../../core/util/Log';
import type { AdPresenter } from '../common/StubAds';

type NativeResult = 'shown' | 'rewarded' | 'closed' | 'unavailable' | 'busy' | 'error';

/** Нативный плагин tools/android/YandexAdsPlugin.java (флейвор ruStore). */
interface YandexAdsPlugin {
  showInterstitial(): Promise<{ result: NativeResult; message?: string }>;
  showRewarded(): Promise<{ result: NativeResult; message?: string }>;
}

const YandexAds = registerPlugin<YandexAdsPlugin>('YandexAds');

/** Пока блок грузится (загрузка — в момент показа, без предзагрузки) — надпись поверх игры. */
function loadingOverlay(): () => void {
  const el = document.createElement('div');
  el.className = 'pustosh-ad-stub';
  el.textContent = t('ad.loading');
  document.body.appendChild(el);
  return () => el.remove();
}

async function call(kind: 'interstitial' | 'rewarded', placement: string): Promise<NativeResult> {
  const hide = loadingOverlay();
  try {
    const r = await (kind === 'interstitial' ? YandexAds.showInterstitial() : YandexAds.showRewarded());
    if (r.result === 'error') log.warn(`ads: ${kind} «${placement}» — ${r.message ?? 'ошибка'}`);
    return r.result;
  } catch (e) {
    // Сборка без плагина (флейворы без РСЯ) — рекламы нет.
    log.warn(`ads: плагин YandexAds недоступен (${kind})`, e);
    return 'unavailable';
  } finally {
    hide();
  }
}

/**
 * Реклама РСЯ на Android (RuStore): межстраничная и с вознаграждением через Yandex Mobile Ads SDK.
 * Блок загружается прямо перед показом. Нет рекламы в сборке — межстраничная пропускается,
 * награда — ошибка (игра покажет, что реклама недоступна).
 */
export const yandexMobileAds: AdPresenter = {
  async interstitial(placement) {
    const r = await call('interstitial', placement);
    return r === 'shown' ? 'shown' : r === 'unavailable' ? 'skipped' : 'error';
  },
  async rewarded(placement) {
    const r = await call('rewarded', placement);
    return r === 'rewarded' ? 'rewarded' : r === 'closed' ? 'closed_early' : 'error';
  },
};
