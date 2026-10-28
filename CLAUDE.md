# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Отвечать пользователю всегда по-русски.**

## Что это

«Пустошь» — 2D-выживание с видом сверху: **TypeScript + Phaser 3.90 + Vite + Capacitor 8**. Одна веб-игра → Яндекс Игры (браузер) и RuStore (Android через Capacitor). Разработка по шагам `Pustosh_GameDev_Package 2/TZ/STEP_01 … STEP_10` (пакет ТЗ 3.0; папка `Pustosh_GameDev_Package` — устаревшая версия 2). Пройденные шаги, отложенное и проблемы — `CHANGELOG.md`. Старая реализация на Kotlin/KorGE — `_legacy_korge/`, не использовать.

Перед шагом прочитать: `TZ/00_OVERVIEW.md`, `TZ/GDD.md`, `TZ/ASSETS.md`, `TZ/ANIMATIONS.md`, файл шага. Следующий шаг — только после всех «Критериев приёмки».

**Игра только горизонтальная** (Android — `sensorLandscape`, браузер — экран «Поверните устройство» + пауза `ORIENTATION`).

## Команды

```bash
npm run dev               # http://localhost:5173, платформа dev
npm test                  # Vitest (tests/, src/core)
npx vitest run tests/GameClock.test.ts
npm run lint && npm run typecheck
npm run build:yandex      # dist-yandex/ + dist-yandex.zip
npm run build:android     # веб + cap sync; затем npm run android:apk / android:release (нужен JDK 21)
npm run pack-assets       # атласы из art/ → public/atlases/ (+ docs/ASSET_REPORT.md)
npm run validate-data     # проверка public/data/*.json
```

Для Gradle: `export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`. Подробности — `docs/BUILD.md`, версии — `docs/VERSIONS.md`, FPS — `docs/PERF_BASELINE.md`.

## Архитектура

