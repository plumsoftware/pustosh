pluginManagement {
    repositories { mavenCentral(); google(); gradlePluginPortal() }
}

dependencyResolutionManagement {
    repositories { mavenCentral(); google() }
}

rootProject.name = "pustosh"

include(":core", ":platform", ":game", ":tools")
