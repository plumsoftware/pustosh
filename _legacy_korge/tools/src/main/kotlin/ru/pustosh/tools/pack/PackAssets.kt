package ru.pustosh.tools.pack

import kotlinx.serialization.Serializable
import java.awt.image.BufferedImage
import java.io.File
import java.security.MessageDigest
import kotlin.system.exitProcess

/**
 * Пайплайн ассетов (TZ/STEP_02, 2.1): манифест → ресайз по targetPx (хранение 2x) → атласы по группам
 * + `asset_index.json`. Исходники в пакете только читаются.
 *
 * Запуск: `PackAssets <package_dir> <out_dir>` (из Gradle: `./gradlew packAssets`).
 * В `<out_dir>/res` — ресурсы игры (`asset_index.json`, `atlases/<имя>.png`); в `<out_dir>` — отчёт, регионы атласов, хеш.
 */
fun main(args: Array<String>) {
    if (args.size != 2) {
        System.err.println("usage: PackAssets <package_dir> <out_dir>")
        exitProcess(2)
    }
    AssetPacker(File(args[0]), File(args[1])).run()
}

/** Составные файлы из TZ/ASSETS.md §6: исходник остаётся, рядом появляются части. */
sealed interface SplitRule {
    val sourceId: String
    data class Horizontal(override val sourceId: String, val nearFrac: Double, val topId: String, val bottomId: String) : SplitRule
    data class Components(override val sourceId: String, val idPrefix: String, val expected: Int) : SplitRule
}

val SPLITS = listOf(
    SplitRule.Horizontal("characters.animals.toad_tongue_and_sac", 0.25, "characters.animals.toad_tongue", "characters.animals.toad_sac"),
    SplitRule.Components("characters.animals.scorpion_leg_lower", "characters.animals.scorpion_leg_lower_", expected = 2),
)

/** Отступ между спрайтами и повтор края: тайлы — 2 px повтора без отступа, остальное — 1 px повтора + 2 px отступа. */
private fun extrudeOf(group: String) = if (group == "tiles") 2 else 1
private fun paddingOf(group: String) = if (group == "tiles") 0 else 2

const val ATLAS_MAX = 2048

class AssetPacker(private val packageDir: File, private val outDir: File) {
    private class Sprite(
        val id: String,
        val group: String,
        val image: BufferedImage,
        val plan: SpritePlan,
        val source: String,
        val status: String,
        val derivedFrom: String? = null,
    )

    /** Что уходит в ресурсы игры: asset_index.json и atlases/<имя>.png. Остальное (хеш, отчёт, регионы) — рядом. */
    private val resDir = File(outDir, RES_DIR)
    private val report = StringBuilder()
    private val warnings = mutableListOf<String>()

    fun run() {
        val hash = inputsHash()
        val hashFile = File(outDir, ".pack_hash")
        if (hashFile.isFile && hashFile.readText() == hash && File(resDir, INDEX_FILE).isFile) {
            println("packAssets: входные данные не изменились (хеш совпал), пересборка не нужна")
            return
        }
        val started = System.nanoTime()
        outDir.deleteRecursively()
        File(resDir, ATLAS_DIR).mkdirs()
        File(outDir, REGIONS_DIR).mkdirs()

        val manifest = readManifest(packageDir)
        val byId = manifest.assets.associateBy { it.id }
        val sizing = Sizing(RigData(packageDir), byId)
        val used = manifest.assets.filter { it.status != "replaced" }
        println("packAssets: ${manifest.assets.size} в манифесте, ${manifest.assets.size - used.size} replaced пропущено")

        val defringed = mutableListOf<Pair<String, Int>>()
        val sprites = mutableListOf<Sprite>()
        for (e in used) {
            val img = readArgb(File(packageDir, e.path))
            val fixed = defringe(img, keyColorOf(e.folder))
            if (fixed > 0) defringed += e.id to fixed
            val plan = sizing.plan(e, Size2(img.width.toDouble(), img.height.toDouble()))
            val group = groupOf(sizing.replacedOriginal(e)?.folder ?: e.folder, e.name)
            sprites += Sprite(e.id, group, resize(img, plan.storeW, plan.storeH), plan, e.path, e.status)
            for (rule in SPLITS.filter { it.sourceId == e.id }) sprites += split(rule, img, plan, group, e)
        }

        val pages = packGroups(sprites)
        writeIndex(sprites, pages)
        writeReport(sprites, pages, defringed, (System.nanoTime() - started) / 1_000_000)
        hashFile.writeText(hash)
        warnings.forEach { println("packAssets: ВНИМАНИЕ: $it") }
        println("packAssets: ${sprites.size} спрайтов, ${pages.size} атласов → $outDir")
    }

