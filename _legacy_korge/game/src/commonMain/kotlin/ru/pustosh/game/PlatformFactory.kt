package ru.pustosh.game

import korlibs.korge.view.Views
import ru.pustosh.core.config.PlatformConfig
import ru.pustosh.core.config.PlatformId
import ru.pustosh.platform.PlatformServices
import ru.pustosh.platform.stub.StubAdPresenter

/** Площадка текущего таргета: js → Яндекс, android → RuStore, jvm → десктоп. */
expect val currentPlatformId: PlatformId

/** Отладочная сборка (десктоп — всегда). */
expect fun isDebugBuild(views: Views): Boolean

expect fun createPlatform(views: Views, config: PlatformConfig, adPresenter: StubAdPresenter): PlatformServices
