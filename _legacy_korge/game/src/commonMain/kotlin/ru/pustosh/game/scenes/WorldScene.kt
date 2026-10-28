package ru.pustosh.game.scenes

import korlibs.event.Key
import korlibs.image.color.RGBA
import korlibs.korge.input.keys
import korlibs.korge.input.onClick
import korlibs.korge.scene.Scene
import korlibs.korge.ui.uiButton
import korlibs.korge.view.SContainer
import korlibs.korge.view.position
import korlibs.korge.view.solidRect
import korlibs.math.geom.Size
import ru.pustosh.core.PauseReason
import ru.pustosh.core.Log
import ru.pustosh.core.i18n.Strings
import ru.pustosh.game.Game
import ru.pustosh.game.ui.centeredText

/** Заглушка мира: серый фон и надпись. Мир из чанков — шаг 3. */
class WorldScene(private val game: Game) : Scene() {
    override suspend fun SContainer.sceneMain() {
        Log.d("Scene", "World")
        solidRect(Game.VIRTUAL_WIDTH.toDouble(), Game.VIRTUAL_HEIGHT.toDouble(), RGBA(0x55, 0x55, 0x55))
        centeredText(Strings.get("ui.world_stub"), 64, Game.VIRTUAL_HEIGHT / 2.0)

        // Кнопка паузы для телефона; на ПК — Esc.
        uiButton(Strings.get("ui.pause"), Size(PAUSE_W, 56)) {
            textSize = 24.0
            position(Game.VIRTUAL_WIDTH - PAUSE_W - 16, 16.0)
            onClick { game.openPause() }
        }
        keys { down(Key.ESCAPE) { game.togglePause() } }

        game.clock.resume(PauseReason.MENU)
        game.platform.onGameplayStart()
    }

    override suspend fun sceneBeforeLeaving() {
        game.platform.onGameplayStop()
    }

    private companion object {
        const val PAUSE_W = 160.0
    }
}
