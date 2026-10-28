package ru.pustosh.game.ui

import korlibs.image.color.Colors
import korlibs.image.color.RGBA
import korlibs.image.text.TextAlignment
import korlibs.korge.input.onClick
import korlibs.korge.view.Container
import korlibs.korge.view.container
import korlibs.korge.view.position
import korlibs.korge.view.solidRect
import korlibs.korge.view.text
import kotlinx.coroutines.delay
import ru.pustosh.core.i18n.Strings
import ru.pustosh.game.Game
import ru.pustosh.platform.stub.StubAdPresenter

/** Модальное окно «РЕКЛАМА (заглушка)» поверх всего, перехватывает ввод на время показа. */
class AdStubOverlay(private val layer: Container) : StubAdPresenter {
    override suspend fun show(kind: String, placement: String, durationMs: Long) {
        val w = Game.VIRTUAL_WIDTH.toDouble()
        val h = Game.VIRTUAL_HEIGHT.toDouble()
        val box = layer.container {
            solidRect(w, h, RGBA(0, 0, 0, 0xE6)) { onClick { } }
            text(Strings.get("ui.ad_stub"), 48, Colors.WHITE, alignment = TextAlignment.MIDDLE_CENTER)
                .position(w / 2, h / 2 - 20)
            text("$kind · $placement", 22, Colors.LIGHTGRAY, alignment = TextAlignment.MIDDLE_CENTER)
                .position(w / 2, h / 2 + 30)
        }
        try {
            delay(durationMs)
        } finally {
            box.removeFromParent()
        }
    }
}
