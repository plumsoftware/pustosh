/**
 * Нарезка дополнительных листов (art_extra/sheets.json) на спрайты. Запуск: npm run cut-sheets
 *
 * Лист — сетка rows × cols, один объект в ячейке (промпты — ПРОМПТЫ/). Фон убирается как в
 * tools/cutter.py пакета (магента/синий/чёрный с подавлением каймы), объект обрезается по альфе
 * с отступом 2 px → art/assets/<folder>/<name>.png; записи манифеста добавляются/обновляются.
 * Запускать после sync-package: он перезаписывает art/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..');
const EXTRA = join(ROOT, 'art_extra');
const ART = join(ROOT, 'art');
const MANIFEST = join(ART, 'assets_manifest.json');
const PAD = 2;
/** Пиксели слабее этой альфы — фон. */
const ALPHA_MIN = 0.12;
/** Области меньше этой доли листа — шум (как min_frac в cutter.py). */
const MIN_AREA_FRAC = 0.00012;
/** Метки связных областей последнего листа (cellComponents). */
let lab = new Int32Array(0);

type Key = 'magenta' | 'blue' | 'black';
interface SheetJob {
  file: string;
  folder: string;
  key: Key;
  grid: [rows: number, cols: number];
  names: (string | null)[];
  scaleMode: string;
  targetPx: number;
  pivot: string;
  /**
   * Общий масштаб листа: логических px на px листа. Тогда каждому спрайту — scaleMode height с
   * targetPx = высота × pxScale, и пропорции между спрайтами листа сохраняются.
   */
  pxScale?: number | null;
  /** Центры объектов, px листа, по порядку имён — вместо сетки, если объекты сдвинуты. */
  points?: [number, number][];
  /** Переопределения по имени (регулярное выражение): scaleMode, targetPx, pivot, pxScale, folder. */
  overrides?: ({ match: string } & Partial<Pick<SheetJob, 'scaleMode' | 'targetPx' | 'pivot' | 'folder'>> & {
      pxScale?: number | null;
    })[];
}
interface ManifestEntry {
  id: string;
  path: string;
  folder: string;
  name: string;
  sourceSheet: string;
  srcSize: [number, number];
  status: string;
  scaleMode: string;
  targetPx: number;
  pivot: string;
}

/** Альфа и цвет без фона (формулы tools/cutter.py → key_alpha). */
function keyPixel(r: number, g: number, b: number, key: Key): [number, number, number, number] {
  if (key === 'black') {
    const a = Math.min(1, (Math.max(r, g, b) / 255) * 1.15);
    if (a < 0.06) return [0, 0, 0, 0];
    return [Math.min(255, r / a), Math.min(255, g / a), Math.min(255, b / a), a];
  }
  const m =
    key === 'magenta'
      ? Math.min(1, Math.max(0, (Math.min(r, b) - g - 25) / 110))
      : Math.min(1, Math.max(0, (b - Math.max(r, g) - 35) / 95));
  let a = 1 - m;
  if (a < ALPHA_MIN) return [0, 0, 0, 0];
  const K = key === 'magenta' ? [255, 0, 255] : [0, 0, 255];
  let cr = Math.min(255, Math.max(0, (r - (1 - a) * K[0]!) / a));
  const cg = Math.min(255, Math.max(0, (g - (1 - a) * K[1]!) / a));
  let cb = Math.min(255, Math.max(0, (b - (1 - a) * K[2]!) / a));
  if (a < 0.98) {
    if (key === 'magenta') {
      // Подавить розовую кайму по краю.
      const sp = Math.max(0, Math.min(cr, cb) - cg - 20);
      cr -= sp * 0.7;
      cb -= sp * 0.7;
    } else {
      cb = Math.min(cb, Math.max(cr, cg) * 0.9 + 6);
      if (cr > cg + 25) cr = cg + 25;
    }
  }
  a = Math.min(1, a);
  return [cr, cg, cb, a];
}

interface CellGroup {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  labels: Set<number>;
}

/**
 * Связные области непрозрачных пикселей (с расширением на dil px, чтобы капли и искры держались
 * своего объекта), каждая — в ячейку по центру масс; рамка — по самим пикселям, без расширения.
 */
function cellComponents(
  px: Buffer,
  W: number,
  H: number,
  rows: number,
  cols: number,
  dil: number,
  points?: [number, number][],
): Map<number, CellGroup> {
  const solid = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) solid[k] = px[k * 4 + 3]! > 15 ? 1 : 0;
  // Расширение квадратом (2·dil+1): по строкам, затем по столбцам.
  const tmp = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    let last = -1e9;
    for (let x = 0; x < W; x++) {
      if (solid[y * W + x]) last = x;
      tmp[y * W + x] = x - last <= dil ? 1 : 0;
    }
    last = 1e9;
    for (let x = W - 1; x >= 0; x--) {
      if (solid[y * W + x]) last = x;
      if (last - x <= dil) tmp[y * W + x] = 1;
    }
  }
  const big = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) {
    let last = -1e9;
    for (let y = 0; y < H; y++) {
      if (tmp[y * W + x]) last = y;
      big[y * W + x] = y - last <= dil ? 1 : 0;
    }
    last = 1e9;
    for (let y = H - 1; y >= 0; y--) {
      if (tmp[y * W + x]) last = y;
      if (last - y <= dil) big[y * W + x] = 1;
    }
  }
  lab = new Int32Array(W * H);
  const groups = new Map<number, CellGroup>();
  const stack: number[] = [];
  let next = 0;
  for (let start = 0; start < W * H; start++) {
    if (!big[start] || lab[start]) continue;
    const id = ++next;
    lab[start] = id;
    stack.push(start);
    let area = 0;
    let sx = 0;
    let sy = 0;
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % W;
      const y = (k - x) / W;
      if (solid[k]) {
        area++;
        sx += x;
        sy += y;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      for (const n of [
        x > 0 ? k - 1 : -1,
        x < W - 1 ? k + 1 : -1,
        y > 0 ? k - W : -1,
        y < H - 1 ? k + W : -1,
      ])
        if (n >= 0 && big[n] && !lab[n]) {
          lab[n] = id;
          stack.push(n);
        }
    }
    if (area < MIN_AREA_FRAC * W * H) continue;
    const mx = sx / area;
    const my = sy / area;
    let cell: number;
    if (points) {
      // Ячейка — ближайшая заданная точка (лист, где объекты сдвинуты относительно сетки).
      cell = 0;
      let best = Infinity;
      points.forEach(([px, py], i) => {
        const d = Math.hypot(px - mx, py - my);
        if (d < best) {
          best = d;
          cell = i;
        }
      });
    } else {
      const r = Math.min(rows - 1, Math.floor(my / (H / rows)));
      const c = Math.min(cols - 1, Math.floor(mx / (W / cols)));
      cell = r * cols + c;
    }
    const g = groups.get(cell);
    if (!g) groups.set(cell, { x0, y0, x1, y1, labels: new Set([id]) });
    else {
      g.labels.add(id);
      g.x0 = Math.min(g.x0, x0);
      g.y0 = Math.min(g.y0, y0);
      g.x1 = Math.max(g.x1, x1);
      g.y1 = Math.max(g.y1, y1);
    }
  }
  return groups;
}