    private fun split(rule: SplitRule, img: BufferedImage, plan: SpritePlan, group: String, e: ManifestEntry): List<Sprite> {
        // Части сохраняют масштаб исходника: логический размер = размер части × (логический/исходный).
        val scale = plan.logical.w / img.width
        val pieces: List<Pair<String, BufferedImage>> = when (rule) {
            is SplitRule.Horizontal -> splitHorizontal(img, rule.nearFrac).let { (t, b) -> listOf(rule.topId to t, rule.bottomId to b) }
            is SplitRule.Components -> splitComponents(img).also {
                if (it.size != rule.expected) warnings += "${rule.sourceId}: ожидалось ${rule.expected} частей, найдено ${it.size}"
            }.mapIndexed { i, piece -> "${rule.idPrefix}${i + 1}" to piece }
        }
        return pieces.map { (id, piece) ->
            val logical = Size2(piece.width * scale, piece.height * scale)
            Sprite(id, group, piece, SpritePlan(logical, piece.width, piece.height, plan.pivot, exact = false), e.path, e.status, derivedFrom = e.id)
        }
    }

    private data class Page(val name: String, val group: String, val width: Int, val height: Int, val bytes: Long, val placements: Map<String, Rect>)

    private fun packGroups(sprites: List<Sprite>): List<Page> {
        val pages = mutableListOf<Page>()
        for ((group, list) in sprites.groupBy { it.group }.toSortedMap()) {
            val ext = extrudeOf(group)
            val pad = paddingOf(group)
            val items = list.map { PackItem(it.id, it.image.width + 2 * ext + pad, it.image.height + 2 * ext + pad) }
            val byId = list.associateBy { it.id }
            packPages(items, ATLAS_MAX).forEachIndexed { index, packed ->
                val name = "${group}_$index"
                val atlas = BufferedImage(packed.width, packed.height, BufferedImage.TYPE_INT_ARGB)
                val regions = LinkedHashMap<String, Rect>()
                for ((id, cell) in packed.placements) {
                    val s = byId.getValue(id)
                    blitExtruded(atlas, s.image, cell.x + ext, cell.y + ext, ext)
                    regions[id] = Rect(cell.x + ext, cell.y + ext, s.image.width, s.image.height)
                }
                val file = File(resDir, "$ATLAS_DIR/$name.png")
                writePngCompact(atlas, file)
                File(outDir, "$REGIONS_DIR/$name.json").writeText(
                    json.encodeToString(AtlasRegionsJson.serializer(), AtlasRegionsJson("$name.png", listOf(packed.width, packed.height),
                        regions.mapValues { (_, r) -> listOf(r.x, r.y, r.w, r.h) })),
                )
                pages += Page(name, group, packed.width, packed.height, file.length(), regions)
            }
        }
        return pages
    }

    private fun writeIndex(sprites: List<Sprite>, pages: List<Page>) {
        val pageOf = pages.flatMap { p -> p.placements.map { (id, r) -> id to (p to r) } }.toMap()
        val index = AssetIndexJson(
            version = 1,
            storeScale = STORE_SCALE,
            groups = pages.groupBy { it.group }.mapValues { (g, ps) -> GroupJson(loadPhaseOf(g).key, ps.map { it.name }) },
            atlases = pages.associate { it.name to AtlasJson("$ATLAS_DIR/${it.name}.png", it.group, listOf(it.width, it.height), it.bytes) },
            assets = sprites.sortedBy { it.id }.associate { s ->
                val (page, r) = pageOf.getValue(s.id)
                s.id to AssetJson(
                    atlas = page.name,
                    region = listOf(r.x, r.y, r.w, r.h),
                    pivot = listOf(s.plan.pivot.first, s.plan.pivot.second),
                    logicalSize = listOf(round2(s.plan.logical.w), round2(s.plan.logical.h)),
                    source = s.source,
                    status = s.status.takeIf { it != "ok" },
                    derivedFrom = s.derivedFrom,
                )
            },
        )
        File(resDir, INDEX_FILE).writeText(json.encodeToString(AssetIndexJson.serializer(), index))
    }

