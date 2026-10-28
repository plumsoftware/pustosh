package ru.pustosh.tools.pack

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File

/** Запись `assets_manifest.json`. */
@Serializable
data class ManifestEntry(
    val id: String,
    val path: String,
    val folder: String,
    val name: String,
    val sourceSheet: String,
    val srcSize: List<Int>,
    val status: String,
    val scaleMode: String,
    val targetPx: Int,
    val pivot: String,
    val replacedBy: String? = null,
)

@Serializable
data class Manifest(val assets: List<ManifestEntry>)

val json = Json { ignoreUnknownKeys = true; prettyPrint = true; prettyPrintIndent = " " }

fun readManifest(packageDir: File): Manifest =
    json.decodeFromString(Manifest.serializer(), File(packageDir, "assets_manifest.json").readText())

/** id ассета по пути из данных: `assets/icons/tools/axe.png` → `icons.tools.axe` (та же схема, что в манифесте). */
fun assetIdOfPath(path: String): String =
    path.removePrefix("assets/").removeSuffix(".png").replace('/', '.')

/**
 * Группа атласа по папке. Замены (`replacements`) попадают в группу заменённого спрайта,
 * трофеи боссов — в иконки (нужны в инвентаре без атласа боссов).
 */
fun groupOf(folder: String, name: String): String = when {
    folder == "ui" -> "ui"
    folder.startsWith("icons/") -> "icons"
    folder == "tiles" -> "tiles"
    folder == "building/walls" -> "walls"
    folder == "world/interior" || folder == "world/defense" -> "interior_defense"
    folder.startsWith("world/biome") -> "biome" + folder.removePrefix("world/biome").first()
    folder == "characters/hero" -> "hero"
    folder == "characters/enemies" -> "enemies"
    folder == "characters/animals" -> "animals"
    folder == "characters/bosses" -> if ("_trophy_" in name) "icons" else "bosses"
    folder == "vehicles" -> "vehicles"
    folder == "effects" -> "effects"
    else -> error("неизвестная папка ассетов '$folder'")
}

/** Порядок загрузки группы в игре (TZ/STEP_02, 2.1.4). */
enum class LoadPhase(val key: String) {
    /** Первая загрузка: UI, иконки, тайлы, биом 1, герой, враги, эффекты. */
    INITIAL("initial"),
    /** Нужны вскоре после старта (база, звери, транспорт) — догружаются в фоне. */
    BACKGROUND("background"),
    /** Биомы 2–6 и боссы — при подходе к биому. */
    LAZY("lazy"),
}

fun loadPhaseOf(group: String): LoadPhase = when (group) {
    "ui", "icons", "tiles", "biome1", "hero", "enemies", "effects" -> LoadPhase.INITIAL
    "walls", "interior_defense", "animals", "vehicles" -> LoadPhase.BACKGROUND
    else -> LoadPhase.LAZY
}
