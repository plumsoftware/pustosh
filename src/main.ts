import './styles.css';
import { installCursor } from './game/ui/Cursor';
import { installReadableText } from './game/ui/Styled';
import { loadFonts, setTextRes } from './game/ui/layout';
import Phaser from 'phaser';
import { createPlatformConfig } from './core/config/PlatformConfig';
import { BalanceDef } from './core/data/schemas';
import { setStrings, type Dict } from './core/i18n/i18n';
import { log } from './core/util/Log';
import { createContext } from './game/GameContext';
import { AssetLoader } from './game/assets/AssetLoader';
import { installLifecycle } from './game/Lifecycle';
import { installOrientationGuard } from './game/OrientationGuard';
import { AssetGalleryScene } from './game/scenes/AssetGalleryScene';
import { BootScene } from './game/scenes/BootScene';
import { DebugOverlayScene } from './game/scenes/DebugOverlayScene';
import { MainMenuScene } from './game/scenes/MainMenuScene';
import { PauseScene } from './game/scenes/PauseScene';
import { PreloadScene } from './game/scenes/PreloadScene';
import { StressScene } from './game/scenes/StressScene';
import { UIScene } from './game/scenes/UIScene';
import { WorldScene } from './game/scenes/WorldScene';
import { SavesScene } from './game/scenes/SavesScene';
import { RigEditorScene } from './game/scenes/RigEditorScene';
import { DeathScene } from './game/scenes/DeathScene';
import { CraftScene } from './game/scenes/CraftScene';
import { BuildScene } from './game/scenes/BuildScene';
import { MenuScene } from './game/scenes/MenuScene';
import { SettingsScene } from './game/scenes/SettingsScene';
import { SkillsScene } from './game/scenes/SkillsScene';
import { StatsScene } from './game/scenes/StatsScene';
import { JournalScene } from './game/scenes/JournalScene';
import { MapScene } from './game/scenes/MapScene';
import { InventoryScene } from './game/scenes/InventoryScene';
import { WorldOverlayScene } from './game/scenes/WorldOverlayScene';
import { WorldMapScene } from './game/scenes/WorldMapScene';
import { AnimationGalleryScene } from './game/scenes/AnimationGalleryScene';
import { graphicsQuality, installRenderScale, scaleFor } from './game/render/Quality';
import type { PlatformConfig } from './core/config/PlatformConfig';
import type { PlatformId, PlatformServices } from './platform/PlatformServices';

const PLATFORM = import.meta.env.VITE_PLATFORM as PlatformId;
const VERSION = import.meta.env.VITE_APP_VERSION as string;
/** Выбор реализации площадки по переменной сборки. Динамический импорт — в сборку попадает только нужная. */
async function createPlatform(config: PlatformConfig, iap: readonly string[]): Promise<PlatformServices> {
  switch (PLATFORM) {
    case 'yandex':
      return new (await import('./platform/yandex/YandexPlatform')).YandexPlatform(config, iap);
    case 'android':
      return new (await import('./platform/android/AndroidPlatform')).AndroidPlatform(config, iap);
    default:
      return new (await import('./platform/dev/DevPlatform')).DevPlatform(config, iap);
  }
}

/**
 * Масштаб рендера: ?rs=<число> для замеров, иначе по настройке «Качество графики» (render/Quality):
 * на ПК — по плотности экрана (до 2), на телефоне — «Авто» по замеру FPS.
 */
function renderScale(params: URLSearchParams, desktop: boolean): number {
  const fromUrl = Number(params.get('rs'));
  const v = fromUrl > 0 ? fromUrl : scaleFor(graphicsQuality(desktop));
  return Math.max(1, Math.min(v, 3));
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return (await r.json()) as T;
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const debug = PLATFORM === 'dev' || import.meta.env.DEV || params.has('debug');
  log.setLevel(debug ? 'debug' : 'warn');

  // До загрузки ресурсов: строки (для окна рекламы-заглушки) и конфиг площадки (интервалы рекламы).
  const [strings, balanceRaw] = await Promise.all([
    fetchJson<Dict>('i18n/ru.json'),
    fetchJson<unknown>('data/balance.json'),
    loadFonts(),
  ]);
  setStrings(strings, { debug });
  const balance = BalanceDef.parse(balanceRaw);
  const config = createPlatformConfig(balance, PLATFORM, debug);

  const platform = await createPlatform(config, balance.iap);
  await platform.init();

  const rs = renderScale(params, platform.device === 'desktop');
  const context = createContext({ platform, config, version: VERSION, debug, params, renderScale: rs });

  setTextRes(rs);
  installReadableText();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#000000',
    // Поле растягивается до краёв экрана (требование Яндекса). Канвас — CSS × renderScale, CSS-размер =
    // окну (размер ведёт installRenderScale, масштаб меняется на лету); интерфейс — от 1280×720 (ui/layout).
    scale: {
      mode: Phaser.Scale.NONE,
      width: Math.round(innerWidth * rs),
      height: Math.round(innerHeight * rs),
      zoom: 1 / rs,
      autoCenter: Phaser.Scale.NO_CENTER,
    },
    render: { pixelArt: false, antialias: true, roundPixels: true, powerPreference: 'high-performance' },
    banner: debug,
    disableContextMenu: true,
    // Без всплывающих сообщений про WebGL: Phaser.AUTO молча откатывается на Canvas.
    failIfMajorPerformanceCaveat: false,
    input: { activePointers: 3 },
    fps: { target: 60 },
    scene: [
      BootScene,
      PreloadScene,
      MainMenuScene,
      SavesScene,
      WorldScene,
      WorldOverlayScene,
      UIScene,
      WorldMapScene,
      DeathScene,
      InventoryScene,
      CraftScene,
      BuildScene,
      MenuScene,
      SettingsScene,
      SkillsScene,
      StatsScene,
      JournalScene,
      MapScene,
      PauseScene,
      StressScene,
      AssetGalleryScene,
      AnimationGalleryScene,
      RigEditorScene,
      DebugOverlayScene,
    ],
  });
  game.events.once(Phaser.Core.Events.READY, () => {
    installLifecycle(game);
    installOrientationGuard();
    installCursor(game);
  });
  installRenderScale(game);
  // Доступ из консоли и автотестов браузера — только в отладке.
  if (debug) (window as unknown as { __pustosh: unknown }).__pustosh = { ctx: context, game, AssetLoader };
}

boot().catch((e: unknown) => {
  log.error('boot failed', e);
  const el = document.getElementById('game');
  if (el)
    el.innerHTML =
      '<p style="color:#f2e6c9;font:16px system-ui;padding:24px">Не удалось запустить игру. Обновите страницу.</p>';
});