    private fun writeReport(sprites: List<Sprite>, pages: List<Page>, defringed: List<Pair<String, Int>>, ms: Long) {
        fun kb(b: Long) = "%.0f КБ".format(b / 1024.0)
        val indexBytes = File(resDir, INDEX_FILE).length()
        report.appendLine("# Отчёт упаковки ассетов").appendLine()
        report.appendLine("Спрайтов: ${sprites.size}, атласов: ${pages.size}, время: $ms мс.").appendLine()
        report.appendLine("| Группа | Загрузка | Атласы | Спрайтов | Размер PNG |").appendLine("| --- | --- | --- | --- | --- |")
        for ((group, ps) in pages.groupBy { it.group }.toSortedMap()) {
            val count = sprites.count { it.group == group }
            report.appendLine("| $group | ${loadPhaseOf(group).key} | ${ps.joinToString { "${it.width}×${it.height}" }} | $count | ${kb(ps.sumOf { it.bytes })} |")
        }
        report.appendLine()
        for (phase in LoadPhase.entries) {
            val bytes = pages.filter { loadPhaseOf(it.group) == phase }.sumOf { it.bytes }
            report.appendLine("- **${phase.key}**: ${kb(bytes)}")
        }
        val initial = pages.filter { loadPhaseOf(it.group) == LoadPhase.INITIAL }.sumOf { it.bytes } + indexBytes
        report.appendLine("- `asset_index.json`: ${kb(indexBytes)}")
        report.appendLine().appendLine("**Первая загрузка (атласы initial + asset_index.json): ${kb(initial)}**").appendLine()

        val upscaled = sprites.filter { !it.plan.exact && it.derivedFrom == null && it.plan.storeW < it.plan.logical.w * STORE_SCALE - 1 }
            .groupingBy { it.group }.eachCount()
        report.appendLine("## Исходник меньше 2x").appendLine()
        report.appendLine("Хранятся в размере исходника (увеличение не добавит деталей), в игре масштабируются до логического размера:").appendLine()
        upscaled.toSortedMap().forEach { (g, n) -> report.appendLine("- $g: $n") }
        report.appendLine().appendLine("## Удаление каймы фона").appendLine()
        report.appendLine("Исправлено пикселей в ${defringed.size} спрайтах. Больше всего:").appendLine()
        defringed.sortedByDescending { it.second }.take(15).forEach { (id, n) -> report.appendLine("- `$id`: $n") }
        report.appendLine().appendLine("## Разрезанные составные файлы").appendLine()
        sprites.filter { it.derivedFrom != null }.forEach { report.appendLine("- `${it.derivedFrom}` → `${it.id}`") }
        if (warnings.isNotEmpty()) {
            report.appendLine().appendLine("## Предупреждения").appendLine()
            warnings.forEach { report.appendLine("- $it") }
        }
        File(outDir, REPORT_FILE).writeText(report.toString())
    }

    /** Хеш всех входов: манифест, нужные данные, все PNG и код самого инструмента. */
    private fun inputsHash(): String {
        val md = MessageDigest.getInstance("SHA-256")
        fun add(f: File) {
            md.update(f.path.toByteArray())
            md.update(f.readBytes())
        }
        add(File(packageDir, "assets_manifest.json"))
        listOf("rigs.json", "enemies.json", "bosses.json").forEach { add(File(packageDir, "data/$it")) }
        File(packageDir, "assets").walkTopDown().filter { it.isFile && it.extension == "png" }.sortedBy { it.path }.forEach(::add)
        val code = File(AssetPacker::class.java.protectionDomain.codeSource.location.toURI())
        code.walkTopDown().filter { it.isFile }.sortedBy { it.path }.forEach(::add)
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    private fun round2(v: Double) = Math.round(v * 100) / 100.0

    companion object {
        const val INDEX_FILE = "asset_index.json"
        const val REPORT_FILE = "asset_report.md"
        const val ATLAS_DIR = "atlases"
        const val RES_DIR = "res"
        const val REGIONS_DIR = "regions"
    }
}

@Serializable
data class AtlasRegionsJson(val image: String, val size: List<Int>, val regions: Map<String, List<Int>>)

@Serializable
data class AssetIndexJson(
    val version: Int,
    /** Во сколько раз атлас крупнее логических координат. */
    val storeScale: Int,
    val groups: Map<String, GroupJson>,
    val atlases: Map<String, AtlasJson>,
    val assets: Map<String, AssetJson>,
)

@Serializable
data class GroupJson(val load: String, val atlases: List<String>)

@Serializable
data class AtlasJson(val file: String, val group: String, val size: List<Int>, val bytes: Long)

@Serializable
data class AssetJson(
    val atlas: String,
    /** x, y, w, h в пикселях атласа. */
    val region: List<Int>,
    /** Точка привязки в долях размера: (0.5, 1.0) — низ-центр. */
    val pivot: List<Double>,
    /** Размер в игре в 1x-координатах (тайл = 64). */
    val logicalSize: List<Double>,
    val source: String,
    val status: String? = null,
    val derivedFrom: String? = null,
)
