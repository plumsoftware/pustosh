package ru.pustosh.tools.pack

import java.awt.RenderingHints
import java.awt.image.BufferedImage
import java.io.File
import javax.imageio.ImageIO
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

fun readArgb(file: File): BufferedImage {
    val src = ImageIO.read(file) ?: error("не удалось прочитать $file")
    return toType(src, BufferedImage.TYPE_INT_ARGB)
}

private fun toType(src: BufferedImage, type: Int): BufferedImage {
    if (src.type == type) return src
    val out = BufferedImage(src.width, src.height, type)
    val g = out.createGraphics()
    g.drawImage(src, 0, 0, null)
    g.dispose()
    return out
}

/** Фон, на котором рисовался лист (TZ/ASSETS.md, tools/PROMPT_TEMPLATE.md). */
enum class KeyColor { MAGENTA, BLUE, NONE }

fun keyColorOf(folder: String): KeyColor = when {
    folder == "effects" -> KeyColor.NONE // эффекты — на чёрном, рисуются сложением
    folder == "world/biome4_desert" -> KeyColor.BLUE
    else -> KeyColor.MAGENTA
}

private fun isKeyTinted(rgb: Int, key: KeyColor): Boolean {
    val r = rgb shr 16 and 0xFF
    val g = rgb shr 8 and 0xFF
    val b = rgb and 0xFF
    return when (key) {
        KeyColor.MAGENTA -> r > 110 && b > 110 && g * 10 < min(r, b) * 6
        KeyColor.BLUE -> b > 110 && r * 10 < b * 6 && g * 10 < b * 7
        KeyColor.NONE -> false
    }
}

/**
 * Убирает кайму цвета фона на краях: полупрозрачные и крайние пиксели с оттенком фона
 * перекрашиваются в средний цвет чистых непрозрачных соседей (радиус 2). Альфа не меняется.
 * @return число исправленных пикселей.
 */
fun defringe(img: BufferedImage, key: KeyColor): Int {
    if (key == KeyColor.NONE) return 0
    val w = img.width
    val h = img.height
    val px = img.getRGB(0, 0, w, h, null, 0, w)
    fun alpha(i: Int) = px[i] ushr 24
    fun isEdge(x: Int, y: Int): Boolean {
        for (dy in -1..1) for (dx in -1..1) {
            val nx = x + dx
            val ny = y + dy
            if (nx !in 0 until w || ny !in 0 until h || alpha(ny * w + nx) < 255) return true
        }
        return false
    }
    val fix = IntArray(px.size) { -1 }
    var fixed = 0
    for (y in 0 until h) for (x in 0 until w) {
        val i = y * w + x
        val a = alpha(i)
        if (a == 0 || !isKeyTinted(px[i], key)) continue
        if (a == 255 && !isEdge(x, y)) continue
        var sr = 0
        var sg = 0
        var sb = 0
        var n = 0
        for (dy in -2..2) for (dx in -2..2) {
            val nx = x + dx
            val ny = y + dy
            if (nx !in 0 until w || ny !in 0 until h) continue
            val j = ny * w + nx
            if (alpha(j) == 255 && !isKeyTinted(px[j], key)) {
                sr += px[j] shr 16 and 0xFF; sg += px[j] shr 8 and 0xFF; sb += px[j] and 0xFF; n++
            }
        }
        // Нет чистых соседей — нейтральный тёмный: кайма в 1-2 пикселя на тёмном незаметна, розовая — заметна.
        val rgb = if (n > 0) (sr / n shl 16) or (sg / n shl 8) or (sb / n) else 0x202020
        fix[i] = (a shl 24) or rgb
        fixed++
    }
    for (i in px.indices) if (fix[i] != -1) px[i] = fix[i]
    img.setRGB(0, 0, w, h, px, 0, w)
    return fixed
}

/**
 * Масштаб с премультиплицированной альфой (без тёмной/цветной каймы на краях).
 * Уменьшение — ступенями по половине (качество близко к усреднению по площади), увеличение — бикубическое.
 */
fun resize(img: BufferedImage, tw: Int, th: Int): BufferedImage {
    if (img.width == tw && img.height == th) return img
    var cur = toType(img, BufferedImage.TYPE_INT_ARGB_PRE)
    var cw = cur.width
    var ch = cur.height
    while (cw / 2 >= tw && ch / 2 >= th) {
        cw /= 2; ch /= 2
        cur = draw(cur, cw, ch, RenderingHints.VALUE_INTERPOLATION_BILINEAR)
    }
    cur = draw(cur, tw, th, RenderingHints.VALUE_INTERPOLATION_BICUBIC)
    return toType(cur, BufferedImage.TYPE_INT_ARGB)
}

private fun draw(src: BufferedImage, w: Int, h: Int, interpolation: Any): BufferedImage {
    val out = BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB_PRE)
    val g = out.createGraphics()
    g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, interpolation)
    g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY)
    g.drawImage(src, 0, 0, w, h, null)
    g.dispose()
    return out
}

/** Прямоугольник непрозрачных пикселей (альфа > [threshold]). */
fun opaqueBounds(img: BufferedImage, threshold: Int = 8): java.awt.Rectangle? {
    var x0 = img.width; var y0 = img.height; var x1 = -1; var y1 = -1
    for (y in 0 until img.height) for (x in 0 until img.width) {
        if (img.getRGB(x, y) ushr 24 > threshold) {
            x0 = min(x0, x); y0 = min(y0, y); x1 = max(x1, x); y1 = max(y1, y)
        }
    }
    return if (x1 < 0) null else java.awt.Rectangle(x0, y0, x1 - x0 + 1, y1 - y0 + 1)
}

