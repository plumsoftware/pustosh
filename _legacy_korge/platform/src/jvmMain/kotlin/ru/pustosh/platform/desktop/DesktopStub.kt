package ru.pustosh.platform.desktop

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

/** Десктоп для отладки: реклама — окно-заглушка, сохранения — `~/.pustosh/saves`, покупки — всегда успех. */
class DesktopStub(config: PlatformConfig, adPresenter: StubAdPresenter) : PlatformServices {
    override val id = PlatformId.DESKTOP
    override val device = DeviceType.DESKTOP
    override val language: String = Locale.getDefault().language.ifEmpty { "ru" }
    override val purchases = StubPurchaseService()
    override val ads = StubAdsService(config.ads, adPresenter, purchases)
    override val saves = FileSaveService(File(System.getProperty("user.home"), ".pustosh/saves"))
    override val analytics = LogAnalyticsService()

    override suspend fun init() = Log.i(TAG, "desktop stub, language=$language")
    override fun onLoadingFinished() = Log.d(TAG, "loading finished")
    override fun onGameplayStart() = Log.d(TAG, "gameplay start")
    override fun onGameplayStop() = Log.d(TAG, "gameplay stop")

    // Сворачивание окна на десктопе отдельно не отслеживается: это отладочная сборка.
    override fun setPauseListener(onPause: () -> Unit, onResume: () -> Unit) = Unit

    private companion object {
        const val TAG = "Platform"
    }
}
