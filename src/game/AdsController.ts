import { ctx } from './GameContext';

/**
 * Показ рекламы только через этот контроллер: на время показа — пауза AD (игра стоит, звук выключен).
 */
export const AdsController = {
  async interstitial(placement: string): Promise<'shown' | 'skipped' | 'error'> {
    const { clock, platform } = ctx();
    if (!platform.ads.canShowInterstitial()) return 'skipped';
    clock.pause('AD');
    try {
      return await platform.ads.showInterstitial(placement);
    } catch {
      return 'error';
    } finally {
      clock.resume('AD');
    }
  },

  async rewarded(placement: string): Promise<'rewarded' | 'closed_early' | 'error'> {
    const { clock, platform } = ctx();
    clock.pause('AD');
    try {
      return await platform.ads.showRewarded(placement);
    } catch {
      return 'error';
    } finally {
      clock.resume('AD');
    }
  },
};
