package ru.pustosh.core

/** Причины паузы. Игра идёт, только когда ни одна причина не активна (TZ/00_OVERVIEW.md §3, правило 6). */
enum class PauseReason { AD, MENU, TAB_HIDDEN, PLATFORM, DIALOG }

/**
 * Игровые часы с фиксированным шагом логики [TICK_MS].
 *
 * Рендер вызывает [advance] каждый кадр с реальной длительностью кадра; часы копят время
 * и вызывают `onTick` нужное число раз. Остаток накопителя отдаётся в [alpha] для интерполяции.
 * Пока набор причин паузы не пуст, время не копится и тики не идут.
 */
class GameClock {
    private val reasons = linkedSetOf<PauseReason>()
    private var accumulatorMs = 0.0
    private val listeners = mutableListOf<(paused: Boolean) -> Unit>()

    val pauseReasons: Set<PauseReason> get() = reasons.toSet()
    val isPaused: Boolean get() = reasons.isNotEmpty()

    /** Число выполненных тиков логики с начала игры. */
    var ticks: Long = 0L
        private set

    /** Игровое время в секундах (идёт только вне паузы). */
    val gameTimeSec: Double get() = ticks * TICK_MS / 1000.0

    /** Доля следующего тика, уже накопленная в кадре: 0..1, для интерполяции рендера. */
    val alpha: Double get() = accumulatorMs / TICK_MS

    fun pause(reason: PauseReason) {
        val wasPaused = isPaused
        if (reasons.add(reason)) Log.d(TAG, "pause $reason -> $reasons")
        if (!wasPaused && isPaused) notify(true)
    }

    fun resume(reason: PauseReason) {
        val wasPaused = isPaused
        if (reasons.remove(reason)) Log.d(TAG, "resume $reason -> $reasons")
        if (wasPaused && !isPaused) notify(false)
    }

    /** Подписка на смену состояния «пауза/игра» (например, чтобы глушить звук). */
    fun addPauseListener(listener: (paused: Boolean) -> Unit) {
        listeners += listener
    }

    /**
     * Продвигает часы на [frameMs] реального времени и выполняет накопившиеся тики.
     * Длинный кадр (подвисание, возврат из фона) обрезается до [MAX_FRAME_MS], чтобы логика не догоняла лавиной.
     * @return число выполненных тиков.
     */
    fun advance(frameMs: Double, onTick: () -> Unit = {}): Int {
        if (isPaused) return 0
        accumulatorMs += frameMs.coerceIn(0.0, MAX_FRAME_MS)
        var done = 0
        while (accumulatorMs >= TICK_MS) {
            accumulatorMs -= TICK_MS
            ticks++
            done++
            onTick()
        }
        return done
    }

    private fun notify(paused: Boolean) {
        for (listener in listeners.toList()) listener(paused)
    }

    companion object {
        /** Шаг логики: 20 тиков в секунду. */
        const val TICK_MS = 50.0
        const val MAX_FRAME_MS = 250.0
        private const val TAG = "GameClock"
    }
}