- `src/core` — чистый TS без Phaser/браузера (ESLint запрещает): `util/GameClock` (50 мс, причины паузы), `util/Log`, `util/rng`, `config/PlatformConfig`, `i18n/i18n` (`t()`), `data/` (zod-схемы, `Registry`, `loadGameData`, `validateReferences`).
- `src/platform` — `PlatformServices` (сигнатуры зафиксированы шагом 1, не менять без владельца), `dev/`, `yandex/`, `android/`, общие заглушки в `common/`. Выбор — в `src/main.ts` по `VITE_PLATFORM`.
- `src/game` — Phaser: `GameContext` (`ctx()`, `registry()`), `Lifecycle` (вкладка/площадка/«Назад» → пауза, звук), `OrientationGuard`, `AdsController` (реклама только через него, пауза `AD`), `assets/` (`spawnSprite`, `AssetLoader.ensureGroup`, `getAssetInfo`, `iconFor`), `scenes/`.
- `src/core/save` — `SaveManager` (несколько именованных игр: `index` + `slot.<id>` через `PlatformServices.saves`), `SaveModel` (zod, `SAVE_VERSION` 2, `migrate()` v1→v2; хранение gzip+base64 с префиксом `gz1:` — `SaveCodec`/`codec.ts`, старый JSON читается). Текущая игра — `ctx().currentSave`; `WorldScene` загружает её и сохраняет (автосохранение, пауза, сворачивание, выход в меню; событие `save-request`).
- Герой: `core/systems/Movement`, `core/systems/Survival` (числа — `public/data/survival.json` и `balance.json → player/survival`); `game/hero/HeroController` (логика), `HeroView` (риг или запасной режим), `game/rig` (`RigDef` + `rigs_tuned`, `RigInstance`, `AnimationPlayer`, `Animations`); ввод — `game/input/InputMapper` (клавиатура по `event.code`, стик и кнопки — `UIScene`; «Собрать» — E/кнопка действия, «Удар» — ЛКМ/кнопка удара, удержания раздельные; бег со стика — палец за кольцом ×1.4 радиуса).
- Инвентарь и добыча: `core/inventory` (`Inventory`, `PlayerInventory`), `core/systems/Harvest` (цель, удар, дроп, восстановление), `Loot` (таблицы `loot_tables.json`, хранилища), `Consumables`; числа — `public/data/harvest.json`. Окно — `InventoryScene` (пауза `DIALOG`, ввод мира выключен), эффекты — `game/world/WorldFx`, подсветка — `game/render/Highlight`. Дроп, открытые ящики и содержимое сундуков — в дельте `World`.
- Крафт: `core/systems/Craft` (`Stations` — очереди, выход, топливо, питание, догон по игровому времени; источники ресурсов — игрок + сундуки рядом; открытие рецептов), числа — `public/data/craft.json`. Станки и защита — предметы категорий `placeable`/`defense`, их собирает `Registry` из `stations.json`/`defense.json`. Окно — `CraftScene` (мир не на паузе), установка — `WorldScene.startPlacing`, визуал станков — `game/world/StationViews`. В сохранении — `craft: { known, seen, stations }`.
- Стройка: `core/world/Build.ts` (детали, цена, допустимость, улучшение/починка/разбор, комнаты), постройки игрока — `World.setBuilt/builtAt/damageWall` (дельта `build`); защита — `core/systems/Defense.ts` (`tickDefense`, взрывы, `Dummy`); числа — `public/data/build_rules.json`. Режим стройки — `BuildScene` (панель) + `game/build/BuildController` (призрак, протяжка, молоток, отмена); визуал защиты — `game/world/DefenseViews`; меню кровати/тотема — `MenuScene`. Объекты из `delta.added` в чанке — те же объекты (не копии), их `hp`/`data` сохраняются.
- Бой и враги: `core/systems/Combat.ts` (оружие с модами, броня, сектор, луч), `core/entities/Enemy.ts` (автомат и особые механики 16 врагов), `core/systems/Pathfind.ts` (A*), `core/systems/Spawn.ts` (спавн, кровавая ночь); числа — `public/data/combat.json`. В игре — `game/enemies/EnemyManager` (спавн, снаряды, площади, удары героя, цифры) и `EnemyViews` (целый спрайт с процедурной анимацией — риги врагов не откалиброваны). Бой героя — `HeroController.attack` через `hero.combat`. Анимации врага (`anim.at`) — в игровых секундах. Баланс — `npm run balance-check` → `docs/BALANCE_CHECK.md`.
- Прогрессия (шаг 9): `core/systems/Progress` (опыт, навыки, `skillEffect`; `requiresSkill "engineer_2"` = 2 очка в ветке), `Quests` (ежедневные задания, записки), `Tutorial`, `core/entities/Boss`, `Vehicle`; числа — `public/data/progression.json` (`reg.prog`). В игре — `game/progress/GameProgress` (`world.progress`, событие `NOTIFY`), `game/bosses/BossManager` (арены, красные зоны, награда `boss_defeated`), `game/vehicles/VehicleManager`, `ui/HudExtras` (плашки, полоса босса, часы, мини-карта, обучение). Окна: `SkillsScene` (K), `JournalScene` (J), `MapScene` (M), `SettingsScene`.
- Звук — `game/audio/AudioBus` (шины music/sfx/ui, `play`, `loop`, `playMusic`); файлы `public/audio/` (OGG Opus + MP3, лицензии — `LICENSES.md`) **грузятся в фоне** (`loadInBackground` из меню и мира) — не добавлять их в `PreloadScene`: 76 файлов вешали загрузку на телефоне.
- `src/core/world` — `World` (чанки, кэш, дельта, коллайдеры), `WorldLayout` (кольца, дороги, префабы, ворота), `Collision`; `src/core/systems/DayNight`. Рендер мира — `src/game/render` (`ChunkView`, `GroundTiles`, `Lighting`, `Fx` — общие приёмы анимации).
- Отладка: `?debug`, F1 — оверлей, C — книга крафтов, B — стройка, F2 — галерея ассетов (`?gallery=<вкладка>&bg=&ref=`), F7 — галерея анимаций, `?scene=stress` / `?scene=world`, `?rs=` — масштаб рендера. F6 — редактор рига (`?scene=rig&char=<id>`; в `npm run dev` сохраняет в `public/data/rigs_tuned/`). В мире: F3 — свободная камера и коллайдеры, F4 — время ×10, F5 — карта с телепортом, F8 — инструменты на пояс, F9 — запасной режим героя, F10 — урон, F11 — враг биома (Shift — манекен), `?nospawn` — без спавна, F12 — чит стройки.

