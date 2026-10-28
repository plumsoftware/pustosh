"""Генератор игровых данных «Пустоши» + манифест ассетов.
python3 -I datagen.py <package_root>
Проверяет, что каждая картинка, на которую ссылаются данные, существует.
"""
import json, os, sys
from PIL import Image

ROOT = sys.argv[1]
A = f'{ROOT}/assets'
D = f'{ROOT}/data'
os.makedirs(D, exist_ok=True)
missing = []

def ic(path):
    p = f'assets/{path}.png'
    if not os.path.exists(f'{ROOT}/{p}'):
        missing.append(p)
    return p

# ============================================================ ITEMS
items = []
def item(id, name, cat, tier, icon, stack=1, **kw):
    d = dict(id=id, name_ru=name, category=cat, tier=tier, icon=ic(icon), stack=stack)
    d.update(kw); items.append(d)

# --- resources
R = 'icons/resources/'
for id, name, tier, icon, src in [
 ('wood', 'Древесина', 1, R+'log', 'деревья (топор)'),
 ('sticks', 'Ветки', 0, R+'sticks', 'кусты, земля (руки)'),
 ('fiber', 'Волокно', 0, R+'fiber', 'трава (руки/нож)'),
 ('stone', 'Камень', 1, R+'stone', 'камни (кирка), земля (руки)'),
 ('planks', 'Доски', 1, 'icons/base/planks', 'крафт из древесины, мебель (молоток)'),
 ('scrap_metal', 'Металлолом', 2, 'icons/base/scrap_metal', 'машины и руины (гаечный ключ)'),
 ('clay', 'Глина', 2, 'replacements/clay', 'болото (лопата)'),
 ('peat', 'Торф', 2, R+'peat', 'болото (лопата), топливо'),
 ('bones', 'Кости', 1, R+'bones', 'звери, скелеты'),
 ('hide', 'Шкура', 1, R+'hide', 'звери (нож)'),
 ('fur', 'Мех', 3, R+'fur', 'волки, кабаны (нож)'),
 ('copper_ore', 'Медная руда', 3, 'icons/base/copper_ore', 'медные камни болота (кирка тир 2+)'),
 ('copper_ingot', 'Медный слиток', 3, R+'copper_ingot', 'плавильня'),
 ('steel_ingot', 'Стальной слиток', 4, 'icons/base/steel_ingot', 'плавильня: металлолом + уголь'),
 ('steel_plates', 'Стальные пластины', 4, R+'steel_plates', 'верстак II, разбор техники'),
 ('titanium_ore', 'Титановая руда', 5, R+'titanium_ore', 'тундра (кирка тир 4+)'),
 ('titanium_ingot', 'Титановый слиток', 5, R+'titanium_ingot', 'плавильня'),
 ('sand', 'Песок', 2, R+'sand', 'пустыня, берег (лопата)'),
 ('sulfur', 'Сера', 4, R+'sulfur', 'серные камни пустыни'),
 ('coal', 'Уголь', 3, R+'coal', 'угольные камни, обжиг древесины'),
 ('crude_oil', 'Нефть / топливо', 4, R+'crude_oil', 'нефтяные лужи, канистры в руинах'),
 ('uranium', 'Уран', 6, R+'uranium', 'эпицентр (кирка тир 5+)'),
 ('circuit_board', 'Электроника', 3, R+'circuit_board', 'техника в городе'),
 ('rags', 'Тряпьё', 1, R+'rags', 'заражённые, шкафы'),
 ('plastic', 'Пластик', 2, 'replacements/plastic', 'мусор, бытовая техника'),
 ('rubber', 'Резина', 2, R+'rubber', 'шины, машины'),
 ('copper_wire', 'Медная проволока', 3, R+'copper_wire', 'крафт, техника'),
 ('battery', 'Аккумулятор', 3, R+'battery', 'машины (гаечный ключ)'),
 ('nails_bolts', 'Гвозди и болты', 2, R+'nails_bolts', 'мебель, техника, крафт'),
 ('duct_tape', 'Изолента', 2, 'icons/tools/duct_tape', 'ящики, крафт'),
]:
    item(id, name, 'resource', tier, icon, stack=99, source=src)

# --- tools: type, tier, power(урон по ресурсу), durability
T = 'icons/tools/'
for id, name, typ, tier, icon, dur in [
 ('axe_stone', 'Каменный топор', 'axe', 1, 'icons/base/stone_axe_alt', 60),
 ('axe_scrap', 'Ржавый топор', 'axe', 2, T+'axe_scrap', 120),
 ('axe_copper', 'Медный топор', 'axe', 3, T+'axe_copper', 220),
 ('axe_steel', 'Стальной топор', 'axe', 4, T+'axe_steel', 400),
 ('axe_titanium', 'Титановый топор', 'axe', 5, T+'axe_titanium', 900),
 ('pickaxe_stone', 'Каменная кирка', 'pickaxe', 1, 'icons/base/stone_pickaxe_alt', 60),
 ('pickaxe_scrap', 'Ржавая кирка', 'pickaxe', 2, T+'pickaxe_scrap', 120),
 ('pickaxe_copper', 'Медная кирка', 'pickaxe', 3, T+'pickaxe_copper', 220),
 ('pickaxe_steel', 'Стальная кирка', 'pickaxe', 4, T+'pickaxe_steel', 400),
 ('pickaxe_titanium', 'Титановая кирка', 'pickaxe', 5, T+'pickaxe_titanium', 900),
 ('shovel_wooden', 'Деревянная лопата', 'shovel', 1, T+'shovel_wooden', 80),
 ('shovel_steel', 'Стальная лопата', 'shovel', 4, T+'shovel_steel', 400),
 ('hammer_builder', 'Молоток строителя', 'hammer', 1, T+'hammer_builder', 300),
 ('hammer_claw', 'Стальной молоток', 'hammer', 4, T+'hammer_claw', 900),
 ('wrench', 'Гаечный ключ', 'wrench', 2, T+'wrench', 250),
 ('knife_hunting', 'Охотничий нож', 'knife', 2, T+'knife_hunting', 200),
 ('knife_skinning', 'Титановый нож', 'knife', 5, T+'knife_skinning_titanium', 700),
 ('flashlight', 'Фонарик', 'light', 3, T+'flashlight', 600),
 ('lantern', 'Керосиновая лампа', 'light', 2, T+'lantern', 400),
 ('fishing_rod', 'Удочка', 'fishing', 1, T+'fishing_rod', 100),
 ('binoculars', 'Бинокль', 'utility', 2, T+'binoculars', 0),
 ('lockpicks', 'Отмычки', 'utility', 2, T+'lockpicks', 20),
 ('hand_drill', 'Ручная дрель', 'utility', 3, T+'hand_drill', 150),
]:
    item(id, name, 'tool', tier, icon, toolType=typ, harvestTier=tier, durability=dur,
         staminaPerUse=2, gatherMultiplier=round(1 + 0.35 * (tier - 1), 2))
item('repair_kit', 'Ремкомплект', 'consumable', 2, T+'repair_kit', stack=10, effect=dict(repairPercent=50))
item('canteen', 'Фляга', 'container', 1, T+'canteen', waterCapacity=3)
item('bucket', 'Ведро', 'container', 1, T+'bucket', waterCapacity=6)

# --- weapons
W = 'icons/weapons/'
def weapon(id, name, tier, icon, kind, dmg, rate, rng, dur, ammo=None, special=None, mods=0):
    item(id, name, 'weapon', tier, icon, weaponKind=kind, damage=dmg, attacksPerSec=rate, rangeTiles=rng,
         durability=dur, ammo=ammo, special=special, modSlots=mods)
weapon('club', 'Дубина', 1, 'replacements/club_wooden', 'melee_blunt', 12, 1.2, 1.2, 80)
weapon('spear_stone', 'Каменное копьё', 1, W+'spear_stone', 'melee_pierce', 14, 1.0, 1.8, 70)
weapon('slingshot', 'Праща', 1, W+'slingshot', 'ranged', 8, 1.4, 6, 100, ammo='stone')
weapon('bow', 'Лук', 1, 'icons/base/bow', 'ranged', 16, 1.0, 8, 120, ammo='sticks')
weapon('bat_nails', 'Бита с гвоздями', 2, W+'bat_nails', 'melee_blunt', 20, 1.1, 1.3, 140, special='bleed', mods=2)
weapon('machete', 'Мачете', 2, W+'machete', 'melee_slash', 22, 1.4, 1.2, 160, mods=2)
weapon('crossbow', 'Арбалет', 2, W+'crossbow', 'ranged', 30, 0.6, 9, 160, ammo='sticks', mods=2)
weapon('pistol_pipe', 'Самодельный пистолет', 2, W+'pistol_pipe', 'firearm', 26, 0.8, 8, 120, ammo='ammo_pistol', mods=2)
weapon('fire_axe', 'Пожарный топор', 3, W+'fire_axe', 'melee_slash', 34, 0.9, 1.3, 260, mods=2)
weapon('knuckles_shock', 'Кастет-шокер', 3, W+'knuckles_shock', 'melee_blunt', 24, 2.0, 0.9, 220, special='stun', mods=2)
weapon('pistol', 'Пистолет', 3, 'replacements/pistol', 'firearm', 30, 2.0, 9, 400, ammo='ammo_pistol', mods=2)
weapon('shotgun_sawedoff', 'Обрез', 3, W+'shotgun_sawedoff', 'firearm', 18, 0.8, 4, 300, ammo='ammo_shotgun', special='pellets_6', mods=2)
weapon('sledgehammer', 'Кувалда', 4, W+'sledgehammer', 'melee_blunt', 60, 0.6, 1.4, 500, special='knockback', mods=3)
weapon('sword_steel', 'Стальной меч', 4, W+'sword_steel', 'melee_slash', 45, 1.3, 1.4, 500, mods=3)
weapon('shotgun_pump', 'Помповый дробовик', 4, W+'shotgun_pump', 'firearm', 22, 1.0, 5, 600, ammo='ammo_shotgun', special='pellets_8', mods=3)
weapon('rifle_hunting', 'Охотничья винтовка', 4, 'replacements/rifle_hunting', 'firearm', 70, 0.7, 14, 600, ammo='ammo_rifle', mods=3)
weapon('molotov', 'Коктейль Молотова', 4, W+'molotov', 'throwable', 40, 0.5, 6, 1, special='fire_area', mods=0)
weapon('grenade', 'Граната', 4, W+'grenade', 'throwable', 90, 0.5, 6, 1, special='explosion_area', mods=0)
weapon('katana_titanium', 'Титановая катана', 5, W+'katana_titanium', 'melee_slash', 75, 1.5, 1.5, 900, mods=3)
weapon('baton_electric', 'Электродубина', 5, W+'baton_electric', 'melee_blunt', 55, 1.3, 1.3, 800, special='shock_breaks_shield', mods=3)
weapon('assault_rifle', 'Автомат', 5, W+'assault_rifle', 'firearm', 34, 8.0, 12, 900, ammo='ammo_rifle', mods=3)
weapon('sniper_rifle', 'Снайперская винтовка', 5, 'replacements/sniper_rifle', 'firearm', 160, 0.5, 20, 800, ammo='ammo_rifle', mods=3)
weapon('flamethrower', 'Огнемёт', 5, W+'flamethrower', 'flame', 12, 10.0, 4, 700, ammo='crude_oil', special='fire_cone', mods=2)
weapon('plasma_cutter', 'Плазменный резак', 6, W+'plasma_cutter', 'melee_slash', 120, 1.6, 1.4, 1500, special='ignore_armor', mods=3)
weapon('railgun', 'Рельсотрон', 6, W+'railgun', 'energy', 260, 0.4, 22, 1500, ammo='battery', special='pierce_all', mods=3)
weapon('energy_rifle', 'Энерговинтовка', 6, W+'energy_rifle', 'energy', 60, 4.0, 14, 1500, ammo='battery', mods=3)
for id, name, t, tint in [('ammo_pistol', 'Патроны пистолетные', 3, '#C9A24B'), ('ammo_shotgun', 'Патроны дробовые', 3, '#B5402F'),
                          ('ammo_rifle', 'Патроны винтовочные', 4, '#6E8B3D')]:
    item(id, name, 'ammo', t, 'icons/clothing_mods/ammo_box', stack=60, iconTint=tint,
         note='Одна иконка ammo_box, тип патронов различается цветной плашкой кодом')

