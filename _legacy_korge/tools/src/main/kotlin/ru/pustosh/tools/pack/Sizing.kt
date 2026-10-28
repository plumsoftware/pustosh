package ru.pustosh.tools.pack

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.math.max
import kotlin.math.roundToInt

/** Множитель хранения: атласы в 2x, игра рисует в 1x-координатах. */
const val STORE_SCALE = 2

/** Размер тайла и лица стены в 1x (TZ/ASSETS.md §3). */
const val TILE_PX = 64
const val WALL_FACE_H = 48

data class Size2(val w: Double, val h: Double) {
    fun scaled(s: Double) = Size2(w * s, h * s)
}

/**
 * План для одного спрайта: логический размер в игре, размер хранения в атласе и точка привязки.
 * [exact] — растянуть ровно до [storeW]×[storeH] (тайлы, стены), иначе масштаб с сохранением пропорций.
 */
data class SpritePlan(
    val logical: Size2,
    val storeW: Int,
    val storeH: Int,
    val pivot: Pair<Double, Double>,
    val exact: Boolean,
)

fun pivotOf(name: String): Pair<Double, Double> = when (name) {
    "bottom_center" -> 0.5 to 1.0
    "center", "rig" -> 0.5 to 0.5
    "top_left" -> 0.0 to 0.0
    else -> error("неизвестный pivot '$name'")
}

/** Данные пакета, нужные для размеров персонажей: rigs.json, enemies.json, bosses.json. */
class RigData(private val packageDir: File) {
    private fun read(name: String) = json.parseToJsonElement(File(packageDir, "data/$name").readText())

    private val rigs = read("rigs.json").jsonObject
    val heroBodyHeight: Double = rigs.obj("humanoid")["bodyHeightPx"]!!.jsonPrimitive.double
    val humanoidFrac: Map<String, Double> = rigs.obj("humanoid").obj("partLengthFrac").doubles()
    val quadFrac: Map<String, Double> = rigs.obj("quadruped").obj("partLengthFrac").doubles()

    /** id врага/зверя → (рост в 1x, тип рига). */
    val enemies: Map<String, Pair<Double, String>> = read("enemies.json").jsonArray.associate {
        val o = it.jsonObject
        o.str("id") to (o["targetHeightPx"]!!.jsonPrimitive.int.toDouble() to o.str("rig"))
    }
    val bossHeights: Map<String, Double> = read("bosses.json").jsonArray.associate {
        val o = it.jsonObject
        o.str("id") to o["targetHeightPx"]!!.jsonPrimitive.int.toDouble()
    }

    private fun JsonObject.obj(k: String) = this[k]!!.jsonObject
    private fun JsonObject.str(k: String) = this[k]!!.jsonPrimitive.content
    private fun JsonObject.doubles() = mapValues { it.value.jsonPrimitive.double }
}

/**
 * Считает [SpritePlan] по режиму масштаба из манифеста.
 * Не увеличивает хранимую картинку выше исходника: деталей это не добавит, а место в атласе съест.
 * Исключения — тайлы и стены (`exact`/`special`): они обязаны совпасть с сеткой.
 */
class Sizing(private val rig: RigData, private val byId: Map<String, ManifestEntry>) {

    fun plan(e: ManifestEntry, src: Size2 = Size2(e.srcSize[0].toDouble(), e.srcSize[1].toDouble())): SpritePlan {
        val mode = effective(e)
        return when (mode.scaleMode) {
            "fit_box" -> uniform(src, mode.targetPx / max(src.w, src.h), pivotOf(mode.pivot))
            "height" -> uniform(src, mode.targetPx / src.h, pivotOf(mode.pivot))
            "width" -> uniform(src, mode.targetPx / src.w, pivotOf(mode.pivot))
            "exact" -> exact(Size2(mode.targetPx.toDouble(), mode.targetPx.toDouble()), pivotOf(mode.pivot))
            "special" -> wall(e, src)
            "rig" -> rigPlan(e, src)
            else -> error("${e.id}: неизвестный scaleMode '${mode.scaleMode}'")
        }
    }

