import { t } from '../../core/i18n/i18n';

/** Длительность показа рекламы-заглушки. */
const STUB_AD_MS = 2000;

/**
 * Окно «РЕКЛАМА (заглушка)» поверх игры (DOM, без зависимости от движка).
 * Используется dev-платформой и заглушками площадок до шага 10.
 */
export function showAdStub(placement: string, kind: 'interstitial' | 'rewarded'): Promise<void> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'pustosh-ad-stub';
    el.dataset.kind = kind;
    const title = document.createElement('div');
    title.textContent = t('ad.stub.title');
    const sub = document.createElement('small');
    sub.textContent = `${t('ad.stub.placement', { placement })} · ${kind}`;
    el.append(title, sub);
    document.body.appendChild(el);
    setTimeout(() => {
      el.remove();
      resolve();
    }, STUB_AD_MS);
  });
}
