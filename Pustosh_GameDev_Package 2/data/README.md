# Игровые данные

Все числа баланса и весь контент — здесь. Код только читает эти файлы (шаг 2). Пути к картинкам — от корня пакета (`assets/...png`); на шаге 2 они превращаются в `assetId` манифеста. Файлы сгенерированы скриптом `tools/datagen.py`; при правке руками — сохранять формат и прогонять валидатор.

| Файл | Что внутри | Ключевые поля |
| --- | --- | --- |
| `items.json` | 149 предметов: ресурсы, инструменты, оружие, патроны, еда, медицина, одежда, рюкзаки, моды, трофеи | `id`, `category`, `tier`, `icon`, `stack`; инструменты — `toolType`, `harvestTier`, `durability`; оружие — `weaponKind`, `damage`, `attacksPerSec`, `rangeTiles`, `ammo`, `special`, `modSlots`; еда — `hunger`, `thirst`, `health`; одежда — `slot`, `armor`, `coldRes`, `heatRes`, `radRes`, `poisonRes`, `heroHead` |
| `stations.json` | 23 станка и объекта базы | `sprite`, `stateSprites`, `crafts`, `footprintTiles`, `needsPower` |
| `recipes.json` | 149 рецептов | `output`, `count`, `station`, `inputs`, `timeSec`, `unlock` (`known`/`tutorial`/`blueprint_or_boss`), `requiresSkill` |
| `building.json` | 5 материалов стен, 10 деталей, правила сборки стен | `materials[].hp`, `cost`, `requires`, `sprites`; `assembly_rules` |
| `defense.json` | 21 тип защиты и ловушек | `hp`, `effect`, `cost`, `station` |
| `enemies.json` | 13 врагов + 3 мирных зверя | `biomes`, `hp`, `damage`, `speedTilesPerSec`, `behavior`, `drops` (min, max), `rig`, `parts`, `elite` |
| `bosses.json` | 6 боссов | `hp`, `sprites`, `phases`, `attacks`, `trophy`, `unlocks` |
| `biomes.json` | 6 биомов + общие контейнеры и мебель | `levels`, `tiles`, `enemies`, `boss`, `gate`, `objects[].harvest` (`tool`, `minTier`, `drops`, `hits`), `afterHarvest` |
| `vehicles.json` | 7 машин | `body`, `wheel`, `track`, `speedMul`, `trunkSlots`, `fuelPer100Tiles`, `terrain` |
| `skills.json` | 4 ветки × 6 навыков × 3 уровня, кривая опыта | `branches[].skills[]` |
| `balance.json` | мир, сутки, игрок, выживание по площадкам, реклама по площадкам, покупки | `world`, `dayNight`, `player`, `survival.yandex/rustore`, `ads.yandex/rustore` |
| `rigs.json` | скелеты для анимации по частям: гуманоид, четвероногий, подход к боссам, анимации | `bones[]` (`pivot`, `attach`, `z`, `tint`), `partLengthFrac`, `animations`, `fallbackMVP` |

Файлы, которые агент создаёт сам по ходу шагов (с согласованием владельца): `loot_tables.json` (шаг 5), `world/prefabs/*.json` (шаг 3), `rigs_tuned/*.json` (шаги 4, 8), рецепты транспорта и улучшения тотема (шаг 9), `spawnWeight` врагов (шаг 8).