    /** Замена (`see_item`) берёт режим, размер и pivot у спрайта, который заменяет. */
    data class Mode(val scaleMode: String, val targetPx: Double, val pivot: String)

    fun effective(e: ManifestEntry): Mode {
        if (e.scaleMode == "see_item") {
            val original = replacedOriginal(e) ?: error("${e.id}: замена без исходного спрайта")
            return effective(original)
        }
        // Трофеи боссов — иконки предметов.
        if (e.folder == "characters/bosses" && "_trophy_" in e.name) return Mode("fit_box", 64.0, "center")
        return Mode(e.scaleMode, e.targetPx.toDouble(), e.pivot)
    }

    fun replacedOriginal(e: ManifestEntry): ManifestEntry? =
        byId.values.firstOrNull { it.replacedBy == e.path }

    private fun uniform(src: Size2, scale: Double, pivot: Pair<Double, Double>): SpritePlan {
        val logical = src.scaled(scale)
        val storeScale = minOf(scale * STORE_SCALE, 1.0)
        return SpritePlan(logical, px(src.w * storeScale), px(src.h * storeScale), pivot, exact = false)
    }

    private fun exact(logical: Size2, pivot: Pair<Double, Double>) =
        SpritePlan(logical, px(logical.w * STORE_SCALE), px(logical.h * STORE_SCALE), pivot, exact = true)

    /**
     * Стены (data/building.json → assembly_rules): лицо 64×48, верх и пол 64×64 (в 1x).
     * Дверь рисуется поверх проёма — масштабируется теми же коэффициентами, что проём того же материала.
     * Забор и обломки стоят на клетке сами по себе — по ширине клетки, пропорционально.
     */
    private fun wall(e: ManifestEntry, src: Size2): SpritePlan {
        val material = e.name.substringBefore('_')
        val piece = e.name.substringAfter('_')
        val tl = 0.0 to 0.0
        return when (piece) {
            "top_cap", "floor" -> exact(Size2(TILE_PX.toDouble(), TILE_PX.toDouble()), tl)
            "face", "window", "window_boarded", "door_opening", "damage_overlay" ->
                exact(Size2(TILE_PX.toDouble(), WALL_FACE_H.toDouble()), tl)
            "door" -> {
                val opening = byId["building.walls.${material}_door_opening"] ?: error("нет проёма для ${e.id}")
                val sx = TILE_PX / opening.srcSize[0].toDouble()
                val sy = WALL_FACE_H / opening.srcSize[1].toDouble()
                val logical = Size2(src.w * sx, src.h * sy)
                SpritePlan(logical, px(logical.w * STORE_SCALE), px(logical.h * STORE_SCALE), 0.5 to 1.0, exact = true)
            }
            "fence", "rubble" -> uniform(src, TILE_PX / src.w, 0.5 to 1.0)
            else -> error("${e.id}: неизвестная деталь стены '$piece'")
        }
    }

    /**
     * Персонажи: части пакуются в исходном размере (масштаб применяет риг, TZ/STEP_02 2.1.2).
     * Логический размер — стартовое значение по data/rigs.json (scaleRule), донастройка — в редакторе рига (шаг 4).
     */
    private fun rigPlan(e: ManifestEntry, src: Size2): SpritePlan {
        val scale = rigScale(e.folder, e.name, src)
        return SpritePlan(src.scaled(scale), px(src.w), px(src.h), 0.5 to 0.5, exact = false)
    }

