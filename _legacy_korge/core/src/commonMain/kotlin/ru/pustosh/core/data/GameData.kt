package ru.pustosh.core.data

import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/** Все игровые данные из data/<файл>.json в типизированном виде. */
data class GameData(
    val items: List<ItemDef>,
    val recipes: List<RecipeDef>,
    val stations: List<StationDef>,
    val building: BuildingDef,
    val defense: List<DefenseDef>,
    val enemies: List<EnemyDef>,
    val bosses: List<BossDef>,
    val biomes: BiomesFile,
    val vehicles: List<VehicleDef>,
    val skills: SkillsDef,
    val balance: BalanceDef,
    val rigs: RigsDef,
)

class DataLoadException(val file: String, cause: Throwable) : Exception("data/$file: ${cause.message}", cause)

object GameDataLoader {
    /** Неизвестные поля игнорируются: данные можно расширять, не ломая старый код. */
    val json = Json { ignoreUnknownKeys = true }

    val FILES = listOf(
        "items.json", "recipes.json", "stations.json", "building.json", "defense.json", "enemies.json",
        "bosses.json", "biomes.json", "vehicles.json", "skills.json", "balance.json", "rigs.json",
    )

    /** [read] получает имя файла (`items.json`) и возвращает его текст. */
    suspend fun load(read: suspend (String) -> String): GameData {
        val texts = FILES.associateWith { read(it) }
        return parse { texts.getValue(it) }
    }

    fun parse(text: (String) -> String): GameData {
        fun <T> file(name: String, strategy: DeserializationStrategy<T>): T =
            try {
                json.decodeFromString(strategy, text(name))
            } catch (e: Exception) {
                throw DataLoadException(name, e)
            }
        return GameData(
            items = file("items.json", ListSerializer(ItemDef.serializer())),
            recipes = file("recipes.json", ListSerializer(RecipeDef.serializer())),
            stations = file("stations.json", ListSerializer(StationDef.serializer())),
            building = file("building.json", BuildingDef.serializer()),
            defense = file("defense.json", ListSerializer(DefenseDef.serializer())),
            enemies = file("enemies.json", ListSerializer(EnemyDef.serializer())),
            bosses = file("bosses.json", ListSerializer(BossDef.serializer())),
            biomes = file("biomes.json", BiomesFile.serializer()),
            vehicles = file("vehicles.json", ListSerializer(VehicleDef.serializer())),
            skills = file("skills.json", SkillsDef.serializer()),
            balance = file("balance.json", BalanceDef.serializer()),
            rigs = file("rigs.json", RigsDef.serializer()),
        )
    }
}

/** Все ссылки данных на картинки: (где используется, id спрайта). */
fun GameData.assetRefs(): List<Pair<String, AssetId>> = buildList {
    fun add(where: String, id: AssetId?) { if (id != null) add(where to id) }
    items.forEach { add("items/${it.id}.icon", it.icon); add("items/${it.id}.heroHead", it.heroHead); add("items/${it.id}.heroBackpack", it.heroBackpack) }
    stations.forEach { s -> add("stations/${s.id}.sprite", s.sprite); s.stateSprites?.forEach { (k, v) -> add("stations/${s.id}.stateSprites.$k", v) } }
    building.materials.forEach { m -> m.sprites.forEach { (k, v) -> add("building/${m.id}.sprites.$k", v) } }
    defense.forEach { d ->
        add("defense/${d.id}.sprite", d.sprite); add("defense/${d.id}.destroyedSprite", d.destroyedSprite)
        add("defense/${d.id}.effect.closedSprite", d.effect.closedSprite); add("defense/${d.id}.effect.postSprite", d.effect.postSprite)
        add("defense/${d.id}.effect.head", d.effect.head)
    }
    enemies.forEach { e ->
        e.parts.forEach { (k, v) -> add("enemies/${e.id}.parts.$k", v) }
        e.specialParts.forEach { (k, v) -> add("enemies/${e.id}.specialParts.$k", v) }
    }
    bosses.forEach { b -> b.sprites.forEach { (k, v) -> add("bosses/${b.id}.sprites.$k", v) }; add("bosses/${b.id}.trophy.icon", b.trophy.icon) }
    biomes.biomes.forEach { b ->
        b.objects.forEach { o -> add("biomes/${b.id}/${o.id}.sprite", o.sprite); add("biomes/${b.id}/${o.id}.afterHarvest", o.afterHarvest) }
        b.tiles.forEach { add("biomes/${b.id}.tiles", AssetId("tiles.$it")) }
    }
    biomes.common.lootContainers.forEach { add("loot/${it.id}.sprite", it.sprite); add("loot/${it.id}.openedSprite", it.openedSprite) }
    biomes.common.furnitureSalvage.forEach { add("furniture/${it.id}.sprite", it.sprite) }
    vehicles.forEach { v ->
        add("vehicles/${v.id}.body", v.body); add("vehicles/${v.id}.wheel", v.wheel); add("vehicles/${v.id}.track", v.track)
        v.mods?.forEach { (k, s) -> add("vehicles/${v.id}.mods.$k", s) }
    }
}
