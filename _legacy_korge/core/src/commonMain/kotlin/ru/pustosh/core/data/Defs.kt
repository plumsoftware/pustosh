package ru.pustosh.core.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

// Модели data/<файл>.json (описание полей — Pustosh_GameDev_Package/data/README.md).
// Обязательные поля — без значений по умолчанию; необязательные (есть не у всех записей) — `= null`.
// Ключ, который присутствует всегда, но бывает null, — nullable без значения по умолчанию.

/** Количество «от и до» в дропах: `[min, max]`. */
typealias DropRange = List<Int>

// ---------------------------------------------------------------- items.json

@Serializable
data class ItemDef(
    val id: String,
    @SerialName("name_ru") val nameRu: String,
    val category: String,
    val tier: Int,
    val icon: AssetId,
    val stack: Int,
    val source: String? = null,
    val note: String? = null,
    val iconTint: String? = null,
    // инструменты
    val toolType: String? = null,
    val harvestTier: Int? = null,
    val durability: Int? = null,
    val staminaPerUse: Int? = null,
    val gatherMultiplier: Double? = null,
    val waterCapacity: Int? = null,
    // оружие
    val weaponKind: String? = null,
    val damage: Int? = null,
    val attacksPerSec: Double? = null,
    val rangeTiles: Double? = null,
    val ammo: String? = null,
    val special: String? = null,
    val modSlots: Int? = null,
    // еда и медицина
    val hunger: Int? = null,
    val thirst: Int? = null,
    val health: Int? = null,
    val poisonChance: Double? = null,
    val staminaRestore: Int? = null,
    val staminaRegenBuffSec: Int? = null,
    val effect: ItemEffect? = null,
    // одежда, рюкзаки, модификации
    val slot: String? = null,
    val armor: Int? = null,
    val coldRes: Int? = null,
    val heatRes: Int? = null,
    val radRes: Int? = null,
    val poisonRes: Int? = null,
    val beltSlots: Int? = null,
    val speedMul: Double? = null,
    val noiseMul: Double? = null,
    val heroHead: AssetId? = null,
    val heroBackpack: AssetId? = null,
    val extraSlots: Int? = null,
    val modTarget: String? = null,
)

@Serializable
data class ItemEffect(
    val health: Int? = null,
    val radiation: Int? = null,
    val staminaRestore: Int? = null,
    val regenSec: Int? = null,
    val durationSec: Int? = null,
    val damageTakenMul: Double? = null,
    val repairPercent: Int? = null,
    val stopsBleeding: Boolean? = null,
    val curesFracture: Boolean? = null,
    val curesInfection: Boolean? = null,
    val curesPoison: Boolean? = null,
    val speedMul: Double? = null,
    val rangeMul: Double? = null,
    val spreadMul: Double? = null,
    val noiseMul: Double? = null,
    val magazineMul: Double? = null,
    val lightRadiusTiles: Int? = null,
    val armorAdd: Int? = null,
    val coldResAdd: Int? = null,
    val addSpecial: String? = null,
)

// ---------------------------------------------------------------- recipes.json, stations.json

@Serializable
data class RecipeDef(
    val id: String,
    val output: String,
    val count: Int,
    val station: String,
    val inputs: Map<String, Int>,
    val timeSec: Int,
    /** `known` / `tutorial` / `blueprint_or_boss`. */
    val unlock: String,
    /** Ветка и число очков в ней: `engineer_2` = 2 очка в ветке «Инженер». */
    val requiresSkill: String?,
)

@Serializable
data class StationDef(
    val id: String,
    @SerialName("name_ru") val nameRu: String,
    val tier: Int,
    val sprite: AssetId,
    val crafts: String,
    val footprintTiles: List<Int>,
    val needsPower: Boolean,
    val stateSprites: Map<String, AssetId>? = null,
    val fx: String? = null,
    val requiresSkill: String? = null,
    val fuel: String? = null,
    val powerRadiusTiles: Int? = null,
    val radiusTiles: List<Int>? = null,
)

// ---------------------------------------------------------------- building.json, defense.json

@Serializable
data class BuildingDef(
    val gridTile: Int,
    val pieces: List<String>,
    @SerialName("assembly_rules") val assemblyRules: List<String>,
    val materials: List<MaterialDef>,
    val upgradeRule: String,
    val floorCostMul: Double,
    val windowCostMul: Double,
    val doorCost: Map<String, Int>,
)

