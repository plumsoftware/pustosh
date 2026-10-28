import { t } from '../core/i18n/i18n';
import { log } from '../core/util/Log';
import { ctx } from './GameContext';

/**
 * Игра только горизонтальная. На Android ориентацию фиксирует манифест (sensorLandscape);
 * в мобильном браузере жёстко зафиксировать нельзя — пробуем screen.orientation.lock,
 * а в портрете показываем «Поверните устройство» и ставим паузу ORIENTATION.
 */
export function installOrientationGuard(): void {
  const { clock, platform } = ctx();
  if (platform.device === 'desktop' || platform.device === 'tv') return;

  const el = document.createElement('div');
  el.className = 'pustosh-rotate';
  const icon = document.createElement('div');
  icon.className = 'icon';
  const title = document.createElement('div');
  title.textContent = t('ui.rotate');
  const hint = document.createElement('small');
  hint.textContent = t('ui.rotate.hint');
  el.append(icon, title, hint);
  document.body.appendChild(el);

  const isPortrait = () => window.innerHeight > window.innerWidth;
  const sync = () => {
    const portrait = isPortrait();
    el.classList.toggle('visible', portrait);
    if (portrait) clock.pause('ORIENTATION');
    else clock.resume('ORIENTATION');
  };
  window.addEventListener('resize', sync);
  window.addEventListener('orientationchange', sync);
  sync();

  // Где браузер разрешает (обычно только в полноэкранном режиме), фиксируем альбомную ориентацию.
  const tryLock = () => {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    o?.lock?.('landscape').catch((e: unknown) => log.debug('orientation lock недоступен', e));
  };
  tryLock();
  window.addEventListener('pointerup', tryLock, { once: true });
}
