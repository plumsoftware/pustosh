package ru.pustosh.game.ui

import korlibs.image.color.RGBA
import korlibs.image.text.TextAlignment
import korlibs.korge.input.onClick
import korlibs.korge.ui.UIButton
import korlibs.korge.ui.uiButton
import korlibs.korge.view.Container
import korlibs.korge.view.SolidRect
import korlibs.korge.view.Text
import korlibs.korge.view.position
import korlibs.korge.view.solidRect
import korlibs.korge.view.text
import korlibs.math.geom.Size
import ru.pustosh.game.Game

// Временные виджеты-заглушки. Настоящий UI на спрайтах из assets/ui — на следующих шагах.

val BUTTON_SIZE = Size(280, 64)

fun Container.menuButton(label: String, centerX: Double, y: Double, onPress: () -> Unit): UIButton =
    uiButton(label, BUTTON_SIZE) {
        textSize = 28.0
        position(centerX - BUTTON_SIZE.width / 2, y)
        onClick { onPress() }
    }

fun Container.centeredText(value: String, size: Number, y: Double, color: RGBA = RGBA(0xEE, 0xEE, 0xEE)): Text =
    text(value, size, color, alignment = TextAlignment.MIDDLE_CENTER).position(Game.VIRTUAL_WIDTH / 2.0, y)

/** Полупрозрачная подложка на весь экран, которая перехватывает клики под собой. */
fun Container.dimBackground(alpha: Int = 0xB0): SolidRect =
    solidRect(Game.VIRTUAL_WIDTH.toDouble(), Game.VIRTUAL_HEIGHT.toDouble(), RGBA(0, 0, 0, alpha)) { onClick { } }
