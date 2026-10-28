# Шаблон промпта для новых картинок (ChatGPT)

Нужен, если агент записал что-то в `ASSET_REQUESTS.md`. Прикладывай к промпту: 1) лист иконок `source_sheets/s01_icons_tools.png` (образец стиля); 2) для объектов мира — `tools/angle_reference.png` (образец ракурса); 3) для персонажей — `source_sheets/s17_hero.png`.

Проверенные правила (из опыта генерации этого пакета):

- Фон — сплошной `#FF00FF`; для пустынных/оранжевых объектов — `#0000FF`; для эффектов — чёрный `#000000`.
- Никаких подложек под объектами (песок, трава, снег, лужи), никаких теней на земле.
- Дым, пар, огонь, вода, туман, ореолы — не рисовать в спрайтах (делаются кодом). Свечение — только краской на объекте.
- Стекло непрозрачное; тонкие балки, проволока, спицы — толще волоса.
- Ракурс объектов мира: «front-facing top-down RPG view, only top + front visible» + образец. Персонажи — «facing right, from the side, slightly from above».
- Сетка до 10×5 держится; при потере деталей — «Draw ONLY rows 1–N».

```
TWO ATTACHED IMAGES: image 1 = the art style reference (inventory icons). Image 2 = the camera angle reference: copy ONLY its LEFT side.

ART STYLE — follow strictly. 2D world sprites for a mobile post-apocalyptic open-world survival game. Match image 1 exactly in rendering: painted semi-realistic look with slightly chunky, friendly proportions, visible volume and hand-painted texture detail (rust, moss, chipped paint, worn wood, scratches, dirt). Warm muted palette: olive and moss greens, rusty oranges, weathered browns, faded blues and reds. Soft light from the top-left, gentle ambient occlusion, crisp readable silhouettes.

CAMERA: classic front-facing top-down RPG view — every object stands square to the camera, its front faces the viewer straight-on, we look down from about 45 degrees, so ONLY the top and the front are visible. Never diagonal, never isometric.

BACKGROUND AND EDGES — critical: perfectly flat solid magenta #FF00FF. NO ground patch, NO shadow. Hard, clean, fully opaque edges. Glass painted opaque. Thin parts solid.

FORBIDDEN: smoke, steam, fire, water spray, mist, glow halos, blood, text, letters, numbers, logos, real brands, watermark, grid lines, labels.

SHEET FORMAT: one square image, invisible grid of [C] columns and [R] rows of equal cells, one object per cell, centered, at least 12% empty margin, objects never touch. Fill left to right, top to bottom:
1. ...
2. ...
```

Нарезка: `python3 -I tools/cutter.py <папка_с_листами> <папка_вывода>` (добавить лист и имена в список `JOBS`), затем `tools/datagen.py` и `tools/manifest.py`.
