"""Нарезка всех листов «Пустоши» на отдельные спрайты.
Запуск: python3 -I cutter.py <src_dir> <out_dir>
"""
import os, sys, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

SRC, OUT = sys.argv[1], sys.argv[2]
FONT = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)

# ---------------------------------------------------------------- names
def grid(rows, cols, row_names, col_names, overrides=None):
    out = []
    for r, rn in enumerate(row_names):
        for c, cn in enumerate(col_names):
            n = (overrides or {}).get((r, c), cn)
            out.append(f'{rn}_{n}' if rn else n)
    return out

ICONS_FIRST = ['planks','scrap_metal','copper_ore','steel_ingot','canned_food','water_bottle','bandage','medkit',
               'bow','makeshift_pistol_alt','gas_mask','small_backpack']
ICONS_FIRST = ['stone_axe_alt','stone_pickaxe_alt','rusty_wrench_alt','hunting_knife_alt'] + ICONS_FIRST

TOOLS = ['axe_scrap','axe_copper','axe_steel','axe_titanium','pickaxe_scrap','pickaxe_copper','pickaxe_steel','pickaxe_titanium',
 'shovel_wooden','shovel_steel','hammer_builder','hammer_claw','wrench','knife_hunting','knife_skinning_titanium','flashlight',
 'lantern','fishing_rod','canteen','repair_kit','duct_tape','bucket','binoculars','lockpicks','hand_drill']
WEAPONS = ['club_OLD','spear_stone','slingshot','bat_nails','machete','crossbow','pistol_pipe','fire_axe','knuckles_shock',
 'pistol_OLD','shotgun_sawedoff','sledgehammer','sword_steel','shotgun_pump','rifle_hunting_OLD','molotov','grenade',
 'katana_titanium','baton_electric','assault_rifle','sniper_rifle_OLD','flamethrower','plasma_cutter','railgun','energy_rifle']
RESOURCES = ['log','sticks','fiber','stone','clay_OLD','peat','bones','hide','fur','copper_ingot','steel_plates','titanium_ore',
 'titanium_ingot','sand','sulfur','coal','crude_oil','uranium','circuit_board','rags','plastic_OLD','rubber','copper_wire',
 'battery','nails_bolts']
FOOD = ['meat_raw','meat_grilled','fish_raw','fish_grilled','berries','mushrooms','potato','carrot','beans_can','ration',
 'chocolate','honey','water_dirty','water_clean','soda_OLD','coffee','painkillers','antibiotics','antirad','stimulant',
 'splint_OLD','herbal_poultice','disinfectant','antidote_OLD','first_aid_bag']
CLOTHING = ['shirt_ragged','jacket_leather','jacket_winter','robe_desert','hazmat_suit','vest_armor','pants_cargo',
 'pants_winter','sneakers','boots_combat','boots_snow','hat_fur','hat_sun','helmet','respirator','backpack_hiking_OLD',
 'backpack_military','mod_scope','mod_silencer','mod_ext_mag','mod_stock','mod_flashlight_OLD','mod_armor_plate',
 'mod_insulation','ammo_box']
REPL = ['club_wooden','rifle_hunting','sniper_rifle','pistol','clay','plastic',
        'soda','splint','antidote','backpack_hiking','mod_flashlight',
        'bear_trap_closed','turret_head_mg','manhole','hydrant','bus_stop','well',
        'outhouse','gas_kiosk','fishing_hut','guardrail','concrete_barrier','boardwalk']
