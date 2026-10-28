# Версии

Проверены по npm 28.10.2026 (`npm view <пакет> version`). Версии зафиксированы точно в `package.json`.

| Пакет | Версия | Примечание |
| --- | --- | --- |
| phaser | 3.90.0 | последняя 3.x (вышла и 4.2.1 — переход только по решению владельца, ТЗ §2) |
| vite | 8.3.5 | сборщик (rolldown) |
| typescript | 6.0.3 | **не 7.0**: typescript-eslint 8.72 поддерживает TS < 6.1 |
| vitest | 5.0.5 | тесты `src/core` и инструментов |
| zod | 4.6.7 | схемы `data/*.json` (`z.looseObject` — неизвестные поля допускаются) |
| eslint / @eslint/js | 10.13.0 / 10.0.1 | |
| typescript-eslint | 8.72.1 | |
| prettier / eslint-config-prettier | 3.9.10 / 10.1.8 | |
| tsx | 4.23.15 | запуск `tools/*.ts` |
| sharp | 0.35.5 | ресайз спрайтов в `pack-assets` |
| maxrects-packer | 3.0.0 | раскладка атласов (свой вывод в формат Phaser, выдавливание края — `sharp.extend`) |
| adm-zip | 0.6.1 | архив для консоли Яндекса |
| @capacitor/core, cli, android | 8.5.3 | Android-оболочка |
| @capacitor/app | 8.1.2 | сворачивание, кнопка «Назад» |
| @capacitor/preferences | 8.0.1 | сохранения на Android |
| @capacitor/filesystem | 8.1.5 | подключён на будущее (крупные сохранения) |
| @capacitor/status-bar | 8.0.4 | скрытие строки состояния |

Окружение: Node ≥ 22.12 (проверено на 26.11), JDK 21 для Gradle Android, Android SDK compile/target 36, minSdk 24 (по умолчанию Capacitor 8).

SDK Яндекс Игр подключается тегом `<script src="/sdk.js">` (версия на стороне Яндекса). Методы сверены с документацией: `YaGames.init()`, `ysdk.features.LoadingAPI?.ready()`, `ysdk.features.GameplayAPI?.start()/stop()`, события `game_api_pause` / `game_api_resume`.

`npm audit`: 3 умеренные уязвимости в `uuid` внутри `@capacitor/cli` (iOS-утилита `xcode`), в сборку игры не попадает.
