package ru.pustosh.game.assets

import korlibs.image.bitmap.Bitmap
import korlibs.image.bitmap.BmpSlice
import korlibs.image.bitmap.slice
import korlibs.image.format.readBitmap
import korlibs.io.file.std.resourcesVfs
import korlibs.math.geom.RectangleInt
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import ru.pustosh.core.Log
import ru.pustosh.core.data.AssetEntry
import ru.pustosh.core.data.AssetIndex

/** Спрайт, готовый к отрисовке: кусок атласа + размер в игре (1x) + точка привязки. */
class Sprite(
    val id: String,
    val slice: BmpSlice,
    val logicalWidth: Double,
    val logicalHeight: Double,
    val pivotX: Double,
    val pivotY: Double,
)

/**
 * Атласы по группам из `asset_index.json`. Группы `initial` грузятся на экране загрузки,
 * `background` — после старта, `lazy` (биомы 2–6, боссы) — по требованию через [ensureGroup].
 */
class AssetStore(val index: AssetIndex) {
    private val atlases = mutableMapOf<String, Bitmap>()
    private val loadedGroups = mutableSetOf<String>()
    private val sprites = mutableMapOf<String, Sprite>()
    private val mutex = Mutex()

    fun isLoaded(group: String) = group in loadedGroups

    fun groupsByPhase(phase: String): List<String> = index.groups.filterValues { it.load == phase }.keys.sorted()

    /** Загружает все атласы группы (один раз). */
    suspend fun ensureGroup(group: String) = mutex.withLock {
        if (group in loadedGroups) return@withLock
        val info = index.groups[group] ?: error("нет группы ассетов '$group'")
        for (name in info.atlases) {
            val atlas = index.atlases.getValue(name)
            atlases[name] = resourcesVfs[atlas.file].readBitmap()
        }
        loadedGroups += group
        Log.d(TAG, "группа '$group' загружена (${info.atlases.size} атл.)")
    }

    /** Спрайт по id; группа должна быть загружена. */
    operator fun get(id: String): Sprite = sprites.getOrPut(id) {
        val entry = index.assets[id] ?: error("нет спрайта '$id' в asset_index.json")
        val bitmap = atlases[entry.atlas] ?: error("атлас '${entry.atlas}' для '$id' не загружен (группа ${index.groupOf(id)})")
        entry.toSprite(id, bitmap)
    }

    fun getOrNull(id: String): Sprite? = index.assets[id]?.takeIf { atlases.containsKey(it.atlas) }?.let { get(id) }

    fun idsInGroup(group: String): List<String> {
        val names = index.groups[group]?.atlases?.toSet() ?: return emptyList()
        return index.assets.filterValues { it.atlas in names }.keys.sorted()
    }

    private fun AssetEntry.toSprite(id: String, bitmap: Bitmap): Sprite {
        val (x, y, w, h) = region
        return Sprite(id, bitmap.slice(RectangleInt(x, y, w, h)), logicalSize[0], logicalSize[1], pivot[0], pivot[1])
    }

    companion object {
        private const val TAG = "Assets"

        suspend fun load(): AssetStore = AssetStore(AssetIndex.parse(resourcesVfs[AssetIndex.FILE].readString()))
    }
}
