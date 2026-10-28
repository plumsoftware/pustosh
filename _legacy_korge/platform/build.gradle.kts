// Платформенный слой: интерфейсы в commonMain, реализации — jsMain (Яндекс), androidMain (RuStore), jvmMain (десктоп).

plugins {
    kotlin("multiplatform")
    id("com.android.library")
}

kotlin {
    jvm()
    js(IR) {
        browser { testTask { enabled = false } }
    }
    androidTarget()

    sourceSets {
        commonMain.dependencies {
            api(project(":core"))
        }
        // Общий код JVM и Android (java.io): файловые сохранения.
        val jvmCommonMain by creating { dependsOn(commonMain.get()) }
        jvmMain.get().dependsOn(jvmCommonMain)
        androidMain.get().dependsOn(jvmCommonMain)
    }
}

android {
    namespace = "ru.pustosh.platform"
    compileSdk = 35
    defaultConfig { minSdk = 24 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
}

// JVM 21 — как у KorGE 6 (десктоп и Android), иначе game не сможет подключить модуль.
tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinJvmCompile>().configureEach {
    compilerOptions.jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
}
