# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Отвечать пользователю всегда по-русски.**

## Что это

«Пустошь» — 2D-выживание с видом сверху на Kotlin Multiplatform + **KorGE 6.0.0**: одна кодовая база → браузер (Яндекс Игры, Kotlin/JS), Android (RuStore), десктоп JVM (отладка). Разработка идёт по шагам `Pustosh_GameDev_Package/TZ/STEP_01 … STEP_10`. Пройденные шаги, отложенное и известные проблемы — в `CHANGELOG.md` (запись в конце каждого шага).

Перед работой над шагом прочитать: `Pustosh_GameDev_Package/TZ/00_OVERVIEW.md` (архитектура и правила), `TZ/GDD.md`, `TZ/ASSETS.md`, файл шага. Следующий шаг — только после выполнения всех «Критериев приёмки» текущего.

## Команды

Нужен JDK 21 (на JDK 25 Gradle 8.10 не запускается):
`export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`

```bash
./gradlew :core:allTests                                            # тесты логики (JVM + JS/Node)
./gradlew :core:jvmTest --tests "ru.pustosh.core.GameClockTest"     # один тест
./gradlew :game:runJvm                                              # десктоп
./gradlew :game:jsBrowserDistribution                               # веб → game/build/dist/js/productionExecutable
./gradlew :game:packageYandexZip                                    # zip для консоли Яндекса
./gradlew :game:assembleDebug                                       # APK
./gradlew :game:bundleRelease                                       # AAB
```

Подробности (локальный запуск веба, подпись, отладочный оверлей) — `docs/BUILD.md`, версии — `docs/VERSIONS.md`.

## Архитектура

- `core` — чистый Kotlin (jvm + js), **без KorGE**: `GameClock`, `Log`, `config/PlatformConfig`, `i18n/Strings`; дальше data, world, ecs, systems, save. Тесты в `commonTest`.
- `platform` — `PlatformServices` и сервисы (сигнатуры зафиксированы в `TZ/STEP_01`, не менять без владельца). Реализации: `jsMain/YandexPlatform`, `androidMain/RuStorePlatform`, `jvmMain/DesktopStub`; общий JVM/Android-код — `jvmCommonMain`. Платформа не зависит от движка: UI рекламы-заглушки ей даёт игра через `StubAdPresenter`.
- `game` — KorGE-приложение. `Game` — корень: слои (основные сцены → оверлей-сцены/пауза → окно рекламы → отладочный оверлей), `GameClock`, конфиг и платформа. Выбор платформы по таргету — `expect/actual` в `PlatformFactory*.kt`. Рекламу показывать только через `AdsController` (ставит паузу `AD`).

Правила из ТЗ, которые легко нарушить:

1. Логика — в тиках `GameClock` (50 мс), никакого системного времени в `core`. Пауза — только `GameClock.pause/resume(reason)`.
2. Числа баланса, рецепты, дропы — только в `data/*.json`; хардкод в коде = ошибка ревью.
3. Различия площадок — только через `PlatformServices`/`PlatformConfig`, без `if (isYandex)`.
4. Строки UI — через `Strings.get(...)` и `game/src/commonMain/resources/strings_ru.json`.
5. Мир детерминирован по сиду `balance.world.seed`.

## Данные и ассеты

- `Pustosh_GameDev_Package/data/*.json` попадают в ресурсы игры как `data/*.json` через задачу `:game:syncGameData` (копия в `game/build/generated`). Не копировать руками и **не менять молча** — любое изменение данных или `assets/` отдельным коммитом с объяснением; ошибки в данных — в отчёт.
- В `balance.json` встречаются ссылки вида `"rewarded": "as yandex"` — их разворачивает `PlatformConfig`. Десктоп берёт значения Яндекса.
- Не генерировать картинки; недостающее делать кодом и записывать в `ASSET_REQUESTS.md`. Не использовать спрайты со `status: replaced`. Размер в игре — `scaleMode`/`targetPx` из `assets_manifest.json`, дефекты спрайтов — `TZ/ASSETS.md §6`.
- Python-скрипты пакета (`tools/datagen.py`, `tools/manifest.py`) **перезаписывают** `data/*.json`, `assets_manifest.json`, `rigs.json` целиком. `tools/cutter.py` использует Linux-путь к шрифту.

## Подводные камни KorGE 6

- Настройки Android (`androidSdk`, ориентация) в блоке `korge {}` должны стоять **до** `targetAndroid()`.
- Configuration cache выключен: KorGE генерирует Android-манифест и ресурсы при конфигурации.
- Шаблон `<head>` для `index.html` — `game/web/custom-html-head.template.html` (подключён в `afterEvaluate`, ресурсы `commonMain` KorGE для него не читает).
- Плагины `kotlin("multiplatform")` и `com.android.library` в `core`/`platform` — без версий: их приносит плагин KorGE через корневой `build.gradle.kts`.
- Android-сборки подписываются dev-ключом `game/keystore/dev.keystore`; релизный ключ — через `RELEASE_*` в `~/.gradle/gradle.properties`.
- MVP — биомы 1–3 и боссы 1–3 (`PlatformConfig.mvpBiomeLimit = 3`).
- Версии SDK Яндекс Игр, RuStore, рекламных сетей сверять с официальной документацией перед реализацией.
