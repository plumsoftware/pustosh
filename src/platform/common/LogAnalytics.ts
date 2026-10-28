import { log } from '../../core/util/Log';
import type { AnalyticsService } from '../PlatformServices';

/** Аналитика-заглушка: события в отладочный лог. */
export class LogAnalytics implements AnalyticsService {
  event(name: string, params?: Record<string, unknown>): void {
    log.debug(`analytics: ${name}`, params ?? {});
  }
}
