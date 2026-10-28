# Шаг 1. Каркас проекта, сборки и платформенный слой (TypeScript + Phaser + Capacitor)

## Цель

Пустой, но правильно устроенный проект: одна веб-игра на Phaser, которая запускается в браузере (dev), собирается архивом для **Яндекс Игр** и APK/AAB для **RuStore** через Capacitor. Платформенные сервисы — заглушки с окончательными интерфейсами. Плюс **проверка производительности**: прежде чем писать игру, убедиться, что стек тянет нашу сцену на слабом телефоне.

## Входные данные

- `TZ/00_OVERVIEW.md` §2–4.
- `data/balance.json` (раздел `ads`, `survival` для конфига).

## Задачи

### 1.1. Проект

1. Проверить актуальные стабильные версии Phaser 3.x, Vite, TypeScript, Capacitor (core, cli, android, плагины `app`, `preferences`, `filesystem`, `status-bar`) — записать в `docs/VERSIONS.md`.
2. Создать проект Vite + TypeScript (strict), структура папок — как в OVERVIEW §3. ESLint + Prettier, правило `no-restricted-imports` запрещает `phaser` в `src/core/**`.
3. Vitest настроен на `tests/` и `src/core/**`.
4. Режимы сборки через `VITE_PLATFORM` = `dev` | `yandex` | `android`; `main.ts` выбирает реализацию `PlatformServices`.
5. `index.html` для режима `yandex` содержит `<script src="/sdk.js"></script>` **до** бандла игры (Vite-плагин или отдельный шаблон); для `dev` и `android` — без него. `base: './'` — все пути относительные.
6. CSS страницы: фон чёрный, канвас на весь экран, `touch-action: none`, `user-select: none`, `-webkit-touch-callout: none`, `overscroll-behavior: none`, без полос прокрутки; `oncontextmenu` отключён.

### 1.2. Phaser

1. Конфиг: `type: Phaser.AUTO` (WebGL с откатом на Canvas, **без всплывающих сообщений про WebGL** — требование Яндекса), логическое разрешение 1280×720, `scale.mode` — FIT или RESIZE (решить на проверке 1.6), `pixelArt: false`, `antialias: true`, `roundPixels: true` для спрайтов мира.
2. Сцены: `BootScene` → `PreloadScene` (полоска прогресса) → `MainMenuScene` (кнопки «Играть», «Настройки») → `WorldScene` (пока серый фон) + `UIScene` поверх → `PauseScene` (Esc/кнопка).
3. Отладочный оверлей (F1 на ПК, тройной тап в углу): FPS, тики, платформа, причины паузы, версия.

### 1.3. Платформенный слой — окончательные интерфейсы

```ts
export type PlatformId = 'yandex' | 'android' | 'dev';
export type DeviceType = 'desktop' | 'mobile' | 'tablet' | 'tv';

export interface PlatformServices {
  readonly id: PlatformId;
  readonly device: DeviceType;
  readonly language: string;                 // 'ru', 'en'…
  readonly ads: AdsService;
  readonly saves: SaveService;
  readonly purchases: PurchaseService;
  readonly analytics: AnalyticsService;
  init(): Promise<void>;                     // до загрузки ресурсов
  onLoadingFinished(): void;                 // Яндекс: LoadingAPI.ready()
  onGameplayStart(): void;                   // Яндекс: GameplayAPI.start()
  onGameplayStop(): void;                    // Яндекс: GameplayAPI.stop()
  setPauseListener(onPause: () => void, onResume: () => void): void; // события площадки, сворачивание
}
export interface AdsService {
  canShowInterstitial(): boolean;            // интервал из конфига + покупка «без рекламы»
  showInterstitial(placement: string): Promise<'shown' | 'skipped' | 'error'>;
  showRewarded(placement: string): Promise<'rewarded' | 'closed_early' | 'error'>;
}
export interface SaveService {
  load(slot: string): Promise<string | null>;
  save(slot: string, json: string): Promise<boolean>;
}
export interface PurchaseService {
  catalog(): Promise<ProductInfo[]>;
  purchase(productId: string): Promise<'success' | 'cancelled' | 'error'>;
  owned(): Promise<Set<string>>;
}
export interface AnalyticsService { event(name: string, params?: Record<string, unknown>): void; }
```

### 1.4. Реализации-заглушки

