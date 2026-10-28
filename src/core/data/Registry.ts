import type {
  BalanceDef,
  BiomeDef,
  BiomesFile,
  BossDef,
  BuildingDef,
  DefenseDef,
  EnemyDef,
  FurnitureSalvageDef,
  ItemCategory,
  ItemDef,
  LootContainerDef,
  MaterialDef,
  PrefabDef,
  RecipeDef,
  RigsDef,
  SkillsDef,
  StationDef,
  VehicleDef,
  WorldObjectDef,
  WorldGenDef,
  SurvivalDef,
  HarvestCfgDef,
  LootTablesDef,
  CraftCfgDef,
  BuildRulesDef,
  CombatCfgDef,
  ProgressionDef,
} from './schemas';

/** Каталог по id, только чтение. */
export class Catalog<T extends { id: string }> {
  private readonly map: ReadonlyMap<string, T>;

  constructor(readonly all: readonly T[]) {
    this.map = new Map(all.map((x) => [x.id, x]));
  }

  get(id: string): T | undefined {
    return this.map.get(id);
  }

  has(id: string): boolean {
    return this.map.has(id);
  }

  /** То же, что get, но с понятной ошибкой, если id нет. */
  require(id: string): T {
    const v = this.map.get(id);
    if (!v) throw new Error(`Нет записи «${id}» в данных`);
    return v;
  }

  get size(): number {
    return this.all.length;
  }
}

function groupBy<T, K>(list: readonly T[], keys: (x: T) => readonly K[]): ReadonlyMap<K, readonly T[]> {
  const m = new Map<K, T[]>();
  for (const x of list) {
    for (const k of keys(x)) {
      const arr = m.get(k);
      if (arr) arr.push(x);
      else m.set(k, [x]);
    }
  }
  return m;
}

const EMPTY: readonly never[] = [];

export class ItemCatalog extends Catalog<ItemDef> {
  private readonly cats = groupBy(this.all, (i) => [i.category]);
  byCategory(cat: ItemCategory): readonly ItemDef[] {
    return this.cats.get(cat) ?? EMPTY;
  }
}

export class RecipeCatalog extends Catalog<RecipeDef> {
  private readonly st = groupBy(this.all, (r) => [r.station]);
  private readonly out = groupBy(this.all, (r) => [r.output]);
  byStation(stationId: string): readonly RecipeDef[] {
    return this.st.get(stationId) ?? EMPTY;
  }
  byOutput(itemId: string): readonly RecipeDef[] {
    return this.out.get(itemId) ?? EMPTY;
  }
}

export class EnemyCatalog extends Catalog<EnemyDef> {
  private readonly bio = groupBy(this.all, (e) => e.biomes);
  byBiome(biome: number): readonly EnemyDef[] {
    return this.bio.get(biome) ?? EMPTY;
  }
}

export class BossCatalog extends Catalog<BossDef> {
  byBiome(biome: number): BossDef | undefined {
    return this.all.find((b) => b.biome === biome);
  }
}

export class BiomeCatalog {
  private readonly map: ReadonlyMap<number, BiomeDef>;
  constructor(readonly all: readonly BiomeDef[]) {
    this.map = new Map(all.map((b) => [b.id, b]));
  }
  get(n: number): BiomeDef | undefined {
    return this.map.get(n);
  }
}

/** Объекты мира по биомам + общие контейнеры и мебель. */
export class ObjectCatalog {
  private readonly perBiome: ReadonlyMap<number, ReadonlyMap<string, WorldObjectDef>>;
  readonly containers: Catalog<LootContainerDef>;
  readonly furniture: Catalog<FurnitureSalvageDef>;

  constructor(file: BiomesFile) {
    this.perBiome = new Map(file.biomes.map((b) => [b.id, new Map(b.objects.map((o) => [o.id, o]))]));
    this.containers = new Catalog(file.common.loot_containers);
    this.furniture = new Catalog(file.common.furniture_salvage);
  }
  byBiome(biome: number): readonly WorldObjectDef[] {
    const m = this.perBiome.get(biome);
    return m ? [...m.values()] : EMPTY;
  }
  get(biome: number, id: string): WorldObjectDef | undefined {
    return this.perBiome.get(biome)?.get(id);
  }
}

export class BuildingCatalog {
  private readonly mats: Catalog<MaterialDef>;
  constructor(readonly def: BuildingDef) {
    this.mats = new Catalog(def.materials);
  }
  material(id: string): MaterialDef | undefined {
    return this.mats.get(id);
  }
  get materials(): readonly MaterialDef[] {
    return this.mats.all;
  }
}