WALL_MAT = ['wood','logs','brick','steel','concrete']
WALL_PIECE = ['face','top_cap','window','window_boarded','door_opening','door','floor','fence','damage_overlay','rubble']
INTERIOR = ['crate_wood_closed','crate_wood_open','crate_military_closed','crate_military_open','locker','wardrobe',
 'drawers','fridge','safe','dead_backpack','stove','kitchen_sink','table','chair_broken','sofa','bed','bookshelf','tv',
 'office_desk','medical_cabinet','bathtub','toilet','trash_can','cardboard_boxes','tires','campfire_unlit','campfire_coals',
 'workbench_1','workbench_2','workbench_3','forge','smelter','sewing_table','chem_table','gun_bench','generator',
 'electric_bench','repair_pit','garden_empty','garden_sprouts','garden_ripe','rain_barrel','water_purifier','chest_wood',
 'chest_metal','bed_pallets','sleeping_bag','base_core','outpost_beacon','cooking_station']
DEFENSE = ['stakes','spike_barricade','floor_spikes','barbed_wire','bear_trap_open','bear_trap_closed_OLD','tripwire',
 'barrel_explosive','electric_fence','electric_post','sandbags','barricade_doors','watchtower','searchlight','alarm_bell',
 'landmine','fire_trap','turret_base','turret_head_mg_OLD','turret_head_energy','dart_trap','blade_trap','pit_trap',
 'gate_spiked','turret_destroyed']
SUBURB = ['pine','pine_stump','birch','birch_stump','oak','dead_tree','bush_berries','bush_picked','tall_grass','log_fallen',
 'boulder','boulder_mined','rock_remains','scrap_pile','car_hatchback','car_frame','tractor','bus_stop_OLD','fence_picket',
 'well_OLD','outhouse_OLD','scarecrow','greenhouse','power_pole','road_sign']
SWAMP = ['willow','swamp_tree_dead','cattails','lily_pads','peat_mound','clay_deposit','copper_rock','copper_rock_mined',
 'boulder_mossy','mushrooms_glow','fuel_pump','gas_kiosk_OLD','trailer','truck_cab','tires_pile','toxic_barrels',
 'boardwalk_OLD','rowboat','fishing_hut_OLD','guardrail_OLD','concrete_barrier_OLD','drain_pipe','animal_skeleton',
 'motel_sign','fallen_tree_water']
CITY = ['tree_planter','hedge','street_lamp','traffic_light_fallen','car_burnt','patrol_car','bus','ambulance','rubble',
 'building_collapsed','apartment_entrance','shop_front','kiosk','vending_machine','phone_booth','dumpster','bench',
 'hydrant_OLD','road_barriers','checkpoint_tent','manhole_OLD','shopping_cart','billboard','garbage_bags','scrap_pile']
DESERT = ['dry_bush','cactus','sandstone','sulfur_rock','sulfur_rock_mined','coal_rock','coal_rock_mined','oil_seep',
 'pumpjack','drill_rig','excavator','dump_truck','conveyor','mine_cart','mine_entrance','power_tower','water_tower',
 'animal_skull','dune','container','tent','plane_wreck','tumbleweed','explosives_crate','windmill']
TUNDRA = ['spruce','spruce_stump','frozen_tree','boulder','boulder_mined','titanium_rock','titanium_rock_mined',
 'bush_berries','bush_picked','ice_shards','snowdrift','tent_military','truck_wreck','apc_wreck','radar_dish',
 'weather_mast','bunker_entrance','lab_door','fuel_barrels','snowmobile','barbed_fence','watchtower','cabin','icicles',
 'specimen_tank']
EPICENTER = ['mutant_tree','mutant_stump','crystals','crystals_harvested','uranium_rock','uranium_rock_mined',
 'molten_rock','cooling_tower','pipes','lab_module','containment_tank','robot_arm','server_rack','science_desk',
 'decon_shower','rad_sign','hazmat_locker','car_melted','monorail','statue','transformer','satellite_dish','cables',
 'glow_fungus','vault_door']
HERO = ['ref_idle','ref_walk','head_neutral','head_hurt','head_blink','torso','backpack','pelvis','upper_arm',
 'forearm_open','forearm_fist','thigh','shin_boot','head_helmet','head_gasmask','head_furhat']
