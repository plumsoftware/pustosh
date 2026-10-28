package ru.pustosh.game.debug

import korlibs.event.Key
import korlibs.image.color.Colors
import korlibs.image.color.RGBA
import korlibs.image.text.TextAlignment
import korlibs.korge.input.keys
import korlibs.korge.input.onClick
import korlibs.korge.input.onMouseDrag
import korlibs.korge.input.onScroll
import korlibs.korge.scene.Scene
import korlibs.korge.ui.UIButton
import korlibs.korge.ui.uiButton
import korlibs.korge.view.Container
import korlibs.korge.view.SContainer
import korlibs.korge.view.circle
import korlibs.korge.view.clipContainer
import korlibs.korge.view.container
import korlibs.korge.view.position
import korlibs.korge.view.solidRect
import korlibs.korge.view.text
import korlibs.math.geom.Size
import kotlinx.coroutines.launch
import ru.pustosh.core.Log
import ru.pustosh.core.PauseReason
import ru.pustosh.core.data.MaterialDef
import ru.pustosh.core.i18n.Strings
import ru.pustosh.game.Game
import ru.pustosh.game.assets.sprite
import ru.pustosh.game.scenes.MainMenuScene
import kotlin.math.max

/**
 * Отладочная галерея ассетов (TZ/STEP_02, 2.3): вкладки по группам атласов, спрайты в логическом размере
 * с подписью id и точкой привязки, переключение фона, отдельные вкладки «Тайлы 4×4» и «Стены: комнаты».
 */
class AssetGalleryScene(private val game: Game) : Scene() {
    private enum class Background(val key: String) { GRASS("gallery.bg.grass"), LIGHT("gallery.bg.light"), DARK("gallery.bg.dark"), CHECKER("gallery.bg.checker") }

    private sealed interface Tab {
        val title: String
        data class Group(val group: String) : Tab { override val title get() = group }
        data object TilesRepeat : Tab { override val title get() = Strings.get("gallery.tab.tiles_repeat") }
        data object Rooms : Tab { override val title get() = Strings.get("gallery.tab.rooms") }
    }

    private lateinit var bgLayer: Container
    private lateinit var content: Container
    private lateinit var bgButton: UIButton
    private var background = Background.GRASS
    private var tab: Tab = Tab.Group("icons")
    private var scrollY = 0.0
    private var contentHeight = 0.0
    private val tabButtons = mutableMapOf<Tab, UIButton>()

    override suspend fun SContainer.sceneMain() {
        Log.d("Scene", "AssetGallery")
        game.clock.pause(PauseReason.MENU)
        val assets = game.assets

        bgLayer = container().position(0.0, VIEW_TOP)
        val clip = clipContainer(Size(Game.VIRTUAL_WIDTH.toDouble(), VIEW_HEIGHT)).position(0.0, VIEW_TOP)
        content = clip.container()
        clip.solidRect(Game.VIRTUAL_WIDTH.toDouble(), VIEW_HEIGHT, Colors.TRANSPARENT).apply {
            onScroll { scrollBy(it.scrollDeltaYPixels.toDouble()) }
            onMouseDrag { info -> if (!info.start) scrollBy(-info.deltaDy) }
        }
        clip.addChildAt(clip.children.last(), 0) // зона прокрутки — под содержимым

        // Шапка: вкладки в две строки + фон + назад.
        solidRect(Game.VIRTUAL_WIDTH.toDouble(), VIEW_TOP, RGBA(0x18, 0x18, 0x18))
        val tabs: List<Tab> = assets.index.groups.keys.sorted().map { Tab.Group(it) } + Tab.TilesRepeat + Tab.Rooms
        tabs.forEachIndexed { i, t ->
            val col = i % TABS_PER_ROW
            val row = i / TABS_PER_ROW
            tabButtons[t] = uiButton(t.title, Size(TAB_W, TAB_H)) {
                textSize = 15.0
                position(8.0 + col * (TAB_W + 4), 6.0 + row * (TAB_H + 4))
                onClick { select(t) }
            }
        }
        bgButton = uiButton("", Size(170.0, TAB_H)) {
            textSize = 15.0
            position(Game.VIRTUAL_WIDTH - 8.0 - 170.0, 6.0)
            onClick { background = Background.entries[(background.ordinal + 1) % Background.entries.size]; drawBackground() }
        }
        uiButton(Strings.get("ui.back"), Size(170.0, TAB_H)) {
            textSize = 15.0
            position(Game.VIRTUAL_WIDTH - 8.0 - 170.0, 6.0 + TAB_H + 4)
            onClick { close() }
        }
        keys {
            down(Key.ESCAPE) { close() }
            down(Key.UP) { scrollBy(-120.0) }
            down(Key.DOWN) { scrollBy(120.0) }
        }

        drawBackground()
        select(tab)
    }

