package ru.pustosh.core

/** Единый лог игры. В релизе [minLevel] = WARN (TZ/00_OVERVIEW.md §3, правило 8). */
object Log {
    enum class Level { DEBUG, INFO, WARN, ERROR }

    var minLevel: Level = Level.DEBUG

    /** Куда пишутся строки; по умолчанию println (в браузере — консоль, на Android — logcat через stdout). */
    var sink: (level: Level, tag: String, message: String) -> Unit = { level, tag, message ->
        println("[${level.name}] $tag: $message")
    }

    fun d(tag: String, message: String) = log(Level.DEBUG, tag, message)
    fun i(tag: String, message: String) = log(Level.INFO, tag, message)
    fun w(tag: String, message: String) = log(Level.WARN, tag, message)
    fun e(tag: String, message: String, error: Throwable? = null) =
        log(Level.ERROR, tag, if (error == null) message else "$message: $error")

    private fun log(level: Level, tag: String, message: String) {
        if (level >= minLevel) sink(level, tag, message)
    }
}