ENEMY_ROWS = ['walker','crawler','spitter','sprinter','bloated','soldier','glowing']
ENEMY_COLS = ['idle','head','torso','pelvis','upper_arm','forearm','thigh','shin','special']
ENEMY_OVR = {(1, 6): 'rags', (1, 7): 'forearm_2', (1, 8): 'ambush_pose', (0, 8): 'shirt_flap', (2, 8): 'throat_sac',
             (3, 8): 'run_pose', (4, 8): 'blisters', (5, 8): 'helmet', (6, 8): 'coat_flap'}
ANIMAL_ROWS = ['deer','boar','hare','dog','toad','raptor','scorpion','armored_lizard','snow_wolf']
ANIMAL_COLS = ['idle','head','body','front_upper','front_lower','back_upper','back_lower','tail']
ANIMAL_OVR = {(2, 7): 'ears', (4, 7): 'tongue_and_sac', (5, 3): 'arm_upper', (5, 4): 'arm_lower', (5, 5): 'leg_upper',
              (5, 6): 'leg_lower', (6, 3): 'pincer_arm', (6, 4): 'pincer_claw', (6, 5): 'leg_upper',
              (6, 6): 'leg_lower', (6, 7): 'tail_stinger'}
BOSS_ROWS = [
 ['butcher_' + n for n in ['idle','phase2','head','torso','arm','leg','hook_chain','trophy_key']],
 ['queen_' + n for n in ['idle','phase2','head','body','front_leg','back_leg','egg_sacs','trophy_jar']],
 ['tyrant_' + n for n in ['idle','phase2','head','leg','arm','tail','trophy_fang']],
 ['devourer_' + n for n in ['idle','phase2','head_mouth','segment','teeth_ring','mouth_alt','tail_segment','armor_plate','trophy_heart']],
 ['frost_' + n for n in ['idle','phase2','head','body','front_leg','back_leg','tail','trophy_core','ice_shard']],
 ['zero_' + n for n in ['idle','phase2','head','torso','arm','tentacle','lower_body','trophy_medallion']],
]
TRANSPORT = ['bicycle_body','bicycle_wheel','moped_body','moped_wheel','quad_body','quad_wheel','moto_body','moto_wheel',
 'pickup_body','pickup_wheel','buggy_body','buggy_wheel','snowcat_body','snowcat_track','pickup_armor_kit','roof_rack']
EFFECT_ROWS = [['spark_1','spark_2','spark_3','dust_1','dust_2'],
               ['dust_3','smoke_1','smoke_2','flame_1','flame_2'],
               ['flame_3','flame_4','flame_5','flame_6','explosion_1'],
               ['explosion_2','explosion_3','explosion_4','explosion_5','muzzle_1'],
               ['muzzle_2','slime_1','slime_2','rad_aura','sparkle_1'],
               ['sparkle_2','water_splash']]
UI_ROWS = [['bar_frame','bar_fill_red','icon_hunger','icon_thirst','icon_temperature'],
           ['icon_radiation','icon_stamina','slot','slot_selected','slot_green'],
           ['slot_blue','slot_purple','slot_orange','joystick_base','joystick_knob'],
           ['btn_action','btn_attack','btn_dodge','btn_build','panel_9slice'],
           ['button_plate_9slice','btn_close','marker_pin','marker_boss','clock_day_night']]
TILES = ['grass','grass_flowers','dirt','dirt_road_h','asphalt_cracked','asphalt_line_h','swamp_mud','water_shallow',
         'sand','clay_cracked','snow','ice','concrete','scorched_rad','ceramic_floor','gravel']