# --- food & medicine
F = 'icons/food_medicine/'
for id, name, icon, hun, thi, hp, extra in [
 ('meat_raw', 'Сырое мясо', F+'meat_raw', 10, 0, 0, dict(poisonChance=0.3)),
 ('meat_grilled', 'Жареное мясо', F+'meat_grilled', 35, -5, 5, {}),
 ('fish_raw', 'Сырая рыба', F+'fish_raw', 8, 0, 0, dict(poisonChance=0.25)),
 ('fish_grilled', 'Жареная рыба', F+'fish_grilled', 30, 0, 5, {}),
 ('berries', 'Ягоды', F+'berries', 8, 4, 0, {}),
 ('mushrooms', 'Грибы', F+'mushrooms', 10, 0, 0, dict(poisonChance=0.1)),
 ('potato', 'Картофель', F+'potato', 15, 0, 0, {}),
 ('carrot', 'Морковь', F+'carrot', 12, 3, 0, {}),
 ('beans_can', 'Банка фасоли', F+'beans_can', 30, 5, 0, {}),
 ('canned_food', 'Консервы', 'icons/base/canned_food', 30, 5, 0, {}),
 ('ration', 'Армейский паёк', F+'ration', 50, 10, 10, {}),
 ('chocolate', 'Шоколад', F+'chocolate', 15, -3, 0, dict(staminaRestore=30)),
 ('honey', 'Мёд', F+'honey', 20, -2, 5, {}),
 ('water_dirty', 'Грязная вода', F+'water_dirty', 0, 25, 0, dict(poisonChance=0.4)),
 ('water_clean', 'Чистая вода', F+'water_clean', 0, 40, 0, {}),
 ('water_bottle', 'Бутылка воды', 'icons/base/water_bottle', 0, 35, 0, {}),
 ('soda', 'Газировка', 'replacements/soda', 5, 25, 0, dict(staminaRestore=15)),
 ('coffee', 'Кофе', F+'coffee', 0, 10, 0, dict(staminaRegenBuffSec=120)),
]:
    item(id, name, 'food', 1, icon, stack=20, hunger=hun, thirst=thi, health=hp, **extra)
for id, name, icon, eff in [
 ('bandage', 'Бинт', 'icons/base/bandage', dict(health=15, stopsBleeding=True)),
 ('splint', 'Шина', 'replacements/splint', dict(health=10, curesFracture=True)),
 ('herbal_poultice', 'Травяная примочка', F+'herbal_poultice', dict(health=20, regenSec=20)),
 ('painkillers', 'Обезболивающее', F+'painkillers', dict(health=10, damageTakenMul=0.8, durationSec=60)),
 ('antibiotics', 'Антибиотики', F+'antibiotics', dict(curesInfection=True)),
 ('antirad', 'Антирадин', F+'antirad', dict(radiation=-50)),
 ('antidote', 'Противоядие', 'replacements/antidote', dict(curesPoison=True)),
 ('disinfectant', 'Дезинфектор', F+'disinfectant', dict(health=5, curesInfection=True)),
 ('stimulant', 'Стимулятор', F+'stimulant', dict(staminaRestore=100, speedMul=1.2, durationSec=30)),
 ('medkit', 'Аптечка', 'icons/base/medkit', dict(health=60, stopsBleeding=True)),
 ('first_aid_bag', 'Большая аптечка', F+'first_aid_bag', dict(health=100, stopsBleeding=True, curesPoison=True)),
]:
    item(id, name, 'medicine', 2, icon, stack=10, effect=eff)

# --- clothing
C = 'icons/clothing_mods/'
for id, name, slot, tier, icon, arm, cold, heat, rad, poison, extra in [
 ('shirt_ragged', 'Рваная рубаха', 'body', 1, C+'shirt_ragged', 2, 1, 0, 0, 0, {}),
 ('jacket_leather', 'Кожаная куртка', 'body', 2, C+'jacket_leather', 6, 3, 0, 0, 0, {}),
 ('jacket_winter', 'Пуховик', 'body', 3, C+'jacket_winter', 4, 10, -3, 0, 0, {}),
 ('robe_desert', 'Пустынная роба', 'body', 3, C+'robe_desert', 3, 0, 10, 0, 0, {}),
 ('hazmat_suit', 'Химзащита', 'body', 4, C+'hazmat_suit', 3, 2, -2, 10, 8, {}),
 ('vest_armor', 'Бронежилет', 'body', 4, C+'vest_armor', 16, 1, -1, 0, 0, {}),
 ('pants_cargo', 'Карго-штаны', 'legs', 1, C+'pants_cargo', 3, 1, 0, 0, 0, dict(beltSlots=1)),
 ('pants_winter', 'Утеплённые штаны', 'legs', 3, C+'pants_winter', 3, 7, -2, 0, 0, {}),
 ('sneakers', 'Кроссовки', 'feet', 1, C+'sneakers', 1, 0, 0, 0, 0, dict(speedMul=1.05, noiseMul=0.8)),
 ('boots_combat', 'Берцы', 'feet', 3, C+'boots_combat', 4, 2, 0, 0, 0, {}),
 ('boots_snow', 'Унты', 'feet', 4, C+'boots_snow', 2, 6, -2, 0, 0, {}),
 ('hat_fur', 'Шапка-ушанка', 'head', 3, C+'hat_fur', 1, 6, -2, 0, 0, dict(heroHead='characters/hero/head_furhat')),
 ('hat_sun', 'Панама', 'head', 2, C+'hat_sun', 0, 0, 6, 0, 0, {}),
 ('helmet', 'Каска', 'head', 3, C+'helmet', 8, 1, 0, 0, 0, dict(heroHead='characters/hero/head_helmet')),
 ('respirator', 'Респиратор', 'head', 3, C+'respirator', 0, 0, 0, 3, 8, {}),
 ('gas_mask', 'Противогаз', 'head', 4, 'icons/base/gas_mask', 1, 0, 0, 8, 10, dict(heroHead='characters/hero/head_gasmask')),
]:
    extra = dict(extra)
    if 'heroHead' in extra:
        extra['heroHead'] = ic(extra['heroHead'])
    item(id, name, 'clothing', tier, icon, slot=slot, armor=arm, coldRes=cold, heatRes=heat, radRes=rad,
         poisonRes=poison, durability=200 + tier * 150, modSlots=1 if tier < 3 else 2, **extra)
for id, name, tier, icon, slots in [('backpack_small', 'Малый рюкзак', 1, 'icons/base/small_backpack', 10),
                                    ('backpack_hiking', 'Туристический рюкзак', 3, 'replacements/backpack_hiking', 20),
                                    ('backpack_military', 'Военный рюкзак', 4, C+'backpack_military', 30)]:
    item(id, name, 'clothing', tier, icon, slot='backpack', extraSlots=slots, heroBackpack=ic('characters/hero/backpack'))
for id, name, target, icon, eff in [
 ('mod_scope', 'Прицел', 'firearm', C+'mod_scope', dict(rangeMul=1.3, spreadMul=0.8)),
 ('mod_silencer', 'Глушитель', 'firearm', C+'mod_silencer', dict(noiseMul=0.3)),
 ('mod_ext_mag', 'Увеличенный магазин', 'firearm', C+'mod_ext_mag', dict(magazineMul=1.5)),
 ('mod_stock', 'Приклад', 'firearm', C+'mod_stock', dict(spreadMul=0.7)),
 ('mod_flashlight', 'Фонарь на ствол', 'firearm', 'replacements/mod_flashlight', dict(lightRadiusTiles=5)),
 ('mod_armor_plate', 'Бронепластина', 'clothing', C+'mod_armor_plate', dict(armorAdd=6)),
 ('mod_insulation', 'Утеплитель', 'clothing', C+'mod_insulation', dict(coldResAdd=4)),
]:
    item(id, name, 'mod', 3, icon, modTarget=target, effect=eff)
item('mod_nails', 'Гвозди на оружие', 'mod', 2, R+'nails_bolts', modTarget='melee', effect=dict(addSpecial='bleed'))
item('mod_battery', 'Батарея-шокер', 'mod', 3, R+'battery', modTarget='melee', effect=dict(addSpecial='stun'))
item('blueprint', 'Чертёж', 'blueprint', 1, 'icons/tools/repair_kit', stack=1,
     note='Иконки чертежа нет: использовать ui/panel_9slice с иконкой рецепта поверх (кодом)')

