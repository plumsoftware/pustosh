package ru.pustosh.game.ui

import ru.pustosh.core.GameClock
import ru.pustosh.core.PauseReason
import ru.pustosh.platform.AdResult
import ru.pustosh.platform.PlatformServices
import ru.pustosh.platform.RewardResult

/** Показ рекламы из игры: на время показа игра стоит на паузе с причиной AD (и звук заглушен). */
class AdsController(private val platform: PlatformServices, private val clock: GameClock) {
    suspend fun interstitial(placement: String): AdResult {
        if (!platform.ads.canShowInterstitial()) return AdResult.SKIPPED
        val result = withAdPause { platform.ads.showInterstitial(placement) }
        platform.analytics.event("ad_interstitial", mapOf("placement" to placement, "result" to result.name))
        return result
    }

    suspend fun rewarded(placement: String): RewardResult {
        val result = withAdPause { platform.ads.showRewarded(placement) }
        platform.analytics.event("ad_rewarded", mapOf("placement" to placement, "result" to result.name))
        return result
    }

    private inline fun <T> withAdPause(block: () -> T): T {
        clock.pause(PauseReason.AD)
        try {
            return block()
        } finally {
            clock.resume(PauseReason.AD)
        }
    }
}
