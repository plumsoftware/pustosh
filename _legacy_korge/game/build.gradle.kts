import korlibs.korge.gradle.*

plugins {
    id("com.soywiz.korge")
}

korge {
    id = "ru.pustosh.game"
    name = "pustosh"
    title = "Пустошь"
    version = "0.1.0"
    versionCode = 1
    jvmMainClassName = "ru.pustosh.game.MainKt"

    // Android: настройки читаются в момент targetAndroid(), поэтому задаются до него.
    androidSdk(compileSdk = 35, minSdk = 24, targetSdk = 35)
    orientation = Orientation.LANDSCAPE
    fullscreen = true

    // Dev-ключ только для отладки и тестовых сборок. Релизный ключ RuStore задаётся свойствами
    // RELEASE_STORE_FILE / RELEASE_STORE_PASSWORD / RELEASE_KEY_ALIAS / RELEASE_KEY_PASSWORD (см. docs/BUILD.md).
    androidReleaseSignStoreFile = "keystore/dev.keystore"
    androidReleaseSignStorePassword = "pustosh-dev"
    androidReleaseSignKeyAlias = "dev"
    androidReleaseSignKeyPassword = "pustosh-dev"

    targetJvm()
    targetJs()
    targetAndroid()

    serializationJson()
}

dependencies {
    add("commonMainImplementation", project(":core"))
    add("commonMainImplementation", project(":platform"))
}

// Игровые данные берутся из пакета как есть (data/*.json не копируются в репозиторий руками и не правятся).
val packageDir = rootProject.file("Pustosh_GameDev_Package")
val generatedDataRoot = layout.buildDirectory.dir("generated/pustosh-data")
val packedAssetsDir = layout.buildDirectory.dir("generated/pustosh-assets")

val syncGameData by tasks.registering(Sync::class) {
    from(packageDir.resolve("data")) { include("*.json") }
    into(generatedDataRoot.map { it.dir("data") })
}

// Атласы из assets/ по assets_manifest.json (TZ/STEP_02, 2.1). Повторный запуск без изменений — UP-TO-DATE.
val packAssetsTool by configurations.creating {
    isCanBeConsumed = false
    attributes { attribute(Usage.USAGE_ATTRIBUTE, objects.named(Usage.JAVA_RUNTIME)) }
}
dependencies { packAssetsTool(project(":tools")) }

val packAssets by tasks.registering(JavaExec::class) {
    group = "assets"
    description = "Упаковывает спрайты в атласы и пишет asset_index.json"
    classpath = packAssetsTool
    mainClass.set("ru.pustosh.tools.pack.PackAssetsKt")
    inputs.dir(packageDir.resolve("assets")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.file(packageDir.resolve("assets_manifest.json"))
    inputs.files(listOf("rigs.json", "enemies.json", "bosses.json").map { packageDir.resolve("data/$it") })
    outputs.dir(packedAssetsDir)
    argumentProviders += CommandLineArgumentProvider { listOf(packageDir.absolutePath, packedAssetsDir.get().asFile.absolutePath) }
}

kotlin.sourceSets.getByName("commonMain").resources.srcDir(generatedDataRoot)
kotlin.sourceSets.getByName("commonMain").resources.srcDir(packedAssetsDir.map { it.dir("res") })

tasks.matching { it.name.endsWith("ProcessResources") || it.name.startsWith("korgeProcessedResources") || it.name.startsWith("jsCreateIndexHtml") }
    .configureEach { dependsOn(syncGameData, packAssets) }

// Шаблон <head> для index.html (подключение SDK Яндекса). Лежит вне ресурсов, чтобы не попадать в сборки как файл.
// KorGE создаёт задачу в своём afterEvaluate (он зарегистрирован раньше), поэтому здесь она уже есть.
afterEvaluate {
    tasks.named<korlibs.korge.gradle.targets.js.JsCreateIndexTask>("jsCreateIndexHtml") {
        resourcesFolders = listOf(file("web")) + resourcesFolders
    }
}

// Архив для загрузки в консоль Яндекс Игр: index.html в корне, без source map.
val packageYandexZip by tasks.registering(Zip::class) {
    group = "distribution"
    description = "Собирает веб-билд в zip для консоли Яндекс Игр"
    dependsOn("jsBrowserDistribution")
    from(layout.buildDirectory.dir("dist/js/productionExecutable")) { exclude("**/*.map") }
    archiveFileName.set("pustosh-yandex-${project.korge.version}.zip")
    destinationDirectory.set(layout.buildDirectory.dir("yandex"))
}
