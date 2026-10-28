package ru.pustosh.core.data

class ValidationReport(val errors: List<String>, val warnings: List<String>) {
    val ok: Boolean get() = errors.isEmpty()

    fun summary() = "${errors.size} ошибок, ${warnings.size} предупреждений"

    fun format(): String = buildString {
        appendLine("Проверка данных: ${summary()}")
        errors.forEach { appendLine("  ОШИБКА: $it") }
        warnings.forEach { appendLine("  внимание: $it") }
    }
}

/**
 * Проверка связности данных (TZ/STEP_02, 2.2.3). Данные не меняет — только сообщает.
 * @param knownAssets id спрайтов, которые есть в игре (`asset_index.json`; в тестах — манифест без `replaced`).
 * @param replacedAssets id спрайтов со статусом `replaced` — ссылка на них отдельная ошибка.
 */
class DataValidator(
    private val data: GameData,
    private val knownAssets: Set<String>,
    private val replacedAssets: Set<String> = emptySet(),
) {
    private val errors = mutableListOf<String>()
    private val warnings = mutableListOf<String>()
    private val reg = Registry(data)

    fun validate(): ValidationReport {
        errors.clear(); warnings.clear()
        checkUniqueIds()
        checkItemRefs()
        checkStations()
        checkSkills()
        checkAssets()
        checkBossesAndBiomes()
        checkHarvestTools()
        checkCraftCycles()
        return ValidationReport(errors.toList(), warnings.toList())
    }

    private fun err(msg: String) { errors += msg }
    private fun warn(msg: String) { warnings += msg }

    private fun checkUniqueIds() {
        fun dup(what: String, ids: List<String>) =
            ids.groupingBy { it }.eachCount().filterValues { it > 1 }.keys.forEach { err("$what: повторяется id '$it'") }
        dup("items", data.items.map { it.id })
        dup("recipes", data.recipes.map { it.id })
        dup("stations", data.stations.map { it.id })
        dup("defense", data.defense.map { it.id })
        dup("enemies", data.enemies.map { it.id })
        dup("bosses", data.bosses.map { it.id })
        dup("biomes", data.biomes.biomes.map { it.id.toString() })
        dup("vehicles", data.vehicles.map { it.id })
    }

    private fun item(where: String, id: String) {
        if (id !in reg.items) err("$where: нет предмета '$id'")
    }

    private fun items(where: String, ids: Map<String, *>) = ids.keys.forEach { item(where, it) }

    private fun drops(where: String, drops: Map<String, DropRange>) {
        items(where, drops)
        drops.forEach { (id, range) ->
            if (range.size != 2 || range[0] < 0 || range[0] > range[1]) err("$where: дроп '$id' должен быть [min, max], а не $range")
        }
    }

    private fun checkItemRefs() {
        data.recipes.forEach { r ->
            if (!reg.isCraftable(r.output)) err("recipes/${r.id}: результат '${r.output}' не предмет, не станок и не защита")
            items("recipes/${r.id}.inputs", r.inputs)
            if (r.count <= 0) err("recipes/${r.id}: count = ${r.count}")
        }
        data.enemies.forEach { drops("enemies/${it.id}.drops", it.drops) }
        data.biomes.biomes.forEach { b -> b.objects.forEach { o -> o.harvest?.let { drops("biomes/${b.id}/${o.id}.harvest", it.drops) } } }
        data.biomes.common.furnitureSalvage.forEach { drops("furniture/${it.id}.harvest", it.harvest.drops) }
        data.building.materials.forEach { items("building/${it.id}.cost", it.cost) }
        items("building.doorCost", data.building.doorCost)
        data.defense.forEach { d ->
            items("defense/${d.id}.cost", d.cost)
            d.effect.fuel?.let { item("defense/${d.id}.effect.fuel", it) }
            d.effect.ammo?.let { item("defense/${d.id}.effect.ammo", it) }
        }
        data.items.forEach { i -> i.ammo?.let { item("items/${i.id}.ammo", it) } }
        data.stations.forEach { s -> s.fuel?.let { item("stations/${s.id}.fuel", it) } }
        data.building.materials.forEach { m ->
            if (m.requires !in reg.items && m.requires !in reg.stations) err("building/${m.id}.requires: нет предмета или станка '${m.requires}'")
        }
    }

    private fun checkStations() {
        data.recipes.forEach { if (it.station !in reg.stations) err("recipes/${it.id}: нет станка '${it.station}'") }
        data.defense.forEach { if (it.station !in reg.stations) err("defense/${it.id}: нет станка '${it.station}'") }
        data.biomes.common.interior.forEach { if (it !in reg.stations) err("biomes.common.interior: нет станка '$it'") }
    }

    /** `requiresSkill` = `<ветка>_<очки>`: ветка существует, очков не больше, чем есть уровней во всей ветке. */
    private fun checkSkills() {
        fun check(where: String, ref: String?) {
            ref ?: return
            val branchId = ref.substringBeforeLast('_')
            val points = ref.substringAfterLast('_').toIntOrNull()
            val branch = reg.skillBranches[branchId]
            when {
                branch == null || points == null -> err("$where: requiresSkill '$ref' — нет такой ветки навыков")
                points !in 1..branch.skills.sumOf { it.levels } -> err("$where: requiresSkill '$ref' — в ветке нет столько очков")
            }
        }
        data.recipes.forEach { check("recipes/${it.id}", it.requiresSkill) }
        data.stations.forEach { check("stations/${it.id}", it.requiresSkill) }
    }

    private fun checkAssets() {
        for ((where, id) in data.assetRefs()) {
            when {
                id.id in replacedAssets -> err("$where: спрайт '$id' заменён (status replaced), нужна замена из assets/replacements")
                id.id !in knownAssets -> err("$where: нет спрайта '$id'")
            }
            KNOWN_DEFECTS[id.id]?.let { warn("$where: спрайт '$id' — $it") }
        }
    }

    private fun checkBossesAndBiomes() {
        data.bosses.forEach { b ->
            val trophy = reg.items[b.trophy.item]
            if (trophy == null) err("bosses/${b.id}: нет предмета-трофея '${b.trophy.item}'")
            else if (trophy.category != "trophy") warn("bosses/${b.id}: трофей '${trophy.id}' в категории '${trophy.category}'")
            if (b.biome !in reg.biomes) err("bosses/${b.id}: нет биома ${b.biome}")
        }
        data.biomes.biomes.forEach { b ->
            if (b.boss !in reg.bosses) err("biomes/${b.id}: нет босса '${b.boss}'")
            if (b.tiles.isEmpty()) err("biomes/${b.id}: нет тайлов")
            b.enemies.forEach { if (it !in reg.enemies) err("biomes/${b.id}: нет врага '$it'") }
        }
        data.enemies.forEach { e -> e.biomes.forEach { if (it !in reg.biomes) err("enemies/${e.id}: нет биома $it") } }
    }

    /** Инструмент добычи — тип инструмента у предметов или голые руки. */
    private fun checkHarvestTools() {
        val toolTypes = data.items.mapNotNull { it.toolType }.toSet() + "hands"
        val harvests = data.biomes.biomes.flatMap { b -> b.objects.mapNotNull { o -> o.harvest?.let { "biomes/${b.id}/${o.id}" to it } } } +
            data.biomes.common.furnitureSalvage.map { "furniture/${it.id}" to it.harvest }
        harvests.forEach { (where, h) ->
            if (h.tool !in toolTypes) {
                val asItem = reg.items[h.tool]
                if (asItem != null) warn("$where: инструмент '${h.tool}' — это предмет (toolType '${asItem.toolType}'), а не тип инструмента")
                else err("$where: нет инструмента '${h.tool}'")
            }
        }
    }

    /** Предмет не может быть нужен для собственного производства на том же станке (прямо или через цепочку). */
    private fun checkCraftCycles() {
        for ((station, recipes) in reg.recipesByStation) {
            val edges = recipes.flatMap { r -> r.inputs.keys.map { it to r.output } }.groupBy({ it.first }, { it.second })
            val state = mutableMapOf<String, Int>() // 1 — в обходе, 2 — проверен
            val path = ArrayDeque<String>()
            fun dfs(node: String): Boolean {
                state[node] = 1
                path.addLast(node)
                for (next in edges[node].orEmpty()) {
                    if (state[next] == 1) {
                        val cycle = path.dropWhile { it != next } + next
                        err("станок '$station': цикл крафта ${cycle.joinToString(" → ")}")
                        return true
                    }
                    if (state[next] == null && dfs(next)) return true
                }
                path.removeLast()
                state[node] = 2
                return false
            }
            for (node in edges.keys) if (state[node] == null && dfs(node)) break
        }
    }

    companion object {
        /** Дефекты спрайтов из TZ/ASSETS.md §6, которые нельзя использовать как есть. */
        val KNOWN_DEFECTS = mapOf(
            "characters.enemies.crawler_forearm_2" to "в файле стопа, а не рука (TZ/ASSETS.md §6) — не использовать",
        )
    }
}
