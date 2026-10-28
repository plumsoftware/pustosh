package ru.pustosh.game

import android.content.Context
import android.content.pm.ApplicationInfo
import korlibs.korge.view.Views
import ru.pustosh.core.config.PlatformConfig
import ru.pustosh.core.config.PlatformId
import ru.pustosh.platform.PlatformServices
import ru.pustosh.platform.rustore.RuStorePlatform
import ru.pustosh.platform.stub.StubAdPresenter

actual val currentPlatformId: PlatformId = PlatformId.RUSTORE

/** Отладка — сборка с android:debuggable. */
actual fun isDebugBuild(views: Views): Boolean =
    views.androidContext.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0

actual fun createPlatform(views: Views, config: PlatformConfig, adPresenter: StubAdPresenter): PlatformServices =
    RuStorePlatform(views.androidContext, config, adPresenter)

private val Views.androidContext: Context get() = gameWindow.androidContextAny as Context
