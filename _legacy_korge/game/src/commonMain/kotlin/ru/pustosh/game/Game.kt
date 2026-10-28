package ru.pustosh.game

import korlibs.korge.scene.SceneContainer
import korlibs.korge.scene.sceneContainer
import korlibs.korge.view.Container
import korlibs.korge.view.Stage
import korlibs.korge.view.addUpdater
import korlibs.korge.view.container
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import ru.pustosh.core.GameClock
import ru.pustosh.core.PauseReason
import ru.pustosh.core.config.PlatformConfig
import ru.pustosh.core.data.Registry
import ru.pustosh.game.assets.AssetStore
import ru.pustosh.game.debug.AssetGalleryScene
import korlibs.event.Key
import korlibs.korge.input.keys
import ru.pustosh.game.audio.AudioBus
import ru.pustosh.game.debug.DebugOverlay
import ru.pustosh.game.scenes.BootScene
import ru.pustosh.game.scenes.EmptyScene
import ru.pustosh.game.scenes.MainMenuScene
import ru.pustosh.game.scenes.PauseScene
import ru.pustosh.game.ui.AdStubOverlay
import ru.pustosh.game.ui.AdsController
import ru.pustosh.platform.PlatformServices
import kotlin.coroutines.coroutineContext

/**
 * Корень игры: слои сцены, часы, платформа и конфиг. Создаётся один раз в [main].
 *
 * Слои сверху вниз: отладочный оверлей → окно рекламы-заглушки → оверлей-сцена (пауза) → основная сцена.
 */
class Game(val stage: Stage) {
    val clock = GameClock()
    lateinit var scope: CoroutineScope
        private set

    lateinit var scenes: SceneContainer
        private set
    private lateinit var overlayScenes: SceneContainer
    lateinit var adStub: AdStubOverlay
        private set
    private lateinit var debugLayer: Container

    // Заполняются в BootScene: конфиг читается из balance.json, платформа создаётся по таргету.
    lateinit var config: PlatformConfig
    lateinit var platform: PlatformServices
    lateinit var ads: AdsController

    // Заполняются в LoadingScene.
    lateinit var registry: Registry
    lateinit var assets: AssetStore

    var isPauseOpen = false
        private set

    suspend fun start() {
        scope = CoroutineScope(coroutineContext)
        scenes = stage.sceneContainer()
        overlayScenes = stage.sceneContainer()
        adStub = AdStubOverlay(stage.container())
        debugLayer = stage.container()

        clock.addPauseListener { paused -> AudioBus.muted = paused }
        stage.addUpdater { dt -> clock.advance(dt.inWholeMicroseconds / 1000.0) }

        scenes.changeTo { BootScene(this@Game) }
    }

    /** Вызывается из BootScene, когда платформа готова. */
    fun onPlatformReady() {
        platform.setPauseListener(
            onPause = { clock.pause(PauseReason.TAB_HIDDEN) },
            onResume = { clock.resume(PauseReason.TAB_HIDDEN) },
        )
        DebugOverlay(debugLayer, this).install()
        stage.keys { down(Key.F2) { openGallery() } }
    }

    /** Отладочная галерея ассетов (F2 на ПК, кнопка в меню в debug). Доступна после загрузки. */
    fun openGallery() {
        if (!::assets.isInitialized || isPauseOpen || PauseReason.AD in clock.pauseReasons) return
        if (scenes.currentScene is AssetGalleryScene) return
        scope.launch { scenes.changeTo { AssetGalleryScene(this@Game) } }
    }

    fun openPause() {
        if (isPauseOpen || PauseReason.AD in clock.pauseReasons) return
        isPauseOpen = true
        clock.pause(PauseReason.MENU)
        platform.onGameplayStop()
        scope.launch { overlayScenes.changeTo { PauseScene(this@Game) } }
    }

    fun closePause() {
        if (!isPauseOpen) return
        isPauseOpen = false
        scope.launch {
            overlayScenes.changeTo { EmptyScene() }
            clock.resume(PauseReason.MENU)
            platform.onGameplayStart()
        }
    }

    fun togglePause() = if (isPauseOpen) closePause() else openPause()

    /** Из паузы в главное меню: меню само ставит паузу MENU. */
    fun exitToMenu() {
        if (!isPauseOpen) return
        isPauseOpen = false
        scope.launch {
            overlayScenes.changeTo { EmptyScene() }
            scenes.changeTo { MainMenuScene(this@Game) }
        }
    }

    companion object {
        const val VIRTUAL_WIDTH = 1280
        const val VIRTUAL_HEIGHT = 720
        const val BUILD_VERSION = "0.1.0 (шаг 1)"
    }
}
