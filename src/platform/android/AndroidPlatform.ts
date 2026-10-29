import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { StatusBar } from '@capacitor/status-bar';
import type { PlatformConfig } from '../../core/config/PlatformConfig';
import { log } from '../../core/util/Log';
import type { BackButtonSource, DeviceType, PlatformServices, SaveService } from '../PlatformServices';
import { browserLanguage } from '../common/device';
import { LogAnalytics } from '../common/LogAnalytics';
import { RuledAds, StubAds } from '../common/StubAds';
import { yandexMobileAds } from './YandexMobileAds';
import { StubPurchases } from '../common/StubPurchases';

const SAVE_PREFIX = 'pustosh.save.';

/** Сохранения через @capacitor/preferences (SharedPreferences приложения). */
class PreferencesSaves implements SaveService {
  async load(slot: string): Promise<string | null> {
    try {
      return (await Preferences.get({ key: SAVE_PREFIX + slot })).value;
    } catch (e) {
      log.warn('saves: Preferences.get', e);
      return null;
    }
  }
  async save(slot: string, json: string): Promise<boolean> {
    try {
      await Preferences.set({ key: SAVE_PREFIX + slot, value: json });
      return true;
    } catch (e) {
      log.warn('saves: Preferences.set', e);
      return false;
    }
  }
}

/**
 * RuStore / Android (Capacitor): сохранения, жизненный цикл (сворачивание → пауза), кнопка «Назад» →
 * пауза, скрытая строка состояния, реклама РСЯ (YandexMobileAds). Покупки — заглушка до шага 10.
 */
export class AndroidPlatform implements PlatformServices, BackButtonSource {
  readonly id = 'android' as const;
  readonly device: DeviceType = Math.min(screen.width, screen.height) >= 600 ? 'tablet' : 'mobile';
  readonly language = browserLanguage();
  readonly purchases: StubPurchases;
  readonly ads: RuledAds;
  readonly saves = new PreferencesSaves();
  readonly analytics = new LogAnalytics();
  private pauseHandlers: { onPause: () => void; onResume: () => void } | null = null;
  private backHandler: (() => void) | null = null;

  constructor(config: PlatformConfig, iap: readonly string[]) {
    this.purchases = new StubPurchases(iap);
    const adFree = () => this.purchases.has('remove_interstitials');
    // В приложении — реклама РСЯ (флейвор ruStore), в браузере (отладка) — заглушка.
    this.ads = Capacitor.isNativePlatform()
      ? new RuledAds(config.ads, adFree, yandexMobileAds)
      : new StubAds(config.ads, adFree);
  }

  async init(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      log.warn('android platform: запущено не в Capacitor, нативные функции отключены');
      return;
    }
    try {
      await StatusBar.hide();
    } catch (e) {
      log.warn('StatusBar.hide', e);
    }
    await App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) this.pauseHandlers?.onResume();
      else this.pauseHandlers?.onPause();
    });
    // Без слушателя «Назад» закрывает приложение; со слушателем — решает игра (пауза).
    await App.addListener('backButton', () => this.backHandler?.());
  }

  onLoadingFinished(): void {}
  onGameplayStart(): void {}
  onGameplayStop(): void {}

  setPauseListener(onPause: () => void, onResume: () => void): void {
    this.pauseHandlers = { onPause, onResume };
  }

  setBackButtonListener(onBack: () => void): void {
    this.backHandler = onBack;
  }
}
