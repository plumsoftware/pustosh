"""assets_manifest.json + data/rigs.json + data/scale.json
python3 -I manifest.py <package_root>"""
import os, sys, json
from PIL import Image
ROOT = sys.argv[1]
SHEET = {'icons/base': 's00_icons_first', 'icons/tools': 's01_icons_tools', 'icons/weapons': 's02_icons_weapons',
         'icons/resources': 's03_icons_resources', 'icons/food_medicine': 's04_icons_food_medicine',
         'icons/clothing_mods': 's05_icons_clothing_mods', 'tiles': 's06_tiles', 'building/walls': 's07_walls',
         'world/interior': 's08_interior', 'replacements': 's09_replacements', 'world/defense': 's10_defense',
         'world/biome1_suburb': 's11_biome1_suburb', 'world/biome2_swamp': 's12_biome2_swamp', 'world/biome3_city': 's13_biome3_city',
         'world/biome4_desert': 's14_biome4_desert', 'world/biome5_tundra': 's15_biome5_tundra',
         'world/biome6_epicenter': 's16_biome6_epicenter', 'characters/hero': 's17_hero', 'characters/enemies': 's18_enemies',
         'characters/animals': 's19_animals', 'characters/bosses': 's20_bosses', 'vehicles': 's21_transport',
         'effects': 's22_effects', 'ui': 's23_ui'}
# default in-game size (px at 1x, tile = 64 px) — longest side or height
DEFAULT = {'icons': ('fit_box', 64, 'center'), 'tiles': ('exact', 64, 'top_left'), 'building/walls': ('special', 64, 'see building.json'),
           'world/interior': ('height', 72, 'bottom_center'), 'replacements': ('see_item', 64, 'center'),
           'world/defense': ('height', 72, 'bottom_center'), 'world/biome': ('height', 96, 'bottom_center'),
           'characters': ('rig', 96, 'rig'), 'vehicles': ('width', 128, 'bottom_center'), 'effects': ('fit_box', 64, 'center'),
           'ui': ('fit_box', 64, 'center')}
BIG = {  # world objects that need bigger size (height px)
 'pine': 192, 'birch': 176, 'oak': 200, 'dead_tree': 160, 'willow': 192, 'swamp_tree_dead': 176, 'spruce': 192, 'frozen_tree': 176,
 'mutant_tree': 176, 'tree_planter': 128, 'street_lamp': 160, 'power_pole': 176, 'power_tower': 224, 'water_tower': 200,
 'drill_rig': 224, 'watchtower': 176, 'bus': 128, 'building_collapsed': 224, 'apartment_entrance': 224, 'shop_front': 176,
 'cooling_tower': 224, 'lab_module': 160, 'radar_dish': 160, 'excavator': 160, 'dump_truck': 160, 'pumpjack': 160,
 'tractor': 120, 'car_hatchback': 96, 'car_frame': 88, 'truck_cab': 120, 'trailer': 110, 'bus_stop': 128, 'well': 120,
 'gas_kiosk': 140, 'fishing_hut': 160, 'cabin': 160, 'mine_entrance': 140, 'checkpoint_tent': 120, 'tent_military': 120,
 'billboard': 150, 'monorail': 170, 'statue': 150, 'windmill': 200, 'plane_wreck': 110, 'bush_berries': 64, 'bush_picked': 60,
 'tall_grass': 48, 'cattails': 64, 'lily_pads': 40, 'rock_remains': 40, 'boulder': 72, 'boulder_mined': 64, 'stakes': 56,
 'landmine': 24, 'floor_spikes': 32, 'bear_trap_open': 36, 'pit_trap': 40, 'tumbleweed': 48, 'dune': 64, 'oil_seep': 32,
 'snowdrift': 48, 'cables': 40, 'animal_skull': 56, 'animal_skeleton': 48}
