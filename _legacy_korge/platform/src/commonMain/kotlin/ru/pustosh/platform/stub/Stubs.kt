package ru.pustosh.platform.stub

import ru.pustosh.core.Log
import ru.pustosh.core.config.AdsConfig
import ru.pustosh.platform.AdResult
import ru.pustosh.platform.AdsService
import ru.pustosh.platform.AnalyticsService
import ru.pustosh.platform.ProductInfo
import ru.pustosh.platform.PurchaseResult
import ru.pustosh.platform.PurchaseService
import ru.pustosh.platform.RewardResult
import ru.pustosh.platform.SaveService
import kotlin.time.TimeSource

/**
 * Показ рекламы-заглушки. Реализует игра (модальное окно в UI), платформа только просит показать.
 * Так платформенный модуль не зависит от движка.
 */
fun interface StubAdPresenter {
    suspend fun show(kind: String, placement: String, durationMs: Long)
}

/** Покупка, отключающая межстраничную рекламу (balance.json → iap). */
const val PRODUCT_REMOVE_INTERSTITIALS = "remove_interstitials"

/**
 * Реклама-заглушка: окно «РЕКЛАМА (заглушка)» на [STUB_AD_DURATION_MS], награда выдаётся всегда.
 * Интервал и разрешённые точки показа — из [AdsConfig] площадки.
 */
class StubAdsService(
    private val config: AdsConfig,
    private val presenter: StubAdPresenter,
    private val purchases: StubPurchaseService,
) : AdsService {
    private var lastInterstitial: TimeSource.Monotonic.ValueTimeMark? = null

    override fun canShowInterstitial(): Boolean {
        if (PRODUCT_REMOVE_INTERSTITIALS in purchases.ownedNow) return false
        val last = lastInterstitial ?: return true
        return last.elapsedNow().inWholeSeconds >= config.interstitialMinIntervalSec
    }

    override suspend fun showInterstitial(placement: String): AdResult {
        if (placement !in config.interstitialPoints) {
            Log.w(TAG, "interstitial '$placement' не разрешён для площадки")
            return AdResult.SKIPPED
        }
        if (!canShowInterstitial()) return AdResult.SKIPPED
        return try {
            presenter.show("interstitial", placement, STUB_AD_DURATION_MS)
            lastInterstitial = TimeSource.Monotonic.markNow()
            AdResult.SHOWN
        } catch (e: Exception) {
            Log.e(TAG, "interstitial '$placement'", e)
            AdResult.ERROR
        }
    }

    override suspend fun showRewarded(placement: String): RewardResult {
        if (placement !in config.rewarded) Log.w(TAG, "rewarded '$placement' нет в balance.json")
        return try {
            presenter.show("rewarded", placement, STUB_AD_DURATION_MS)
            RewardResult.REWARDED
        } catch (e: Exception) {
            Log.e(TAG, "rewarded '$placement'", e)
            RewardResult.ERROR
        }
    }

    companion object {
        const val STUB_AD_DURATION_MS = 2_000L
        private const val TAG = "Ads"
    }
}

/** Покупки-заглушка: всегда успех, купленное хранится в памяти. */
class StubPurchaseService : PurchaseService {
    private val owned = linkedSetOf<String>()
    val ownedNow: Set<String> get() = owned

    override suspend fun catalog(): List<ProductInfo> = emptyList()

    override suspend fun purchase(productId: String): PurchaseResult {
        owned += productId
        Log.i("Purchases", "stub purchase '$productId'")
        return PurchaseResult.SUCCESS
    }

    override suspend fun owned(): Set<String> = owned.toSet()
}

class LogAnalyticsService : AnalyticsService {
    override fun event(name: String, params: Map<String, Any>) {
        Log.d("Analytics", if (params.isEmpty()) name else "$name $params")
    }
}

/** Сохранения в памяти — запасной вариант, если хранилище площадки недоступно. */
class MemorySaveService : SaveService {
    private val slots = mutableMapOf<String, String>()
    override suspend fun load(slot: String): String? = slots[slot]
    override suspend fun save(slot: String, json: String): Boolean {
        slots[slot] = json
        return true
    }
}

/** Проверка имени слота: оно становится частью имени файла/ключа. */
internal fun requireValidSlot(slot: String) {
    require(slot.isNotEmpty() && slot.all { it.isLetterOrDigit() || it == '_' || it == '-' }) { "bad save slot '$slot'" }
}