fun crop(img: BufferedImage, r: java.awt.Rectangle): BufferedImage {
    val out = BufferedImage(r.width, r.height, BufferedImage.TYPE_INT_ARGB)
    val g = out.createGraphics()
    g.drawImage(img, 0, 0, r.width, r.height, r.x, r.y, r.x + r.width, r.y + r.height, null)
    g.dispose()
    return out
}

/**
 * Разрез по горизонтали: ищет самую длинную полосу пустых строк рядом с [nearFrac] высоты,
 * если полосы нет — режет ровно на [nearFrac]. Возвращает (верх, низ), обрезанные по альфе.
 */
fun splitHorizontal(img: BufferedImage, nearFrac: Double): Pair<BufferedImage, BufferedImage> {
    val emptyRow = BooleanArray(img.height) { y -> (0 until img.width).none { x -> img.getRGB(x, y) ushr 24 > 8 } }
    val target = (img.height * nearFrac).roundToInt()
    var best = -1
    var bestScore = Double.MAX_VALUE
    var y = 0
    while (y < img.height) {
        if (!emptyRow[y]) { y++; continue }
        val start = y
        while (y < img.height && emptyRow[y]) y++
        val mid = (start + y) / 2
        if (start == 0 || y == img.height) continue // поля сверху/снизу — не разрез
        val score = kotlin.math.abs(mid - target).toDouble() - (y - start) * 0.5
        if (score < bestScore) { bestScore = score; best = mid }
    }
    val cut = if (best >= 0) best else target
    val top = crop(img, java.awt.Rectangle(0, 0, img.width, cut))
    val bottom = crop(img, java.awt.Rectangle(0, cut, img.width, img.height - cut))
    return trim(top) to trim(bottom)
}

/** Разделение на связные области по альфе (8-связность), мелкий мусор (< [minPixels]) отбрасывается. Сверху вниз, слева направо. */
fun splitComponents(img: BufferedImage, minPixels: Int = 40): List<BufferedImage> {
    val w = img.width
    val h = img.height
    val label = IntArray(w * h)
    val boxes = mutableListOf<IntArray>() // x0,y0,x1,y1,count
    val stack = ArrayDeque<Int>()
    for (start in 0 until w * h) {
        if (label[start] != 0 || img.getRGB(start % w, start / w) ushr 24 <= 8) continue
        val id = boxes.size + 1
        val box = intArrayOf(w, h, -1, -1, 0)
        label[start] = id
        stack.addLast(start)
        while (stack.isNotEmpty()) {
            val i = stack.removeLast()
            val x = i % w
            val y = i / w
            box[0] = min(box[0], x); box[1] = min(box[1], y); box[2] = max(box[2], x); box[3] = max(box[3], y); box[4]++
            for (dy in -1..1) for (dx in -1..1) {
                val nx = x + dx
                val ny = y + dy
                if (nx !in 0 until w || ny !in 0 until h) continue
                val j = ny * w + nx
                if (label[j] == 0 && img.getRGB(nx, ny) ushr 24 > 8) { label[j] = id; stack.addLast(j) }
            }
        }
        boxes += box
    }
    return boxes.withIndex()
        .filter { it.value[4] >= minPixels }
        .sortedWith(compareBy({ it.value[1] }, { it.value[0] }))
        .map { (index, b) ->
            val id = index + 1
            val r = java.awt.Rectangle(b[0], b[1], b[2] - b[0] + 1, b[3] - b[1] + 1)
            val out = BufferedImage(r.width, r.height, BufferedImage.TYPE_INT_ARGB)
            for (y in 0 until r.height) for (x in 0 until r.width) {
                val sx = r.x + x
                val sy = r.y + y
                if (label[sy * w + sx] == id) out.setRGB(x, y, img.getRGB(sx, sy))
            }
            out
        }
}

fun trim(img: BufferedImage): BufferedImage = opaqueBounds(img)?.let { crop(img, it) } ?: img

/** Копирует [image] в [atlas] в точку (x, y) и повторяет краевые пиксели на [extrude] наружу. */
fun blitExtruded(atlas: BufferedImage, image: BufferedImage, x: Int, y: Int, extrude: Int) {
    val w = image.width
    val h = image.height
    for (dy in -extrude until h + extrude) for (dx in -extrude until w + extrude) {
        val sx = dx.coerceIn(0, w - 1)
        val sy = dy.coerceIn(0, h - 1)
        atlas.setRGB(x + dx, y + dy, image.getRGB(sx, sy))
    }
}

/**
 * PNG без потерь с максимальным сжатием. Цвет полностью прозрачных пикселей обнуляется:
 * он не виден (края защищены повтором), а одинаковые нули сжимаются заметно лучше.
 */
fun writePngCompact(img: BufferedImage, file: File) {
    val w = img.width
    val h = img.height
    val px = img.getRGB(0, 0, w, h, null, 0, w)
    for (i in px.indices) if (px[i] ushr 24 == 0) px[i] = 0
    val clean = BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB)
    clean.setRGB(0, 0, w, h, px, 0, w)
    val writer = ImageIO.getImageWritersByFormatName("png").next()
    val param = writer.defaultWriteParam
    if (param.canWriteCompressed()) {
        param.compressionMode = javax.imageio.ImageWriteParam.MODE_EXPLICIT
        param.compressionQuality = 0.0f // 0 = максимальное сжатие deflate
    }
    file.delete()
    ImageIO.createImageOutputStream(file).use { out ->
        writer.output = out
        writer.write(null, javax.imageio.IIOImage(clean, null, null), param)
    }
    writer.dispose()
}
