// Чистый Kotlin без движка: логика тестируется без окна (TZ/00_OVERVIEW.md §3, правило 1).
plugins {
    kotlin("multiplatform")
    kotlin("plugin.serialization")
}

kotlin {
    jvm()
    js(IR) {
        browser { testTask { enabled = false } }
        nodejs()
    }

    sourceSets {
        commonMain.dependencies {
            implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.1")
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
        }
    }
}

// JVM 21 — как у KorGE 6 (десктоп и Android), иначе game не сможет подключить модуль.
tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinJvmCompile>().configureEach {
    compilerOptions.jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
}

// Тесты данных читают настоящий пакет (только чтение).
tasks.named<Test>("jvmTest") {
    systemProperty("pustosh.package", rootProject.file("Pustosh_GameDev_Package").absolutePath)
}
