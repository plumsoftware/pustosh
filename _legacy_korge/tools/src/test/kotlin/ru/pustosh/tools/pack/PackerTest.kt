package ru.pustosh.tools.pack

import java.io.File
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PackerTest {
    private val packageDir = File(System.getProperty("pustosh.package"))

    @Test
    fun pagesHaveNoOverlapsAndStayInBounds() {
        val rnd = Random(1)
        val items = List(400) { PackItem(it, rnd.nextInt(8, 300), rnd.nextInt(8, 300)) }
        val pages = packPages(items, 1024)
        assertEquals(items.size, pages.sumOf { it.placements.size })
        for (page in pages) {
            val rects = page.placements.values.toList()
            rects.forEach { assertTrue(it.x >= 0 && it.y >= 0 && it.right <= page.width && it.bottom <= page.height) }
            for (i in rects.indices) for (j in i + 1 until rects.size) assertFalse(rects[i].intersects(rects[j]), "${rects[i]} ∩ ${rects[j]}")
        }
    }

    @Test
    fun smallSetGetsSmallPage() {
        val pages = packPages(listOf(PackItem("a", 100, 100), PackItem("b", 100, 100)), 2048)
        assertEquals(1, pages.size)
        assertTrue(pages[0].width <= 256 && pages[0].height <= 256)
    }

    @Test
    fun compositeSpritesSplit() {
        val toad = readArgb(File(packageDir, "assets/characters/animals/toad_tongue_and_sac.png"))
        val (tongue, sac) = splitHorizontal(toad, 0.25)
        assertTrue(tongue.height < toad.height * 0.35, "язык — верхняя узкая полоса, получено ${tongue.height} из ${toad.height}")
        assertTrue(sac.height > toad.height * 0.5)

        val leg = readArgb(File(packageDir, "assets/characters/animals/scorpion_leg_lower.png"))
        assertEquals(2, splitComponents(leg).size)
    }

    @Test
    fun sizingRules() {
        val manifest = readManifest(packageDir)
        val byId = manifest.assets.associateBy { it.id }
        val sizing = Sizing(RigData(packageDir), byId)

        val icon = sizing.plan(byId.getValue("icons.tools.axe_scrap"))
        assertEquals(64.0, maxOf(icon.logical.w, icon.logical.h), 0.01)

        val tile = sizing.plan(byId.getValue("tiles.grass"))
        assertEquals(128, tile.storeW)
        assertEquals(128, tile.storeH)

        val face = sizing.plan(byId.getValue("building.walls.wood_face"))
        assertEquals(128 to 96, face.storeW to face.storeH)

        val hero = sizing.plan(byId.getValue("characters.hero.ref_idle"))
        assertEquals(96.0, hero.logical.h, 0.01)
        assertEquals(byId.getValue("characters.hero.ref_idle").srcSize[1], hero.storeH, "риг пакуется в исходном размере")

        val pine = sizing.plan(byId.getValue("world.biome1_suburb.pine"))
        assertEquals(192.0, pine.logical.h, 0.01)
        assertEquals(0.5 to 1.0, pine.pivot)

        // Замена берёт размер и pivot заменённого спрайта.
        val well = sizing.plan(byId.getValue("replacements.well"))
        assertEquals(byId.getValue("world.biome1_suburb.well_OLD").targetPx.toDouble(), well.logical.h, 0.01)
        assertEquals(0.5 to 1.0, well.pivot)
    }
}
