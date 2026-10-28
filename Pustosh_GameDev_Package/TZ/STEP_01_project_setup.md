# Шаг 1. Каркас проекта и платформенный слой

## Цель

Пустой, но правильно устроенный проект: один репозиторий Kotlin Multiplatform на KorGE, который собирается и запускается в трёх вариантах — **браузер (Яндекс Игры)**, **Android (RuStore)** и **десктоп (отладка)**. Платформенные сервисы пока заглушки, но их интерфейсы окончательные.

## Входные данные

- `TZ/00_OVERVIEW.md` §2–3 (стек и структура), §3 правила 1–8.
- `data/balance.json` — понадобится раздел `ads` для конфига.

## Задачи

1. **Проверить версии.** Найти актуальную стабильную версию KorGE и её шаблон проекта (docs.korge.org). Записать версии Kotlin, KorGE, Gradle, Android SDK (minSdk 24, targetSdk — актуальный требуемый RuStore) в `docs/VERSIONS.md`.
2. **Создать модули** `core`, `game`, `platform` (как в OVERVIEW §3) + корневой gradle-проект.
   - `core`: только `commonMain`/`commonTest`, зависимости — `kotlinx.serialization-json`, `kotlinx.coroutines-core` (если нужно). Без KorGE.
   - `game`: KorGE-приложение, зависит от `core` и `platform`.
   - `platform`: `commonMain` с интерфейсами, `jsMain`, `androidMain`, `jvmMain` с реализациями.
3. **Таргеты сборки:**
   - `jvm` — запуск окна 1280×720 для отладки.
   - `js` (браузер) — выход: папка `build/web/` с `index.html`, JS-бандлом, ресурсами. В `index.html` подключён SDK Яндекс Игр строкой `<script src="/sdk.js"></script>` **до** скрипта игры; при запуске вне Яндекса SDK отсутствует — игра должна это пережить (заглушка).
   - `android` — APK/AAB, альбомная ориентация, полный экран, без статус-бара, иконка-заглушка.
4. **Интерфейсы платформы** (`platform/commonMain`), окончательные сигнатуры:

```kotlin
interface PlatformServices {
    val id: PlatformId                     // YANDEX, RUSTORE, DESKTOP
    val device: DeviceType                 // DESKTOP, MOBILE, TABLET
    val language: String                   // "ru", "en"...
    val ads: AdsService
    val saves: SaveService
    val purchases: PurchaseService
    val analytics: AnalyticsService
    suspend fun init()                     // вызывается до загрузки ресурсов
    fun onLoadingFinished()                // Яндекс: LoadingAPI.ready()
    fun onGameplayStart()                  // Яндекс: GameplayAPI.start()
    fun onGameplayStop()                   // Яндекс: GameplayAPI.stop()
    fun setPauseListener(onPause: () -> Unit, onResume: () -> Unit) // события платформы и сворачивание
}
interface AdsService {
    fun canShowInterstitial(): Boolean      // учитывает интервал из конфига и покупку "без рекламы"
    suspend fun showInterstitial(placement: String): AdResult   // SHOWN, SKIPPED, ERROR
    suspend fun showRewarded(placement: String): RewardResult   // REWARDED, CLOSED_EARLY, ERROR
}
interface SaveService {
    suspend fun load(slot: String): String?          // JSON сохранения или null
    suspend fun save(slot: String, json: String): Boolean
}
interface PurchaseService {
    suspend fun catalog(): List<ProductInfo>
    suspend fun purchase(productId: String): PurchaseResult
    suspend fun owned(): Set<String>
}
interface AnalyticsService { fun event(name: String, params: Map<String, Any> = emptyMap()) }
```

5. **Заглушки:**
   - `DesktopStub`: реклама — модальное окно «РЕКЛАМА (заглушка)» 2 c, награда выдаётся; сохранения — файл в домашней папке; покупки — всегда успех.
   - `YandexPlatform` (пока): если `window.YaGames` нет — работать как заглушка с логом; если есть — только `init()` и `onLoadingFinished()` (полная интеграция — шаг 10).
   - `RuStorePlatform`: заглушки, как десктоп, сохранения — во внутреннее хранилище приложения.
6. **`GameClock`** в `core`: фиксированный шаг 50 мс, накопитель времени, `pause(reason)`/`resume(reason)` с множеством причин (`AD`, `MENU`, `TAB_HIDDEN`, `PLATFORM`, `DIALOG`), `isPaused`, счётчик тиков, игровое время в секундах.
7. **Сцены-заглушки** (`game/scenes`): `BootScene` → `LoadingScene` (полоска прогресса) → `MainMenuScene` (кнопки «Играть», «Настройки»; при нажатии «Играть» — `ads.showInterstitial("menu_to_game")` если можно) → `WorldScene` (серый фон, текст «мир»). Esc/кнопка — `PauseScene` поверх.
8. **Пауза платформы:** подписаться на скрытие вкладки (JS: `visibilitychange`), сворачивание (Android: lifecycle `onPause`), события платформы — всё в `GameClock.pause(TAB_HIDDEN|PLATFORM)`. Звук глушится через единый `AudioBus.muted`.
9. **Конфиг платформы** `PlatformConfig` в `core/config`: читает `balance.json → ads.<platform>`, `survival.<platform>`; флаг `mvpBiomeLimit = 3`; флаг `debug` (на десктопе true).
10. **Отладочный оверлей** (F1 на ПК, тройной тап в углу на телефоне): FPS, тики, платформа, причины паузы, версия сборки.
11. **Скрипты сборки** в `docs/BUILD.md`: команды запуска десктопа, сборки веба (с zip для загрузки в консоль Яндекса), сборки Android AAB.
12. **CI** (по желанию владельца): GitHub Actions — тесты `core` + сборка трёх таргетов.

## Критерии приёмки

- [ ] Десктоп запускается: Boot → Loading → Menu → World → Pause работает.
- [ ] Веб-сборка открывается в браузере с локального сервера, без SDK не падает; в консоли лог «Yandex SDK not found, stub mode».
- [ ] Android-сборка устанавливается, открывается в альбомной ориентации на весь экран.
- [ ] При переключении вкладки/сворачивании `GameClock.isPaused == true`, при возврате — false.
- [ ] Кнопка «Играть» показывает заглушку рекламы на десктопе, игра на паузе на время показа.
- [ ] `core` не импортирует ничего из KorGE (проверка: модуль собирается без зависимости от KorGE).
- [ ] Юнит-тест `GameClockTest`: пауза по двум причинам снимается только после снятия обеих; тики не идут на паузе.
- [ ] `docs/VERSIONS.md` и `docs/BUILD.md` заполнены.

## Не делать на этом шаге

Мир, героя, данные, настоящую рекламу.

## Промпт для ИИ

> Выполни шаг 1 из `TZ/STEP_01_project_setup.md`. Сначала проверь актуальную стабильную версию KorGE и покажи мне выбранные версии (Kotlin, KorGE, Gradle, Android SDK) — дождись подтверждения. Затем создай модули `core`, `game`, `platform`, таргеты jvm/js/android, интерфейсы `PlatformServices` ровно с указанными сигнатурами, заглушки платформ, `GameClock` с причинами паузы, сцены-заглушки и отладочный оверлей. В конце пройди по «Критериям приёмки», отметь каждый пункт и приложи команды для проверки.