@Serializable
data class MaterialDef(
    val id: String,
    @SerialName("name_ru") val nameRu: String,
    val level: Int,
    val hp: Int,
    val cost: Map<String, Int>,
    /** Инструмент или станок, нужный для постройки. */
    val requires: String,
    /** Деталь (`face`, `top_cap`, ...) → спрайт. */
    val sprites: Map<String, AssetId>,
)

@Serializable
data class DefenseDef(
    val id: String,
    @SerialName("name_ru") val nameRu: String,
    val sprite: AssetId,
    val hp: Int,
    val effect: DefenseEffect,
    val cost: Map<String, Int>,
    val station: String,
    val destroyedSprite: AssetId?,
)

@Serializable
data class DefenseEffect(
    val contactDamage: Int? = null,
    val damage: Int? = null,
    val explosionDamage: Int? = null,
    val slowMul: Double? = null,
    val bleed: Boolean? = null,
    val stun: Boolean? = null,
    val rootSec: Int? = null,
    val radiusTiles: Double? = null,
    val alertRadiusTiles: Int? = null,
    val needsPower: Boolean? = null,
    val blocksBullets: Boolean? = null,
    val visionBonusTiles: Int? = null,
    val lightConeTiles: Int? = null,
    val fireConeTiles: Int? = null,
    val rate: Double? = null,
    val rangeTiles: Int? = null,
    val fuel: String? = null,
    val ammo: String? = null,
    val closedSprite: AssetId? = null,
    val postSprite: AssetId? = null,
    val head: AssetId? = null,
    /** Описание вращающейся части словами (не картинка). */
    val spinPart: String? = null,
)

// ---------------------------------------------------------------- enemies.json, bosses.json

@Serializable
data class EnemyDef(
    val id: String,
    @SerialName("name_ru") val nameRu: String,
    /** `infected`, `mutant`, `reptile`, `animal` (мирные звери). */
    val family: String,
    val biomes: List<Int>,
    val hp: Int,
    val damage: Int,
    val speedTilesPerSec: Double,
    val behavior: String,
    val drops: Map<String, DropRange>,
    val specialParts: Map<String, AssetId>,
    val xp: Int,
    val targetHeightPx: Int,
    /** `humanoid`, `quadruped`, `crawler`. */
    val rig: String,
    val parts: Map<String, AssetId>,
    val elite: EliteDef,
)

@Serializable
data class EliteDef(
    val hpMul: Double,
    val dmgMul: Double,
    val scale: Double,
    val eyeColor: String,
    val dropMul: Double,
    val chance: Double,
)

@Serializable
data class BossDef(
    val id: String,
    @SerialName("name_ru") val nameRu: String,
    val biome: Int,
    val hp: Int,
    val targetHeightPx: Int,
    val sprites: Map<String, AssetId>,
    val phases: List<String>,
    val attacks: List<String>,
    val trophy: TrophyDef,
    val unlocks: List<String>,
    val arena: String,
    val telegraph: String,
)

@Serializable
data class TrophyDef(val item: String, val icon: AssetId)

// ---------------------------------------------------------------- biomes.json

@Serializable
data class BiomesFile(val biomes: List<BiomeDef>, val common: CommonObjectsDef)

@Serializable
data class BiomeDef(
    val id: Int,
    @SerialName("name_ru") val nameRu: String,
    val ring: String,
    val levels: List<Int>,
    /** Имена тайлов: `grass` → спрайт `tiles.grass`. */
    val tiles: List<String>,
    val enemies: List<String>,
    val boss: String,
    val gate: String,
    val objects: List<WorldObjectDef>,
    val hazards: List<String>? = null,
)

@Serializable
data class WorldObjectDef(
    val id: String,
    val sprite: AssetId,
    val kind: String,
    val harvest: HarvestDef? = null,
    val afterHarvest: AssetId? = null,
    val note: String? = null,
)

@Serializable
data class HarvestDef(
    /** Тип инструмента (`toolType` предмета) или `hands`. */
    val tool: String,
    val minTier: Int,
    val drops: Map<String, DropRange>,
    val hits: Int,
)

@Serializable
data class CommonObjectsDef(
    /** id станков, которые ставятся в интерьере. */
    val interior: List<String>,
    @SerialName("loot_containers") val lootContainers: List<LootContainerDef>,
    @SerialName("furniture_salvage") val furnitureSalvage: List<FurnitureDef>,
)

@Serializable
data class LootContainerDef(
    val id: String,
    val sprite: AssetId,
    /** null — у контейнера нет отдельного открытого спрайта. */
    val openedSprite: AssetId?,
    val slots: Int,
    /** Имя таблицы лута (сами таблицы — loot_tables.json, шаг 5). */
    val table: String,
)

