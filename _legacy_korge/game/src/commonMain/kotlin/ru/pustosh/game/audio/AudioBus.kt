package ru.pustosh.game.audio

/** Единая точка громкости. Любая пауза GameClock глушит звук (звуки появятся на шаге 9). */
object AudioBus {
    var muted: Boolean = false
}