async function cutSheet(job: SheetJob): Promise<ManifestEntry[]> {
  const src = join(EXTRA, 'sheets', job.file);
  const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const keyed = Buffer.alloc(W * H * 4);
  for (let i = 0, o = 0; i < W * H; i++, o += 4) {
    const [r, g, b, a] = keyPixel(data[i * 3]!, data[i * 3 + 1]!, data[i * 3 + 2]!, job.key);
    keyed[o] = Math.round(r);
    keyed[o + 1] = Math.round(g);
    keyed[o + 2] = Math.round(b);
    keyed[o + 3] = Math.round(a * 255);
  }
  const [rows, cols] = job.grid;
  const groups = cellComponents(keyed, W, H, rows, cols, job.key === 'black' ? 8 : 3, job.points);
  const out: ManifestEntry[] = [];
  const sheetId = job.file.replace(/\.png$/, '');
  for (let idx = 0; idx < rows * cols; idx++) {
    const name = job.names[idx];
    if (!name) continue;
    const o = { ...job, ...job.overrides?.find((x) => new RegExp(`^(${x.match})$`).test(name)) };
    if (o.pxScale === null) delete o.pxScale; // null в переопределении — без общего масштаба
    const dir = join(ART, 'assets', o.folder);
    mkdirSync(dir, { recursive: true });
    const g = groups.get(idx);
    if (!g) throw new Error(`${job.file}: пустая ячейка ${idx + 1} (${name})`);
    const { x0, y0, x1, y1, labels } = g;
    // Только пиксели своих областей: соседний объект, заходящий в рамку, не попадёт.
    const own = Buffer.alloc(W * H * 4);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const k = y * W + x;
        if (labels.has(lab[k]!) && keyed[k * 4 + 3]! > 0) keyed.copy(own, k * 4, k * 4, k * 4 + 4);
      }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const px = Buffer.alloc((w + PAD * 2) * (h + PAD * 2) * 4);
    for (let y = 0; y < h; y++)
      own.copy(
        px,
        ((y + PAD) * (w + PAD * 2) + PAD) * 4,
        ((y0 + y) * W + x0) * 4,
        ((y0 + y) * W + x0 + w) * 4,
      );
    await sharp(px, { raw: { width: w + PAD * 2, height: h + PAD * 2, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toFile(join(dir, `${name}.png`));
    const folderId = o.folder.replace(/\//g, '.');
    out.push({
      id: `${folderId}.${name}`,
      path: `assets/${o.folder}/${name}.png`,
      folder: o.folder,
      name,
      sourceSheet: sheetId,
      srcSize: [w + PAD * 2, h + PAD * 2],
      status: 'ok',
      scaleMode: o.pxScale ? 'height' : o.scaleMode,
      targetPx: o.pxScale ? Math.max(1, Math.round(h * o.pxScale)) : o.targetPx,
      pivot: o.pivot,
    });
  }
  return out;
}

async function main(): Promise<void> {
  const jobs = (JSON.parse(readFileSync(join(EXTRA, 'sheets.json'), 'utf8')) as { sheets: SheetJob[] })
    .sheets;
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { count: number; assets: ManifestEntry[] };
  for (const job of jobs) {
    if (!existsSync(join(EXTRA, 'sheets', job.file)))
      throw new Error(`нет листа art_extra/sheets/${job.file}`);
    const entries = await cutSheet(job);
    for (const e of entries) {
      const i = manifest.assets.findIndex((a) => a.id === e.id);
      if (i >= 0) manifest.assets[i] = e;
      else manifest.assets.push(e);
    }
    console.log(`${job.file}: ${entries.length} спрайтов`);
  }
  manifest.count = manifest.assets.length;
  // Курсоры для браузера — отдельные PNG 32×32 (CSS cursor не берёт кадры атласа).
  const cur = join(ART, 'assets', 'ui', 'kit');
  const outDir = join(ROOT, 'public', 'cursors');
  mkdirSync(outDir, { recursive: true });
  for (const n of ['cursor_normal', 'cursor_active', 'cursor_grab'])
    if (existsSync(join(cur, `${n}.png`)))
      await sharp(join(cur, `${n}.png`))
        .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(join(outDir, `${n.replace('cursor_', '')}.png`));
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + '\n');
}

await main();
