package ru.pustosh.game

import korlibs.korge.view.Views
import ru.pustosh.core.config.PlatformConfig
import ru.pustosh.core.config.PlatformId
import ru.pustosh.platform.PlatformServices
import ru.pustosh.platform.desktop.DesktopStub
import ru.pustosh.platform.stub.StubAdPresenter

actual val currentPlatformId: PlatformId = PlatformId.DESKTOP

actual fun isDebugBuild(views: Views): Boolean = true

actual fun createPlatform(views: Views, config: PlatformConfig, adPresenter: StubAdPresenter): PlatformServices =
    DesktopStub(config, adPresenter)
