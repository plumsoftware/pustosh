# Отчёт об упаковке ассетов

Создан `npm run pack-assets`. Формат листов: **PNG**, масштаб атласов 2x, лист до 2048×2048, отступ 2 px, выдавливание края 1 px (тайлы 2 px).

## Итог

| Что | Вес |
| --- | --- |
| Все атласы | 10.24 МБ |
| **Первая загрузка** (группы «при старте» + данные + индекс) | **7.12 МБ** |
| — из них атласы | 6.78 МБ |
| — данные `public/data` | 223 КБ |
| — `asset_index.json` | 119 КБ |
| Ленивые группы (биомы 2–6, боссы, транспорт) | 3.45 МБ |
| Спрайтов в индексе | 980 |

Первая загрузка укладывается в цель ~15 МБ.

## Атласы

| Группа | Загрузка | Листы | Размер листов, px | Кадров | Вес |
| --- | --- | --- | --- | --- | --- |
| `ui` | при старте | 1 | 1450×1337 | 110 | 871 КБ |
| `icons` | при старте | 1 | 1635×1612 | 148 | 952 КБ |
| `tiles` | при старте | 1 | 534×534 | 16 | 171 КБ |
| `walls` | при старте | 1 | 1323×1409 | 115 | 979 КБ |
| `interior` | при старте | 1 | 1731×1802 | 110 | 1328 КБ |
| `biome1` | при старте | 1 | 1114×1166 | 22 | 505 КБ |
| `biome2` | лениво | 1 | 1094×1002 | 20 | 487 КБ |
| `biome3` | лениво | 1 | 1319×1394 | 23 | 713 КБ |
| `biome4` | лениво | 1 | 1373×1374 | 25 | 586 КБ |
| `biome5` | лениво | 1 | 1087×1182 | 25 | 534 КБ |
| `biome6` | лениво | 1 | 1222×1294 | 25 | 622 КБ |
| `hero` | при старте | 1 | 1232×1316 | 32 | 616 КБ |
| `enemies` | при старте | 1 | 1375×1336 | 91 | 694 КБ |
| `animals` | при старте | 1 | 1249×1282 | 101 | 581 КБ |
| `bosses` | лениво | 1 | 1040×988 | 49 | 377 КБ |
| `vehicles` | лениво | 1 | 710×643 | 16 | 216 КБ |
| `effects` | при старте | 1 | 977×871 | 52 | 250 КБ |

## Пропущены (status: replaced) — 23

- `world.defense.bear_trap_closed_OLD` → `assets/replacements/bear_trap_closed.png`
- `world.defense.turret_head_mg_OLD` → `assets/replacements/turret_head_mg.png`
- `world.biome3_city.hydrant_OLD` → `assets/replacements/hydrant.png`
- `world.biome3_city.manhole_OLD` → `assets/replacements/manhole.png`
- `world.biome2_swamp.boardwalk_OLD` → `assets/replacements/boardwalk.png`
- `world.biome2_swamp.concrete_barrier_OLD` → `assets/replacements/concrete_barrier.png`
- `world.biome2_swamp.fishing_hut_OLD` → `assets/replacements/fishing_hut.png`
- `world.biome2_swamp.gas_kiosk_OLD` → `assets/replacements/gas_kiosk.png`
- `world.biome2_swamp.guardrail_OLD` → `assets/replacements/guardrail.png`
- `world.biome1_suburb.bus_stop_OLD` → `assets/replacements/bus_stop.png`
- `world.biome1_suburb.outhouse_OLD` → `assets/replacements/outhouse.png`
- `world.biome1_suburb.well_OLD` → `assets/replacements/well.png`
- `icons.food_medicine.antidote_OLD` → `assets/replacements/antidote.png`
- `icons.food_medicine.soda_OLD` → `assets/replacements/soda.png`
- `icons.food_medicine.splint_OLD` → `assets/replacements/splint.png`
- `icons.weapons.club_OLD` → `assets/replacements/club_wooden.png`
- `icons.weapons.pistol_OLD` → `assets/replacements/pistol.png`
- `icons.weapons.rifle_hunting_OLD` → `assets/replacements/rifle_hunting.png`
- `icons.weapons.sniper_rifle_OLD` → `assets/replacements/sniper_rifle.png`
- `icons.clothing_mods.backpack_hiking_OLD` → `assets/replacements/backpack_hiking.png`
- `icons.clothing_mods.mod_flashlight_OLD` → `assets/replacements/mod_flashlight.png`
- `icons.resources.clay_OLD` → `assets/replacements/clay.png`
- `icons.resources.plastic_OLD` → `assets/replacements/plastic.png`

## Разрезанные составные файлы

- `characters.animals.toad_tongue_and_sac` → `characters.animals.toad_tongue` (0–25% высоты)
- `characters.animals.toad_tongue_and_sac` → `characters.animals.toad_sac` (25–100% высоты)

## Масштаб относительно героя

Эталон `characters.hero.ref_idle`: рост 96 px, ширина ≈ 42 px (логический размер). Критерий «машина в 1.5–2 раза шире героя» считается от **роста** героя: от ширины фигуры (≈ 42 px) машина вышла бы ниже пояса.

| Проверка | Спрайт | Размер, px | Отношение к росту | Нужно | Ок |
| --- | --- | --- | --- | --- | --- |
| дерево ≈ 2 роста | `world.biome1_suburb.birch` | 134×176 | 1.83 | 1.6–2.4 роста | да |
| дерево ≈ 2 роста | `world.biome1_suburb.dead_tree` | 120×160 | 1.67 | 1.6–2.4 роста | да |
| дерево ≈ 2 роста | `world.biome1_suburb.oak` | 196×200 | 2.08 | 1.6–2.4 роста | да |
| дерево ≈ 2 роста | `world.biome1_suburb.pine` | 114×192 | 2.00 | 1.6–2.4 роста | да |
| машина: ширина 1.5–2 роста | `vehicles.buggy_body` | 144×56 | 1.50 | 1.5–2 | да |
| машина: ширина 1.5–2 роста | `vehicles.pickup_body` | 176×68 | 1.83 | 1.5–2 | да |
| машина: ширина 1.5–2 роста | `vehicles.snowcat_body` | 176×102 | 1.83 | 1.5–2 | да |
| обломок машины сбоку | `world.biome1_suburb.car_frame` | 145×104 | 1.51 | 1.5–2 | да |
| обломок машины сбоку | `world.biome1_suburb.car_hatchback` | 153×106 | 1.59 | 1.5–2 | да |
| двухколёсные/квадроцикл ниже героя | `vehicles.bicycle_body` | 96×54 | 0.56 | < 0.7 | да |
| двухколёсные/квадроцикл ниже героя | `vehicles.moped_body` | 104×56 | 0.58 | < 0.7 | да |
| двухколёсные/квадроцикл ниже героя | `vehicles.moto_body` | 120×56 | 0.58 | < 0.7 | да |
| двухколёсные/квадроцикл ниже героя | `vehicles.quad_body` | 112×52 | 0.54 | < 0.7 | да |
| ящик ниже пояса | `world.interior.crate_military_closed` | 58×44 | 0.46 | < 0.5 роста | да |
| ящик ниже пояса | `world.interior.crate_military_open` | 38×44 | 0.46 | < 0.5 роста | да |
| ящик ниже пояса | `world.interior.crate_wood_closed` | 47×44 | 0.46 | < 0.5 роста | да |
| ящик ниже пояса | `world.interior.crate_wood_open` | 35×44 | 0.46 | < 0.5 роста | да |
