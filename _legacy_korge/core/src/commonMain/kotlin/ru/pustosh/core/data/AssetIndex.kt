package ru.pustosh.core.data

import kotlinx.serialization.Serializable

/**
 * `asset_index.json` — результат `./gradlew packAssets` (модуль tools): где лежит каждый спрайт.
 * Атласы хранятся в [storeScale]x, игра рисует в 1x-координатах ([AssetEntry.logicalSize]).
 */
@Serializable
data class AssetIndex(
    val version: Int,
    val storeScale: Int,
    val groups: Map<String, AssetGroup>,
    val atlases: Map<String, AtlasEntry>,
    val assets: Map<String, AssetEntry>,
) {
    fun groupOf(assetId: String): String? = assets[assetId]?.let { atlases[it.atlas]?.group }

    companion object {
        const val FILE = "asset_index.json"

        fun parse(text: String): AssetIndex = GameDataLoader.json.decodeFromString(serializer(), text)
    }
}

@Serializable
data class AssetGroup(
    /** `initial` — первая загрузка, `background` — догрузка после старта, `lazy` — по требованию (биомы 2–6, боссы). */
    val load: String,
    val atlases: List<String>,
)

@Serializable
data class AtlasEntry(val file: String, val group: String, val size: List<Int>, val bytes: Long)

@Serializable
data class AssetEntry(
    val atlas: String,
    /** x, y, w, h в пикселях атласа. */
    val region: List<Int>,
    /** Точка привязки в долях размера: (0.5, 1.0) — низ-центр. */
    val pivot: List<Double>,
    /** Размер в игре в 1x (тайл = 64). */
    val logicalSize: List<Double>,
    val source: String,
    /** `alternative` у запасных спрайтов, иначе null. */
    val status: String? = null,
    /** Для частей составных файлов — id исходника. */
    val derivedFrom: String? = null,
)

object LoadPhase {
    const val INITIAL = "initial"
    const val BACKGROUND = "background"
    const val LAZY = "lazy"
}
