package ru.pustosh.tools.pack

/** Прямоугольник в пикселях атласа. */
data class Rect(val x: Int, val y: Int, val w: Int, val h: Int) {
    val right get() = x + w
    val bottom get() = y + h
    fun contains(o: Rect) = o.x >= x && o.y >= y && o.right <= right && o.bottom <= bottom
    fun intersects(o: Rect) = o.x < right && o.right > x && o.y < bottom && o.bottom > y
}

/**
 * Упаковка MaxRects (эвристика Best Short Side Fit), без поворота спрайтов.
 * Свободные области хранятся как набор максимальных прямоугольников.
 */
class MaxRectsBin(val width: Int, val height: Int) {
    private val free = mutableListOf(Rect(0, 0, width, height))

    fun insert(w: Int, h: Int): Rect? {
        var best: Rect? = null
        var bestShort = Int.MAX_VALUE
        var bestLong = Int.MAX_VALUE
        for (f in free) {
            if (w > f.w || h > f.h) continue
            val short = minOf(f.w - w, f.h - h)
            val long = maxOf(f.w - w, f.h - h)
            if (short < bestShort || (short == bestShort && long < bestLong)) {
                best = Rect(f.x, f.y, w, h); bestShort = short; bestLong = long
            }
        }
        val placed = best ?: return null
        split(placed)
        return placed
    }

    private fun split(used: Rect) {
        val added = mutableListOf<Rect>()
        val it = free.iterator()
        while (it.hasNext()) {
            val f = it.next()
            if (!f.intersects(used)) continue
            it.remove()
            if (used.x > f.x) added += Rect(f.x, f.y, used.x - f.x, f.h)
            if (used.right < f.right) added += Rect(used.right, f.y, f.right - used.right, f.h)
            if (used.y > f.y) added += Rect(f.x, f.y, f.w, used.y - f.y)
            if (used.bottom < f.bottom) added += Rect(f.x, used.bottom, f.w, f.bottom - used.bottom)
        }
        free += added
        // Убираем области, целиком лежащие внутри других.
        val pruned = free.filterIndexed { i, a -> free.withIndex().none { (j, b) -> i != j && b.contains(a) && (a != b || j < i) } }
        free.clear()
        free += pruned
    }
}

/** Ячейка для упаковки: размер с отступами, ключ — что положить. */
data class PackItem<T>(val key: T, val w: Int, val h: Int)

data class PackedPage<T>(val width: Int, val height: Int, val placements: Map<T, Rect>)

/**
 * Раскладывает элементы по страницам не больше [maxSize]×[maxSize].
 * Для каждой страницы подбирается самый маленький размер-степень двойки, куда поместится остаток;
 * если остаток не влезает и в максимум — страница заполняется сколько влезет, остальное — на следующую.
 */
fun <T> packPages(items: List<PackItem<T>>, maxSize: Int = 2048): List<PackedPage<T>> {
    val oversized = items.filter { it.w > maxSize || it.h > maxSize }
    require(oversized.isEmpty()) { "не влезают в атлас $maxSize: ${oversized.map { it.key }}" }
    val sorted = items.sortedWith(compareByDescending<PackItem<T>> { maxOf(it.w, it.h) }.thenByDescending { it.w * it.h })
    val pages = mutableListOf<PackedPage<T>>()
    var rest = sorted
    while (rest.isNotEmpty()) {
        val sizes = candidateSizes(maxSize).filter { (w, h) -> w * h >= rest.sumOf { it.w * it.h } || (w == maxSize && h == maxSize) }
        var page: PackedPage<T>? = null
        for ((w, h) in sizes) {
            val placed = tryPack(rest, w, h)
            if (placed.size == rest.size) { page = PackedPage(w, h, placed); break }
        }
        if (page == null) {
            val placed = tryPack(rest, maxSize, maxSize)
            check(placed.isNotEmpty()) { "упаковка зациклилась" }
            page = PackedPage(maxSize, maxSize, placed)
        }
        pages += page
        rest = rest.filter { it.key !in page.placements }
    }
    return pages
}

private fun <T> tryPack(items: List<PackItem<T>>, w: Int, h: Int): Map<T, Rect> {
    val bin = MaxRectsBin(w, h)
    val out = LinkedHashMap<T, Rect>()
    for (item in items) bin.insert(item.w, item.h)?.let { out[item.key] = it }
    return out
}

/** 64×64 … max×max по возрастанию площади (прямоугольники 2:1 тоже). */
private fun candidateSizes(max: Int): List<Pair<Int, Int>> {
    val sides = generateSequence(64) { it * 2 }.takeWhile { it <= max }.toList()
    return sides.flatMap { w -> sides.filter { h -> h == w || h == w / 2 || h == w * 2 }.map { h -> w to h } }
        .distinct()
        .sortedWith(compareBy({ it.first * it.second }, { maxOf(it.first, it.second) }))
}
