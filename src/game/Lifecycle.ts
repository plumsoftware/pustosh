import type Phaser from 'phaser';
import { log } from '../core/util/Log';
import { hasBackButton } from '../platform/PlatformServices';
import { createAudio, type AudioBus } from './audio/AudioBus';
import { ctx } from './GameContext';
import { SceneKeys } from './SceneKeys';

/**
 * Пауза и жизненный цикл: вкладка/фокус → TAB_HIDDEN, события площадки → PLATFORM,
 * «Назад» на Android → меню паузы. Любая пауза глушит звук и останавливает WorldScene.
 */
export function installLifecycle(game: Phaser.Game): AudioBus {
  const { clock, platform } = ctx();
  const audio = createAudio(game.sound);

  // Фокус — только по событиям: в iframe Яндекса hasFocus() до первого клика бывает false.
  let blurred = false;
  const syncTabHidden = () => {
    if (document.hidden || blurred) clock.pause('TAB_HIDDEN');
    else clock.resume('TAB_HIDDEN');
  };
  document.addEventListener('visibilitychange', syncTabHidden);
  window.addEventListener('blur', () => {
    blurred = true;
    syncTabHidden();
  });
  window.addEventListener('focus', () => {
    blurred = false;
    syncTabHidden();
  });
  syncTabHidden();

  platform.setPauseListener(
    () => clock.pause('PLATFORM'),
    () => clock.resume('PLATFORM'),
  );

  if (hasBackButton(platform)) {
    platform.setBackButtonListener(() => {
      const sm = game.scene;
      if (sm.isActive(SceneKeys.World) && !sm.isActive(SceneKeys.Pause)) {
        sm.getScene(SceneKeys.World).events.emit('request-pause');
      }
    });
  }

  clock.onPauseChange((paused, reasons) => {
    // Окна игры (инвентарь, карта, навыки, подсказка — DIALOG) звук не глушат: музыка и фон идут дальше.
    // Глушат меню паузы, реклама, скрытая вкладка, пауза площадки, поворот экрана.
    audio.setPausedMute(paused && [...reasons].some((r) => r !== 'DIALOG'));
    // Меню паузы, сворачивание, скрытая вкладка, пауза площадки — сохранить игру.
    if (paused && (reasons.has('MENU') || reasons.has('TAB_HIDDEN') || reasons.has('PLATFORM')))
      game.events.emit('save-request');
    const sm = game.scene;
    const world = sm.getScene(SceneKeys.World);
    const inWorld = world && (sm.isActive(SceneKeys.World) || sm.isPaused(SceneKeys.World));
    if (inWorld) {
      if (paused && sm.isActive(SceneKeys.World)) {
        sm.pause(SceneKeys.World);
        platform.onGameplayStop();
      } else if (!paused && sm.isPaused(SceneKeys.World)) {
        sm.resume(SceneKeys.World);
        platform.onGameplayStart();
      }
    }
    log.debug(`pause: ${paused ? [...reasons].join(', ') : 'нет'}`);
  });

  return audio;
}
