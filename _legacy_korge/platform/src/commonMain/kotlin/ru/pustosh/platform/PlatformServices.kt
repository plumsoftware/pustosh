package ru.pustosh.platform

import ru.pustosh.core.config.PlatformId

// Сигнатуры зафиксированы в TZ/STEP_01_project_setup.md, задача 4. Менять только по согласованию.

enum class DeviceType { DESKTOP, MOBILE, TABLET }

enum class AdResult { SHOWN, SKIPPED, ERROR }

enum class RewardResult { REWARDED, CLOSED_EARLY, ERROR }

enum class PurchaseResult { SUCCESS, CANCELLED, ERROR }

data class ProductInfo(
    val id: String,
    val title: String,
    /** Цена в валюте площадки, уже отформатированная для показа. */
    val price: String,
)

interface PlatformServices {
    val id: PlatformId                     // YANDEX, RUSTORE, DESKTOP
    val device: DeviceType                 // DESKTOP, MOBILE, TABLET
    val language: String                   // "ru", "en"...
    val ads: AdsService
    val saves: SaveService
    val purchases: PurchaseService
    val analytics: AnalyticsService
    suspend fun init()                     // вызывается до загрузки ресурсов
    fun onLoadingFinished()                // Яндекс: LoadingAPI.ready()
    fun onGameplayStart()                  // Яндекс: GameplayAPI.start()
    fun onGameplayStop()                   // Яндекс: GameplayAPI.stop()
    fun setPauseListener(onPause: () -> Unit, onResume: () -> Unit) // события платформы и сворачивание
}

interface AdsService {
    fun canShowInterstitial(): Boolean      // учитывает интервал из конфига и покупку "без рекламы"
    suspend fun showInterstitial(placement: String): AdResult   // SHOWN, SKIPPED, ERROR
    suspend fun showRewarded(placement: String): RewardResult   // REWARDED, CLOSED_EARLY, ERROR
}

interface SaveService {
    suspend fun load(slot: String): String?          // JSON сохранения или null
    suspend fun save(slot: String, json: String): Boolean
}

interface PurchaseService {
    suspend fun catalog(): List<ProductInfo>
    suspend fun purchase(productId: String): PurchaseResult
    suspend fun owned(): Set<String>
}

interface AnalyticsService { fun event(name: String, params: Map<String, Any> = emptyMap()) }