export interface RegistrySource {
  items: ItemDef[];
  stations: StationDef[];
  recipes: RecipeDef[];
  building: BuildingDef;
  defense: DefenseDef[];
  enemies: EnemyDef[];
  bosses: BossDef[];
  biomes: BiomesFile;
  vehicles: VehicleDef[];
  skills: SkillsDef;
  balance: BalanceDef;
  rigs: RigsDef;
  worldgen: WorldGenDef;
  survival: SurvivalDef;
  harvest: HarvestCfgDef;
  loot_tables: LootTablesDef;
  craft: CraftCfgDef;
  build_rules: BuildRulesDef;
  combat: CombatCfgDef;
  progression: ProgressionDef;
  prefabs: Record<string, PrefabDef>;
}

/** Единая точка доступа к игровым данным. Только чтение. */
export class Registry {
  readonly items: ItemCatalog;
  readonly recipes: RecipeCatalog;
  readonly stations: Catalog<StationDef>;
  readonly enemies: EnemyCatalog;
  readonly bosses: BossCatalog;
  readonly biomes: BiomeCatalog;
  readonly objects: ObjectCatalog;
  readonly building: BuildingCatalog;
  readonly defense: Catalog<DefenseDef>;
  readonly vehicles: Catalog<VehicleDef>;
  readonly skills: SkillsDef;
  readonly balance: BalanceDef;
  readonly rigs: RigsDef;
  /** id общих объектов интерьера (biomes.json → common.interior). */
  readonly interior: readonly string[];
  readonly worldgen: WorldGenDef;
  readonly survival: SurvivalDef;
  readonly harvest: HarvestCfgDef;
  readonly loot: LootTablesDef;
  readonly craft: CraftCfgDef;
  readonly build: BuildRulesDef;
  readonly combat: CombatCfgDef;
  readonly prog: ProgressionDef;
  readonly prefabs: Readonly<Record<string, PrefabDef>>;

  constructor(src: RegistrySource) {
    this.items = new ItemCatalog([...src.items, ...placeableItems(src)]);
    this.recipes = new RecipeCatalog(src.recipes);
    this.stations = new Catalog(src.stations);
    this.enemies = new EnemyCatalog(src.enemies);
    this.bosses = new BossCatalog(src.bosses);
    this.biomes = new BiomeCatalog(src.biomes.biomes);
    this.objects = new ObjectCatalog(src.biomes);
    this.building = new BuildingCatalog(src.building);
    this.defense = new Catalog(src.defense);
    this.vehicles = new Catalog(src.vehicles);
    this.skills = src.skills;
    this.balance = src.balance;
    this.rigs = src.rigs;
    this.interior = src.biomes.common.interior;
    this.worldgen = src.worldgen;
    this.survival = src.survival;
    this.harvest = src.harvest;
    this.loot = src.loot_tables;
    this.craft = src.craft;
    this.build = src.build_rules;
    this.combat = src.combat;
    this.prog = src.progression;
    this.prefabs = src.prefabs;
  }
}

/**
 * Станки и защита — результат рецептов, но их нет в items.json: собираем предметы из stations.json
 * и defense.json (иконка — спрайт, стопка — craft.json → placeableStack). Тир станка — его tier.
 */
function placeableItems(src: RegistrySource): ItemDef[] {
  const known = new Set(src.items.map((i) => i.id));
  const out: ItemDef[] = [];
  for (const s of src.stations) {
    if (s.id === 'hands' || known.has(s.id)) continue;
    out.push({
      id: s.id,
      name_ru: s.name_ru,
      category: 'placeable',
      tier: Math.min(6, s.tier),
      icon: s.sprite,
      stack: src.craft.placeableStack,
    });
  }
  for (const v of src.vehicles) {
    if (known.has(v.id)) continue;
    out.push({
      id: v.id,
      name_ru: v.name_ru,
      category: 'vehicle',
      tier: Math.min(6, v.tier),
      icon: v.body,
      stack: 1,
    });
  }
  for (const d of src.defense) {
    if (known.has(d.id)) continue;
    out.push({
      id: d.id,
      name_ru: d.name_ru,
      category: 'defense',
      tier: 1,
      icon: d.sprite,
      stack: src.craft.placeableStack,
    });
  }
  return out;
}
