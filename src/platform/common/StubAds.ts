import type { AdsConfig } from '../../core/config/PlatformConfig';
import { log } from '../../core/util/Log';
import type { AdsService } from '../PlatformServices';
import { showAdStub } from './AdStubPresenter';

/**
 * Реклама-заглушка с правилами из balance.json: межстраничная — только в разрешённых точках
 * и не чаще интервала, не показывается после покупки «без рекламы». Награда выдаётся всегда.
 */
export class StubAds implements AdsService {
  private lastInterstitialAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly config: AdsConfig,
    private readonly isAdFree: () => boolean,
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
    await showAdStub(placement, 'interstitial');
    return 'shown';
  }

  async showRewarded(placement: string): Promise<'rewarded' | 'closed_early' | 'error'> {
    if (!this.config.rewarded.includes(placement))
      log.warn(`ads: точка награды «${placement}» не описана в balance.json`);
    await showAdStub(placement, 'rewarded');
    return 'rewarded';
  }
}
