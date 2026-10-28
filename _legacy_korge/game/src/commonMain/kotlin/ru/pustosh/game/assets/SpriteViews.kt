package ru.pustosh.game.assets

import korlibs.korge.view.Container
import korlibs.korge.view.Image
import korlibs.korge.view.anchor
import korlibs.korge.view.image

/** Картинка спрайта в логическом размере (1x); позиция view = точка привязки спрайта. */
fun Container.sprite(s: Sprite): Image = image(s.slice) {
    anchor(s.pivotX, s.pivotY)
    scaledWidth = s.logicalWidth
    scaledHeight = s.logicalHeight
}
