# Сборка и запуск

## Подготовка

- JDK 21. Если по умолчанию стоит другой JDK:
  ```bash
  export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
  ```
  В Android Studio: Settings → Build Tools → Gradle → Gradle JDK = 21.
- Android SDK: путь в `local.properties` (`sdk.dir=...`), файл не коммитится.
- Игровые данные берутся из `Pustosh_GameDev_Package/data/*.json` автоматически (задача `:game:syncGameData`), руками ничего не копировать.

## Команды

| Что | Команда | Результат |
| --- | --- | --- |
| Тесты логики | `./gradlew :core:allTests` | JVM + JS (Node) |
| Один тест | `./gradlew :core:jvmTest --tests "ru.pustosh.core.GameClockTest"` | |
| Десктоп (отладка) | `./gradlew :game:runJvm` | окно 1280×720 |
| Веб-сборка | `./gradlew :game:jsBrowserDistribution` | `game/build/dist/js/productionExecutable/` |
| Запуск веба локально | `python3 -m http.server 8080 -d game/build/dist/js/productionExecutable` → http://localhost:8080/?debug | без SDK Яндекса в консоли: `Yandex SDK not found, stub mode` |
| Архив для Яндекса | `./gradlew :game:packageYandexZip` | `game/build/yandex/pustosh-yandex-<версия>.zip` (index.html в корне, без .map) |
| Android APK (отладка) | `./gradlew :game:assembleDebug` | `game/build/outputs/apk/debug/game-debug.apk` |
| Установка на устройство | `adb install -r game/build/outputs/apk/debug/game-debug.apk` | |
| Android AAB (релиз) | `./gradlew :game:bundleRelease` | `game/build/outputs/bundle/release/game-release.aab` |

## Подпись Android

По умолчанию сборки подписываются dev-ключом `game/keystore/dev.keystore` (только для отладки и тестов, пароль открыт в `game/build.gradle.kts`).

Для релиза в RuStore — свой ключ владельца, без коммита в репозиторий. В `~/.gradle/gradle.properties`:

```properties
RELEASE_STORE_FILE=/абсолютный/путь/к/release.keystore
RELEASE_STORE_PASSWORD=...
RELEASE_KEY_ALIAS=...
RELEASE_KEY_PASSWORD=...
```

## Отладка

- Отладочный оверлей (FPS, тики, площадка, причины паузы, версия): **F1** на ПК, **тройной тап** в левом верхнем углу на телефоне.
- В браузере подробный лог включается параметром `?debug` в адресе; на десктопе и в debug-APK — всегда.

## Особенности

- Configuration cache Gradle выключен: KorGE 6 генерирует Android-манифест и ресурсы на этапе конфигурации, и с кэшем после `clean` они не пересоздаются.
- Шаблон `<head>` для `index.html` (подключение `/sdk.js` до скрипта игры) — `game/web/custom-html-head.template.html`.
