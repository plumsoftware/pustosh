import { log } from '../../core/util/Log';
import type { ProductInfo, PurchaseService } from '../PlatformServices';

const OWNED_KEY = 'pustosh.stub.owned';

/** Покупки-заглушка: каталог из balance.json → iap, покупка всегда успешна, владение — в localStorage. */
export class StubPurchases implements PurchaseService {
  private readonly ownedSet: Set<string>;

  constructor(private readonly productIds: readonly string[]) {
    this.ownedSet = new Set(readOwned());
  }

  /** Синхронная проверка для рекламы (canShowInterstitial). */
  has(productId: string): boolean {
    return this.ownedSet.has(productId);
  }

  async catalog(): Promise<ProductInfo[]> {
    return this.productIds.map((id) => ({ id, title: id, description: '', price: '0 ₽' }));
  }

  async purchase(productId: string): Promise<'success' | 'cancelled' | 'error'> {
    if (!this.productIds.includes(productId)) return 'error';
    this.ownedSet.add(productId);
    try {
      localStorage.setItem(OWNED_KEY, JSON.stringify([...this.ownedSet]));
    } catch (e) {
      log.warn('purchases: localStorage недоступен', e);
    }
    return 'success';
  }

  async owned(): Promise<Set<string>> {
    return new Set(this.ownedSet);
  }
}

function readOwned(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(OWNED_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