# --- placeable stations as items
I = 'world/interior/'
stations = []
def station(id, name, tier, sprite, crafts, power=None, states=None, size=(1, 1), extra=None):
    d = dict(id=id, name_ru=name, tier=tier, sprite=ic(sprite), crafts=crafts, footprintTiles=list(size),
             needsPower=power or False)
    if states: d['stateSprites'] = {k: ic(v) for k, v in states.items()}
    if extra: d.update(extra)
    stations.append(d)
station('hands', 'Руки (меню крафта)', 0, 'ui/btn_build', 'базовые: инструменты тир 1, костёр, верстак I, тотем')
station('campfire', 'Костёр', 1, I+'campfire_unlit', 'жарка еды, кипячение воды, свет и тепло', states=dict(off=I+'campfire_unlit', on=I+'campfire_coals'),
        extra=dict(fx='effects/flame_1..6 поверх, свет радиус 5 тайлов, тепло радиус 3'))
station('cooking_station', 'Кухня', 2, I+'cooking_station', 'сложная еда (паёк, рыба, мёд)')
station('workbench_1', 'Верстак I', 1, I+'workbench_1', 'инструменты тир 1–2, оружие тир 1–2, мебель, постройки', size=(2, 1))
station('workbench_2', 'Верстак II', 2, I+'workbench_2', 'инструменты тир 3, оружие тир 3, ремкомплекты, брёвна+металл', size=(2, 1))
station('workbench_3', 'Верстак III', 4, I+'workbench_3', 'инструменты тир 4–5, второй этаж, броня', size=(2, 1))
station('forge', 'Горн', 2, I+'forge', 'металлолом → сталь (с углём), ремонт металла', extra=dict(fx='coals glow'))
station('smelter', 'Плавильня', 3, I+'smelter', 'руда → слитки (медь, титан, уран)')
station('sewing_table', 'Швейный стол', 2, I+'sewing_table', 'одежда, рюкзаки, бинты, модификации одежды', size=(2, 1))
station('chem_table', 'Химстол', 3, I+'chem_table', 'лекарства, антирадин, порох→патроны, взрывчатка', size=(2, 1))
station('gun_bench', 'Оружейный стол', 4, I+'gun_bench', 'огнестрел, патроны, модификации оружия', size=(2, 1), extra=dict(requiresSkill='engineer_2'))
station('generator', 'Генератор', 3, I+'generator', 'питание для электростола, электрозабора, турелей, света', extra=dict(fuel='crude_oil', powerRadiusTiles=12))
station('electric_bench', 'Электростол', 4, I+'electric_bench', 'электроника, энергооружие, турели', power=True, size=(2, 1))
station('repair_pit', 'Гараж (ремонтная яма)', 3, I+'repair_pit', 'сборка, ремонт и улучшение транспорта', size=(2, 2))
station('garden', 'Грядка', 1, I+'garden_empty', 'еда автоматически: 3 стадии за 1 игровой день',
        states=dict(empty=I+'garden_empty', sprouts=I+'garden_sprouts', ripe=I+'garden_ripe'), size=(2, 1))
station('rain_barrel', 'Бочка для воды', 1, I+'rain_barrel', 'копит грязную воду: 1 ед. в игровой час')
station('water_purifier', 'Очиститель воды', 3, I+'water_purifier', 'грязная вода → чистая', size=(2, 1))
station('chest_wood', 'Сундук', 1, I+'chest_wood', 'хранение 24 слота')
station('chest_metal', 'Железный сундук', 3, I+'chest_metal', 'хранение 36 слотов, не ломается врагами')
station('bed_pallets', 'Кровать', 1, I+'bed_pallets', 'точка возрождения, сон пропускает ночь', size=(2, 1))
station('sleeping_bag', 'Спальник', 1, I+'sleeping_bag', 'точка возрождения на аванпосте', size=(2, 1))
station('base_core', 'Тотем базы', 1, I+'base_core', 'задаёт базу 24×24, без дневных спавнов, автосбор, телепорт',
        extra=dict(radiusTiles=[12, 16, 20], fx='красная лампа мигает'))
station('outpost_beacon', 'Аванпост', 2, I+'outpost_beacon', 'возрождение и телепорт, вызов транспорта')

# ============================================================ BUILDING
building = dict(
    gridTile=64,
    pieces=['face', 'top_cap', 'window', 'window_boarded', 'door_opening', 'door', 'floor', 'fence', 'damage_overlay', 'rubble'],
    assembly_rules=[
        'Стена в клетке (x,y) рисуется как top_cap сверху (строго сверху, 64x64) + face под ним (64x48), если клетка (x,y+1) не стена.',
        'Если южнее тоже стена — рисуется только top_cap. Так углы и Т-стыки собираются автоматически.',
        'Дверь: door_opening как лицо стены + спрайт door поверх; открытая дверь = door, сжатая по X до 20% и сдвинутая к краю проёма.',
        'Ворота 2 клетки = два door рядом (правый отражён по X).',
        'Повреждение: damage_overlay поверх лица с альфой = 1 - hp/maxHp (видно с 30% урона).',
        'Разрушение: стена исчезает, спавнится rubble на 10 сек + частицы dust_1..3.',
        'Когда игрок внутри дома, стены южного ряда комнаты рисуются с альфой 0.35.',
    ],
    materials=[dict(id=m, name_ru=n, level=i + 1, hp=hp, cost=cost, requires=req,
                    sprites={p: ic(f'building/walls/{m}_{p}') for p in
                             ['face', 'top_cap', 'window', 'window_boarded', 'door_opening', 'door', 'floor', 'fence', 'damage_overlay', 'rubble']})
               for i, (m, n, hp, cost, req) in enumerate([
                   ('wood', 'Доски', 300, dict(planks=4, nails_bolts=1), 'hammer_builder'),
                   ('logs', 'Брёвна и металл', 800, dict(wood=4, scrap_metal=2), 'workbench_2'),
                   ('brick', 'Кирпич и бетон', 1600, dict(clay=4, stone=3), 'forge'),
                   ('steel', 'Листовая сталь', 3000, dict(steel_plates=2, nails_bolts=2), 'workbench_3'),
                   ('concrete', 'Армированный бетон', 5000, dict(stone=6, steel_ingot=1, titanium_ingot=1), 'workbench_3')])],
    upgradeRule='Молоток по уже стоящей детали → следующий материал, оплачивается полная стоимость нового материала',
    floorCostMul=0.5, windowCostMul=1.0, doorCost=dict(planks=3, nails_bolts=2),
)

# ============================================================ DEFENSE
DF = 'world/defense/'
defense = [dict(id=i, name_ru=n, sprite=ic(DF + s), hp=hp, effect=e, cost=c, station=st) for i, n, s, hp, e, c, st in [
 ('stakes', 'Колья', 'stakes', 200, dict(contactDamage=8), dict(sticks=6), 'hands'),
 ('spike_barricade', 'Ёж из кольев', 'spike_barricade', 400, dict(contactDamage=12, slowMul=0.6), dict(wood=6, nails_bolts=2), 'workbench_1'),
 ('floor_spikes', 'Шипы', 'floor_spikes', 300, dict(contactDamage=15), dict(scrap_metal=4), 'workbench_2'),
 ('barbed_wire', 'Колючая проволока', 'barbed_wire', 250, dict(contactDamage=5, slowMul=0.4, bleed=True), dict(scrap_metal=3, copper_wire=1), 'workbench_2'),
 ('bear_trap', 'Капкан', 'bear_trap_open', 150, dict(rootSec=4, damage=30, closedSprite=ic('replacements/bear_trap_closed')), dict(scrap_metal=4), 'workbench_2'),
 ('tripwire', 'Растяжка с банками', 'tripwire', 50, dict(alertRadiusTiles=10), dict(fiber=4, scrap_metal=1), 'hands'),
 ('barrel_explosive', 'Взрывная бочка', 'barrel_explosive', 40, dict(explosionDamage=120, radiusTiles=2.5), dict(crude_oil=2, scrap_metal=3), 'chem_table'),
 ('electric_fence', 'Электрозабор', 'electric_fence', 600, dict(contactDamage=20, stun=True, needsPower=True, postSprite=ic(DF + 'electric_post')), dict(copper_wire=4, steel_ingot=1), 'electric_bench'),
 ('sandbags', 'Мешки с песком', 'sandbags', 900, dict(blocksBullets=True), dict(sand=6, rags=3), 'workbench_1'),
 ('barricade_doors', 'Баррикада', 'barricade_doors', 1200, {}, dict(scrap_metal=8), 'workbench_2'),
 ('watchtower', 'Вышка', 'watchtower', 800, dict(visionBonusTiles=6), dict(wood=12, planks=6), 'workbench_2'),
 ('searchlight', 'Прожектор', 'searchlight', 200, dict(lightConeTiles=10, needsPower=True), dict(scrap_metal=3, circuit_board=1, copper_wire=2), 'electric_bench'),
 ('alarm_bell', 'Тревожный колокол', 'alarm_bell', 150, dict(alertRadiusTiles=20), dict(scrap_metal=4), 'workbench_2'),
 ('landmine', 'Мина', 'landmine', 1, dict(explosionDamage=150, radiusTiles=1.5), dict(steel_ingot=1, sulfur=2, coal=1), 'chem_table'),
 ('fire_trap', 'Огненная ловушка', 'fire_trap', 300, dict(fireConeTiles=3, fuel='crude_oil'), dict(steel_plates=2, crude_oil=2), 'gun_bench'),
 ('turret_mg', 'Турель (пулемёт)', 'turret_base', 700, dict(head=ic('replacements/turret_head_mg'), damage=12, rate=5, rangeTiles=9, ammo='ammo_rifle'), dict(steel_plates=4, circuit_board=2, steel_ingot=2), 'gun_bench'),
 ('turret_energy', 'Турель (энергия)', 'turret_base', 900, dict(head=ic(DF + 'turret_head_energy'), damage=30, rate=1.5, rangeTiles=11, needsPower=True), dict(titanium_ingot=2, circuit_board=4, battery=2), 'electric_bench'),
 ('dart_trap', 'Ловушка-самострел', 'dart_trap', 300, dict(damage=20, rate=1, rangeTiles=6), dict(planks=4, sticks=10), 'workbench_2'),
 ('blade_trap', 'Пила-ловушка', 'blade_trap', 500, dict(contactDamage=25, needsPower=True, spinPart='circle r=0.32 от центра'), dict(steel_plates=2, battery=1), 'electric_bench'),
 ('pit_trap', 'Яма с кольями', 'pit_trap', 200, dict(damage=40, rootSec=3), dict(sticks=8, planks=4), 'workbench_1'),
 ('gate_spiked', 'Ворота с шипами', 'gate_spiked', 1500, dict(contactDamage=6), dict(wood=10, scrap_metal=6), 'workbench_2'),
]]
for d in defense:
    d['destroyedSprite'] = ic(DF + 'turret_destroyed') if d['id'].startswith('turret') else None

