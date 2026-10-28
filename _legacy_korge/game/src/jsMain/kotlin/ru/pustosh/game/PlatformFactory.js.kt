package ru.pustosh.game

import korlibs.korge.view.Views
import kotlinx.browser.window
import ru.pustosh.core.config.PlatformConfig
import ru.pustosh.core.config.PlatformId
import ru.pustosh.platform.PlatformServices
import ru.pustosh.platform.stub.StubAdPresenter
import ru.pustosh.platform.yandex.YandexPlatform

actual val currentPlatformId: PlatformId = PlatformId.YANDEX

/** В браузере отладка включается параметром `?debug` в адресе. */
actual fun isDebugBuild(views: Views): Boolean = window.location.search.contains("debug")

actual fun createPlatform(views: Views, config: PlatformConfig, adPresenter: StubAdPresenter): PlatformServices =
    YandexPlatform(config, adPresenter)