- `DevPlatform`: реклама — модальное окно «РЕКЛАМА (заглушка)» на 2 с, награда выдаётся; сохранения — `localStorage`; покупки — всегда успех.
- `YandexPlatform` (пока): `init()` — `YaGames.init()` в try/catch; если SDK нет — режим заглушки с логом `Yandex SDK not found, stub mode`; `onLoadingFinished()` вызывает `LoadingAPI.ready()`. Остальное — шаг 10. Типы SDK — свой `src/platform/yandex/ysdk.d.ts` (минимальный набор, который используем).
- `AndroidPlatform` (пока): сохранения через `@capacitor/preferences` (или `filesystem`), реклама и покупки — заглушки, жизненный цикл через `@capacitor/app` (`pause`/`resume`, кнопка «Назад» → пауза).

### 1.5. Пауза и звук

`GameClock` в `src/core/util`: фиксированный шаг 50 мс, причины паузы, `isPaused`, счётчик тиков, игровое время. Подписки: `document.visibilitychange` и `window.blur/focus` → `TAB_HIDDEN`; события площадки → `PLATFORM`; Capacitor `appStateChange` → `PLATFORM`. При любой паузе `this.sound.mute = true` (единый `AudioBus`), `scene.pause()` для `WorldScene`.

### 1.6. Android-оболочка

1. `npx cap init` (appId `ru.<владелец>.pustosh` — уточнить у владельца), `npx cap add android`.
2. `AndroidManifest`: альбомная ориентация (`sensorLandscape`), полный экран, скрытая строка состояния (`@capacitor/status-bar` или тема), аппаратное ускорение WebView.
3. Сборка debug APK и установка на телефон по `docs/BUILD.md`.

### 1.7. Проверка производительности (обязательно до шага 2)

Временная сцена `StressScene` (без реальной игры): 3×3 экрана тайлов 64 px из `assets/tiles`, 300 спрайтов объектов из `assets/world/biome1_suburb` с Y-сортировкой каждый кадр, 40 «врагов» (`characters/enemies/walker_idle`) с движением и покачиванием, тёмная маска ночи (RenderTexture с вырезанным мягким кругом вокруг центра), 100 частиц.

Замерить FPS на: ПК (Chrome), самом слабом доступном Android в **Яндекс Браузере**, том же Android в **APK** (Capacitor WebView), iPhone в Safari (если есть). Результаты — таблицей в `docs/PERF_BASELINE.md`. **Если на слабом Android < 30 FPS** — остановиться и предложить владельцу варианты (Canvas-режим, понижение разрешения, Phaser 4, упрощение света).

## Критерии приёмки

- [ ] `npm run dev` — Boot → Preload → Menu → World → Pause работают в браузере ПК и телефона.
- [ ] `npm run build:yandex` создаёт архив с `index.html` в корне, относительными путями и подключением `/sdk.js`; вне Яндекса игра не падает.
- [ ] `npm run build:android` + Gradle → APK ставится, открывается альбомно на весь экран, «Назад» ставит паузу.
- [ ] При скрытии вкладки/сворачивании `GameClock.isPaused === true` и звук выключен; при возврате всё восстанавливается.
- [ ] «Играть» показывает рекламу-заглушку (`menu_to_game`), игра на паузе во время показа.
- [ ] ESLint не пускает `import 'phaser'` в `src/core`; Vitest-тест `GameClock` (две причины паузы, нет тиков на паузе) зелёный.
- [ ] `docs/VERSIONS.md`, `docs/BUILD.md`, `docs/PERF_BASELINE.md` заполнены.

## Промпт для ИИ

> Выполни шаг 1 из `TZ/STEP_01_project_setup.md` на стеке TypeScript + Phaser 3 + Vite + Capacitor. Сначала покажи выбранные версии пакетов и дождись подтверждения. Затем создай проект со структурой из `TZ/00_OVERVIEW.md` §3, режимы сборки dev/yandex/android, интерфейсы `PlatformServices` ровно с указанными сигнатурами, заглушки платформ, `GameClock` с тестами, сцены-заглушки, Android-оболочку Capacitor. Обязательно сделай `StressScene` и замер FPS из п. 1.7 — пришли таблицу `docs/PERF_BASELINE.md` до начала шага 2. Пройди «Критерии приёмки».
