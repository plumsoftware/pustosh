/**
 * Платформенный слой — окончательные интерфейсы (ТЗ шаг 1.3). Сигнатуры не менять без владельца.
 */
export type PlatformId = 'yandex' | 'android' | 'dev';
export type DeviceType = 'desktop' | 'mobile' | 'tablet' | 'tv';

export interface ProductInfo {
  id: string;
  title: string;
  description: string;
  /** Цена строкой в валюте площадки: «99 ₽», «15 YAN». */
  price: string;
  imageUrl?: string;
}

export interface PlatformServices {
  readonly id: PlatformId;
  readonly device: DeviceType;
  readonly language: string; // 'ru', 'en'…
  readonly ads: AdsService;
  readonly saves: SaveService;
  readonly purchases: PurchaseService;
  readonly analytics: AnalyticsService;
  init(): Promise<void>; // до загрузки ресурсов
  onLoadingFinished(): void; // Яндекс: LoadingAPI.ready()
  onGameplayStart(): void; // Яндекс: GameplayAPI.start()
  onGameplayStop(): void; // Яндекс: GameplayAPI.stop()
  setPauseListener(onPause: () => void, onResume: () => void): void; // события площадки, сворачивание
}
export interface AdsService {
  canShowInterstitial(): boolean; // интервал из конфига + покупка «без рекламы»
  showInterstitial(placement: string): Promise<'shown' | 'skipped' | 'error'>;
  showRewarded(placement: string): Promise<'rewarded' | 'closed_early' | 'error'>;
}
export interface SaveService {
  load(slot: string): Promise<string | null>;
  save(slot: string, json: string): Promise<boolean>;
}
export interface PurchaseService {
  catalog(): Promise<ProductInfo[]>;
  purchase(productId: string): Promise<'success' | 'cancelled' | 'error'>;
  owned(): Promise<Set<string>>;
}
export interface AnalyticsService {
  event(name: string, params?: Record<string, unknown>): void;
}

/**
 * Необязательная возможность площадки: аппаратная кнопка «Назад» (Android).
 * Вне основного интерфейса, чтобы не менять его сигнатуры; подключается в main.ts.
 */
export interface BackButtonSource {
  setBackButtonListener(onBack: () => void): void;
}

export function hasBackButton(p: PlatformServices): p is PlatformServices & BackButtonSource {
  return typeof (p as Partial<BackButtonSource>).setBackButtonListener === 'function';
}