entries = []
for dp, dn, fn in os.walk(f'{ROOT}/assets'):
    for f in sorted(fn):
        if not f.endswith('.png'): continue
        rel = os.path.relpath(os.path.join(dp, f), ROOT)
        folder = os.path.relpath(dp, f'{ROOT}/assets')
        name = f[:-4]
        w, h = Image.open(os.path.join(dp, f)).size
        status = 'ok'
        if name.endswith('_OLD'): status = 'replaced'
        elif name.endswith('_alt'): status = 'alternative'
        key = next((k for k in DEFAULT if folder.startswith(k)), None)
        mode, size, pivot = DEFAULT[key]
        if folder.startswith('world/') and name in BIG: mode, size = 'height', BIG[name]
        e = dict(id=f"{folder.replace('/', '.')}.{name}", path=rel, folder=folder, name=name, sourceSheet=SHEET.get(folder),
                 srcSize=[w, h], status=status, scaleMode=mode, targetPx=size, pivot=pivot)
        if status == 'replaced':
            e['replacedBy'] = 'assets/replacements/' + name[:-4].replace('club', 'club_wooden') + '.png'
        if folder == 'replacements':
            REPL_WORLD = {'bear_trap_closed': 36, 'manhole': 40, 'hydrant': 64, 'bus_stop': 128, 'well': 120, 'outhouse': 120,
                          'gas_kiosk': 140, 'fishing_hut': 160, 'guardrail': 56, 'concrete_barrier': 56, 'boardwalk': 48}
            if name in REPL_WORLD: e.update(scaleMode='height', targetPx=REPL_WORLD[name], pivot='bottom_center')
            elif name == 'turret_head_mg': e.update(scaleMode='width', targetPx=72, pivot='center')
            else: e.update(scaleMode='fit_box', targetPx=64, pivot='center')
        entries.append(e)
json.dump(dict(note='Все пути от корня пакета. scaleMode: height/width = подогнать сторону к targetPx; fit_box = вписать в квадрат; '
                    'exact = привести к targetPx x targetPx; rig = масштаб задаёт data/rigs.json; special = см. data/building.json. '
                    'status=replaced — не использовать, есть замена в assets/replacements. pivot: точка привязки спрайта к позиции объекта.',
               count=len(entries), assets=entries), open(f'{ROOT}/assets_manifest.json', 'w'), ensure_ascii=False, indent=1)

