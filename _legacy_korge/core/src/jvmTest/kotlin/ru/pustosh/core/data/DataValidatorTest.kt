package ru.pustosh.core.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Проверка на настоящих data/<файл>.json из пакета (только чтение). */
class DataValidatorTest {
    private val packageDir = File(System.getProperty("pustosh.package") ?: error("нет -Dpustosh.package"))
    private val data = GameDataLoader.parse { File(packageDir, "data/$it").readText() }

    private val manifest = Json.parseToJsonElement(File(packageDir, "assets_manifest.json").readText())
        .jsonObject["assets"]!!.jsonArray.map { it.jsonObject }
    private val known = manifest.filter { it["status"]!!.jsonPrimitive.content != "replaced" }.map { it["id"]!!.jsonPrimitive.content }.toSet()
    private val replaced = manifest.filter { it["status"]!!.jsonPrimitive.content == "replaced" }.map { it["id"]!!.jsonPrimitive.content }.toSet()

    private fun validate(d: GameData = data) = DataValidator(d, known, replaced).validate().also { println(it.format()) }

    @Test
    fun allFilesLoad() {
        assertEquals(149, data.items.size)
        assertEquals(149, data.recipes.size)
        assertEquals(23, data.stations.size)
        assertEquals(6, data.bosses.size)
        assertEquals(6, data.biomes.biomes.size)
        assertEquals(20261027L, data.balance.world.seed)
        // Пути к картинкам переведены в id манифеста.
        assertEquals("icons.resources.log", data.items.first { it.id == "wood" }.icon.id)
    }

    /**
     * Ошибки в данных пакета, найденные валидатором и описанные в docs/DATA_ISSUES.md.
     * По ТЗ шага 2 данные не правятся молча — исправление за владельцем. После исправления строку удалить.
     */
    private val knownDataIssues = setOf(
        "recipes: повторяется id 'r_bandage'",
    )

    @Test
    fun currentDataHasNoNewErrors() {
        val report = validate()
        val unexpected = report.errors - knownDataIssues
        assertTrue(unexpected.isEmpty(), report.format())
    }

    @Test
    fun brokenRecipeIsReported() {
        val broken = data.copy(recipes = data.recipes.mapIndexed { i, r ->
            if (i == 0) r.copy(inputs = r.inputs + ("unobtainium" to 1), station = "nowhere") else r
        })
        val report = validate(broken)
        assertTrue(report.errors.any { "unobtainium" in it }, report.format())
        assertTrue(report.errors.any { "nowhere" in it }, report.format())
    }

    @Test
    fun craftCycleIsReported() {
        val a = data.recipes.first { it.station == "workbench_1" }
        val input = a.inputs.keys.first()
        // Добавляем рецепт на том же станке: из результата A обратно делается его же ингредиент.
        val back = a.copy(id = "test_back", output = input, inputs = mapOf(a.output to 1))
        val report = validate(data.copy(recipes = data.recipes + back))
        assertTrue(report.errors.any { "цикл крафта" in it }, report.format())
    }

    @Test
    fun replacedSpriteIsReported() {
        val oldId = replaced.first { it.startsWith("icons.") }
        val broken = data.copy(items = data.items.mapIndexed { i, it -> if (i == 0) it.copy(icon = AssetId(oldId)) else it })
        assertTrue(validate(broken).errors.any { "заменён" in it })
    }
}
