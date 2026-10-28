package ru.pustosh.game.scenes

import korlibs.korge.scene.Scene
import korlibs.korge.view.SContainer
import ru.pustosh.core.Log
import ru.pustosh.core.i18n.Strings
import ru.pustosh.game.Game
import ru.pustosh.game.ui.centeredText
import ru.pustosh.game.ui.dimBackground
import ru.pustosh.game.ui.menuButton

/** Пауза поверх мира (слой оверлей-сцен). Открывается Esc или кнопкой «Пауза». */
class PauseScene(private val game: Game) : Scene() {
    override suspend fun SContainer.sceneMain() {
        Log.d("Scene", "Pause")
        val cx = Game.VIRTUAL_WIDTH / 2.0
        dimBackground()
        centeredText(Strings.get("ui.pause"), 56, 220.0)
        menuButton(Strings.get("ui.resume"), cx, 320.0) { game.closePause() }
        menuButton(Strings.get("ui.to_menu"), cx, 400.0) { game.exitToMenu() }
    }
}

/** Пустая сцена: оверлей-слой без содержимого. */
class EmptyScene : Scene()
