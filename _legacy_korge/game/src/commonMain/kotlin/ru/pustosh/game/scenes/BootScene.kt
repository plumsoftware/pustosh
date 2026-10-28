package ru.pustosh.game.scenes

import korlibs.io.file.std.resourcesVfs
import korlibs.korge.scene.Scene
import korlibs.korge.view.SContainer
import ru.pustosh.core.Log
import ru.pustosh.core.config.PlatformConfig
import ru.pustosh.core.i18n.Strings
import ru.pustosh.game.Game
import ru.pustosh.game.createPlatform
import ru.pustosh.game.currentPlatformId
import ru.pustosh.game.isDebugBuild
import ru.pustosh.game.ui.AdsController

/** Старт: строки, конфиг площадки из balance.json, создание и init() платформы. */
class BootScene(private val game: Game) : Scene() {
    override suspend fun SContainer.sceneMain() {
        val debug = isDebugBuild(views)
        Log.minLevel = if (debug) Log.Level.DEBUG else Log.Level.WARN

        Strings.load(resourcesVfs["strings_ru.json"].readString())
        val balance = resourcesVfs["data/balance.json"].readString()
        game.config = PlatformConfig.fromBalanceJson(balance, currentPlatformId, debug)
        game.platform = createPlatform(views, game.config, game.adStub)
        game.ads = AdsController(game.platform, game.clock)

        game.platform.init()
        game.onPlatformReady()
        Log.i(TAG, "boot: ${game.config.platform}, device=${game.platform.device}, debug=$debug")

        sceneContainer.changeTo { LoadingScene(game) }
    }

    private companion object {
        const val TAG = "Boot"
    }
}