# ============================================================ RECIPES
recipes = []
def rec(out, station, inputs, time=3, count=1, unlock='known', skill=None):
    recipes.append(dict(id=f'r_{out}', output=out, count=count, station=station, inputs=inputs, timeSec=time,
                        unlock=unlock, requiresSkill=skill))
# hands
rec('axe_stone', 'hands', dict(sticks=3, stone=3, fiber=2))
rec('pickaxe_stone', 'hands', dict(sticks=3, stone=4, fiber=2))
rec('club', 'hands', dict(wood=3, fiber=1))
rec('spear_stone', 'hands', dict(sticks=4, stone=2, fiber=2))
rec('slingshot', 'hands', dict(sticks=2, rubber=1))
rec('bandage', 'hands', dict(rags=2), count=2)
rec('planks', 'hands', dict(wood=1), count=2)
rec('campfire', 'hands', dict(stone=6, sticks=4))
rec('workbench_1', 'hands', dict(wood=8, stone=4))
rec('base_core', 'hands', dict(wood=10, scrap_metal=4, rags=2), unlock='tutorial')
rec('stakes', 'hands', dict(sticks=6))
rec('tripwire', 'hands', dict(fiber=4, scrap_metal=1))
rec('chest_wood', 'hands', dict(planks=6))
rec('hammer_builder', 'hands', dict(sticks=2, stone=2, fiber=2))
rec('sleeping_bag', 'hands', dict(rags=6, fiber=4))
# campfire / cooking
for a, b in [('meat_raw', 'meat_grilled'), ('fish_raw', 'fish_grilled')]:
    rec(b, 'campfire', {a: 1}, time=10)
rec('water_clean', 'campfire', dict(water_dirty=1), time=15)
rec('coffee', 'cooking_station', dict(water_clean=1, berries=2), time=10)
rec('ration', 'cooking_station', dict(meat_grilled=1, potato=1, carrot=1), time=20)
# workbench 1
for o, i in [('axe_scrap', dict(scrap_metal=3, wood=2)), ('pickaxe_scrap', dict(scrap_metal=4, wood=2)),
             ('shovel_wooden', dict(wood=3, planks=2)), ('wrench', dict(scrap_metal=4)),
             ('knife_hunting', dict(scrap_metal=2, wood=1, rags=1)), ('bow', dict(wood=3, fiber=4)),
             ('bat_nails', dict(wood=3, nails_bolts=2)), ('machete', dict(scrap_metal=4, rags=1)),
             ('crossbow', dict(planks=4, scrap_metal=2, fiber=4)), ('lantern', dict(scrap_metal=2, crude_oil=1)),
             ('fishing_rod', dict(sticks=3, fiber=3)), ('canteen', dict(scrap_metal=2, rags=1)),
             ('bucket', dict(scrap_metal=3)), ('rain_barrel', dict(planks=6, scrap_metal=2)),
             ('garden', dict(planks=6, wood=2)), ('bed_pallets', dict(planks=8, rags=4)),
             ('workbench_2', dict(planks=10, scrap_metal=8, nails_bolts=4)), ('forge', dict(stone=12, scrap_metal=6)),
             ('sewing_table', dict(planks=8, scrap_metal=4)), ('cooking_station', dict(stone=8, scrap_metal=4)),
             ('sandbags', dict(sand=6, rags=3)), ('spike_barricade', dict(wood=6, nails_bolts=2)),
             ('pit_trap', dict(sticks=8, planks=4)), ('outpost_beacon', dict(wood=6, rags=4, scrap_metal=2)),
             ('backpack_small', dict(rags=6, hide=2))]:
    rec(o, 'workbench_1', i)
# workbench 2
for o, i in [('axe_copper', dict(copper_ingot=3, wood=2)), ('pickaxe_copper', dict(copper_ingot=4, wood=2)),
             ('fire_axe', dict(steel_ingot=2, wood=2)), ('pistol_pipe', dict(scrap_metal=6, nails_bolts=2, duct_tape=1)),
             ('repair_kit', dict(scrap_metal=2, duct_tape=1, nails_bolts=1)), ('floor_spikes', dict(scrap_metal=4)),
             ('barbed_wire', dict(scrap_metal=3, copper_wire=1)), ('bear_trap', dict(scrap_metal=4)),
             ('barricade_doors', dict(scrap_metal=8)), ('watchtower', dict(wood=12, planks=6)),
             ('alarm_bell', dict(scrap_metal=4)), ('dart_trap', dict(planks=4, sticks=10)),
             ('gate_spiked', dict(wood=10, scrap_metal=6)), ('smelter', dict(clay=10, stone=10, scrap_metal=4)),
             ('chem_table', dict(planks=8, scrap_metal=4, plastic=4)), ('repair_pit', dict(stone=20, scrap_metal=10)),
             ('generator', dict(scrap_metal=10, copper_wire=4, battery=1)), ('chest_metal', dict(steel_plates=4, nails_bolts=2)),
             ('lockpicks', dict(scrap_metal=1)), ('binoculars', dict(scrap_metal=2, plastic=2)),
             ('copper_wire', dict(copper_ingot=1)), ('mod_nails', dict(nails_bolts=3))]:
    rec(o, 'workbench_2', i)
# forge / smelter
rec('steel_ingot', 'forge', dict(scrap_metal=3, coal=1), time=20)
rec('coal', 'forge', dict(wood=3), time=15)
rec('steel_plates', 'workbench_2', dict(steel_ingot=2))
rec('copper_ingot', 'smelter', dict(copper_ore=2, coal=1), time=20)
rec('titanium_ingot', 'smelter', dict(titanium_ore=3, coal=2), time=40)
# workbench 3
for o, i in [('axe_steel', dict(steel_ingot=3, wood=2)), ('pickaxe_steel', dict(steel_ingot=4, wood=2)),
             ('shovel_steel', dict(steel_ingot=3, wood=1)), ('hammer_claw', dict(steel_ingot=2, rubber=1)),
             ('sledgehammer', dict(steel_ingot=6, wood=2)), ('sword_steel', dict(steel_ingot=5, hide=1)),
             ('axe_titanium', dict(titanium_ingot=3, rubber=1)), ('pickaxe_titanium', dict(titanium_ingot=4, rubber=1)),
             ('knife_skinning', dict(titanium_ingot=2, rubber=1)), ('katana_titanium', dict(titanium_ingot=6, hide=2)),
             ('workbench_3', dict(steel_plates=6, steel_ingot=4, circuit_board=1))]:
    rec(o, 'workbench_2' if o == 'workbench_3' else 'workbench_3', i)
# sewing
for o, i in [('shirt_ragged', dict(rags=4)), ('jacket_leather', dict(hide=6, rags=2)), ('jacket_winter', dict(fur=6, rags=4)),
             ('robe_desert', dict(rags=8)), ('pants_cargo', dict(rags=5)), ('pants_winter', dict(fur=4, rags=3)),
             ('sneakers', dict(rubber=2, rags=2)), ('boots_combat', dict(hide=4, rubber=2)), ('boots_snow', dict(fur=4, hide=2)),
             ('hat_fur', dict(fur=3)), ('hat_sun', dict(rags=3)), ('backpack_hiking', dict(rags=8, hide=4, scrap_metal=2)),
             ('backpack_military', dict(rags=10, hide=6, steel_ingot=1)), ('mod_insulation', dict(fur=2, rags=2)),
             ('bandage', dict(rags=1)), ('splint', dict(sticks=2, rags=1))]:
    rec(o, 'sewing_table', i)
# chem
for o, i in [('antirad', dict(mushrooms=2, water_clean=1)), ('antidote', dict(berries=3, bones=1)),
             ('antibiotics', dict(mushrooms=3, water_clean=1)), ('painkillers', dict(herbal_poultice=1, water_clean=1)),
             ('disinfectant', dict(crude_oil=1, water_clean=1)), ('herbal_poultice', dict(fiber=3, berries=1)),
             ('molotov', dict(crude_oil=1, rags=1)), ('grenade', dict(steel_ingot=1, sulfur=2, coal=1)),
             ('barrel_explosive', dict(crude_oil=2, scrap_metal=3)), ('landmine', dict(steel_ingot=1, sulfur=2, coal=1)),
             ('stimulant', dict(honey=1, coffee=1, antibiotics=1)), ('respirator', dict(plastic=2, rags=2, coal=1)),
             ('gas_mask', dict(rubber=3, plastic=2, coal=2)), ('hazmat_suit', dict(rubber=6, plastic=6, rags=4)),
             ('water_purifier', dict(scrap_metal=6, coal=4, plastic=2)),
             ('medkit', dict(bandage=2, disinfectant=1, antibiotics=1)), ('first_aid_bag', dict(medkit=1, antidote=1, rags=4))]:
    rec(o, 'chem_table', i)
# gun bench (skill engineer 2)
for o, i in [('pistol', dict(steel_ingot=3, nails_bolts=2)), ('shotgun_sawedoff', dict(steel_ingot=4, wood=2)),
             ('shotgun_pump', dict(steel_ingot=6, wood=2, nails_bolts=2)), ('rifle_hunting', dict(steel_ingot=6, wood=3)),
             ('assault_rifle', dict(steel_ingot=8, steel_plates=2, plastic=2)), ('sniper_rifle', dict(titanium_ingot=4, steel_ingot=4, plastic=2)),
             ('flamethrower', dict(steel_plates=4, rubber=2, crude_oil=2)),
             ('ammo_pistol', dict(scrap_metal=1, sulfur=1, coal=1)), ('ammo_shotgun', dict(scrap_metal=1, sulfur=1, coal=1, plastic=1)),
             ('ammo_rifle', dict(steel_ingot=1, sulfur=1, coal=1)), ('mod_scope', dict(steel_ingot=1, plastic=1)),
             ('mod_silencer', dict(steel_ingot=2, rubber=1)), ('mod_ext_mag', dict(steel_ingot=2)),
             ('mod_stock', dict(wood=2, steel_ingot=1)), ('mod_flashlight', dict(battery=1, plastic=1, copper_wire=1)),
             ('mod_armor_plate', dict(steel_plates=2)), ('vest_armor', dict(steel_plates=4, rags=4)),
             ('helmet', dict(steel_plates=2, rags=1)), ('turret_mg', dict(steel_plates=4, circuit_board=2, steel_ingot=2)),
             ('fire_trap', dict(steel_plates=2, crude_oil=2))]:
    rec(o, 'gun_bench', i, count=20 if o.startswith('ammo') else 1, skill='engineer_2')
