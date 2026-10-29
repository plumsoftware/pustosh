import type { AdsConfig } from '../../core/config/PlatformConfig';
import { log } from '../../core/util/Log';
import type { AdsService } from '../PlatformServices';
import { showAdStub } from './AdStubPresenter';

/** Показ рекламы площадкой: межстраничная — показана или нет; с наградой — досмотрена, закрыта, ошибка. */
export interface AdPresenter {
  interstitial(placement: string): Promise<'shown' | 'skipped' | 'error'>;
  rewarded(placement: string): Promise<'rewarded' | 'closed_early' | 'error'>;
}

/**
 * Правила рекламы из balance.json поверх показа площадки: межстраничная — только в разрешённых точках
 * и не чаще интервала, не показывается после покупки «без рекламы».
 */
export class RuledAds implements AdsService {
  private lastInterstitialAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly config: AdsConfig,
    private readonly isAdFree: () => boolean,
    private readonly presenter: AdPresenter,
    private readonly now: () => number = () => performance.now(),
  ) {}

  canShowInterstitial(): boolean {
    if (this.isAdFree()) return false;
    return this.now() - this.lastInterstitialAt >= this.config.interstitialMinIntervalSec * 1000;
  }

  async showInterstitial(placement: string): Promise<'shown' | 'skipped' | 'error'> {
    if (!this.config.interstitialPoints.includes(placement)) {
      log.debug(`ads: точка «${placement}» не разрешена для межстраничной рекламы`);
      return 'skipped';
    }
    if (!this.canShowInterstitial()) return 'skipped';
    this.lastInterstitialAt = this.now();
    return this.presenter.interstitial(placement);
  }

  async showRewarded(placement: string): Promise<'rewarded' | 'closed_early' | 'error'> {
    if (!this.config.rewarded.includes(placement))
      log.warn(`ads: точка награды «${placement}» не описана в balance.json`);
    return this.presenter.rewarded(placement);
  }
}

/** Реклама-заглушка (окно «РЕКЛАМА» на 2 с): dev и площадки без настоящей рекламы. Награда — всегда. */
export class StubAds extends RuledAds {
  constructor(config: AdsConfig, isAdFree: () => boolean, now?: () => number) {
    super(
      config,
      isAdFree,
      {
        interstitial: async (p) => {
          await showAdStub(p, 'interstitial');
          return 'shown';
        },
        rewarded: async (p) => {
          await showAdStub(p, 'rewarded');
          return 'rewarded';
        },
      },
      now,
    );
  }
}
