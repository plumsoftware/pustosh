// Инструменты сборки ассетов (JVM): упаковка атласов из Pustosh_GameDev_Package (TZ/STEP_02, 2.1).
plugins {
    kotlin("jvm")
    kotlin("plugin.serialization")
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.1")
    testImplementation(kotlin("test"))
}

tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinJvmCompile>().configureEach {
    compilerOptions.jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
}

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

tasks.test {
    useJUnitPlatform()
    // Тесты читают реальный пакет ассетов (только чтение).
    systemProperty("pustosh.package", rootProject.file("Pustosh_GameDev_Package").absolutePath)
}