# electric bench
for o, i in [('flashlight', dict(battery=1, plastic=2, copper_wire=1)), ('knuckles_shock', dict(steel_ingot=1, battery=1, copper_wire=2)),
             ('baton_electric', dict(titanium_ingot=2, battery=2, copper_wire=3)), ('electric_fence', dict(copper_wire=4, steel_ingot=1)),
             ('searchlight', dict(scrap_metal=3, circuit_board=1, copper_wire=2)), ('turret_energy', dict(titanium_ingot=2, circuit_board=4, battery=2)),
             ('blade_trap', dict(steel_plates=2, battery=1)), ('mod_battery', dict(battery=1, copper_wire=2)),
             ('electric_bench', dict(steel_plates=4, circuit_board=2, copper_wire=4)), ('hand_drill', dict(steel_ingot=1, battery=1)),
             ('plasma_cutter', dict(uranium=2, titanium_ingot=4, circuit_board=4)), ('railgun', dict(uranium=4, titanium_ingot=6, circuit_board=6)),
             ('energy_rifle', dict(uranium=3, titanium_ingot=5, circuit_board=5))]:
    rec(o, 'workbench_3' if o == 'electric_bench' else 'electric_bench', i)
for r in recipes:
    if r['output'] in ('plasma_cutter', 'railgun', 'energy_rifle', 'turret_energy', 'sniper_rifle', 'katana_titanium'):
        r['unlock'] = 'blueprint_or_boss'

# ============================================================ ENEMIES
EN = 'characters/enemies/'
def parts(prefix, names):
    return {n: ic(prefix + n) for n in names}
HUMANOID = ['idle', 'head', 'torso', 'pelvis', 'upper_arm', 'forearm', 'thigh', 'shin']
enemies = []
def enemy(id, name, family, biomes, hp, dmg, speed, behavior, drops, specials, xp, size, rig='humanoid', extra=None):
    folder = 'characters/animals/' if rig == 'quadruped' else EN
    if rig == 'humanoid':
        names = HUMANOID
    elif rig == 'crawler':
        names = ['idle', 'head', 'torso', 'pelvis', 'upper_arm', 'forearm', 'rags', 'forearm_2']
    else:
        names = ['idle', 'head', 'body', 'front_upper', 'front_lower', 'back_upper', 'back_lower', 'tail']
        if id == 'hare': names = names[:-1] + ['ears']
        if id == 'toad': names = names[:-1] + ['tongue_and_sac']
        if id == 'raptor': names = ['idle', 'head', 'body', 'arm_upper', 'arm_lower', 'leg_upper', 'leg_lower', 'tail']
        if id == 'scorpion': names = ['idle', 'head', 'body', 'pincer_arm', 'pincer_claw', 'leg_upper', 'leg_lower', 'tail_stinger']
    d = dict(id=id, name_ru=name, family=family, biomes=biomes, hp=hp, damage=dmg, speedTilesPerSec=speed,
             behavior=behavior, drops=drops, specialParts={k: ic(folder + f'{id}_{k}') for k in specials},
             xp=xp, targetHeightPx=size, rig=rig, parts=parts(folder + id + '_', names),
             elite=dict(hpMul=1.5, dmgMul=1.3, scale=1.15, eyeColor='#FF3B2F', dropMul=2, chance=0.08))
    if extra: d.update(extra)
    enemies.append(d)
enemy('walker', 'Бродяга', 'infected', [1, 2, 3, 4, 5, 6], 40, 6, 0.9, 'wander_groups_2_4; chase_on_sight 7 tiles; night speed x1.6',
      dict(rags=(1, 2), nails_bolts=(0, 1)), ['shirt_flap'], 8, 96)
enemy('crawler', 'Ползун', 'infected', [1, 2, 3], 25, 8, 0.7, 'ambush_in_grass: invisible until 3 tiles; grab: roots player 1.5s',
      dict(rags=(1, 1)), ['ambush_pose'], 8, 40, rig='crawler')
enemy('spitter', 'Болотник', 'infected', [2], 45, 7, 0.8, 'keep_distance 5 tiles; spit poison every 3s (projectile: effects/slime_1 tinted, poison 4/s for 5s)',
      dict(rags=(1, 2), herbal_poultice=(0, 1)), ['throat_sac'], 14, 96)
enemy('sprinter', 'Бегун', 'infected', [3, 4, 5, 6], 35, 9, 2.4, 'sprints at night; lunges; low hp',
      dict(rags=(1, 2), circuit_board=(0, 1)), ['run_pose'], 16, 104)
enemy('bloated', 'Толстяк', 'infected', [3, 4, 5, 6], 90, 4, 0.6, 'walks to player; explodes on death (radius 2 tiles, 40 dmg, acid) — kill from range',
      dict(crude_oil=(0, 1), rags=(1, 3)), ['blisters'], 20, 104)
enemy('soldier', 'Солдат', 'infected', [5, 6], 140, 14, 1.0, 'armored (50% melee resist from front); throws grenade every 10s; helmet falls off at 50% hp',
      dict(ammo_rifle=(3, 8), steel_plates=(0, 1)), ['helmet'], 40, 100)
enemy('glowing', 'Светящийся', 'infected', [6], 160, 12, 1.0, 'radiation aura 2 tiles (+rad 3/s); explodes in radiation burst on death',
      dict(uranium=(0, 1), rags=(1, 2)), ['coat_flap'], 50, 100)
enemy('dog', 'Бешеный пёс', 'mutant', [1, 2, 3], 30, 7, 2.2, 'packs of 3; circle and bite; flee at 20% hp', dict(meat_raw=(1, 1), hide=(0, 1)), [], 10, 56, rig='quadruped')
enemy('toad', 'Гигантская жаба', 'mutant', [2], 70, 10, 0.8, 'tongue pull 4 tiles every 5s; leaps', dict(meat_raw=(1, 2), hide=(1, 1)), [], 18, 64, rig='quadruped')
enemy('raptor', 'Раптор', 'reptile', [3, 4, 5], 80, 13, 2.6, 'hunts in pairs, flanks from sides, pounce', dict(meat_raw=(1, 2), hide=(1, 2), bones=(1, 2)), [], 30, 96, rig='quadruped')
enemy('scorpion', 'Скорпион', 'mutant', [4], 110, 14, 1.4, 'buries in sand (ambush); poison sting', dict(sulfur=(0, 1), bones=(1, 2)), [], 34, 56, rig='quadruped')
enemy('armored_lizard', 'Броненосец-ящер', 'reptile', [4, 5], 220, 18, 0.9, 'front armor 80%: hit from behind; charge', dict(steel_plates=(0, 1), hide=(2, 3)), [], 45, 64, rig='quadruped')
enemy('snow_wolf', 'Снежный волк', 'mutant', [5], 90, 14, 2.4, 'packs of 4; invisible at night without light', dict(fur=(1, 2), meat_raw=(1, 1)), [], 28, 72, rig='quadruped')
for id, name, b, hp, beh, drops, sz in [('deer', 'Олень', [1, 5], 30, 'passive; flees from player at 6 tiles', dict(meat_raw=(2, 3), hide=(1, 2), bones=(1, 1)), 96),
                                        ('boar', 'Кабан', [1, 2], 60, 'neutral; charges back when hit', dict(meat_raw=(2, 3), hide=(1, 2)), 64),
                                        ('hare', 'Заяц', [1, 3, 5], 8, 'passive; fast zigzag flee', dict(meat_raw=(1, 1), hide=(0, 1)), 32)]:
    enemy(id, name, 'animal', b, hp, 8 if id == 'boar' else 0, 2.0, beh, drops, [], 4, sz, rig='quadruped')

# ============================================================ BOSSES
BO = 'characters/bosses/'
bosses = []
def boss(id, name, prefix, biome, hp, files, phases, attacks, trophy, unlocks, size):
    bosses.append(dict(id=id, name_ru=name, biome=biome, hp=hp, targetHeightPx=size,
                       sprites={k: ic(BO + prefix + '_' + k) for k in files}, phases=phases, attacks=attacks,
                       trophy=dict(item=f'trophy_{id}', icon=ic(BO + prefix + '_' + [f for f in files if f.startswith('trophy')][0])),
                       unlocks=unlocks, arena='круг радиусом 9 тайлов, костёр-чекпоинт у входа, вход закрывается до победы/смерти',
                       telegraph='каждая сильная атака: красная зона на земле за 0.8–1.2 c'))
boss('butcher', 'Мясник Дачного', 'butcher', 1, 600, ['idle', 'phase2', 'head', 'torso', 'arm', 'leg', 'hook_chain', 'trophy_key'],
     ['100–50%: крюк и удары', '50–0%: phase2 спрайт, зовёт 4 бродяг, скорость x1.3'],
     ['hook_pull: бросок крюка на 6 тайлов, притягивает игрока (цепь = повтор сегмента)', 'slam: удар по площади 2 тайла', 'swing: широкий удар перед собой'],
     'trophy_key', ['ворота к трассе (биом 2)', 'рецепт workbench_2', 'мопед'], 288)
boss('queen', 'Королева Трясины', 'queen', 2, 1100, ['idle', 'phase2', 'head', 'body', 'front_leg', 'back_leg', 'egg_sacs', 'trophy_jar'],
     ['100–50%: ныряет в воду, выпрыгивает', '50–0%: яйца лопаются → головастики (используют spitter-проджектайлы)'],
     ['tongue: притягивание (используй язык из animals/toad_tongue_and_sac)', 'leap_slam: прыжок, ударная волна', 'poison_pools: 3 ядовитые лужи (эффект slime + тонированный круг)'],
     'trophy_jar', ['мост через реку (биом 3)', 'рецепт gas_mask и respirator', 'квадроцикл'], 260)
