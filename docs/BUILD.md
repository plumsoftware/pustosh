# Сборка и запуск

## Подготовка

- Node ≥ 22.12, `npm install`.
- Для Android: JDK 21 и Android SDK.
  ```bash
  export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
  ```

## Команды

| Что | Команда | Результат |
| --- | --- | --- |
| Разработка | `npm run dev` | http://localhost:5173 (и по IP в локальной сети), платформа `dev` |
| Тесты | `npm test` | Vitest: `tests/`, `src/core` |
| Линт / типы | `npm run lint`, `npm run typecheck` | |
| Яндекс | `npm run build:yandex` | `dist-yandex/` + `dist-yandex.zip` (index.html в корне, `/sdk.js` до бандла, пути относительные) |
| Проверить архив локально | `npm run preview:yandex` → http://localhost:4173 | без SDK в консоли: `Yandex SDK not found, stub mode` |
| Android (веб + sync) | `npm run build:android` | `dist-android/` → `android/` (`cap sync`); при отсутствии `android/` создаёт его и применяет `tools/patch-android.ts` |
| Debug APK | `npm run android:apk` | `android/app/build/outputs/apk/debug/app-debug.apk` |
| Release AAB + APK | `npm run android:release` | `android/app/build/outputs/bundle/release/app-release.aab`, `apk/release/app-release.apk` |
| Установка | `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` | |
| Атласы | `npm run pack-assets` (`-- --force`, `-- --webp`) | `public/atlases/*`, `docs/ASSET_REPORT.md` |
| Проверка данных | `npm run validate-data` | код выхода 1 при ошибках |
| Обновить исходники из пакета ТЗ | `npm run sync-package` | **перезаписывает** `art/` и `public/data/` |

## Android

- Настройки оболочки — `capacitor.config.ts` и `tools/patch-android.ts` (повторный запуск безопасен): `sensorLandscape`, аппаратное ускорение, полноэкранная тема; строку состояния скрывает `@capacitor/status-bar`.
- Подпись: по умолчанию dev-ключ `keystore/dev.keystore` (только для тестов). Релиз RuStore — свой ключ в `~/.gradle/gradle.properties`:
  ```properties
  RELEASE_STORE_FILE=/абсолютный/путь/release.keystore
  RELEASE_STORE_PASSWORD=...
  RELEASE_KEY_ALIAS=...
  RELEASE_KEY_PASSWORD=...
  ```
- Отладка WebView: `chrome://inspect` (debug-сборка), игра открывается как `https://localhost/`.

## Отладка

- Параметр `?debug` — отладка в любой сборке (`dev` — всегда): подробный лог, `window.__pustosh` (контекст, игра, `AssetLoader`).
- Оверлей (FPS, тики, площадка, причины паузы, рендер, версия): **F1** или тройной тап в левом верхнем углу.
- **F2** — галерея ассетов. Прямые ссылки: `?debug&gallery=biome1&bg=grass&ref=world.biome1_suburb.pine` (вкладки — группы атласов, `tiles`, `walls`, `items`; фоны `grass|dark|checker`).
- `?scene=stress` — сцена замера FPS (итог через 17 с на экране и в `window.__pustoshStress`), `?scene=world` — сразу в мир.
- `?rs=<число>` — масштаб рендера (по умолчанию 1, см. `docs/PERF_BASELINE.md`).
