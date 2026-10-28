package ru.pustosh.game.scenes

import korlibs.image.color.RGBA
import korlibs.korge.scene.Scene
import korlibs.korge.view.SContainer
import kotlinx.coroutines.launch
import ru.pustosh.core.PauseReason
import ru.pustosh.core.Log
import ru.pustosh.core.i18n.Strings
import ru.pustosh.game.Game
import ru.pustosh.game.ui.centeredText
import ru.pustosh.game.ui.menuButton

class MainMenuScene(private val game: Game) : Scene() {
    private var starting = false

    override suspend fun SContainer.sceneMain() {
        Log.d("Scene", "MainMenu")
        game.clock.pause(PauseReason.MENU)
        val cx = Game.VIRTUAL_WIDTH / 2.0

        centeredText(Strings.get("ui.title"), 72, 180.0, RGBA(0xD9, 0xA4, 0x41))
        val hint = centeredText("", 22, 560.0)

        menuButton(Strings.get("ui.play"), cx, 320.0) { play() }
        menuButton(Strings.get("ui.settings"), cx, 400.0) { hint.text = Strings.get("ui.settings_stub") }
    }

    private fun play() {
        if (starting) return
        starting = true
        launch {
            game.ads.interstitial("menu_to_game")
            sceneContainer.changeTo { WorldScene(game) }
        }
    }
}