boss('tyrant', 'Тиран', 'tyrant', 3, 2000, ['idle', 'phase2', 'head', 'leg', 'arm', 'tail', 'trophy_fang'],
     ['100–60%: таран и укусы', '60–25%: phase2 спрайт, рёв зовёт 2 рапторов', '25–0%: разрушает постройки на пути, скорость x1.4'],
     ['charge: таран по прямой 10 тайлов, ломает стены', 'bite: укус перед собой', 'tail_sweep: удар хвостом сзади', 'roar: оглушение 1 c в радиусе 4'],
     'trophy_fang', ['пропуск в промзону (биом 4)', 'мотоцикл с коляской', 'рецепт gun_bench'], 380)
boss('devourer', 'Пожиратель Карьера', 'devourer', 4, 3200, ['idle', 'phase2', 'head_mouth', 'segment', 'teeth_ring', 'mouth_alt', 'tail_segment', 'armor_plate', 'trophy_heart'],
     ['100–50%: выныривает по кругу, уязвим 2 c после выхода', '50–0%: plates отпадают (armor_plate как частица), выныривает чаще'],
     ['emerge: выход из-под земли под игроком (тень-предупреждение)', 'rock_spit: плевок камнем', 'sweep: удар телом по дуге'],
     'trophy_heart', ['ключ-карта лаборатории (биом 5)', 'багги', 'рецепт grenade'], 360)
boss('frost', 'Объект «Мороз»', 'frost', 5, 4500, ['idle', 'phase2', 'head', 'body', 'front_leg', 'back_leg', 'tail', 'trophy_core', 'ice_shard'],
     ['100–50%: щит на ядре, снимается только электрическим оружием/модом', '50–0%: ядро открыто, урон x2, атаки чаще'],
     ['ice_breath: конус холода 5 тайлов (замедление, холод)', 'ice_shards: веер из 5 ice_shard', 'stomp: ударная волна'],
     'trophy_core', ['доступ в эпицентр (биом 6)', 'снегоход', 'рецепт electric_bench'], 330)
boss('zero', 'Пациент Ноль', 'zero', 6, 7000, ['idle', 'phase2', 'head', 'torso', 'arm', 'tentacle', 'lower_body', 'trophy_medallion'],
     ['100–66%: щупальца из труб', '66–33%: арена заливается радиацией по секторам', '33–0%: phase2 спрайт, всё быстрее, призывает светящихся'],
     ['tentacle_lash: щупальце (повтор сегмента tentacle)', 'rad_orb: сфера (effects/rad_aura)', 'rad_zone: сектор арены облучается'],
     'trophy_medallion', ['концовка', 'бесконечный режим'], 340)
for b in bosses:
    items.append(dict(id=b['trophy']['item'], name_ru='Трофей: ' + b['name_ru'], category='trophy', tier=b['biome'],
                      icon=b['trophy']['icon'], stack=1))

# ============================================================ BIOMES
def objs(folder, spec):
    out = []
    for o in spec:
        sid, kind = o[0], o[1]
        d = dict(id=sid, sprite=ic(f'{folder}/{sid}'), kind=kind)
        if len(o) > 2 and o[2]: d['harvest'] = o[2]
        if len(o) > 3 and o[3]: d['afterHarvest'] = ic(f'{folder}/{o[3]}')
        if len(o) > 4: d['note'] = o[4]
        out.append(d)
    return out
def hv(tool, tier, drops, hits):
    return dict(tool=tool, minTier=tier, drops=drops, hits=hits)
