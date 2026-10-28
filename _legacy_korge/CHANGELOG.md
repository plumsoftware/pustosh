# Журнал изменений

## Шаг 1. Каркас проекта и платформенный слой — 27.10.2026

### Сделано

- Gradle-проект на KorGE 6.0.0 из трёх модулей: `core` (чистый Kotlin, jvm + js), `platform` (jvm + js + android), `game` (KorGE: jvm, js, android). Версии — `docs/VERSIONS.md`, команды — `docs/BUILD.md`.
- `core`: `GameClock` (шаг 50 мс, накопитель, причины паузы `AD/MENU/TAB_HIDDEN/PLATFORM/DIALOG`, подписка на смену паузы), `Log` с уровнями, `PlatformConfig` из `balance.json` (`ads.<площадка>`, `survival.<площадка>`, `mvpBiomeLimit = 3`, `debug`), `Strings` для `strings_ru.json`.
- `platform`: интерфейсы `PlatformServices`, `AdsService`, `SaveService`, `PurchaseService`, `AnalyticsService` ровно с сигнатурами из ТЗ; заглушки `DesktopStub`, `YandexPlatform` (без SDK — режим заглушки, с SDK — `init()` и `LoadingAPI.ready()`), `RuStorePlatform`. Реклама-заглушка соблюдает интервал и разрешённые точки показа из `balance.json`, учитывает покупку `remove_interstitials`.
- Сохранения: десктоп — `~/.pustosh/saves/<slot>.json`, Android — внутреннее хранилище приложения, браузер — `localStorage`.
- `game`: сцены Boot → Loading → MainMenu → World, Pause поверх мира (Esc или кнопка). «Играть» показывает межстраничную рекламу `menu_to_game`, игра на паузе `AD` на время показа. Сворачивание и скрытие вкладки ставят паузу `TAB_HIDDEN`, любая пауза глушит `AudioBus.muted`.
- Отладочный оверлей: F1 или тройной тап в левом верхнем углу.
- `index.html` подключает `/sdk.js` до скрипта игры. Задача `packageYandexZip` собирает архив для консоли Яндекса.
- Android: альбомная ориентация, полный экран, minSdk 24, target/compileSdk 35.
- Тесты: `GameClockTest` (две причины паузы, отсутствие тиков на паузе, обрезка длинного кадра, слушатели), `PlatformConfigTest`.

### Отложено

- Реальные SDK: реклама, покупки, облачные сохранения, GameplayAPI и события паузы Яндекса, RuStore — шаг 10.
- CI (GitHub Actions) — по решению владельца.
- Сворачивание окна на десктопе не отслеживается (отладочная сборка).
- Подпись приложения на Android — `pustosh` (берётся из `korge.name`, который используется и в именах файлов); русское название — к релизу.
- Свой шрифт и UI на спрайтах из `assets/ui` — следующие шаги, сейчас стандартный шрифт и виджеты KorGE.

### Известные проблемы

- AGP 8.2.2 печатает предупреждение про compileSdk 35 (проверен до 34). Сборка и запуск на API 35 работают.
- При программном рендере (headless Chrome со swiftshader, эмулятор без GPU) у текста стандартного шрифта видны артефакты; на настоящем GPU текст чистый.
- Configuration cache Gradle выключен (см. `docs/BUILD.md`).
- Для RuStore точки `menu_to_game` нет в `balance.json → ads.rustore.interstitialPoints`, поэтому там «Играть» рекламу не показывает — так задумано данными.
