package ru.pustosh.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class GameClockTest {
    @Test
    fun ticksAtFixedStep() {
        val clock = GameClock()
        var calls = 0
        assertEquals(2, clock.advance(120.0) { calls++ })
        assertEquals(2, calls)
        assertEquals(2L, clock.ticks)
        assertEquals(0.4, clock.alpha, 1e-9)
        assertEquals(1, clock.advance(30.0))
        assertEquals(0.15, clock.gameTimeSec, 1e-9)
    }

    @Test
    fun pauseWithTwoReasonsLiftsOnlyAfterBoth() {
        val clock = GameClock()
        clock.pause(PauseReason.AD)
        clock.pause(PauseReason.TAB_HIDDEN)
        assertTrue(clock.isPaused)

        clock.resume(PauseReason.AD)
        assertTrue(clock.isPaused)
        assertEquals(setOf(PauseReason.TAB_HIDDEN), clock.pauseReasons)

        clock.resume(PauseReason.TAB_HIDDEN)
        assertFalse(clock.isPaused)
    }

    @Test
    fun noTicksWhilePaused() {
        val clock = GameClock()
        clock.pause(PauseReason.MENU)
        assertEquals(0, clock.advance(1000.0))
        assertEquals(0L, clock.ticks)
        assertEquals(0.0, clock.alpha)

        clock.resume(PauseReason.MENU)
        assertEquals(1, clock.advance(50.0))
    }

    @Test
    fun longFrameIsClamped() {
        val clock = GameClock()
        assertEquals((GameClock.MAX_FRAME_MS / GameClock.TICK_MS).toInt(), clock.advance(10_000.0))
    }

    @Test
    fun listenerFiresOnlyOnStateChange() {
        val clock = GameClock()
        val events = mutableListOf<Boolean>()
        clock.addPauseListener { events += it }
        clock.pause(PauseReason.AD)
        clock.pause(PauseReason.MENU)
        clock.resume(PauseReason.AD)
        clock.resume(PauseReason.MENU)
        clock.resume(PauseReason.MENU)
        assertEquals(listOf(true, false), events)
    }
}
