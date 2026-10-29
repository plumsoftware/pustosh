/**
 * A* по клеткам (TZ 8.3.3): 8 направлений без срезания углов, в квадрате radius вокруг старта.
 * passable(tx, ty) — клетка проходима; wall(ax, ay, bx, by) — соседей по стороне разделяет стена
 * на ребре (постройки игрока). Возвращает путь клеток (без стартовой) или null.
 */
export function findPath(
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  radius: number,
  passable: (tx: number, ty: number) => boolean,
  maxNodes = 1500,
  wall: (ax: number, ay: number, bx: number, by: number) => boolean = () => false,
): [number, number][] | null {
  if (sx === gx && sy === gy) return [];
  const minX = sx - radius;
  const minY = sy - radius;
  const size = radius * 2 + 1;
  if (Math.abs(gx - sx) > radius || Math.abs(gy - sy) > radius) return null;
  const idx = (x: number, y: number) => (y - minY) * size + (x - minX);
  const g = new Float32Array(size * size).fill(Infinity);
  const from = new Int32Array(size * size).fill(-1);
  const closed = new Uint8Array(size * size);
  const open: { i: number; f: number }[] = [];
  const h = (x: number, y: number) => {
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return Math.max(dx, dy) + 0.41 * Math.min(dx, dy);
  };
  const start = idx(sx, sy);
  g[start] = 0;
  open.push({ i: start, f: h(sx, sy) });
  let nodes = 0;
  const goal = idx(gx, gy);
  while (open.length && nodes++ < maxNodes) {
    // Небольшой открытый список — линейный поиск минимума быстрее кучи.
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (open[k]!.f < open[bi]!.f) bi = k;
    const cur = open[bi]!;
    open[bi] = open[open.length - 1]!;
    open.pop();
    if (closed[cur.i]) continue;
    closed[cur.i] = 1;
    if (cur.i === goal) {
      const path: [number, number][] = [];
      for (let i = goal; i !== start; i = from[i]!)
        path.push([minX + (i % size), minY + Math.floor(i / size)]);
      return path.reverse();
    }
    const cx = minX + (cur.i % size);
    const cy = minY + Math.floor(cur.i / size);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < minX || ny < minY || nx >= minX + size || ny >= minY + size) continue;
        const ni = idx(nx, ny);
        if (closed[ni]) continue;
        if (ni !== goal && !passable(nx, ny)) continue;
        if (dx && dy && (!passable(cx + dx, cy) || !passable(cx, cy + dy))) continue;
        // По стороне — ребро между клетками; по диагонали — все четыре ребра вокруг угла.
        if (!dx || !dy) {
          if (wall(cx, cy, nx, ny)) continue;
        } else if (
          wall(cx, cy, cx + dx, cy) ||
          wall(cx, cy, cx, cy + dy) ||
          wall(cx + dx, cy, nx, ny) ||
          wall(cx, cy + dy, nx, ny)
        )
          continue;
        const ng = g[cur.i]! + (dx && dy ? 1.41 : 1);
        if (ng >= g[ni]!) continue;
        g[ni] = ng;
        from[ni] = cur.i;
        open.push({ i: ni, f: ng + h(nx, ny) });
      }
    }
  }
  return null;
}