@Serializable
data class FurnitureDef(val id: String, val sprite: AssetId, val harvest: HarvestDef)

// ---------------------------------------------------------------- vehicles.json, skills.json

@Serializable
data class VehicleDef(
    val id: String,
    @SerialName("name_ru") val nameRu: String,
    val tier: Int,
    val unlock: String,
    val body: AssetId,
    val wheel: AssetId?,
    val speedMul: Double,
    val trunkSlots: Int,
    val fuelPer100Tiles: Double,
    val hp: Int,
    val terrain: List<String>,
    val note: String,
    val track: AssetId? = null,
    val mods: Map<String, AssetId>? = null,
)

@Serializable
data class SkillsDef(
    val maxLevel: Int,
    val pointsPerLevel: Int,
    val xpCurve: String,
    val branches: List<SkillBranchDef>,
    val note: String? = null,
)

@Serializable
data class SkillBranchDef(
    val id: String,
    @SerialName("name_ru") val nameRu: String,
    val skills: List<SkillDef>,
)

@Serializable
data class SkillDef(
    val id: String,
    @SerialName("name_ru") val nameRu: String,
    val levels: Int,
    val perLevel: String,
)

// ---------------------------------------------------------------- balance.json

@Serializable
data class BalanceDef(
    val world: WorldBalance,
    val dayNight: DayNightBalance,
    val player: PlayerBalance,
    /** По площадкам: `yandex`, `rustore`. */
    val survival: Map<String, SurvivalBalance>,
    /** Реклама по площадкам; разбирается в [ru.pustosh.core.config.PlatformConfig] (есть ссылки `"as yandex"`). */
    val ads: JsonObject,
    val iap: List<String>,
    val iapRule: String,
)

@Serializable
data class WorldBalance(
    val seed: Long,
    val sizeTiles: List<Int>,
    val chunkTiles: Int,
    val tilePx: Int,
    val biomeRingsRadiusTiles: List<Int>,
    val lootRespawnGameDays: Int,
    val resourceRespawnGameDays: List<Int>,
)

@Serializable
data class DayNightBalance(
    val fullDaySec: Int,
    val daySec: Int,
    val nightSec: Int,
    val bloodNightEvery: Int,
    val nightEnemySpeedMul: Double,
    val nightSpawnMul: Double,
)

@Serializable
data class PlayerBalance(
    val hp: Int,
    val stamina: Int,
    val speedTilesPerSec: Double,
    val sprintMul: Double,
    val dodgeIFramesSec: Double,
    val dodgeStamina: Int,
    val inventorySlots: Int,
    val hotbarSlots: Int,
    val deathBackpackLifetimeSec: Int,
    val pickupRadiusTiles: Double,
    val highlightRadiusTiles: Double,
)

@Serializable
data class SurvivalBalance(val hungerPerMin: Double, val thirstPerMin: Double, val coldDmgPerSec: Double)

// ---------------------------------------------------------------- rigs.json

@Serializable
data class RigsDef(
    val humanoid: HumanoidRigDef,
    val quadruped: QuadrupedRigDef,
    val boss: BossRigDef,
    val usage: Map<String, String>,
)

@Serializable
data class HumanoidRigDef(
    val facing: String,
    val bodyHeightPx: Double,
    val partLengthFrac: Map<String, Double>,
    val scaleRule: String,
    val bones: List<BoneDef>,
    val attachUnits: String,
    val drawOrder: String,
    /** Описания анимаций (длительность + ключи словами) — для шага 4. */
    val animations: Map<String, JsonElement>,
    val fallbackMVP: String,
)

@Serializable
data class QuadrupedRigDef(
    val facing: String,
    val bodyLengthPx: Double,
    val partLengthFrac: Map<String, Double>,
    val bones: List<BoneDef>,
    val variants: Map<String, String>,
    val animations: Map<String, JsonElement>,
    val fallbackMVP: String,
)

@Serializable
data class BossRigDef(val note: String, val approach: List<String>)

@Serializable
data class BoneDef(
    val id: String,
    val parent: String?,
    /** Имя части (`torso`, `head`...), не путь. */
    val sprite: String? = null,
    val pivot: List<Double>? = null,
    val attach: List<Double>? = null,
    val z: Int? = null,
    val tint: String? = null,
    val optional: Boolean? = null,
    val note: String? = null,
)
