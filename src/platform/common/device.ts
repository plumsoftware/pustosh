import type { DeviceType } from '../PlatformServices';

/** Тип устройства по браузеру (для dev и запасной вариант без SDK). */
export function detectBrowserDevice(): DeviceType {
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'tablet';
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone/i.test(ua)) return 'mobile';
  if (window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia('(pointer: fine)').matches)
    return 'mobile';
  return 'desktop';
}

export function browserLanguage(): string {
  return (navigator.language || 'ru').slice(0, 2).toLowerCase();
}
