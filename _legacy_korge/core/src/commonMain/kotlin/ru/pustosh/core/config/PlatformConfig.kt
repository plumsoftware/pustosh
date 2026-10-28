package ru.pustosh.core.config

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

enum class PlatformId { YANDEX, RUSTORE, DESKTOP }

data class AdsConfig(
    val interstitialMinIntervalSec: Int,
    val interstitialPoints: List<String>,
    val rewarded: List<String>,
)

data class SurvivalConfig(
    val hungerPerMin: Double,
    val thirstPerMin: Double,
    val coldDmgPerSec: Double,
)

/**
 * Настройки, которые отличаются по площадкам. Источник чисел — `data/balance.json`
 * (разделы `ads.<площадка>` и `survival.<площадка>`). Десктоп — отладочная сборка, берёт значения Яндекса.
 */
data class PlatformConfig(
    val platform: PlatformId,
    val ads: AdsConfig,
    val survival: SurvivalConfig,
    /** Сколько биомов открыто в MVP; дальше — ворота после босса 3. */
    val mvpBiomeLimit: Int = MVP_BIOME_LIMIT,
    val debug: Boolean,
) {
    companion object {
        const val MVP_BIOME_LIMIT = 3

        fun balanceKey(platform: PlatformId): String = when (platform) {
            PlatformId.YANDEX, PlatformId.DESKTOP -> "yandex"
            PlatformId.RUSTORE -> "rustore"
        }

        fun fromBalanceJson(balanceJson: String, platform: PlatformId, debug: Boolean): PlatformConfig {
            val root = Json.parseToJsonElement(balanceJson).jsonObject
            val ads = root.section("ads")
            val survival = root.section("survival")
            val key = balanceKey(platform)

            val adsCfg = ads.resolve(key).jsonObject
            val survivalCfg = survival.resolve(key).jsonObject
            return PlatformConfig(
                platform = platform,
                ads = AdsConfig(
                    interstitialMinIntervalSec = adsCfg.field("interstitialMinIntervalSec").jsonPrimitive.int,
                    interstitialPoints = ads.resolveField(key, "interstitialPoints").strings(),
                    rewarded = ads.resolveField(key, "rewarded").strings(),
                ),
                survival = SurvivalConfig(
                    hungerPerMin = survivalCfg.field("hungerPerMin").jsonPrimitive.double,
                    thirstPerMin = survivalCfg.field("thirstPerMin").jsonPrimitive.double,
                    coldDmgPerSec = survivalCfg.field("coldDmgPerSec").jsonPrimitive.double,
                ),
                debug = debug,
            )
        }

        private fun JsonObject.section(name: String): JsonObject =
            (this[name] ?: error("balance.json: нет раздела '$name'")).jsonObject

        private fun JsonObject.field(name: String): JsonElement =
            this[name] ?: error("balance.json: нет поля '$name'")

        private fun JsonObject.resolve(key: String): JsonElement =
            this[key] ?: error("balance.json: нет настроек для площадки '$key'")

        /**
         * В balance.json значение может быть ссылкой на другую площадку: `"rewarded": "as yandex"`.
         * Такие ссылки разворачиваются здесь, по цепочке.
         */
        private fun JsonObject.resolveField(key: String, name: String, depth: Int = 0): JsonElement {
            check(depth < 4) { "balance.json: зацикленная ссылка '$name'" }
            val value = resolve(key).jsonObject.field(name)
            val ref = (value as? JsonPrimitive)?.takeIf { it.isString }?.content
            return if (ref != null && ref.startsWith(REF_PREFIX)) {
                resolveField(ref.removePrefix(REF_PREFIX).trim(), name, depth + 1)
            } else value
        }

        private fun JsonElement.strings(): List<String> =
            (this as? JsonArray ?: jsonArray).map { it.jsonPrimitive.content }

        private const val REF_PREFIX = "as "
    }
}