    private fun close() {
        launch {
            sceneContainer.changeTo { MainMenuScene(game) }
        }
    }

    private fun select(t: Tab) {
        tab = t
        tabButtons.forEach { (k, b) -> b.bgColorOut = if (k == t) RGBA(0xD9, 0xA4, 0x41) else RGBA(0x1B, 0x76, 0xD2) }
        launch {
            content.removeChildren()
            scrollY = 0.0
            content.y = 0.0
            val needed = when (t) {
                is Tab.Group -> listOf(t.group)
                Tab.TilesRepeat -> listOf("tiles")
                Tab.Rooms -> listOf("walls")
            } + "hero"
            if (needed.any { !game.assets.isLoaded(it) }) {
                content.text(Strings.get("gallery.loading"), 24, Colors.WHITE).position(16, 16)
                needed.forEach { game.assets.ensureGroup(it) }
                if (tab != t) return@launch
                content.removeChildren()
            }
            contentHeight = when (t) {
                is Tab.Group -> drawGroup(t.group)
                Tab.TilesRepeat -> drawTilesRepeat()
                Tab.Rooms -> drawRooms()
            }
        }
    }

    private fun scrollBy(dy: Double) {
        scrollY = (scrollY + dy).coerceIn(0.0, max(0.0, contentHeight - VIEW_HEIGHT + 24))
        content.y = -scrollY
    }

    // ------------------------------------------------------------ фон

    private fun drawBackground() {
        bgButton.text = "${Strings.get("gallery.bg")}: ${Strings.get(background.key)}"
        bgLayer.removeChildren()
        val w = Game.VIRTUAL_WIDTH.toDouble()
        when (background) {
            Background.LIGHT -> bgLayer.solidRect(w, VIEW_HEIGHT, RGBA(0xDD, 0xDD, 0xDD))
            Background.DARK -> bgLayer.solidRect(w, VIEW_HEIGHT, RGBA(0x16, 0x16, 0x16))
            Background.CHECKER -> {
                val cell = 16.0
                for (y in 0 until (VIEW_HEIGHT / cell).toInt() + 1) for (x in 0 until (w / cell).toInt()) {
                    val c = if ((x + y) % 2 == 0) RGBA(0x99, 0x99, 0x99) else RGBA(0x66, 0x66, 0x66)
                    bgLayer.solidRect(cell, cell, c).position(x * cell, y * cell)
                }
            }
            Background.GRASS -> {
                val grass = game.assets["tiles.grass"]
                for (y in 0 until (VIEW_HEIGHT / TILE).toInt() + 1) for (x in 0 until (w / TILE).toInt()) {
                    bgLayer.sprite(grass).position(x * TILE, y * TILE)
                }
            }
        }
    }

    // ------------------------------------------------------------ вкладка группы

    /** Сетка спрайтов: ячейка вмещает спрайт в логическом размере, подпись снизу, красная точка — pivot. */
    private fun drawGroup(group: String): Double {
        val ids = game.assets.idsInGroup(group)
        val withReference = group.startsWith("biome") || group in setOf("interior_defense", "vehicles", "walls", "animals", "enemies", "bosses")
        val cells = (if (withReference) listOf(HERO_REF) else emptyList()) + ids
        var x = PAD
        var y = PAD
        var rowH = 0.0
        val maxX = Game.VIRTUAL_WIDTH - PAD
        for (id in cells) {
            val s = game.assets[id]
            val cellW = max(s.logicalWidth, MIN_CELL) + 8
            val cellH = s.logicalHeight + LABEL_H + 8
            if (x + cellW > maxX && x > PAD) { x = PAD; y += rowH + 8; rowH = 0.0 }
            val cell = content.container().position(x, y)
            cell.solidRect(cellW, cellH, RGBA(0, 0, 0, 0x30))
            val left = (cellW - s.logicalWidth) / 2
            cell.sprite(s).position(left + s.pivotX * s.logicalWidth, 4 + s.pivotY * s.logicalHeight)
            cell.circle(2.5, Colors.RED).position(left + s.pivotX * s.logicalWidth - 2.5, 4 + s.pivotY * s.logicalHeight - 2.5)
            val label = if (id == HERO_REF) Strings.get("gallery.hero_ref") else id.substringAfterLast('.')
            cell.text(label, 11, Colors.WHITE, alignment = TextAlignment.TOP_CENTER).position(cellW / 2, s.logicalHeight + 8)
            cell.text("${s.logicalWidth.toInt()}×${s.logicalHeight.toInt()}", 9, Colors.LIGHTGRAY, alignment = TextAlignment.TOP_CENTER)
                .position(cellW / 2, s.logicalHeight + 21)
            x += cellW + 8
            rowH = max(rowH, cellH)
        }
        return y + rowH + PAD
    }