# ---------------------------------------------------------------- keying
def key_alpha(rgb, key):
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    if key == 'magenta':
        m = np.clip((np.minimum(R, B) - G - 25) / 110, 0, 1); K = np.array([255, 0, 255], np.float32)
    elif key == 'blue':
        m = np.clip((B - np.maximum(R, G) - 35) / 95, 0, 1); K = np.array([0, 0, 255], np.float32)
    elif key == 'black':
        a = np.clip(rgb.max(axis=2) / 255 * 1.15, 0, 1)
        col = np.clip(rgb / np.maximum(a, 1e-3)[..., None], 0, 255)
        a[a < 0.06] = 0
        return a, col
    alpha = 1 - m
    alpha[alpha < 0.12] = 0
    col = (rgb - (1 - alpha[..., None]) * K) / np.maximum(alpha, 1e-3)[..., None]
    col = np.clip(col, 0, 255)
    edge = alpha < 0.98
    if key == 'magenta':
        sp = np.clip(np.minimum(col[..., 0], col[..., 2]) - col[..., 1] - 20, 0, None)
        col[..., 0] = np.where(edge, col[..., 0] - sp * .7, col[..., 0]); col[..., 2] = np.where(edge, col[..., 2] - sp * .7, col[..., 2])
    else:
        mx = np.maximum(col[..., 0], col[..., 1])
        col[..., 2] = np.where(edge, np.minimum(col[..., 2], mx * 0.9 + 6), col[..., 2])
        # purple fringe: red lifted by blue haze on thin beams
        purple = edge & (col[..., 0] > col[..., 1] + 25)
        col[..., 0] = np.where(purple, col[..., 1] + 25, col[..., 0])
    return alpha, col

def load(path, key):
    im = Image.open(path)
    if im.mode == 'RGBA' and np.asarray(im)[..., 3].min() < 250:
        a = np.asarray(im).astype(np.float32)
        return a[..., 3] / 255, a[..., :3]
    rgb = np.asarray(im.convert('RGB')).astype(np.float32)
    return key_alpha(rgb, key)

# ---------------------------------------------------------------- components
def components(alpha, dil, min_frac=0.00012):
    mask = alpha > 0.06
    big = ndimage.binary_dilation(mask, iterations=dil)
    lab, n = ndimage.label(big)
    H, W = mask.shape
    comps = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        reg = (lab[sl] == i + 1) & mask[sl]
        area = reg.sum()
        if area < min_frac * H * W:
            continue
        ys, xs = np.nonzero(reg)
        comps.append(dict(id=i + 1, sl=sl, area=area, cy=sl[0].start + ys.mean(), cx=sl[1].start + xs.mean(),
                          x0=sl[1].start, x1=sl[1].stop, y0=sl[0].start, y1=sl[0].stop))
    return lab, mask, comps

def group_grid(comps, H, W, rows, cols):
    g = {}
    for c in comps:
        r = min(rows - 1, int(c['cy'] / (H / rows))); k = min(cols - 1, int(c['cx'] / (W / cols)))
        g.setdefault(r * cols + k, []).append(c)
    return g

def group_rows(comps, H, gap_merge):
    comps = sorted(comps, key=lambda c: c['cy'])
    # rows by y-overlap of vertical extents
    rows = []
    for c in sorted(comps, key=lambda c: c['y0']):
        for r in rows:
            if c['cy'] < r['y1'] and c['cy'] > r['y0']:
                r['items'].append(c); r['y0'] = min(r['y0'], c['y0']); r['y1'] = max(r['y1'], c['y1']); break
        else:
            rows.append(dict(y0=c['y0'], y1=c['y1'], items=[c]))
    rows.sort(key=lambda r: r['y0'])
    out = []
    for r in rows:
        items = sorted(r['items'], key=lambda c: c['x0'])
        groups = []
        for c in items:
            if groups and c['x0'] - max(g['x1'] for g in groups[-1]) < gap_merge:
                groups[-1].append(c)
            else:
                groups.append([c])
        out.append(groups)
    return out