Правила ТЗ, которые легко нарушить:

1. Логика — в тиках `GameClock`; `Date.now`/`performance.now`/`Math.random` в core запрещены. Пауза — только `clock.pause/resume(reason)`.
2. Числа баланса, рецепты, дропы — только в `public/data/*.json`, из кода — через `Registry`.
3. Различия площадок — только через `PlatformServices`/`PlatformConfig`.
4. Строки UI — `t()` и `public/i18n/ru.json`; имена предметов — `name_ru` из данных.
5. Спрайты — только по `assetId` через `spawnSprite`, никаких путей к PNG в коде.

## Данные и ассеты

- `art/` — исходники (копия пакета, в сборку не идут); `public/data/` — источник правды для данных. Любые правки данных и манифеста — отдельно, с записью в `CHANGELOG.md`. `npm run sync-package` **перезаписывает** обе папки.
- Генерация мира, коллайдеры, свет, камера — `public/data/worldgen.json`; префабы — `public/data/world/prefabs/*.json` (формат в README рядом).
- Атласы 2x, логический размер — `size` в `asset_index.json`; масштаб правится через `targetPx` в `art/assets_manifest.json` → `npm run pack-assets`.
- Не генерировать картинки; недостающее — кодом и в `ASSET_REQUESTS.md`. Не использовать `status: replaced`.
- `tools/datagen.py` пакета генерирует id рецептов как `r_<output>` — дубликаты при двух рецептах одного предмета.

## Подводные камни

- TypeScript 6.0 (не 7): typescript-eslint поддерживает < 6.1.
- `android/` создаёт Capacitor; настройки — `capacitor.config.ts` и `tools/patch-android.ts` (идемпотентный), руками не править.
- Слабый Android упирается в заполнение GPU: рендер по умолчанию 1x (`MAX_RENDER_SCALE` в `main.ts`), тексты — `resolution: TEXT_RES`.
- На Xiaomi `adb shell input`/`monkey` могут зависать — оборачивать таймаутом. Телефон для замеров подключён по USB; DevTools WebView: `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`.
- Часто меняющийся текст — только `BitmapText` со шрифтами `UI_FONT` / `UI_FONT_MONO` (`ui/BitmapFont.ts`): `Text.setText` перезаливает текстуру в GPU.
- Ленивые атласы грузятся через `createImageBitmap` (`AssetLoader`), иначе декодирование PNG блокирует кадр на 65–75 мс на телефоне. Память на телефоне — `dumpsys meminfo`, лог драйвера `AllocateTextureMemory` — накопительный счётчик.
- Мир 1024×1024 (было 512): сохранения хранят `world.size`, другой размер не загружается.
- Граница колец — забор (`WALL_FENCE`), проход через ворота на дорогах; изменения мира (дроп, ящики) живут в дельте `World`, а не в отрисовке.
- В HUD каждый Graphics/Shape/Text рвёт пакет отрисовки (~1–1.5 мс на телефоне), маска-трафарет — ещё дороже: рисовать из атласа `ui`, `BitmapText`, часто меняющиеся мелочи — в канву (как мини-карта).
- Phaser не отсекает объекты за кадром — скрывать невидимые чанки (`ChunkView.setVisible`). ADD-спрайты вперемешку с обычными рвут пакеты отрисовки (на телефоне ×5 медленнее) — держать их на одной глубине.
- appId `ru.pustosh.game` — временный.