    // ------------------------------------------------------------ тайлы 4×4

    private fun drawTilesRepeat(): Double {
        val ids = game.assets.idsInGroup("tiles")
        val block = TILE * 4
        val perRow = ((Game.VIRTUAL_WIDTH - PAD) / (block + 24)).toInt()
        ids.forEachIndexed { i, id ->
            val bx = PAD + (i % perRow) * (block + 24)
            val by = PAD + (i / perRow) * (block + 30)
            val s = game.assets[id]
            for (ty in 0 until 4) for (tx in 0 until 4) content.sprite(s).position(bx + tx * TILE, by + ty * TILE)
            content.text(id.substringAfterLast('.'), 13, Colors.WHITE).position(bx, by + block + 4)
        }
        val rows = (ids.size + perRow - 1) / perRow
        return PAD + rows * (block + 30)
    }

    // ------------------------------------------------------------ комнаты из стен

    /**
     * Комната 4×3 клетки пола, обнесённая стенами, по правилам data/building.json → assembly_rules:
     * стена = top_cap в своей клетке + face под ней (64×48), если южнее не стена; дверь = door_opening + door поверх.
     */
    private fun drawRooms(): Double {
        val materials = game.registry.data.building.materials
        val roomW = ROOM_W + 2
        val roomH = ROOM_H + 2
        val blockW = roomW * TILE + 40
        val blockH = (roomH + 1) * TILE + 40
        val perRow = ((Game.VIRTUAL_WIDTH - PAD) / blockW).toInt().coerceAtLeast(1)
        materials.forEachIndexed { i, m ->
            val origin = content.container().position(PAD + (i % perRow) * blockW, PAD + 24 + (i / perRow) * blockH)
            origin.text(m.nameRu, 15, Colors.WHITE).position(0.0, -22.0)
            drawRoom(origin, m, roomW, roomH)
        }
        val rows = (materials.size + perRow - 1) / perRow
        return PAD + 24 + rows * blockH
    }

    private fun drawRoom(root: Container, m: MaterialDef, w: Int, h: Int) {
        fun sprite(piece: String) = game.assets[m.sprites.getValue(piece).id]
        fun isWall(x: Int, y: Int) = x in 0 until w && y in 0 until h && (x == 0 || y == 0 || x == w - 1 || y == h - 1)
        val doorX = w / 2
        val windowX = w / 2 - 1
        for (y in 1 until h - 1) for (x in 1 until w - 1) root.sprite(sprite("floor")).position(x * TILE, y * TILE)
        for (y in 0 until h) for (x in 0 until w) {
            if (!isWall(x, y)) continue
            root.sprite(sprite("top_cap")).position(x * TILE, y * TILE)
            if (isWall(x, y + 1)) continue
            val faceY = (y + 1) * TILE
            val isDoor = y == h - 1 && x == doorX
            val face = when {
                isDoor -> "door_opening"
                y == 0 && x == windowX -> "window"
                else -> "face"
            }
            root.sprite(sprite(face)).position(x * TILE, faceY)
            if (isDoor) root.sprite(sprite("door")).position(x * TILE + TILE / 2.0, faceY + FACE_H)
        }
    }

    private companion object {
        const val VIEW_TOP = 92.0
        val VIEW_HEIGHT = Game.VIRTUAL_HEIGHT - VIEW_TOP
        const val TABS_PER_ROW = 10
        const val TAB_W = 104.0
        const val TAB_H = 36.0
        const val PAD = 16.0
        const val MIN_CELL = 72.0
        const val LABEL_H = 30.0
        const val TILE = 64.0
        const val FACE_H = 48.0
        const val ROOM_W = 4
        const val ROOM_H = 3
        const val HERO_REF = "characters.hero.ref_idle"
    }
}
