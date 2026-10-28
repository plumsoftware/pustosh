package ru.pustosh.core.i18n

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import ru.pustosh.core.Log

/** Строки интерфейса из `strings_<язык>.json`. Неизвестный ключ возвращается как есть и пишется в лог. */
object Strings {
    private var table: Map<String, String> = emptyMap()

    fun load(json: String) {
        table = Json.parseToJsonElement(json).jsonObject.mapValues { it.value.jsonPrimitive.content }
    }

    fun get(key: String): String = table[key] ?: key.also { Log.w("Strings", "нет строки '$it'") }
}
