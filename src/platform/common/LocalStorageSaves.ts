import { log } from '../../core/util/Log';
import type { SaveService } from '../PlatformServices';

const PREFIX = 'pustosh.save.';

/** Сохранения в localStorage браузера (dev, Яндекс до облачных сохранений шага 10). */
export class LocalStorageSaves implements SaveService {
  async load(slot: string): Promise<string | null> {
    try {
      return localStorage.getItem(PREFIX + slot);
    } catch (e) {
      log.warn('saves: localStorage недоступен', e);
      return null;
    }
  }

  async save(slot: string, json: string): Promise<boolean> {
    try {
      localStorage.setItem(PREFIX + slot, json);
      return true;
    } catch (e) {
      log.warn('saves: не удалось сохранить', e);
      return false;
    }
  }
}
