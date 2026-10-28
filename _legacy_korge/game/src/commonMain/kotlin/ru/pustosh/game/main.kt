package ru.pustosh.game

import korlibs.image.color.RGBA
import korlibs.korge.Korge
import korlibs.math.geom.Size

suspend fun main() = Korge(
    title = "Пустошь",
    windowSize = Size(Game.VIRTUAL_WIDTH, Game.VIRTUAL_HEIGHT),
    virtualSize = Size(Game.VIRTUAL_WIDTH, Game.VIRTUAL_HEIGHT),
    backgroundColor = RGBA(0x1E, 0x1E, 0x1E),
) {
    Game(this).start()
}
