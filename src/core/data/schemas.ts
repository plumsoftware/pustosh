import { z } from 'zod';

/**
 * Схемы data/*.json. Обязательные поля — обязательны, неизвестные допускаются (looseObject),
 * чтобы данные можно было расширять без правки кода. Типы — через z.infer.
 */

/** Идентификатор спрайта из манифеста: world.biome1_suburb.pine */
export type AssetId = string;

/** 'assets/world/biome1_suburb/pine.png' → 'world.biome1_suburb.pine' */
export function pathToAssetId(path: string): AssetId {
  return path
    .replace(/^assets\//, '')
    .replace(/\.png$/i, '')
    .split('/')
    .join('.');
}

const ASSET_PATH = /^assets\/[\w/.-]+\.png$/;

/** Путь к картинке в данных; при загрузке превращается в assetId. */
export const AssetRef = z
  .string()
  .regex(ASSET_PATH, 'ожидается путь вида assets/<папка>/<имя>.png')
  .transform(pathToAssetId);

export const Range = z
  .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
  .refine(([min, max]) => min <= max, 'диапазон [min, max]: min > max');
export type Range = z.infer<typeof Range>;

const Id = z.string().min(1);
const Count = z.number().int().positive();
/** Стоимость/входы: { itemId: количество } */
const Cost = z.record(z.string(), Count);
/** Дропы: { itemId: [min, max] } */
const Drops = z.record(z.string(), Range);
const Size2 = z.tuple([z.number().int().positive(), z.number().int().positive()]);

// ---------- items.json ----------
export const ItemCategory = z.enum([
  'resource',
  'tool',
  'weapon',
  'ammo',
  'food',
  'medicine',
  'clothing',
  'mod',
  'trophy',
  'container',
  'consumable',
  'blueprint',
  // Не в items.json: предметы-станки и защита собираются Registry из stations.json и defense.json.
  'placeable',
  'defense',
  'vehicle',
]);
export type ItemCategory = z.infer<typeof ItemCategory>;

export const ItemDef = z.looseObject({
  id: Id,
  name_ru: z.string().min(1),
  category: ItemCategory,
  tier: z.number().int().min(0).max(6),
  icon: AssetRef,
  stack: Count,
  toolType: z.string().optional(),
  harvestTier: z.number().int().optional(),
  durability: z.number().int().nonnegative().optional(),
  ammo: z.string().nullable().optional(),
  heroHead: AssetRef.optional(),
  heroBackpack: AssetRef.optional(),
  iconTint: z.string().optional(),
});
export type ItemDef = z.infer<typeof ItemDef>;

// ---------- stations.json ----------
export const StationDef = z.looseObject({
  id: Id,
  name_ru: z.string().min(1),
  tier: z.number().int().min(0),
  sprite: AssetRef,
  footprintTiles: Size2,
  needsPower: z.boolean(),
  stateSprites: z.record(z.string(), AssetRef).optional(),
  requiresSkill: z.string().nullable().optional(),
  fuel: z.string().nullable().optional(),
});
export type StationDef = z.infer<typeof StationDef>;

// ---------- recipes.json ----------
export const RecipeDef = z.looseObject({
  id: Id,
  output: Id,
  count: Count,
  station: Id,
  inputs: Cost,
  timeSec: z.number().nonnegative(),
  unlock: z.enum(['known', 'tutorial', 'blueprint_or_boss']),
  requiresSkill: z.string().nullable(),
});
export type RecipeDef = z.infer<typeof RecipeDef>;

// ---------- building.json ----------
export const WallPiece = z.enum([
  'face',
  'top_cap',
  'window',
  'window_boarded',
  'door_opening',
  'door',
  'floor',
  'fence',
  'damage_overlay',
  'rubble',
]);
export type WallPiece = z.infer<typeof WallPiece>;

export const MaterialDef = z.looseObject({
  id: Id,
  name_ru: z.string().min(1),
  level: z.number().int().positive(),
  hp: z.number().positive(),
  cost: Cost,
  requires: Id,
  sprites: z.record(WallPiece, AssetRef),
});
export type MaterialDef = z.infer<typeof MaterialDef>;

export const BuildingDef = z.looseObject({
  gridTile: z.number().int().positive(),
  pieces: z.array(WallPiece),
  assembly_rules: z.array(z.string()),
  materials: z.array(MaterialDef).min(1),
  floorCostMul: z.number().nonnegative(),
  windowCostMul: z.number().nonnegative(),
  doorCost: Cost,
});
export type BuildingDef = z.infer<typeof BuildingDef>;

// ---------- defense.json ----------
export const DefenseDef = z.looseObject({
  id: Id,
  name_ru: z.string().min(1),
  sprite: AssetRef,
  hp: z.number().positive(),
  effect: z.looseObject({
    closedSprite: AssetRef.optional(),
    postSprite: AssetRef.optional(),
    head: AssetRef.optional(),
    ammo: z.string().optional(),
    fuel: z.string().optional(),
  }),
  cost: Cost,
  station: Id,
  destroyedSprite: AssetRef.nullable().optional(),
});
export type DefenseDef = z.infer<typeof DefenseDef>;

// ---------- enemies.json ----------
export const EnemyDef = z.looseObject({
  id: Id,
  name_ru: z.string().min(1),
  family: z.string(),
  biomes: z.array(z.number().int().min(1).max(6)).min(1),
  hp: z.number().positive(),
  damage: z.number().nonnegative(),
  speedTilesPerSec: z.number().nonnegative(),
  behavior: z.string(),
  drops: Drops,
  xp: z.number().int().nonnegative(),
  targetHeightPx: z.number().positive(),
  rig: z.string(),
  parts: z.record(z.string(), AssetRef),
  specialParts: z.record(z.string(), AssetRef).optional(),
  elite: z
    .looseObject({
      hpMul: z.number().positive(),
      dmgMul: z.number().positive(),
      scale: z.number().positive(),
      chance: z.number().min(0).max(1),
    })
    .nullable()
    .optional(),
});
export type EnemyDef = z.infer<typeof EnemyDef>;

// ---------- bosses.json ----------
export const BossDef = z.looseObject({
  id: Id,
  name_ru: z.string().min(1),
  biome: z.number().int().min(1).max(6),
  hp: z.number().positive(),
  targetHeightPx: z.number().positive(),
  sprites: z.record(z.string(), AssetRef).refine((s) => 'idle' in s, 'у босса нет спрайта idle'),
  phases: z.array(z.string()).min(1),
  attacks: z.array(z.string()).min(1),
  trophy: z.looseObject({ item: Id, icon: AssetRef }),
  unlocks: z.array(z.string()),
});
export type BossDef = z.infer<typeof BossDef>;

// ---------- biomes.json ----------
export const HarvestDef = z.looseObject({
  tool: z.string(),
  minTier: z.number().int().min(0),
  drops: Drops,
  hits: z.number().int().positive(),
});
export type HarvestDef = z.infer<typeof HarvestDef>;

export const WorldObjectDef = z.looseObject({
  id: Id,
  sprite: AssetRef,
  kind: z.string(),
  harvest: HarvestDef.optional(),
  afterHarvest: AssetRef.optional(),
});
export type WorldObjectDef = z.infer<typeof WorldObjectDef>;

export const LootContainerDef = z.looseObject({
  id: Id,
  sprite: AssetRef,
  openedSprite: AssetRef.nullable().optional(),
  slots: z.number().int().positive(),
  table: z.string(),
});
export type LootContainerDef = z.infer<typeof LootContainerDef>;

export const FurnitureSalvageDef = z.looseObject({
  id: Id,
  sprite: AssetRef,
  harvest: HarvestDef,
});
export type FurnitureSalvageDef = z.infer<typeof FurnitureSalvageDef>;

export const BiomeDef = z.looseObject({
  id: z.number().int().min(1).max(6),
  name_ru: z.string().min(1),
  levels: z.tuple([z.number().int(), z.number().int()]),
  tiles: z.array(z.string()).min(1),
  enemies: z.array(Id),
  boss: Id,
  objects: z.array(WorldObjectDef),
  hazards: z.array(z.string()).optional(),
});
export type BiomeDef = z.infer<typeof BiomeDef>;

export const BiomesFile = z.looseObject({
  biomes: z.array(BiomeDef).min(1),
  common: z.looseObject({
    interior: z.array(Id),
    loot_containers: z.array(LootContainerDef),
    furniture_salvage: z.array(FurnitureSalvageDef),
  }),
});
export type BiomesFile = z.infer<typeof BiomesFile>;

// ---------- vehicles.json ----------
export const VehicleDef = z.looseObject({
  id: Id,
  name_ru: z.string().min(1),
  tier: z.number().int().min(0),
  body: AssetRef,
  /** Иконка в инвентаре (лист s33); нет — корпус. */
  icon: AssetRef.optional(),
  wheel: AssetRef.nullable().optional(),
  track: AssetRef.nullable().optional(),
  speedMul: z.number().positive(),
  trunkSlots: z.number().int().nonnegative(),
  fuelPer100Tiles: z.number().nonnegative(),
  hp: z.number().positive(),
  terrain: z.array(z.string()),
  mods: z.record(z.string(), AssetRef).optional(),
});
export type VehicleDef = z.infer<typeof VehicleDef>;

// ---------- skills.json ----------
export const SkillDef = z.looseObject({
  id: Id,
  name_ru: z.string().min(1),
  levels: z.number().int().positive(),
  perLevel: z.string(),
});
export const SkillBranchDef = z.looseObject({
  id: Id,
  name_ru: z.string().min(1),
  skills: z.array(SkillDef).min(1),
});
export const SkillsDef = z.looseObject({
  maxLevel: z.number().int().positive(),
  pointsPerLevel: z.number().int().positive(),
  xpCurve: z.string(),
  branches: z.array(SkillBranchDef).min(1),
});
export type SkillsDef = z.infer<typeof SkillsDef>;

// ---------- balance.json ----------
/** Ссылка «as yandex» — значение берётся у другой площадки (разворачивает PlatformConfig). */
const AsOther = z.string().regex(/^as \w+$/);

export const AdsPlatformDef = z.looseObject({
  interstitialMinIntervalSec: z.number().nonnegative(),
  interstitialPoints: z.array(z.string()),
  rewarded: z.union([z.array(z.string()), AsOther]),
});
export const SurvivalPlatformDef = z.looseObject({
  hungerPerMin: z.number().nonnegative(),
  thirstPerMin: z.number().nonnegative(),
  coldDmgPerSec: z.number().nonnegative(),
});

export const BalanceDef = z.looseObject({
  world: z.looseObject({
    seed: z.number().int(),
    sizeTiles: Size2,
    chunkTiles: z.number().int().positive(),
    tilePx: z.number().int().positive(),
    biomeRingsRadiusTiles: z.array(z.number().nonnegative()),
  }),
  dayNight: z.looseObject({
    fullDaySec: z.number().positive(),
    daySec: z.number().positive(),
    nightSec: z.number().positive(),
    bloodNightEvery: z.number().int().positive(),
  }),
  player: z.looseObject({
    hp: z.number().positive(),
    stamina: z.number().positive(),
    speedTilesPerSec: z.number().positive(),
    sprintMul: z.number().positive(),
    dodgeIFramesSec: z.number().nonnegative(),
    dodgeStamina: z.number().nonnegative(),
    deathBackpackLifetimeSec: z.number().positive(),
    inventorySlots: z.number().int().positive(),
    hotbarSlots: z.number().int().positive(),
  }),
  survival: z.record(z.string(), z.union([SurvivalPlatformDef, AsOther])),
  ads: z.record(z.string(), z.union([AdsPlatformDef, AsOther])),
  iap: z.array(z.string()),
});
export type BalanceDef = z.infer<typeof BalanceDef>;

// ---------- rigs.json ----------
const Vec2 = z.tuple([z.number(), z.number()]);
export const BoneDef = z.looseObject({
  id: Id,
  parent: z.string().nullable(),
  sprite: z.string().optional(),
  pivot: Vec2.optional(),
  attach: Vec2.optional(),
  z: z.number().optional(),
  tint: z.string().optional(),
  optional: z.boolean().optional(),
});
export const SkeletonDef = z.looseObject({
  facing: z.string(),
  partLengthFrac: z.record(z.string(), z.number().positive()),
  bones: z.array(BoneDef).min(1),
  animations: z.record(z.string(), z.unknown()),
  fallbackMVP: z.string().optional(),
});
export const RigsDef = z.looseObject({
  humanoid: SkeletonDef,
  quadruped: SkeletonDef,
  boss: z.looseObject({}),
});
export type RigsDef = z.infer<typeof RigsDef>;

// ---------- worldgen.json (создан на шаге 3) ----------
const Weights = z.record(z.string(), z.number().nonnegative());
const ByBiome = <T extends z.ZodType>(t: T) => z.record(z.string().regex(/^[1-6]$/), t);

export const ColliderRule = z
  .union([
    z.looseObject({ shape: z.literal('circle'), radiusOfWidth: z.number().positive() }),
    z.looseObject({ shape: z.literal('circle'), radiusTiles: z.number().positive() }),
    z.looseObject({
      shape: z.literal('rect'),
      widthOfWidth: z.number().positive(),
      depthTiles: z.number().positive(),
    }),
  ])
  .nullable();
export type ColliderRule = z.infer<typeof ColliderRule>;

export const WorldGenDef = z.looseObject({
  sea: z.looseObject({ tile: z.string() }),
  ringNoise: z.looseObject({ amplitudeTiles: z.number().nonnegative(), scaleTiles: z.number().positive() }),
  tileNoise: z.looseObject({ scaleTiles: z.number().positive(), octaves: z.number().int().min(1).max(6) }),
  tileMix: ByBiome(Weights),
  waterTiles: z.array(z.string()),
  blendPriority: z.array(z.string()).min(1),
  roads: z.looseObject({
    count: z.number().int().min(0),
    widthTiles: z.number().int().positive(),
    wobbleTiles: z.number().nonnegative(),
    segmentTiles: z.number().positive(),
    centerTile: ByBiome(z.string()),
    sideTile: ByBiome(z.string()),
    endRadiusTiles: z.number().nonnegative(),
  }),
  start: z.looseObject({
    angleDeg: z.number(),
    radiusTiles: z.number().positive(),
    clearRadiusTiles: z.number().nonnegative(),
  }),
  objects: z.looseObject({
    gridTiles: z.number().positive(),
    keepOutFromRoadTiles: z.number().nonnegative(),
    kindChance: Weights,
    treeEdgeBoost: z.looseObject({ edgeTiles: z.number().nonnegative(), mul: z.number().positive() }),
    roadside: z.looseObject({
      kinds: z.array(z.string()),
      chance: z.number().min(0).max(1),
      maxDistTiles: z.number().positive(),
    }),
    settlements: z.looseObject({
      perRing: z.number().int().min(0),
      radiusTiles: z.number().positive(),
      poiChance: z.number().min(0).max(1),
      kinds: z.array(z.string()),
    }),
    skipKinds: z.array(z.string()),
  }),
  ruins: z.looseObject({
    perBiome: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
    minSpacingTiles: z.number().positive(),
    edgeMarginTiles: z.number().nonnegative(),
    roadClearTiles: z.number().nonnegative(),
    prefabs: z.array(z.string()).min(1),
    materials: ByBiome(z.array(z.string()).min(1)),
  }),
  ringFences: z.looseObject({ materials: ByBiome(z.string()) }),
  persistence: z.looseObject({
    droppedItemLifetimeSec: z.number().positive(),
    updateEverySec: z.number().positive(),
    maxSaveSlots: z.number().int().positive(),
    saveNameMaxLength: z.number().int().positive(),
    autosaveEverySec: z.number().positive(),
  }),
  atlasStreaming: z.looseObject({
    preloadRadiusTiles: z.number().positive(),
    unloadRadiusTiles: z.number().positive(),
    sampleStepTiles: z.number().positive(),
    checkEveryMs: z.number().positive(),
  }),
  arenas: z.looseObject({
    prefab: z.string(),
    ringPosition: z.number().min(0).max(1),
    angleOffsetDeg: z.number(),
  }),
  gates: z.looseObject({ prefab: z.string() }),
  bunker: z.looseObject({ prefab: z.string() }),
  colliders: z.record(z.string(), ColliderRule),
  glow: z.record(z.string(), z.string().regex(/^#[0-9a-fA-F]{6}$/)),
  lights: z.looseObject({
    heroRadiusTiles: z.number().positive(),
    campfireRadiusTiles: z.number().positive(),
    streetLampRadiusTiles: z.number().positive(),
    glowRadiusTiles: z.number().positive(),
    lampObjects: z.array(z.string()),
  }),
  dayNight: z.looseObject({ transitionSec: z.number().nonnegative() }),
  camera: z.looseObject({
    lerp: z.number().min(0).max(1),
    zoomMin: z.number().positive(),
    zoomMax: z.number().positive(),
    viewTilesDesktop: z.tuple([z.number().positive(), z.number().positive()]),
    viewTilesMobile: z.tuple([z.number().positive(), z.number().positive()]),
  }),
  streaming: z.looseObject({
    marginChunks: z.number().int().min(0),
    unloadMarginChunks: z.number().int().min(1),
    maxChunkBuildsPerFrame: z.number().int().positive(),
    frameBudgetMs: z.number().positive(),
    cullMarginPx: z.number().nonnegative(),
    cacheChunks: z.number().int().positive(),
  }),
});
export type WorldGenDef = z.infer<typeof WorldGenDef>;

// ---------- world/prefabs/*.json (создаются на шаге 3) ----------
export const PrefabObjectDef = z.looseObject({
  at: z.tuple([z.number(), z.number()]),
  station: z.string().optional(),
  state: z.string().optional(),
  container: z.string().optional(),
  furniture: z.string().optional(),
  object: z.string().optional(),
  sprite: AssetRef.optional(),
  kind: z.string().optional(),
});
export type PrefabObjectDef = z.infer<typeof PrefabObjectDef>;

export const PrefabDef = z.looseObject({
  id: Id,
  kind: z.enum(['bunker', 'ruin', 'arena', 'gate']),
  material: z.string().optional(),
  anchor: z.tuple([z.number().int(), z.number().int()]).optional(),
  plan: z
    .array(z.string().regex(/^[#DO., ]*$/, 'план: допустимы # D O . , и пробел'))
    .refine((rows) => rows.every((r) => r.length === rows[0]?.length), 'строки плана разной длины')
    .optional(),
  objects: z.array(PrefabObjectDef).default([]),
  clearRadiusTiles: z.number().nonnegative().optional(),
  ring: z
    .looseObject({
      radiusTiles: z.number().positive(),
      kind: z.string(),
      count: z.number().int().positive(),
      gapDeg: z.number().min(0),
    })
    .optional(),
  sprite: AssetRef.optional(),
  spanExtraTiles: z.number().int().min(0).optional(),
});
export type PrefabDef = z.infer<typeof PrefabDef>;

// ---------- survival.json (создан на шаге 4) ----------
const Range2 = z.tuple([z.number(), z.number()]);
export const SurvivalDef = z.looseObject({
  movement: z.looseObject({
    sprintStaminaPerSec: z.number().nonnegative(),
    minStaminaToSprint: z.number().nonnegative(),
    staminaRegenPerSec: z.number().nonnegative(),
    staminaRegenDelaySec: z.number().nonnegative(),
    dodgeDistanceTiles: z.number().positive(),
    dodgeDurationSec: z.number().positive(),
    terrainSpeedMul: z.record(z.string(), z.number().positive()),
    hurtKnockbackTiles: z.number().nonnegative(),
  }),
  needs: z.looseObject({
    max: z.number().positive(),
    zeroHpLossPerSec: z.number().nonnegative(),
    desertBiome: z.number().int(),
    desertDayThirstMul: z.number().positive(),
    lowFrac: z.number().min(0).max(1),
  }),
  temperature: z.looseObject({
    comfort: Range2,
    approachPerSec: z.number().positive(),
    biomes: ByBiome(z.looseObject({ day: z.number(), night: z.number() })),
    campfireBonus: z.number(),
    campfireRadiusTiles: z.number().positive(),
    outOfRangeSpeedMul: z.number().positive(),
  }),
  radiation: z.looseObject({
    max: z.number().positive(),
    zonePerSecByBiome: z.record(z.string(), z.number().nonnegative()),
  }),
  conditions: z.looseObject({
    bleeding: z.looseObject({ hpPerSec: z.number().nonnegative() }),
    poison: z.looseObject({ hpPerSec: z.number().nonnegative(), durationSec: z.number().positive() }),
    infection: z.looseObject({ regenMul: z.number().min(0) }),
    fracture: z.looseObject({ speedMul: z.number().positive() }),
  }),
  death: z.looseObject({
    respawnHpMul: z.number().min(0).max(1),
    rewardedPlacement: z.string(),
    interstitialPlacement: z.string(),
  }),
});
export type SurvivalDef = z.infer<typeof SurvivalDef>;

// ---------- harvest.json, loot_tables.json (созданы на шаге 5) ----------
export const HarvestCfgDef = z.looseObject({
  targetRadiusTiles: z.number().positive(),
  targetSectorDeg: z.number().positive().max(360),
  interactRadiusTiles: z.number().positive(),
  wrongToolProgressMul: z.number().min(0),
  wrongToolWearMul: z.number().min(0),
  brokenEfficiency: z.number().min(0).max(1),
  wearPerHit: z.number().min(0),
  handsStaminaPerUse: z.number().min(0),
  bushRegrowGameDays: z.number().positive(),
  regrowKinds: z.array(z.string()),
  storageSlots: z.record(z.string(), z.number().int().positive()),
  repair: z.looseObject({ stations: z.array(z.string()), radiusTiles: z.number().positive() }),
  particles: z.record(z.string(), z.enum(['wood', 'plant', 'stone', 'metal', 'cloth'])),
  noteObjects: z.array(z.string()),
});
export type HarvestCfgDef = z.infer<typeof HarvestCfgDef>;

const LootEntry = z.looseObject({ item: Id, w: z.number().positive(), count: Range });
export const LootTablesDef = z.looseObject({
  maxTierOverBiome: z.number().int().min(0),
  doubleLootCooldownSec: z.number().nonnegative(),
  rolls: z.record(z.string(), Range),
  tables: z.record(z.string(), z.array(LootEntry).min(1)),
  objects: z.record(z.string(), z.looseObject({ table: z.string(), slots: z.number().int().positive() })),
});
export type LootTablesDef = z.infer<typeof LootTablesDef>;

// ---------- craft.json (создан на шаге 6) ----------
const SkillMul = z.looseObject({ id: z.string(), perLevel: z.number() });
export const CraftCfgDef = z.looseObject({
  queueMax: z.number().int().positive(),
  outputMaxStacks: z.number().int().positive(),
  nearbyChestRadiusTiles: z.number().nonnegative(),
  handsMaxSec: z.number().nonnegative(),
  instantCraftMinSec: z.number().nonnegative(),
  stationOpenRadiusTiles: z.number().positive(),
  placeableStack: z.number().int().positive(),
  disassembleReturn: z.number().min(0).max(1),
  disassembleTool: z.string(),
  noticeTier: z.number().int().min(0),
  speedSkill: SkillMul,
  fuelSkill: SkillMul,
  skillLevelRequired: z.record(z.string(), z.number().int().positive()),
  fuel: z.record(
    z.string(),
    z.looseObject({ items: z.record(Id, z.number().positive()), burnAlways: z.boolean() }),
  ),
  fuelSlotMax: z.number().int().positive(),
  garden: z.looseObject({
    growGameDays: z.number().positive(),
    sproutsAt: z.number().min(0).max(1),
    harvest: z.record(Id, Range),
  }),
  locked: z.record(z.string(), z.string()),
  blueprintItem: Id,
  categories: z.record(z.string(), z.array(z.string())),
  fx: z.looseObject({
    campfire: z.looseObject({ flameFrames: z.number().int(), loopSec: z.number(), lightFlicker: z.number() }),
    hot: z.array(z.string()),
    vibrate: z.array(z.string()),
  }),
});
export type CraftCfgDef = z.infer<typeof CraftCfgDef>;

// ---------- build_rules.json (создан на шаге 7) ----------
export const BuildRulesDef = z.looseObject({
  undoSec: z.number().nonnegative(),
  repairPerHit: z.number().positive().max(1),
  repairCostFrac: z.number().min(0),
  disassembleHoldSec: z.number().nonnegative(),
  disassembleReturn: z.number().min(0).max(1),
  fenceCostMul: z.number().nonnegative(),
  requiresStationRadiusTiles: z.number().nonnegative(),
  rubbleSec: z.number().nonnegative(),
  damageOverlayFrom: z.number().min(0).max(1),
  /** С этой доли урона лицо стены игрока — треснувшее (лист s26). */
  crackedFaceFrom: z.number().min(0).max(1).default(0.5),
  doorOpenRadiusTiles: z.number().positive(),
  roomFillLimit: z.number().int().positive(),
  lineMaxCells: z.number().int().positive(),
  base: z.looseObject({
    maxCores: z.number().int().positive(),
    autoCollectEverySec: z.number().positive(),
    maxOutposts: z.number().int().nonnegative(),
    rainBarrel: z.looseObject({
      item: Id,
      perGameHour: z.number().positive(),
      max: z.number().int().positive(),
    }),
    ringDash: z.tuple([z.number().positive(), z.number().positive()]),
  }),
  sleep: z.looseObject({ noEnemiesRadiusTiles: z.number().nonnegative(), fadeMs: z.number().nonnegative() }),
  defense: z.looseObject({
    solid: z.array(Id),
    contactTickSec: z.number().positive(),
    triggerRadiusTiles: z.number().positive(),
    turretTurnDegPerSec: z.number().positive(),
    turretAimTolDeg: z.number().positive(),
    ammoSlotMax: z.number().int().positive(),
    fireTrap: z.looseObject({ dps: z.number(), fuelPerSec: z.number(), coneDeg: z.number() }),
    alarmTriggerRadiusTiles: z.number().positive(),
    explosionScorchSec: z.number().nonnegative(),
    searchlightSwingDeg: z.number(),
  }),
  dummy: z.looseObject({
    hp: z.number().positive(),
    speedTilesPerSec: z.number().positive(),
    patrolTiles: z.number().positive(),
    radiusTiles: z.number().positive(),
  }),
});
export type BuildRulesDef = z.infer<typeof BuildRulesDef>;

// ---------- combat.json (создан на шаге 8) ----------
const Num = z.number();
const NumMap = z.record(z.string(), Num);
export const CombatCfgDef = z.looseObject({
  hero: z.looseObject({
    fistDamage: Num,
    fistRate: Num,
    fistRange: Num,
    meleeSectorDeg: Num,
    staminaPerSwing: Num,
    staminaHeavy: Num,
    heavyDamageFrom: Num,
    backstabMul: Num,
    brokenMul: Num,
    reloadSec: Num,
    noiseRadiusTiles: Num,
    autoAimSectorDeg: Num,
    critChance: Num,
    critMul: Num,
    hitStopMs: Num,
    throwFuseSec: Num,
    projectileSpeed: NumMap,
    spreadDeg: NumMap,
  }),
  magazine: NumMap,
  specials: z.looseObject({
    bleed: z.looseObject({ dps: Num, sec: Num }),
    stunSec: Num,
    knockbackTiles: Num,
    fireArea: z.looseObject({ radiusTiles: Num, sec: Num, dps: Num }),
    explosionArea: z.looseObject({ radiusTiles: Num }),
    flameConeDeg: Num,
    fuelPerShot: Num,
    batteryPerShot: NumMap,
  }),
  bodyTint: z.record(Id, z.string()),
  enemy: z.looseObject({
    visionDayTiles: Num,
    visionNightTiles: Num,
    hearTiles: Num,
    attackRangeTiles: Num,
    attackCooldownSec: Num,
    pathRadiusTiles: Num,
    repathSec: Num,
    loseSightSec: Num,
    wanderRadiusTiles: Num,
    wallSearchTiles: Num,
    deathSec: Num,
    knockbackResist: NumMap,
    radiusTiles: NumMap,
  }),
  behaviors: z.record(Id, z.record(z.string(), z.union([Num, z.array(Num)]))),
  spawn: z.looseObject({
    ringTiles: z.tuple([Num, Num]),
    despawnTiles: Num,
    limitDay: Num,
    limitNight: Num,
    limitDayMobile: Num,
    limitNightMobile: Num,
    everySec: Num,
    nightEveryMul: Num,
    weights: NumMap,
    dayOnlyFamilies: z.array(z.string()),
  }),
  bloodNight: z.looseObject({
    waves: Num,
    waveSec: Num,
    baseCount: Num,
    perNight: Num,
    perBiome: Num,
    rewardContainer: Id,
  }),
  numbers: z.looseObject({ riseTiles: Num, sec: Num }),
});
export type CombatCfgDef = z.infer<typeof CombatCfgDef>;

// ---------- progression.json (создан на шаге 9) ----------
const NoteDef = z.looseObject({
  id: Id,
  title: z.string(),
  text: z.string(),
  biome: z.number().int().optional(),
  boss: z.string().optional(),
  at: z.string().optional(),
});
export type NoteDef = z.infer<typeof NoteDef>;
export const ProgressionDef = z.looseObject({
  xp: z.looseObject({
    perHarvestedResourceTier1: Num,
    craftPerTier: Num,
    poiFirstVisit: Num,
    newRecipe: Num,
    bossPerNumber: Num,
    poiRadiusTiles: Num,
  }),
  skillEffects: z.record(z.string(), z.record(z.string(), z.union([Num, z.array(Num)]))),
  bosses: z.looseObject({
    arenaRadiusTiles: Num,
    telegraphSec: z.tuple([Num, Num]),
    attackPauseSec: z.tuple([Num, Num]),
    checkpointRespawnTiles: Num,
    rewardDoubleMul: Num,
    reward: z.record(z.string(), z.record(Id, Num)),
  }),
  notes: z.array(NoteDef).min(1),
  daily: z.looseObject({
    count: Num,
    templates: z.array(z.looseObject({ type: z.string(), n: z.tuple([Num, Num]) })),
    pools: z.looseObject({}),
  }),
  tutorial: z.looseObject({
    steps: z.array(
      z.looseObject({ id: z.string(), event: z.string(), n: Num, items: z.array(z.string()).optional() }),
    ),
    firstNightSpawnMul: Num,
  }),
  vehicles: z.looseObject({
    baseSpeedTilesPerSec: Num,
    accelSec: Num,
    brakeSec: Num,
    offTerrainMul: Num,
    turnDegPerSec: Num,
    ramMinSpeed: Num,
    ramDamagePerSpeed: Num,
    ramIds: z.array(z.string()),
    collisionDamagePerSpeed: Num,
    repairPerHit: Num,
    callFuel: Num,
    enterRadiusTiles: Num,
    terrainOfTile: z.record(z.string(), z.array(z.string())),
  }),
  map: z.looseObject({ fogRevealTiles: Num, minimapRadiusTiles: Num }),
  audio: z.looseObject({ buses: z.record(z.string(), Num), stepEverySec: Num }),
});
export type ProgressionDef = z.infer<typeof ProgressionDef>;

/** Все файлы данных: имя файла без .json → схема. */
export const DATA_FILES = {
  items: z.array(ItemDef),
  stations: z.array(StationDef),
  recipes: z.array(RecipeDef),
  building: BuildingDef,
  defense: z.array(DefenseDef),
  enemies: z.array(EnemyDef),
  bosses: z.array(BossDef),
  biomes: BiomesFile,
  vehicles: z.array(VehicleDef),
  skills: SkillsDef,
  balance: BalanceDef,
  rigs: RigsDef,
  worldgen: WorldGenDef,
  survival: SurvivalDef,
  harvest: HarvestCfgDef,
  loot_tables: LootTablesDef,
  craft: CraftCfgDef,
  build_rules: BuildRulesDef,
  combat: CombatCfgDef,
  progression: ProgressionDef,
} as const;

export type DataFileName = keyof typeof DATA_FILES;
export const DATA_FILE_NAMES = Object.keys(DATA_FILES) as DataFileName[];