# ---------------- rigs
HUMANOID = dict(
 facing='right (влево = scaleX -1 у корня)',
 bodyHeightPx=96,
 partLengthFrac={'head': 0.30, 'torso': 0.34, 'pelvis': 0.10, 'upper_arm': 0.22, 'forearm': 0.24, 'thigh': 0.24, 'shin': 0.30, 'backpack': 0.30},
 scaleRule='scale(part) = partLengthFrac[part] * bodyHeightPx / длинная_сторона(png части). Затем подправить в редакторе рига (шаг 4).',
 bones=[
  dict(id='root', parent=None, note='точка на земле между стоп'),
  dict(id='pelvis', parent='root', sprite='pelvis', pivot=[0.5, 0.35], attach=[0.0, -0.50]),
  dict(id='torso', parent='pelvis', sprite='torso', pivot=[0.5, 0.95], attach=[0.0, -0.03]),
  dict(id='head', parent='torso', sprite='head', pivot=[0.42, 0.88], attach=[0.06, -0.30]),
  dict(id='arm_far_upper', parent='torso', sprite='upper_arm', pivot=[0.5, 0.1], attach=[-0.02, -0.27], tint='#9A9A9A', z=-2),
  dict(id='arm_far_lower', parent='arm_far_upper', sprite='forearm', pivot=[0.1, 0.4], attach=[0.0, 0.20], tint='#9A9A9A', z=-2),
  dict(id='leg_far_upper', parent='pelvis', sprite='thigh', pivot=[0.5, 0.08], attach=[-0.02, 0.02], tint='#9A9A9A', z=-1),
  dict(id='leg_far_lower', parent='leg_far_upper', sprite='shin', pivot=[0.45, 0.06], attach=[0.0, 0.22], tint='#9A9A9A', z=-1),
  dict(id='leg_near_upper', parent='pelvis', sprite='thigh', pivot=[0.5, 0.08], attach=[0.03, 0.02], z=1),
  dict(id='leg_near_lower', parent='leg_near_upper', sprite='shin', pivot=[0.45, 0.06], attach=[0.0, 0.22], z=1),
  dict(id='backpack', parent='torso', sprite='backpack', pivot=[0.7, 0.5], attach=[-0.10, -0.17], z=-3, optional=True),
  dict(id='arm_near_upper', parent='torso', sprite='upper_arm', pivot=[0.5, 0.1], attach=[0.02, -0.27], z=3),
  dict(id='arm_near_lower', parent='arm_near_upper', sprite='forearm', pivot=[0.1, 0.4], attach=[0.0, 0.20], z=3),
  dict(id='held_item', parent='arm_near_lower', sprite='<icon of equipped tool/weapon>', pivot=[0.25, 0.75], attach=[0.20, 0.0], z=4,
       note='держимый предмет = его иконка, масштаб ~0.45 bodyHeight'),
 ],
 attachUnits='attach = смещение точки крепления от pivot родителя в долях bodyHeightPx (x вправо, y вниз)',
 drawOrder='по z: backpack(-3) → дальняя рука(-2) → дальняя нога(-1) → таз, торс, голова(0) → ближняя нога(1) → ближняя рука(3) → предмет(4)',
 animations=dict(
  idle=dict(loopSec=2.0, keys='torso y ±0.01 (дыхание), head rot ±2°, arms rot ±3°'),
  walk=dict(loopSec=0.7, keys='thigh near: -25°→+25°, far: противофаза; shin: 0→+30° на заносе; arm upper: ±20° в противофазе ногам; root y bob 0.015'),
  run=dict(loopSec=0.45, keys='как walk, амплитуды x1.5, torso наклон +8°'),
  attack_slash=dict(durSec=0.35, keys='arm_near_upper -110° (замах) → +40° (удар) → 0; torso +6°; хит-кадр на 55%'),
  attack_blunt=dict(durSec=0.45, keys='как slash, замах -130°, удар медленнее, тряска камеры 0.1'),
  attack_pierce=dict(durSec=0.3, keys='arm_near_upper -20° → +70° с выносом вперёд на 0.08'),
  shoot=dict(durSec=0.15, keys='обе руки вперёд +80°, отдача held_item x -0.03, вспышка effects/muzzle_1|2'),
  gather=dict(loopSec=0.6, keys='как attack_blunt, но по объекту; частицы dust/spark от типа ресурса'),
  dodge=dict(durSec=0.35, keys='root rot 0→360° (кувырок) или смещение 1.5 тайла + прозрачность 0.7'),
  hurt=dict(durSec=0.2, keys='head → head_hurt, тинт красным 0.15 c, отброс 0.2 тайла'),
  blink=dict(everySec='3–6 случайно', durSec=0.12, keys='head → head_blink'),
  death=dict(durSec=0.6, keys='root rot до 90°, опуститься на землю, альфа 1→0 за 2 c (для врагов)')),
 fallbackMVP='Если риг не готов: рисовать ref_idle целиком, шаг = ref_walk/ref_idle по очереди 0.18 c + bob, удар = поворот held_item. Игра должна работать и так.',
)
QUAD = dict(
 facing='right', bodyLengthPx=96,
 partLengthFrac={'head': 0.35, 'body': 0.60, 'front_upper': 0.28, 'front_lower': 0.30, 'back_upper': 0.30, 'back_lower': 0.30, 'tail': 0.35},
 bones=[dict(id='root', parent=None), dict(id='body', parent='root', sprite='body', pivot=[0.5, 0.5], attach=[0.0, -0.42]),
        dict(id='head', parent='body', sprite='head', pivot=[0.25, 0.65], attach=[0.30, -0.08]),
        dict(id='tail', parent='body', sprite='tail', pivot=[0.9, 0.3], attach=[-0.30, -0.06], z=-1),
        dict(id='leg_fl_far', parent='body', sprite='front_upper', pivot=[0.5, 0.1], attach=[0.20, 0.10], tint='#9A9A9A', z=-1),
        dict(id='leg_fl_far_lower', parent='leg_fl_far', sprite='front_lower', pivot=[0.5, 0.08], attach=[0, 0.22], tint='#9A9A9A', z=-1),
        dict(id='leg_bl_far', parent='body', sprite='back_upper', pivot=[0.5, 0.1], attach=[-0.20, 0.08], tint='#9A9A9A', z=-1),
        dict(id='leg_bl_far_lower', parent='leg_bl_far', sprite='back_lower', pivot=[0.5, 0.08], attach=[0, 0.22], tint='#9A9A9A', z=-1),
        dict(id='leg_fl', parent='body', sprite='front_upper', pivot=[0.5, 0.1], attach=[0.24, 0.10], z=1),
        dict(id='leg_fl_lower', parent='leg_fl', sprite='front_lower', pivot=[0.5, 0.08], attach=[0, 0.22], z=1),
        dict(id='leg_bl', parent='body', sprite='back_upper', pivot=[0.5, 0.1], attach=[-0.16, 0.08], z=1),
        dict(id='leg_bl_lower', parent='leg_bl', sprite='back_lower', pivot=[0.5, 0.08], attach=[0, 0.22], z=1)],
 variants={'raptor': 'двуногий: front_* = arm_upper/arm_lower (маленькие), back_* = leg_upper/leg_lower, тело наклонено, хвост длинный',
           'scorpion': 'front = pincer_arm + pincer_claw; 6 ног = leg_upper/leg_lower повторить 3 раза с шагом 0.15 по X; tail = tail_stinger над телом',
           'toad': 'tongue_and_sac: разрезать по вертикали в коде НЕ надо — для атаки языком растягивать по X верхнюю часть (язык), мешок пульсирует масштабом',
           'hare': 'ears вместо tail: крепятся к голове, подёргиваются'},
 animations=dict(walk='диагональные пары ног в противофазе ±25°, 0.6 c', run='галоп 0.4 c, body наклон ±5°', bite='head rot -15° → +10°, рывок вперёд 0.1',
                 idle='дыхание body scaleY 1±0.02, хвост ±8°'),
 fallbackMVP='idle-спрайт целиком + bob/наклон при движении',
)
BOSS = dict(note='Боссы: целые спрайты idle/phase2 + отдельные части для эффектных атак. Не обязательно собирать полный риг.',
 approach=['Базовая отрисовка — спрайт idle (после 50% — phase2) с процедурной анимацией: дыхание scaleY, наклон к цели, тряска при ударе.',
           'Атаки делаются отдельными частями поверх: butcher_hook_chain летит к игроку, цепь = повтор сегмента; tyrant_tail для взмаха; '
           'devourer_teeth_ring вращается в пасти; frost_ice_shard и zero_tentacle — снаряды/хлысты; queen_egg_sacs пульсируют.',
           'Смерть — повернуть idle на 90°, затемнить, частицы dust/explosion, выпадает трофей.'])
json.dump(dict(humanoid=HUMANOID, quadruped=QUAD, boss=BOSS,
               usage=dict(hero='characters/hero/*: pelvis, torso, head_*, upper_arm, forearm_open|forearm_fist, thigh, shin_boot, backpack',
                          enemies='characters/enemies/<id>_<part>; crawler без ног: rags вместо thigh, forearm_2 — запасная рука (в файле может быть стопа — не использовать)',
                          animals='characters/animals/<id>_<part>')),
          open(f'{ROOT}/data/rigs.json', 'w'), ensure_ascii=False, indent=1)
print('manifest entries', len(entries))
