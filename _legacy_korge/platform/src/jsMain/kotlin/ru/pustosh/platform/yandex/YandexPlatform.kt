package ru.pustosh.platform.yandex

import kotlinx.browser.document
import kotlinx.browser.localStorage
import kotlinx.browser.window
import ru.pustosh.core.Log
import ru.pustosh.core.config.PlatformConfig
import ru.pustosh.core.config.PlatformId
import ru.pustosh.platform.DeviceType
import ru.pustosh.platform.PlatformServices
import ru.pustosh.platform.SaveService
import ru.pustosh.platform.stub.LogAnalyticsService
import ru.pustosh.platform.stub.StubAdPresenter
import ru.pustosh.platform.stub.StubAdsService
import ru.pustosh.platform.stub.StubPurchaseService
import ru.pustosh.platform.stub.requireValidSlot
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine
import kotlin.js.Promise

/**
 * Яндекс Игры. SDK подключается в index.html строкой `<script src="/sdk.js">` до скрипта игры.
 * Вне Яндекса SDK нет — работаем как заглушка (лог «Yandex SDK not found, stub mode»).
 * Шаг 1: из SDK используются только init() и LoadingAPI.ready(); реклама, покупки, облачные сохранения — шаг 10.
 */
class YandexPlatform(config: PlatformConfig, adPresenter: StubAdPresenter) : PlatformServices {
    private var ysdk: dynamic = null

    override val id = PlatformId.YANDEX
    override var device: DeviceType = detectDeviceByTouch()
        private set
    override var language: String = window.navigator.language.substringBefore('-').ifEmpty { "ru" }
        private set
    override val purchases = StubPurchaseService()
    override val ads = StubAdsService(config.ads, adPresenter, purchases)
    override val saves: SaveService = LocalStorageSaveService()
    override val analytics = LogAnalyticsService()

    override suspend fun init() {
        val yaGames: dynamic = window.asDynamic().YaGames
        if (yaGames == null || yaGames == undefined) {
            Log.w(TAG, "Yandex SDK not found, stub mode")
            return
        }
        try {
            val sdk: dynamic = (yaGames.init() as Promise<dynamic>).await()
            ysdk = sdk
            deviceFromSdk(sdk.deviceInfo?.type as? String)?.let { device = it }
            (sdk.environment?.i18n?.lang as? String)?.let { language = it }
            Log.i(TAG, "Yandex SDK ready, device=$device, language=$language")
        } catch (e: Throwable) {
            Log.e(TAG, "Yandex SDK init failed, stub mode", e)
            ysdk = null
        }
    }

    override fun onLoadingFinished() {
        val sdk = ysdk ?: return
        try {
            sdk.features.LoadingAPI?.ready()
        } catch (e: Throwable) {
            Log.e(TAG, "LoadingAPI.ready", e)
        }
    }

    // GameplayAPI подключается на шаге 10.
    override fun onGameplayStart() = Log.d(TAG, "gameplay start")
    override fun onGameplayStop() = Log.d(TAG, "gameplay stop")

    /** Скрытие вкладки (visibilitychange). События паузы SDK — шаг 10. */
    override fun setPauseListener(onPause: () -> Unit, onResume: () -> Unit) {
        document.addEventListener("visibilitychange", {
            if (document.asDynamic().hidden == true) onPause() else onResume()
        })
    }

    private fun deviceFromSdk(type: String?): DeviceType? = when (type) {
        "desktop" -> DeviceType.DESKTOP
        "mobile" -> DeviceType.MOBILE
        "tablet" -> DeviceType.TABLET
        else -> null
    }

    private fun detectDeviceByTouch(): DeviceType {
        val touchPoints = (window.navigator.asDynamic().maxTouchPoints as? Int) ?: 0
        return if (touchPoints > 0) DeviceType.MOBILE else DeviceType.DESKTOP
    }

    private companion object {
        const val TAG = "Platform"
    }
}

/** Сохранения вне Яндекса — localStorage браузера. Облачные сохранения Яндекса — шаг 10. */
private class LocalStorageSaveService : SaveService {
    override suspend fun load(slot: String): String? = try {
        requireValidSlot(slot)
        localStorage.getItem(KEY_PREFIX + slot)
    } catch (e: Throwable) {
        Log.e("Saves", "load '$slot'", e)
        null
    }

    override suspend fun save(slot: String, json: String): Boolean = try {
        requireValidSlot(slot)
        localStorage.setItem(KEY_PREFIX + slot, json)
        true
    } catch (e: Throwable) {
        Log.e("Saves", "save '$slot'", e)
        false
    }

    private companion object {
        const val KEY_PREFIX = "pustosh.save."
    }
}

private suspend fun <T> Promise<T>.await(): T = suspendCoroutine { cont ->
    then({ cont.resume(it) }, { cont.resumeWithException(it) })
}
