import type { PlatformConfig } from '../../core/config/PlatformConfig';
import { log } from '../../core/util/Log';
import type { DeviceType, PlatformServices } from '../PlatformServices';
import { browserLanguage, detectBrowserDevice } from '../common/device';
import { LocalStorageSaves } from '../common/LocalStorageSaves';
import { LogAnalytics } from '../common/LogAnalytics';
import { StubAds } from '../common/StubAds';
import { StubPurchases } from '../common/StubPurchases';
import type { YSDK } from './ysdk';

/**
 * Яндекс Игры. Шаг 1: инициализация SDK, LoadingAPI, GameplayAPI, события паузы площадки.
 * Реклама, покупки и облачные сохранения пока заглушки — шаг 10.
 * Без SDK (локальный запуск архива) — режим заглушки, игра не падает.
 */
export class YandexPlatform implements PlatformServices {
  readonly id = 'yandex' as const;
  device: DeviceType = detectBrowserDevice();
  language = browserLanguage();
  readonly purchases: StubPurchases;
  readonly ads: StubAds;
  readonly saves = new LocalStorageSaves();
  readonly analytics = new LogAnalytics();
  private ysdk: YSDK | null = null;
  private pauseHandlers: { onPause: () => void; onResume: () => void } | null = null;

  constructor(config: PlatformConfig, iap: readonly string[]) {
    this.purchases = new StubPurchases(iap);
    this.ads = new StubAds(config.ads, () => this.purchases.has('remove_interstitials'));
  }

  get sdkAvailable(): boolean {
    return this.ysdk !== null;
  }

  async init(): Promise<void> {
    try {
      if (!window.YaGames) throw new Error('YaGames отсутствует');
      this.ysdk = await window.YaGames.init();
      this.device = this.ysdk.deviceInfo?.type ?? this.device;
      this.language = this.ysdk.environment?.i18n?.lang ?? this.language;
      this.subscribePause();
      log.info('Yandex SDK ready');
    } catch (e) {
      this.ysdk = null;
      log.warn('Yandex SDK not found, stub mode', e);
    }
  }

  onLoadingFinished(): void {
    this.call(() => this.ysdk?.features?.LoadingAPI?.ready());
  }
  onGameplayStart(): void {
    this.call(() => this.ysdk?.features?.GameplayAPI?.start());
  }
  onGameplayStop(): void {
    this.call(() => this.ysdk?.features?.GameplayAPI?.stop());
  }

  setPauseListener(onPause: () => void, onResume: () => void): void {
    this.pauseHandlers = { onPause, onResume };
  }

  private subscribePause(): void {
    this.call(() => {
      this.ysdk?.on?.('game_api_pause', () => this.pauseHandlers?.onPause());
      this.ysdk?.on?.('game_api_resume', () => this.pauseHandlers?.onResume());
    });
  }

  private call(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      log.warn('Yandex SDK call failed', e);
    }
  }
}