def fit_groups(groups, n, mask):
    def gx(g): return min(c['x0'] for c in g), max(c['x1'] for c in g)
    groups = [list(g) for g in groups]
    while len(groups) > n and len(groups) > 1:
        gaps = [gx(groups[i + 1])[0] - gx(groups[i])[1] for i in range(len(groups) - 1)]
        i = int(np.argmin(gaps)); groups[i] = groups[i] + groups.pop(i + 1)
    guard = 0
    while len(groups) < n and guard < 20:
        guard += 1
        i = int(np.argmax([gx(g)[1] - gx(g)[0] for g in groups])); g = groups[i]
        x0, x1 = gx(g); y0 = min(c['y0'] for c in g); y1 = max(c['y1'] for c in g)
        proj = mask[y0:y1, x0:x1].sum(axis=0)
        a, b = int((x1 - x0) * .3), int((x1 - x0) * .7)
        xs = x0 + a + int(np.argmin(proj[a:b]))
        left, right = [], []
        for c in g:
            if c['x1'] <= xs: left.append(c)
            elif c['x0'] >= xs: right.append(c)
            else:
                l = dict(c); l['x1'] = xs; r = dict(c); r['x0'] = xs
                left.append(l); right.append(r)
        groups[i:i + 1] = [left, right]
    return groups

def extract(alpha, col, lab, mask, group, pad=2):
    y0 = min(c['y0'] for c in group); y1 = max(c['y1'] for c in group)
    x0 = min(c['x0'] for c in group); x1 = max(c['x1'] for c in group)
    sel = np.zeros((y1 - y0, x1 - x0), bool)
    for c in group:
        sel |= (lab[y0:y1, x0:x1] == c['id'])
    sel &= mask[y0:y1, x0:x1]
    a = np.where(sel, alpha[y0:y1, x0:x1], 0)
    img = Image.fromarray(np.dstack([col[y0:y1, x0:x1], a * 255]).astype(np.uint8), 'RGBA')
    bb = img.getbbox()
    img = img.crop(bb)
    out = Image.new('RGBA', (img.width + 2 * pad, img.height + 2 * pad))
    out.paste(img, (pad, pad))
    return out