biomes = [
 dict(id=1, name_ru='Заросший пригород', ring='внешнее кольцо', levels=[1, 6], tiles=['grass', 'grass_flowers', 'dirt', 'dirt_road_h'],
      enemies=['walker', 'crawler', 'dog', 'deer', 'boar', 'hare'], boss='butcher', gate='шлагбаум у трассы → открывает trophy_key',
      objects=objs('world/biome1_suburb', [
        ('pine', 'tree', hv('axe', 1, dict(wood=(4, 6), sticks=(1, 2)), 5), 'pine_stump'),
        ('birch', 'tree', hv('axe', 1, dict(wood=(3, 5), sticks=(1, 2)), 4), 'birch_stump'),
        ('oak', 'tree', hv('axe', 1, dict(wood=(6, 9)), 7), 'pine_stump'),
        ('dead_tree', 'tree', hv('axe', 1, dict(wood=(2, 3), sticks=(2, 3)), 3)),
        ('bush_berries', 'bush', hv('hands', 0, dict(berries=(2, 4), sticks=(0, 1)), 1), 'bush_picked', 'отрастает за 2 игровых дня'),
        ('tall_grass', 'grass', hv('hands', 0, dict(fiber=(1, 3)), 1), None, 'укрытие для ползунов'),
        ('log_fallen', 'tree', hv('axe', 1, dict(wood=(3, 5)), 3)),
        ('boulder', 'rock', hv('pickaxe', 1, dict(stone=(4, 7)), 6), 'boulder_mined'),
        ('rock_remains', 'rock', hv('hands', 0, dict(stone=(1, 2)), 1)),
        ('scrap_pile', 'scrap', hv('wrench', 2, dict(scrap_metal=(2, 4), nails_bolts=(0, 2)), 4)),
        ('car_hatchback', 'vehicle_wreck', hv('wrench', 2, dict(scrap_metal=(5, 8), rubber=(1, 2), battery=(0, 1)), 8), 'car_frame'),
        ('tractor', 'vehicle_wreck', hv('wrench', 2, dict(scrap_metal=(8, 12), rubber=(2, 3)), 10)),
        ('fence_picket', 'fence', hv('axe', 1, dict(planks=(1, 2)), 2)),
        ('scarecrow', 'decor', hv('hands', 0, dict(rags=(1, 2), sticks=(1, 2)), 2)),
        ('greenhouse', 'loot', None, None, 'контейнер: семена/овощи (garden)'),
        ('power_pole', 'decor', hv('wrench', 2, dict(copper_wire=(1, 2), wood=(1, 2)), 4)),
        ('road_sign', 'decor', hv('wrench', 2, dict(scrap_metal=(1, 1)), 2)),
      ]) + [dict(id=i, sprite=ic(p), kind=k) for i, p, k in [
        ('bus_stop', 'replacements/bus_stop', 'building_poi'), ('well', 'replacements/well', 'water_source'),
        ('outhouse', 'replacements/outhouse', 'loot')]]),
 dict(id=2, name_ru='Болото у трассы', ring='2-е кольцо', levels=[6, 11], tiles=['swamp_mud', 'water_shallow', 'grass', 'asphalt_cracked', 'asphalt_line_h'],
      enemies=['walker', 'crawler', 'spitter', 'toad', 'dog', 'boar'], boss='queen', gate='река: мост открывается trophy_jar',
      hazards=['вязкая вода: скорость x0.6 без квадроцикла', 'ядовитые бочки: отравление в радиусе 1.5 тайла'],
      objects=objs('world/biome2_swamp', [
        ('willow', 'tree', hv('axe', 1, dict(wood=(4, 6)), 5), None),
        ('swamp_tree_dead', 'tree', hv('axe', 1, dict(wood=(2, 4)), 3)),
        ('cattails', 'grass', hv('hands', 0, dict(fiber=(2, 3)), 1)),
        ('lily_pads', 'decor', None),
        ('peat_mound', 'deposit', hv('shovel', 1, dict(peat=(3, 5)), 3)),
        ('clay_deposit', 'deposit', hv('shovel', 1, dict(clay=(3, 5)), 3)),
        ('copper_rock', 'rock', hv('pickaxe', 2, dict(copper_ore=(3, 5), stone=(1, 2)), 6), 'copper_rock_mined'),
        ('boulder_mossy', 'rock', hv('pickaxe', 1, dict(stone=(4, 6)), 5)),
        ('mushrooms_glow', 'bush', hv('hands', 0, dict(mushrooms=(1, 3)), 1), None, 'светятся ночью (кодом)'),
        ('fuel_pump', 'scrap', hv('wrench', 2, dict(scrap_metal=(3, 5), crude_oil=(0, 1)), 5)),
        ('trailer', 'loot', None, None, 'большой контейнер лута'),
        ('truck_cab', 'vehicle_wreck', hv('wrench', 2, dict(scrap_metal=(6, 9), battery=(0, 1), rubber=(1, 2)), 8)),
        ('tires_pile', 'scrap', hv('hands', 0, dict(rubber=(2, 3)), 2)),
        ('toxic_barrels', 'hazard', hv('wrench', 2, dict(scrap_metal=(2, 3), crude_oil=(0, 1)), 3)),
        ('rowboat', 'decor', hv('axe', 1, dict(planks=(2, 4)), 3)),
        ('drain_pipe', 'decor', None),
        ('animal_skeleton', 'decor', hv('hands', 0, dict(bones=(2, 3)), 1)),
        ('motel_sign', 'decor', hv('wrench', 2, dict(scrap_metal=(2, 3), copper_wire=(0, 1)), 3)),
        ('fallen_tree_water', 'tree', hv('axe', 1, dict(wood=(3, 4)), 3)),
      ]) + [dict(id=i, sprite=ic(p), kind=k) for i, p, k in [
        ('gas_kiosk', 'replacements/gas_kiosk', 'building_poi'), ('fishing_hut', 'replacements/fishing_hut', 'building_poi'),
        ('guardrail', 'replacements/guardrail', 'road_edge_tileable'), ('concrete_barrier', 'replacements/concrete_barrier', 'road_edge_tileable'),
        ('boardwalk', 'replacements/boardwalk', 'walkable_bridge_tileable')]]),
 dict(id=3, name_ru='Мёртвый город', ring='3-е кольцо', levels=[11, 19], tiles=['asphalt_cracked', 'asphalt_line_h', 'concrete', 'ceramic_floor', 'gravel'],
      enemies=['walker', 'sprinter', 'bloated', 'raptor', 'dog', 'hare'], boss='tyrant', gate='КПП промзоны → trophy_fang',
      objects=objs('world/biome3_city', [
        ('tree_planter', 'tree', hv('axe', 1, dict(wood=(2, 3)), 3)), ('hedge', 'bush', hv('axe', 1, dict(sticks=(2, 4), fiber=(1, 2)), 2)),
        ('street_lamp', 'decor', hv('wrench', 2, dict(scrap_metal=(2, 3), copper_wire=(1, 1)), 3)),
        ('traffic_light_fallen', 'scrap', hv('wrench', 2, dict(scrap_metal=(2, 3), circuit_board=(0, 1)), 3)),
        ('car_burnt', 'vehicle_wreck', hv('wrench', 2, dict(scrap_metal=(5, 8)), 7)),
        ('patrol_car', 'vehicle_wreck', hv('wrench', 2, dict(scrap_metal=(5, 7), battery=(0, 1), ammo_pistol=(0, 6)), 8)),
        ('bus', 'vehicle_wreck', hv('wrench', 2, dict(scrap_metal=(10, 14), rubber=(2, 4), plastic=(2, 4)), 12)),
        ('ambulance', 'vehicle_wreck', hv('wrench', 2, dict(scrap_metal=(6, 8), bandage=(1, 3), antibiotics=(0, 1)), 8)),
        ('rubble', 'rock', hv('pickaxe', 1, dict(stone=(3, 5), scrap_metal=(0, 2)), 4)),
        ('building_collapsed', 'building_poi', None, None, 'крупный ориентир, вход лута'),
        ('apartment_entrance', 'building_poi', None, None, 'вход в многоэтажку (интерьер — комната из стен concrete)'),
        ('shop_front', 'building_poi', None, None, 'магазин: еда, вода'),
        ('kiosk', 'loot', None), ('vending_machine', 'loot', hv('wrench', 2, dict(soda=(1, 2), scrap_metal=(2, 3)), 4)),
        ('phone_booth', 'scrap', hv('wrench', 2, dict(scrap_metal=(2, 3), plastic=(1, 2)), 3)),
        ('dumpster', 'loot', None), ('bench', 'decor', hv('axe', 1, dict(planks=(2, 3)), 2)),
        ('road_barriers', 'road_edge_tileable', hv('hands', 0, dict(plastic=(1, 2)), 2)),
        ('checkpoint_tent', 'loot', None, None, 'военный лут: патроны, паёк'),
        ('shopping_cart', 'scrap', hv('wrench', 2, dict(scrap_metal=(1, 2)), 2)),
        ('billboard', 'decor', None), ('garbage_bags', 'loot', None), ('scrap_pile', 'scrap', hv('wrench', 2, dict(scrap_metal=(3, 5), copper_wire=(0, 1)), 4)),
      ]) + [dict(id=i, sprite=ic(p), kind=k) for i, p, k in [
        ('hydrant', 'replacements/hydrant', 'water_source'), ('manhole', 'replacements/manhole', 'decor')]]),
 dict(id=4, name_ru='Пустыня-карьер', ring='4-е кольцо', levels=[19, 26], tiles=['sand', 'clay_cracked', 'gravel'],
      enemies=['scorpion', 'armored_lizard', 'raptor', 'sprinter', 'bloated'], boss='devourer', gate='проход в лабораторию → trophy_heart',
      hazards=['жара днём: нужен heatRes или вода', 'песчаная буря: видимость 4 тайла (кодом, оверлей)'],
      objects=objs('world/biome4_desert', [
        ('dry_bush', 'bush', hv('hands', 0, dict(sticks=(2, 3)), 1)), ('cactus', 'bush', hv('knife', 1, dict(water_dirty=(1, 1), fiber=(1, 2)), 2)),
        ('sandstone', 'rock', hv('pickaxe', 1, dict(stone=(3, 5), sand=(1, 2)), 5)),
        ('sulfur_rock', 'rock', hv('pickaxe', 3, dict(sulfur=(3, 5)), 6), 'sulfur_rock_mined'),
        ('coal_rock', 'rock', hv('pickaxe', 2, dict(coal=(3, 5)), 6), 'coal_rock_mined'),
        ('oil_seep', 'deposit', hv('bucket', 1, dict(crude_oil=(1, 2)), 1), None, 'ресурс восстанавливается раз в день'),
        ('pumpjack', 'scrap', hv('wrench', 3, dict(steel_plates=(1, 2), scrap_metal=(6, 9)), 10)),
        ('drill_rig', 'scrap', hv('wrench', 3, dict(scrap_metal=(6, 8), steel_plates=(1, 1)), 10)),
        ('excavator', 'vehicle_wreck', hv('wrench', 3, dict(steel_plates=(2, 3), scrap_metal=(8, 12)), 14)),
        ('dump_truck', 'vehicle_wreck', hv('wrench', 3, dict(steel_plates=(2, 3), rubber=(3, 5)), 14)),
        ('conveyor', 'scrap', hv('wrench', 2, dict(rubber=(2, 3), scrap_metal=(3, 4)), 5)),
        ('mine_cart', 'loot', hv('wrench', 2, dict(coal=(2, 4), scrap_metal=(2, 3)), 4)),
        ('mine_entrance', 'building_poi', None, None, 'вход в шахту (лут: уголь, сера, взрывчатка)'),
        ('power_tower', 'scrap', hv('wrench', 3, dict(copper_wire=(2, 4), scrap_metal=(4, 6)), 8)),
        ('water_tower', 'water_source', None), ('animal_skull', 'decor', hv('hands', 0, dict(bones=(2, 3)), 1)),
        ('dune', 'deposit', hv('shovel', 1, dict(sand=(3, 5)), 3)), ('container', 'loot', None),
        ('tent', 'loot', None), ('plane_wreck', 'vehicle_wreck', hv('wrench', 3, dict(scrap_metal=(8, 12), circuit_board=(1, 2)), 12)),
        ('tumbleweed', 'decor', None, None, 'катится по ветру (кодом)'), ('explosives_crate', 'loot', None, None, 'гранаты, сера'),
        ('windmill', 'decor', None, None, 'лопасти вращаются (кодом)'),
      ])),
 dict(id=5, name_ru='Ледяная тундра', ring='5-е кольцо', levels=[26, 33], tiles=['snow', 'ice', 'gravel'],
      enemies=['snow_wolf', 'armored_lizard', 'soldier', 'raptor', 'deer', 'hare'], boss='frost', gate='вход в эпицентр → trophy_core',
      hazards=['холод: нужен coldRes или костёр', 'ночью волки невидимы без света'],
      objects=objs('world/biome5_tundra', [
        ('spruce', 'tree', hv('axe', 1, dict(wood=(4, 6)), 5), 'spruce_stump'), ('frozen_tree', 'tree', hv('axe', 1, dict(wood=(2, 3)), 3)),
        ('boulder', 'rock', hv('pickaxe', 1, dict(stone=(4, 6)), 6), 'boulder_mined'),
        ('titanium_rock', 'rock', hv('pickaxe', 4, dict(titanium_ore=(2, 4)), 8), 'titanium_rock_mined'),
        ('bush_berries', 'bush', hv('hands', 0, dict(berries=(2, 3)), 1), 'bush_picked'),
        ('ice_shards', 'rock', hv('pickaxe', 1, dict(water_dirty=(1, 2)), 3)), ('snowdrift', 'decor', None),
        ('tent_military', 'loot', None), ('truck_wreck', 'vehicle_wreck', hv('wrench', 3, dict(steel_plates=(1, 2), scrap_metal=(6, 8)), 10)),
        ('apc_wreck', 'vehicle_wreck', hv('wrench', 4, dict(steel_plates=(3, 4), ammo_rifle=(5, 15)), 14)),
        ('radar_dish', 'scrap', hv('wrench', 3, dict(circuit_board=(2, 3), scrap_metal=(4, 6)), 8)),
        ('weather_mast', 'scrap', hv('wrench', 2, dict(copper_wire=(1, 2), circuit_board=(0, 1)), 4)),
        ('bunker_entrance', 'building_poi', None), ('lab_door', 'building_poi', None, None, 'ворота биома 6'),
        ('fuel_barrels', 'loot', hv('wrench', 2, dict(crude_oil=(1, 3)), 3)),
        ('snowmobile', 'vehicle_wreck', hv('wrench', 3, dict(scrap_metal=(4, 6), battery=(0, 1)), 6)),
        ('barbed_fence', 'fence', None), ('watchtower', 'decor', None), ('cabin', 'building_poi', None),
        ('icicles', 'decor', None), ('specimen_tank', 'loot', None, None, 'записка о «Вспышке»'),
      ])),
 dict(id=6, name_ru='Эпицентр', ring='центр', levels=[33, 40], tiles=['scorched_rad', 'concrete', 'gravel'],
      enemies=['glowing', 'soldier', 'sprinter', 'bloated'], boss='zero', gate='финал',
      hazards=['радиация везде: +2 rad/s без radRes', 'радиоактивные зоны (кодом, effects/rad_aura)'],
      objects=objs('world/biome6_epicenter', [
        ('mutant_tree', 'tree', hv('axe', 3, dict(wood=(3, 5), uranium=(0, 1)), 6), 'mutant_stump'),
        ('crystals', 'rock', hv('pickaxe', 5, dict(uranium=(2, 3)), 8), 'crystals_harvested'),
        ('uranium_rock', 'rock', hv('pickaxe', 5, dict(uranium=(2, 4)), 10), 'uranium_rock_mined'),
        ('molten_rock', 'rock', hv('pickaxe', 3, dict(stone=(3, 5)), 6)), ('cooling_tower', 'building_poi', None),
        ('pipes', 'scrap', hv('wrench', 4, dict(steel_plates=(2, 3)), 8)), ('lab_module', 'building_poi', None),
        ('containment_tank', 'loot', None), ('robot_arm', 'scrap', hv('wrench', 4, dict(circuit_board=(2, 4), steel_ingot=(1, 2)), 10)),
        ('server_rack', 'scrap', hv('wrench', 3, dict(circuit_board=(3, 5)), 6)), ('science_desk', 'loot', None, None, 'записки, чертежи'),
        ('decon_shower', 'heal_station', None, None, 'снимает 50 rad раз в 5 минут'), ('rad_sign', 'decor', None),
        ('hazmat_locker', 'loot', None, None, 'hazmat_suit, antirad'), ('car_melted', 'vehicle_wreck', hv('wrench', 3, dict(scrap_metal=(4, 6)), 6)),
        ('monorail', 'decor', None), ('statue', 'decor', None), ('transformer', 'scrap', hv('wrench', 4, dict(copper_wire=(4, 6)), 8)),
        ('satellite_dish', 'scrap', hv('wrench', 3, dict(circuit_board=(1, 2), scrap_metal=(4, 6)), 6)),
        ('cables', 'scrap', hv('knife', 2, dict(copper_wire=(2, 4)), 3)), ('glow_fungus', 'bush', hv('hands', 0, dict(mushrooms=(1, 2)), 1)),
        ('vault_door', 'building_poi', None, None, 'вход на арену Пациента Ноль'),
      ])),
]
# common objects available in all biomes
common_objects = dict(
    interior=[s['id'] for s in stations],
    loot_containers=[dict(id=n, sprite=ic('world/interior/' + n), openedSprite=ic('world/interior/' + o) if o else None, slots=s, table=t)
                     for n, o, s, t in [('crate_wood_closed', 'crate_wood_open', 6, 'general'), ('crate_military_closed', 'crate_military_open', 6, 'military'),
                                        ('locker', None, 6, 'tools_clothes'), ('wardrobe', None, 8, 'clothes'), ('drawers', None, 6, 'general'),
                                        ('fridge', None, 6, 'food'), ('safe', None, 4, 'rare'), ('dead_backpack', None, 8, 'survivor'),
                                        ('medical_cabinet', None, 6, 'medicine'), ('trash_can', None, 4, 'junk'), ('cardboard_boxes', None, 6, 'junk')]],
    furniture_salvage=[dict(id=n, sprite=ic('world/interior/' + n), harvest=hv(t, 1, d, h)) for n, t, d, h in [
        ('stove', 'wrench', dict(scrap_metal=(3, 4)), 4), ('kitchen_sink', 'wrench', dict(scrap_metal=(2, 3)), 3),
        ('table', 'hammer', dict(planks=(2, 4)), 3), ('chair_broken', 'hammer', dict(planks=(1, 2)), 2),
        ('sofa', 'knife', dict(rags=(2, 4)), 3), ('bed', 'hammer', dict(planks=(2, 3), rags=(1, 2)), 3),
        ('bookshelf', 'hammer', dict(planks=(2, 3)), 3), ('tv', 'wrench', dict(circuit_board=(0, 1), plastic=(1, 2)), 3),
        ('office_desk', 'wrench', dict(circuit_board=(0, 1), planks=(1, 2)), 3), ('bathtub', 'wrench', dict(scrap_metal=(3, 5)), 4),
        ('toilet', 'pickaxe', dict(stone=(1, 2)), 2), ('tires', 'hands', dict(rubber=(2, 3)), 2)]],
)