    fun rigScale(folder: String, name: String, src: Size2): Double = when (folder) {
        "characters/hero" -> humanoidPartScale(name, rig.heroBodyHeight, src) ?: run {
            // ref_idle/ref_walk — эталон роста героя.
            rig.heroBodyHeight / src.h
        }
        "characters/enemies", "characters/animals" -> {
            val (owner, part) = splitOwner(name, rig.enemies.keys)
            val (height, rigKind) = rig.enemies.getValue(owner)
            val idle = srcOf("$folder/${owner}_idle")
            val idleScale = height / idle.h
            when {
                part in WHOLE_BODY -> height / src.h
                rigKind == "quadruped" -> quadPartScale(part, idle.w * idleScale, src)
                // Ползун лежит: длина тела ≈ рост стоящего, отсчитываем части от ширины idle.
                rigKind == "crawler" -> humanoidPartScale(part, idle.w * idleScale, src) ?: idleScale
                else -> humanoidPartScale(part, height, src) ?: idleScale
            }
        }
        "characters/bosses" -> {
            val (owner, part) = splitOwner(name, rig.bossHeights.keys)
            val height = rig.bossHeights.getValue(owner)
            if (part in WHOLE_BODY) height / src.h
            else height / srcOf("characters/bosses/${owner}_idle").h // части нарисованы в масштабе тела
        }
        else -> error("риг для папки '$folder' не определён")
    }

    private fun humanoidPartScale(part: String, bodyHeight: Double, src: Size2): Double? {
        val key = when {
            part.startsWith("head_") || part == "head" -> "head"
            part.startsWith("forearm") -> "forearm"
            part == "shin_boot" -> "shin"
            part == "rags" -> "thigh"
            else -> part
        }
        val frac = rig.humanoidFrac[key] ?: HUMANOID_EXTRA_FRAC[key] ?: return null
        return frac * bodyHeight / max(src.w, src.h)
    }

    private fun quadPartScale(part: String, bodyLength: Double, src: Size2): Double {
        val (key, mul) = QUAD_ALIASES[part] ?: (part to 1.0)
        val frac = rig.quadFrac[key] ?: QUAD_EXTRA_FRAC[key] ?: DEFAULT_PART_FRAC
        return frac * mul * bodyLength / max(src.w, src.h)
    }

    private fun srcOf(folderAndName: String): Size2 {
        val e = byId[folderAndName.replace('/', '.')] ?: error("нет спрайта $folderAndName")
        return Size2(e.srcSize[0].toDouble(), e.srcSize[1].toDouble())
    }

    private fun px(v: Double) = max(1, v.roundToInt())

    companion object {
        val WHOLE_BODY = setOf("idle", "phase2", "ref_idle", "ref_walk", "run_pose", "ambush_pose")
        const val DEFAULT_PART_FRAC = 0.3
        val HUMANOID_EXTRA_FRAC = mapOf(
            "helmet" to 0.3, "throat_sac" to 0.2, "blisters" to 0.25, "shirt_flap" to 0.2, "coat_flap" to 0.3,
        )
        val QUAD_EXTRA_FRAC = mapOf("ears" to 0.2)
        /** Варианты зверей из rigs.json → quadruped.variants (у раптора передние лапы маленькие). */
        val QUAD_ALIASES = mapOf(
            "arm_upper" to ("front_upper" to 0.6), "arm_lower" to ("front_lower" to 0.6),
            "leg_upper" to ("back_upper" to 1.0), "leg_lower" to ("back_lower" to 1.0),
            "pincer_arm" to ("front_upper" to 1.0), "pincer_claw" to ("front_lower" to 1.0),
            "tail_stinger" to ("tail" to 1.0), "tongue_and_sac" to ("head" to 1.0),
            "tongue" to ("head" to 1.0), "sac" to ("head" to 1.0),
        )

        /** `snow_wolf_back_upper` → (`snow_wolf`, `back_upper`): самый длинный подходящий id владельца. */
        fun splitOwner(name: String, owners: Set<String>): Pair<String, String> {
            val owner = owners.filter { name.startsWith(it + "_") }.maxByOrNull { it.length }
                ?: error("не найден владелец для '$name'")
            return owner to name.removePrefix(owner + "_")
        }
    }
}
