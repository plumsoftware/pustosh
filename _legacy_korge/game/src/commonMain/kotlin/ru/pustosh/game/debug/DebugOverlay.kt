package ru.pustosh.game.debug

import korlibs.event.Key
import korlibs.image.color.Colors
import korlibs.image.color.RGBA
import korlibs.korge.input.keys
import korlibs.korge.input.onDown
import korlibs.korge.view.Container
import korlibs.korge.view.addUpdater
import korlibs.korge.view.container
import korlibs.korge.view.position
import korlibs.korge.view.solidRect
import korlibs.korge.view.text
import kotlin.time.TimeSource
import ru.pustosh.game.Game

/**
 * Отладочный оверлей: FPS, тики, площадка, причины паузы, версия сборки.
 * Включается F1 на ПК или тройным тапом в левом верхнем углу на телефоне.
 */
class DebugOverlay(private val layer: Container, private val game: Game) {
    private var frames = 0
    private var fps = 0.0
    private var lastSample = TimeSource.Monotonic.markNow()
    private var tapCount = 0
    private var lastTap = TimeSource.Monotonic.markNow()

    fun install() {
        val panel = layer.container {
            visible = false
            position(8, 8)
        }
        panel.solidRect(560, 120, RGBA(0, 0, 0, 0xA0))
        val label = panel.text("", 18, Colors.YELLOW).position(10, 8)

        // Невидимая зона тройного тапа (для телефонов).
        layer.solidRect(TAP_ZONE, TAP_ZONE, Colors.TRANSPARENT).onDown {
            val now = TimeSource.Monotonic.markNow()
            tapCount = if ((now - lastTap).inWholeMilliseconds <= TAP_WINDOW_MS) tapCount + 1 else 1
            lastTap = now
            if (tapCount >= 3) {
                tapCount = 0
                panel.visible = !panel.visible
            }
        }
        layer.keys { down(Key.F1) { panel.visible = !panel.visible } }

        layer.addUpdater {
            frames++
            val elapsed = lastSample.elapsedNow().inWholeMilliseconds
            if (elapsed >= SAMPLE_MS) {
                fps = frames * 1000.0 / elapsed
                frames = 0
                lastSample = TimeSource.Monotonic.markNow()
                if (panel.visible) label.text = describe()
            }
        }
    }

    private fun describe(): String {
        val clock = game.clock
        val p = game.platform
        val reasons = clock.pauseReasons.ifEmpty { null }?.joinToString() ?: "нет"
        return buildString {
            appendLine("FPS ${fps.toInt()}   тики ${clock.ticks}   время ${clock.gameTimeSec.toInt()} c")
            appendLine("площадка ${p.id} · ${p.device} · ${p.language}${if (game.config.debug) " · debug" else ""}")
            appendLine("пауза: $reasons")
            append("сборка ${Game.BUILD_VERSION}")
        }
    }

    private companion object {
        const val SAMPLE_MS = 250
        const val TAP_ZONE = 96.0
        const val TAP_WINDOW_MS = 400
    }
}
