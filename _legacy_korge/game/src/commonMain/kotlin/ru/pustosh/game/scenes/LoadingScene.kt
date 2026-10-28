package ru.pustosh.game.scenes

import korlibs.io.file.std.resourcesVfs
import korlibs.korge.scene.Scene
import korlibs.korge.ui.uiProgressBar
import korlibs.korge.view.SContainer
import korlibs.korge.view.position
import korlibs.math.geom.Size
import kotlinx.coroutines.launch
import ru.pustosh.core.Log
import ru.pustosh.core.data.DataValidator
import ru.pustosh.core.data.GameDataLoader
import ru.pustosh.core.data.LoadPhase
import ru.pustosh.core.data.Registry
import ru.pustosh.core.i18n.Strings
import ru.pustosh.game.Game
import ru.pustosh.game.assets.AssetStore
import ru.pustosh.game.ui.centeredText

/**
 * Загрузка: данные из data/<файл>.json, индекс атласов, проверка данных (в debug), атласы первой загрузки.
 * Атласы группы `background` догружаются после перехода в меню, `lazy` — по требованию.
 */
class LoadingScene(private val game: Game) : Scene() {
    override suspend fun SContainer.sceneMain() {
        Log.d("Scene", "Loading")
        val cx = Game.VIRTUAL_WIDTH / 2.0
        val cy = Game.VIRTUAL_HEIGHT / 2.0
        centeredText(Strings.get("ui.loading"), 32, cy - 50)

        val assets = AssetStore.load()
        val initialGroups = assets.groupsByPhase(LoadPhase.INITIAL)
        val steps = 1 + initialGroups.size
        val bar = uiProgressBar(Size(BAR_WIDTH, 24), current = 0, maximum = steps).position(cx - BAR_WIDTH / 2, cy)

        val data = GameDataLoader.load { resourcesVfs["data/$it"].readString() }
        game.registry = Registry(data)
        if (game.config.debug) {
            val report = DataValidator(data, assets.index.assets.keys).validate()
            if (report.ok) Log.i(TAG, report.format().trimEnd()) else Log.w(TAG, report.format().trimEnd())
        }
        bar.current = 1.0

        initialGroups.forEachIndexed { i, group ->
            assets.ensureGroup(group)
            bar.current = 2.0 + i
        }
        game.assets = assets
        game.platform.onLoadingFinished()

        game.scope.launch {
            for (group in assets.groupsByPhase(LoadPhase.BACKGROUND)) assets.ensureGroup(group)
        }
        sceneContainer.changeTo { MainMenuScene(game) }
    }

    private companion object {
        const val TAG = "Loading"
        const val BAR_WIDTH = 480.0
    }
}
