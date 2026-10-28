import type { PlatformConfig } from '../../core/config/PlatformConfig';
import { log } from '../../core/util/Log';
import type { DeviceType, PlatformServices } from '../PlatformServices';
import { browserLanguage, detectBrowserDevice } from '../common/device';
import { LocalStorageSaves } from '../common/LocalStorageSaves';
import { LogAnalytics } from '../common/LogAnalytics';
import { StubAds } from '../common/StubAds';
import { StubPurchases } from '../common/StubPurchases';

/** Локальная разработка: реклама — окно-заглушка на 2 с, сохранения — localStorage, покупки — всегда успех. */
export class DevPlatform implements PlatformServices {
  readonly id = 'dev' as const;
  readonly device: DeviceType = detectBrowserDevice();
  readonly language = browserLanguage();
  readonly purchases: StubPurchases;
  readonly ads: StubAds;
  readonly saves = new LocalStorageSaves();
  readonly analytics = new LogAnalytics();

  constructor(config: PlatformConfig, iap: readonly string[]) {
    this.purchases = new StubPurchases(iap);
    this.ads = new StubAds(config.ads, () => this.purchases.has('remove_interstitials'));
  }

  async init(): Promise<void> {
    log.info('dev platform: заглушки площадки');
  }
  onLoadingFinished(): void {
    log.debug('platform: loading finished');
  }
  onGameplayStart(): void {
    log.debug('platform: gameplay start');
  }
  onGameplayStop(): void {
    log.debug('platform: gameplay stop');
  }
  setPauseListener(_onPause: () => void, _onResume: () => void): void {
    // Событий площадки нет; вкладку и фокус отслеживает игра (TAB_HIDDEN).
  }
}
