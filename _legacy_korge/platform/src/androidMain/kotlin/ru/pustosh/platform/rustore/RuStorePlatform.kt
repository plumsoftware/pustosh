package ru.pustosh.platform.rustore

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import ru.pustosh.core.Log
import ru.pustosh.core.config.PlatformConfig
import ru.pustosh.core.config.PlatformId
import ru.pustosh.platform.DeviceType
import ru.pustosh.platform.PlatformServices
import ru.pustosh.platform.stub.FileSaveService
import ru.pustosh.platform.stub.LogAnalyticsService
import ru.pustosh.platform.stub.StubAdPresenter
import ru.pustosh.platform.stub.StubAdsService
import ru.pustosh.platform.stub.StubPurchaseService
import java.io.File
import java.util.Locale

/**
 * RuStore (Android). Шаг 1: реклама и покупки — заглушки, сохранения — во внутреннем хранилище приложения.
 * Реклама, RuStore Billing — шаг 10.
 */
class RuStorePlatform(
    private val context: Context,
    config: PlatformConfig,
    adPresenter: StubAdPresenter,
) : PlatformServices {
    override val id = PlatformId.RUSTORE
    override val device: DeviceType =
        if (context.resources.configuration.smallestScreenWidthDp >= TABLET_MIN_DP) DeviceType.TABLET else DeviceType.MOBILE
    override val language: String = Locale.getDefault().language.ifEmpty { "ru" }
    override val purchases = StubPurchaseService()
    override val ads = StubAdsService(config.ads, adPresenter, purchases)
    override val saves = FileSaveService(File(context.filesDir, "saves"))
    override val analytics = LogAnalyticsService()

    override suspend fun init() = Log.i(TAG, "rustore stub, device=$device, language=$language")
    override fun onLoadingFinished() = Log.d(TAG, "loading finished")
    override fun onGameplayStart() = Log.d(TAG, "gameplay start")
    override fun onGameplayStop() = Log.d(TAG, "gameplay stop")

    /** Сворачивание приложения = onPause активности, возврат = onResume. */
    override fun setPauseListener(onPause: () -> Unit, onResume: () -> Unit) {
        val app = context.applicationContext as Application
        app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityPaused(activity: Activity) = onPause()
            override fun onActivityResumed(activity: Activity) = onResume()
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
            override fun onActivityStarted(activity: Activity) = Unit
            override fun onActivityStopped(activity: Activity) = Unit
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
            override fun onActivityDestroyed(activity: Activity) = Unit
        })
    }

    private companion object {
        const val TAG = "Platform"
        const val TABLET_MIN_DP = 600
    }
}
