package ru.pustosh.core.data

/** Единая точка доступа к данным: поиск по id и готовые выборки. */
class Registry(val data: GameData) {
    val items: Map<String, ItemDef> = data.items.associateBy { it.id }
    val recipes: Map<String, RecipeDef> = data.recipes.associateBy { it.id }
    val recipesByStation: Map<String, List<RecipeDef>> = data.recipes.groupBy { it.station }
    val recipesByOutput: Map<String, List<RecipeDef>> = data.recipes.groupBy { it.output }
    val stations: Map<String, StationDef> = data.stations.associateBy { it.id }
    val defense: Map<String, DefenseDef> = data.defense.associateBy { it.id }
    val materials: Map<String, MaterialDef> = data.building.materials.associateBy { it.id }
    val enemies: Map<String, EnemyDef> = data.enemies.associateBy { it.id }
    val bosses: Map<String, BossDef> = data.bosses.associateBy { it.id }
    val biomes: Map<Int, BiomeDef> = data.biomes.biomes.associateBy { it.id }
    val objectsByBiome: Map<Int, List<WorldObjectDef>> = data.biomes.biomes.associate { it.id to it.objects }
    val lootContainers: Map<String, LootContainerDef> = data.biomes.common.lootContainers.associateBy { it.id }
    val furniture: Map<String, FurnitureDef> = data.biomes.common.furnitureSalvage.associateBy { it.id }
    val vehicles: Map<String, VehicleDef> = data.vehicles.associateBy { it.id }
    val skillBranches: Map<String, SkillBranchDef> = data.skills.branches.associateBy { it.id }
    val enemiesByBiome: Map<Int, List<EnemyDef>> =
        data.enemies.flatMap { e -> e.biomes.map { it to e } }.groupBy({ it.first }, { it.second })

    /** Что может быть результатом рецепта: предмет, станок или защита. */
    fun isCraftable(id: String) = id in items || id in stations || id in defense

    val balance: BalanceDef get() = data.balance
}