# ============================================================ VEHICLES
V = 'vehicles/'
vehicles = [dict(id=i, name_ru=n, tier=t, unlock=u, body=ic(V + b), wheel=ic(V + w) if w else None, speedMul=s, trunkSlots=tr,
                 fuelPer100Tiles=f, hp=hp, terrain=ter, note=note)
            for i, n, t, u, b, w, s, tr, f, hp, ter, note in [
 ('bicycle', 'Велосипед', 1, 'чертёж в пригороде', 'bicycle_body', 'bicycle_wheel', 1.6, 0, 0, 150, ['road', 'grass', 'dirt'], 'без топлива, тихий'),
 ('moped', 'Ржавый мопед', 2, 'босс 1', 'moped_body', 'moped_wheel', 2.2, 4, 1, 200, ['road', 'grass', 'dirt'], 'хрупкий'),
 ('quad', 'Квадроцикл', 3, 'босс 2 / болото', 'quad_body', 'quad_wheel', 2.0, 8, 1.5, 350, ['road', 'grass', 'dirt', 'swamp_mud', 'water_shallow'], 'проходит болото'),
 ('moto_sidecar', 'Мотоцикл с коляской', 4, 'босс 3', 'moto_body', 'moto_wheel', 2.8, 12, 2, 400, ['road', 'grass', 'dirt'], 'таранит слабых врагов'),
 ('pickup', 'Пикап', 5, 'город, гараж', 'pickup_body', 'pickup_wheel', 2.5, 24, 3, 800, ['road', 'grass', 'dirt', 'sand'], 'передвижной сундук, броня, таран'),
 ('buggy', 'Багги', 6, 'босс 4', 'buggy_body', 'buggy_wheel', 3.0, 10, 2.5, 500, ['road', 'sand', 'dirt', 'clay_cracked'], 'не вязнет в песке'),
 ('snowcat', 'Вездеход', 7, 'босс 5 / тундра', 'snowcat_body', None, 2.4, 20, 3, 1000, ['snow', 'ice', 'road', 'dirt'], 'гусеница: snowcat_track, текстура прокручивается; обогрев внутри')]]
vehicles[4]['mods'] = dict(armor=ic(V + 'pickup_armor_kit'), roofRack=ic(V + 'roof_rack'))
vehicles[6]['track'] = ic(V + 'snowcat_track')

# ============================================================ SKILLS
skills = dict(maxLevel=40, pointsPerLevel=1, xpCurve='xpToNext(level) = 60 * level^1.45 (округлять до 5)',
  branches=[
   dict(id='fighter', name_ru='Боец', skills=[dict(id=f'fighter_{i}', name_ru=n, levels=3, perLevel=p) for i, (n, p) in enumerate([
       ('Сила удара', '+10% урона ближнего боя'), ('Стрелок', '+10% урона огнестрела'), ('Ловкость', '-15% выносливости на перекат'),
       ('Удар в спину', '+25% крит сзади'), ('Добивание', 'оглушённые получают x2 урона'), ('Живучесть', '+10 к максимуму здоровья')], 1)]),
   dict(id='gatherer', name_ru='Добытчик', skills=[dict(id=f'gatherer_{i}', name_ru=n, levels=3, perLevel=p) for i, (n, p) in enumerate([
       ('Жадность', '+1 ресурс с добычи (шанс 20/35/50%)'), ('Мародёр', '+15% шанс двойного лута в контейнерах'),
       ('Бережливость', '-15% износа инструментов'), ('Чутьё', '+2 тайла радиус подсветки лута'), ('Свежевание', '+1 шкура/мех'),
       ('Рыбак', '+25% скорость рыбалки')], 1)]),
   dict(id='engineer', name_ru='Инженер', skills=[dict(id=f'engineer_{i}', name_ru=n, levels=3, perLevel=p) for i, (n, p) in enumerate([
       ('Экономия', '-10% стоимость построек'), ('Оружейник', 'открывает оружейный стол (ур.2); +10% урон турелей'),
       ('Конвейер', '+20% скорость станков'), ('Мастер', 'починка без ремкомплекта (ур.3)'), ('Механик', '-15% расход топлива'),
       ('Укрепление', '+10% HP построек')], 1)]),
   dict(id='survivor', name_ru='Выживальщик', skills=[dict(id=f'survivor_{i}', name_ru=n, levels=3, perLevel=p) for i, (n, p) in enumerate([
       ('Выносливый желудок', '-10% скорость голода и жажды'), ('Закалка', '+3 к холоду и жаре'), ('Носильщик', '+4 слота инвентаря'),
       ('Лекарь', '+20% к лечению'), ('Иммунитет', '-15% радиации и яда'), ('Сон', 'сон восстанавливает +20% здоровья')], 1)])],
  note='requiresSkill в рецептах ссылается на ветку_уровень, например engineer_2 = 2 очка в ветке Инженер')

# ============================================================ BALANCE / PLATFORM CONFIG
balance = dict(
  world=dict(seed=20261027, sizeTiles=[512, 512], chunkTiles=32, tilePx=64, biomeRingsRadiusTiles=[256, 210, 165, 120, 80, 40],
             lootRespawnGameDays=3, resourceRespawnGameDays=[2, 5]),
  dayNight=dict(fullDaySec=720, daySec=480, nightSec=240, bloodNightEvery=7, nightEnemySpeedMul=1.6, nightSpawnMul=2.5),
  player=dict(hp=100, stamina=100, speedTilesPerSec=3.2, sprintMul=1.5, dodgeIFramesSec=0.3, dodgeStamina=20,
              inventorySlots=20, hotbarSlots=6, deathBackpackLifetimeSec=1200, pickupRadiusTiles=1.2, highlightRadiusTiles=4),
  survival=dict(yandex=dict(hungerPerMin=0.7, thirstPerMin=1.0, coldDmgPerSec=0.5), rustore=dict(hungerPerMin=1.0, thirstPerMin=1.5, coldDmgPerSec=1.0)),
  ads=dict(yandex=dict(interstitialMinIntervalSec=180, interstitialPoints=['death', 'night_start_at_base', 'menu_to_game', 'boss_defeated', 'sleep', 'teleport'],
                       rewarded=['revive_with_backpack', 'double_loot', 'instant_craft', 'repair_all', 'buff_10min', 'extra_daily', 'supply_drop_30min']),
           rustore=dict(interstitialMinIntervalSec=240, interstitialPoints=['death', 'boss_defeated', 'sleep'], rewarded='as yandex')),
  iap=['remove_interstitials', 'starter_pack(backpack_hiking + tier2 tools)', 'cosmetics (hero tint, vehicle paint)', 'extra_outposts'],
  iapRule='не продавать силу в обход боссов',
)

# ============================================================ WRITE
for name, obj in [('items', items), ('stations', stations), ('recipes', recipes), ('building', building), ('defense', defense),
                  ('enemies', enemies), ('bosses', bosses), ('biomes', dict(biomes=biomes, common=common_objects)),
                  ('vehicles', vehicles), ('skills', skills), ('balance', balance)]:
    json.dump(obj, open(f'{D}/{name}.json', 'w'), ensure_ascii=False, indent=1)

# validation: recipe ids exist
ids = {i['id'] for i in items} | {s['id'] for s in stations} | {d['id'] for d in defense}
bad = sorted({k for r in recipes for k in list(r['inputs']) + [r['output']] if k not in ids})
st = {s['id'] for s in stations}
bad_st = sorted({r['station'] for r in recipes if r['station'] not in st})
drops_bad = sorted({k for e in enemies for k in e['drops'] if k not in ids})
print('items', len(items), 'recipes', len(recipes), 'stations', len(stations), 'defense', len(defense),
      'enemies', len(enemies), 'bosses', len(bosses), 'vehicles', len(vehicles))
print('missing images:', missing)
print('unknown ids in recipes:', bad, 'unknown stations:', bad_st, 'bad drops:', drops_bad)
# items without recipe and not natural
natural_cats = {'resource', 'food', 'trophy'}
craftable = {r['output'] for r in recipes}
print('not craftable (ok if loot-only):', sorted(i['id'] for i in items if i['id'] not in craftable and i['category'] not in natural_cats))