# ---------------------------------------------------------------- tiles
def seamless(t, mode):
    a = np.asarray(t).astype(np.float32)
    H, W = a.shape[:2]
    if mode == 'none':
        return t
    sy, sx = (H // 2, W // 2) if mode == 'both' else (0, W // 2)
    rolled = np.roll(a, (sy, sx), axis=(0, 1))
    def ramp(n):
        d = np.minimum(np.arange(n), n - 1 - np.arange(n)) / (n * 0.22)
        d = np.clip(d, 0, 1); return d * d * (3 - 2 * d)
    mx = ramp(W)[None, :]
    my = ramp(H)[:, None] if mode == 'both' else np.ones((H, 1))
    m = np.minimum(mx, my)[..., None]
    return Image.fromarray((a * m + rolled * (1 - m)).astype(np.uint8))

# ---------------------------------------------------------------- preview
def preview(items, cols, title):
    cw = 170; rows = (len(items) + cols - 1) // cols
    cv = Image.new('RGB', (cols * cw, rows * (cw + 22) + 26), (48, 50, 45)); d = ImageDraw.Draw(cv)
    d.text((6, 6), title, fill=(255, 220, 120), font=FONT)
    for i, (name, img) in enumerate(items):
        x, y = (i % cols) * cw, 26 + (i // cols) * (cw + 22)
        for yy in range(0, cw, 17):
            for xx in range(0, cw, 17):
                if (xx // 17 + yy // 17) % 2 == 0:
                    d.rectangle([x + xx, y + yy, x + xx + 16, y + yy + 16], fill=(60, 62, 56))
        t = img.copy(); t.thumbnail((cw - 12, cw - 12))
        cv.paste(t, (x + (cw - t.width) // 2, y + (cw - t.height) // 2), t if t.mode == 'RGBA' else None)
        colr = (255, 140, 120) if name.endswith('_OLD') else (230, 226, 214)
        d.text((x + 4, y + cw + 3), name[:26], fill=colr, font=FONT)
    return cv

# ---------------------------------------------------------------- run
JOBS = [
 # file, folder, mode, key, layout, names
 ('s00_icons_first.png', 'icons/base', 'grid', 'magenta', (4, 4), ICONS_FIRST),
 ('s01_icons_tools.png', 'icons/tools', 'grid', 'magenta', (5, 5), TOOLS),
 ('s02_icons_weapons.png', 'icons/weapons', 'grid', 'magenta', (5, 5), WEAPONS),
 ('s03_icons_resources.png', 'icons/resources', 'grid', 'magenta', (5, 5), RESOURCES),
 ('s04_icons_food_medicine.png', 'icons/food_medicine', 'grid', 'magenta', (5, 5), FOOD),
 ('s05_icons_clothing_mods.png', 'icons/clothing_mods', 'grid', 'magenta', (5, 5), CLOTHING),
 ('s09_replacements.png', 'replacements', 'grid', 'magenta', (4, 6), REPL[:11] + [None] + REPL[11:]),
 ('s07_walls.png', 'building/walls', 'grid', 'magenta', (5, 10), grid(5, 10, WALL_MAT, WALL_PIECE)),
 ('s08_interior.png', 'world/interior', 'grid', 'magenta', (5, 10), INTERIOR),
 ('s10_defense.png', 'world/defense', 'grid', 'magenta', (5, 5), DEFENSE),
 ('s11_biome1_suburb.png', 'world/biome1_suburb', 'grid', 'magenta', (5, 5), SUBURB),
 ('s12_biome2_swamp.png', 'world/biome2_swamp', 'grid', 'magenta', (5, 5), SWAMP),
 ('s13_biome3_city.png', 'world/biome3_city', 'grid', 'magenta', (5, 5), CITY),
 ('s14_biome4_desert.png', 'world/biome4_desert', 'grid', 'blue', (5, 5), DESERT),
 ('s15_biome5_tundra.png', 'world/biome5_tundra', 'grid', 'magenta', (5, 5), TUNDRA),
 ('s16_biome6_epicenter.png', 'world/biome6_epicenter', 'grid', 'magenta', (5, 5), EPICENTER),
 ('s17_hero.png', 'characters/hero', 'grid', 'magenta', (4, 4), HERO),
 ('s18_enemies.png', 'characters/enemies', 'rows', 'magenta', None, [grid(1, 9, [r], ENEMY_COLS, {(0, c): v for (rr, c), v in ENEMY_OVR.items() if rr == i}) for i, r in enumerate(ENEMY_ROWS)]),
 ('s19_animals.png', 'characters/animals', 'rows', 'magenta', None, [grid(1, 8, [r], ANIMAL_COLS, {(0, c): v for (rr, c), v in ANIMAL_OVR.items() if rr == i}) for i, r in enumerate(ANIMAL_ROWS)]),
 ('s20_bosses.png', 'characters/bosses', 'rows', 'magenta', None, BOSS_ROWS),
 ('s21_transport.png', 'vehicles', 'grid', 'magenta', (4, 4), TRANSPORT),
 ('s22_effects.png', 'effects', 'rowgrid', 'black', 5, EFFECT_ROWS),
 ('s23_ui.png', 'ui', 'rows', 'magenta', None, UI_ROWS),
]

report = {}
os.makedirs(f'{OUT}/_previews', exist_ok=True)
for fname, folder, mode, key, layout, names in JOBS:
    alpha, col = load(f'{SRC}/{fname}', key)
    H, W = alpha.shape
    dil = 8 if key == 'black' else 3
    lab, mask, comps = components(alpha, dil)
    os.makedirs(f'{OUT}/{folder}', exist_ok=True)
    items, issues = [], []
    if mode == 'grid':
        rows, cols = layout
        g = group_grid(comps, H, W, rows, cols)
        for idx, name in enumerate(names):
            if name is None:
                continue
            grp = g.get(idx)
            if not grp:
                issues.append(f'empty cell {idx+1} ({name})'); continue
            img = extract(alpha, col, lab, mask, grp)
            items.append((name, img))
    elif mode == 'rowgrid':
        cols = layout
        rws = group_rows(comps, H, gap_merge=10**6)
        for r, groups in enumerate(rws):
            allc = [c for g in groups for c in g]
            byc = {}
            for c in allc:
                byc.setdefault(min(cols - 1, int(c['cx'] / (W / cols))), []).append(c)
            exp = names[r] if r < len(names) else []
            if len(byc) != len(exp):
                issues.append(f'row {r+1}: found {len(byc)} expected {len(exp)}')
            for k, ci in enumerate(sorted(byc)):
                name = exp[k] if k < len(exp) else f'row{r+1}_extra_{k+1}'
                items.append((name, extract(alpha, col, lab, mask, byc[ci])))
    else:
        rws = group_rows(comps, H, gap_merge=3 if key != 'black' else 30)
        rws = [fit_groups(g, len(names[r]) if r < len(names) else len(g), mask) for r, g in enumerate(rws)]
        if len(rws) != len(names):
            issues.append(f'rows found {len(rws)} expected {len(names)}')
        for r, groups in enumerate(rws):
            exp = names[r] if r < len(names) else []
            if len(groups) != len(exp):
                issues.append(f'row {r+1}: found {len(groups)} expected {len(exp)}')
            for k, grp in enumerate(groups):
                name = exp[k] if k < len(exp) else f'row{r+1}_extra_{k+1}'
                items.append((name, extract(alpha, col, lab, mask, grp)))
    for name, img in items:
        if folder == 'characters/hero' and name == 'pelvis':
            img = img.crop((0, 0, img.width, int(img.height * 0.45)))
        img.save(f'{OUT}/{folder}/{name}.png', optimize=True)
    preview(items, 10 if len(items) > 30 else 6, f'{fname} -> {folder}').save(f'{OUT}/_previews/{fname}')
    report[fname] = dict(folder=folder, count=len(items), issues=issues)

# tiles
alpha, col = load(f'{SRC}/s06_tiles.png', 'magenta')
lab, mask, comps = components(alpha, 1)
comps = sorted(comps, key=lambda c: (round(c['cy'] / 150), c['cx']))
os.makedirs(f'{OUT}/tiles', exist_ok=True)
items = []
src = Image.open(f'{SRC}/s06_tiles.png').convert('RGB')
for name, c in zip(TILES, comps):
    ins = 6
    t = src.crop((c['x0'] + ins, c['y0'] + ins, c['x1'] - ins, c['y1'] - ins))
    s = min(t.size); t = t.crop((0, 0, s, s))
    m = 'none' if name == 'ceramic_floor' else ('x' if name.endswith('_h') else 'both')
    if name == 'ceramic_floor':
        ins2 = int(s * 0.03); t = t.crop((ins2, ins2, s - ins2, s - ins2))
    t = seamless(t, m).resize((256, 256), Image.LANCZOS)
    t.save(f'{OUT}/tiles/{name}.png', optimize=True)
    items.append((name, t))
report['s06_tiles.png'] = dict(folder='tiles', count=len(items), issues=[] if len(comps) == 16 else [f'found {len(comps)}'])
# tile repetition preview (3x3) to prove seams
cv = Image.new('RGB', (16 * 200, 200 * 1))
prev = Image.new('RGB', (8 * 300, 2 * 300))
for i, (n, t) in enumerate(items):
    sm = t.resize((100, 100))
    blk = Image.new('RGB', (300, 300))
    for yy in range(3):
        for xx in range(3):
            blk.paste(sm, (xx * 100, yy * 100))
    prev.paste(blk, ((i % 8) * 300, (i // 8) * 300))
prev.save(f'{OUT}/_previews/s06_tiles_repeat3x3.png')
json.dump(report, open(f'{OUT}/_cut_report.json', 'w'), indent=1, ensure_ascii=False)
for k, v in report.items():
    print(k, v['count'], v['issues'])
