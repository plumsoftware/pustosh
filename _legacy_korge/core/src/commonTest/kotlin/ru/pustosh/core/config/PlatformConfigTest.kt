package ru.pustosh.core.config

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PlatformConfigTest {
    // Фрагмент формата data/balance.json, включая ссылку "as yandex".
    private val balance = """
        {
          "ads": {
            "yandex": { "interstitialMinIntervalSec": 180, "interstitialPoints": ["death", "menu_to_game"], "rewarded": ["double_loot"] },
            "rustore": { "interstitialMinIntervalSec": 240, "interstitialPoints": ["death"], "rewarded": "as yandex" }
          },
          "survival": {
            "yandex": { "hungerPerMin": 0.7, "thirstPerMin": 1.0, "coldDmgPerSec": 0.5 },
            "rustore": { "hungerPerMin": 1.0, "thirstPerMin": 1.5, "coldDmgPerSec": 1.0 }
          }
        }
    """.trimIndent()

    @Test
    fun readsRustoreAndResolvesReference() {
        val cfg = PlatformConfig.fromBalanceJson(balance, PlatformId.RUSTORE, debug = false)
        assertEquals(240, cfg.ads.interstitialMinIntervalSec)
        assertEquals(listOf("death"), cfg.ads.interstitialPoints)
        assertEquals(listOf("double_loot"), cfg.ads.rewarded)
        assertEquals(1.5, cfg.survival.thirstPerMin)
        assertEquals(3, cfg.mvpBiomeLimit)
    }

    @Test
    fun desktopUsesYandexValues() {
        val cfg = PlatformConfig.fromBalanceJson(balance, PlatformId.DESKTOP, debug = true)
        assertEquals(180, cfg.ads.interstitialMinIntervalSec)
        assertTrue("menu_to_game" in cfg.ads.interstitialPoints)
        assertTrue(cfg.debug)
    }
}
