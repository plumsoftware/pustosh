// Плагин KorGE тянет в корневой classpath Kotlin Gradle Plugin и AGP нужных версий,
// поэтому в модулях core и platform плагины kotlin/android подключаются без версий.
plugins {
    id("com.soywiz.korge") version "6.0.0" apply false
    kotlin("plugin.serialization") version "2.0.20" apply false
}
