/**
 * Иконки, заставка и картинки для магазинов из листа art_extra/brand/s35_key_art.png
 * (промпт ПРОМПТЫ/12_splash_icon.txt) и логотипа art_extra/brand/logo.png (шрифт Rubik Dirt).
 * Запуск: npm run brand. Пишет:
 *  - store/ — для страниц игр: иконка 512, обложка Яндекса 800×470, баннер 1920×1080 (вне сборки);
 *  - public/brand/ — картинка экрана загрузки (в сборку);
 *  - art_extra/brand/android/ — иконки и заставка Android; patch-android копирует их в android/.
 * Лист: слева картина (до чёрной полосы), справа сверху — иконка на плите, справа снизу — эмблема
 * на пурпурном (для адаптивной иконки). Разделители ищутся по чёрным полосам.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp, { type Sharp } from 'sharp';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'art_extra/brand');
const SHEET = join(SRC, 's35_key_art.png');
const LOGO = join(SRC, 'logo.png');
/**
 * Иконка из отдельного листа «эмблема на пустоши» (s36), если он есть: квадрат вокруг эмблемы
 * (ICON_CROP — x, y, сторона в px листа); фон адаптивной иконки — та же пустошь, размытая.
 */
const ICON_SHEET = join(SRC, 's36_emblem_scene.png');
const ICON_CROP = { left: 385, top: 40, width: 760, height: 760 };
const STORE = join(ROOT, 'store');
const PUB = join(ROOT, 'public/brand');
const ANDROID = join(SRC, 'android');
/** Фон адаптивной иконки — тёмная ржавчина под цвет плиты эмблемы. */
export const ICON_BG = '#2b1d12';

const DENSITIES: Record<string, number> = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
/** Заставки Capacitor по плотностям (как создаёт cap add), альбомные; портретные — те же поворотом кадра. */
const SPLASH_LAND: Record<string, [number, number]> = {
  mdpi: [480, 320],
  hdpi: [800, 480],
  xhdpi: [1280, 720],
  xxhdpi: [1600, 960],
  xxxhdpi: [1920, 1280],
};

async function parts(): Promise<{ art: Sharp; icon: Sharp; emblem: Buffer }> {
  const { data, info } = await sharp(SHEET).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const dark = (x: number, y: number) => {
    const i = (y * W + x) * 3;
    return data[i]! < 24 && data[i + 1]! < 24 && data[i + 2]! < 24;
  };
  const colDark = (x: number) => {
    let n = 0;
    for (let y = 0; y < H; y += 2) if (dark(x, y)) n++;
    return n / (H / 2) > 0.9;
  };
  // Вертикальная полоса между картиной и колонкой иконок.
  let gx0 = -1;
  let gx1 = -1;
  for (let x = Math.floor(W * 0.5); x < W; x++)
    if (colDark(x)) {
      if (gx0 < 0) gx0 = x;
      gx1 = x;
    } else if (gx0 >= 0) break;
  if (gx0 < 0) throw new Error('brand: не найдена вертикальная чёрная полоса');
  const rx = gx1 + 1;
  const rw = W - rx;
  // Горизонтальная полоса в правой колонке.
  const rowDark = (y: number) => {
    let n = 0;
    for (let x = rx + 8; x < W - 8; x += 2) if (dark(x, y)) n++;
    return n / ((rw - 16) / 2) > 0.9;
  };
  let gy0 = -1;
  let gy1 = -1;
  for (let y = Math.floor(H * 0.3); y < H * 0.7; y++)
    if (rowDark(y)) {
      if (gy0 < 0) gy0 = y;
      gy1 = y;
    } else if (gy0 >= 0) break;
  if (gy0 < 0) throw new Error('brand: не найдена горизонтальная чёрная полоса');
  const art = sharp(SHEET).extract({ left: 0, top: 0, width: gx0, height: H });
  const ih = gy0;
  const icon = sharp(SHEET).extract({ left: rx, top: 0, width: rw, height: ih });
  // Эмблема на пурпурном: убираем фон (как в cut-sheets) и обрезаем по альфе.
  const ey = gy1 + 1;
  const { data: ed, info: ei } = await sharp(SHEET)
    .extract({ left: rx, top: ey, width: rw, height: H - ey })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(ei.width * ei.height * 4);
  for (let i = 0, o = 0; i < ei.width * ei.height; i++, o += 4) {
    const r = ed[i * 3]!;
    const g = ed[i * 3 + 1]!;
    const b = ed[i * 3 + 2]!;
    const m = Math.min(1, Math.max(0, (Math.min(r, b) - g - 25) / 110));
    const a = 1 - m < 0.12 ? 0 : 1 - m;
    const unk = (c: number, k: number) => Math.min(255, Math.max(0, (c - (1 - a) * k) / Math.max(a, 1e-3)));
    let cr = unk(r, 255);
    const cg = unk(g, 0);
    let cb = unk(b, 255);
    if (a < 0.98) {
      const sp = Math.max(0, Math.min(cr, cb) - cg - 20);
      cr -= sp * 0.7;
      cb -= sp * 0.7;
    }
    out[o] = cr;
    out[o + 1] = cg;
    out[o + 2] = cb;
    out[o + 3] = Math.round(a * 255);
  }
  const emblem = await sharp(out, { raw: { width: ei.width, height: ei.height, channels: 4 } })
    .trim()
    .png()
    .toBuffer();
  return { art, icon, emblem };
}

/** Картина с логотипом сверху по центру (logoW — доля ширины), кадр w×h «cover». */
async function withLogo(art: Sharp, w: number, h: number, logoW = 0.62, logoY = 0.08): Promise<Buffer> {
  const bg = await art.clone().resize(w, h, { fit: 'cover', position: 'centre' }).toBuffer();
  const logo = await sharp(LOGO)
    .resize(Math.round(w * logoW))
    .toBuffer();
  const lm = await sharp(logo).metadata();
  return sharp(bg)
    .composite([{ input: logo, left: Math.round((w - lm.width!) / 2), top: Math.round(h * logoY) }])
    .toBuffer();
}

async function main(): Promise<void> {
  const p = await parts();
  const { art, emblem } = p;
  const scene = existsSync(ICON_SHEET);
  const icon = scene ? sharp(ICON_SHEET).extract(ICON_CROP) : p.icon;
  mkdirSync(STORE, { recursive: true });
  mkdirSync(PUB, { recursive: true });
  // Магазины.
  await icon.clone().resize(512, 512, { fit: 'cover' }).png().toFile(join(STORE, 'icon_512.png'));
  await sharp(await withLogo(art, 800, 470))
    .png()
    .toFile(join(STORE, 'yandex_cover_800x470.png'));
  await sharp(await withLogo(art, 1920, 1080, 0.5))
    .jpeg({ quality: 90 })
    .toFile(join(STORE, 'banner_1920x1080.jpg'));
  await sharp(await withLogo(art, 1024, 1024, 0.7))
    .png()
    .toFile(join(STORE, 'key_art_1024.png'));
  // Экран загрузки игры: картина без логотипа (логотип рисует игра шрифтом), лёгкий JPEG.
  await art
    .clone()
    .resize({ height: 720 })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(join(PUB, 'loading.jpg'));
  // Android: иконки (обычная, круглая, передний план адаптивной) и заставка.
  for (const [d, k] of Object.entries(DENSITIES)) {
    const dir = join(ANDROID, `mipmap-${d}`);
    mkdirSync(dir, { recursive: true });
    const s = Math.round(48 * k);
    await icon.clone().resize(s, s, { fit: 'cover' }).png().toFile(join(dir, 'ic_launcher.png'));
    // Круглая — та же плита, обрезанная кругом.
    const circle = Buffer.from(
      `<svg width="${s}" height="${s}"><circle cx="${s / 2}" cy="${s / 2}" r="${s / 2}"/></svg>`,
    );
    await icon
      .clone()
      .resize(s, s, { fit: 'cover' })
      .composite([{ input: circle, blend: 'dest-in' }])
      .png()
      .toFile(join(dir, 'ic_launcher_round.png'));
    const f = Math.round(108 * k);
    if (scene) {
      // Адаптивная иконка: передний план — кадр с эмблемой в видимой зоне 72 dp (лаунчер режет
      // кругом/скруглённым квадратом), задний — та же пустошь, размытая, на все 108 dp.
      const v = Math.round(72 * k);
      const fg = await icon.clone().resize(v, v).toBuffer();
      await sharp({
        create: { width: f, height: f, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite([{ input: fg, left: Math.round((f - v) / 2), top: Math.round((f - v) / 2) }])
        .png()
        .toFile(join(dir, 'ic_launcher_foreground.png'));
      await sharp(ICON_SHEET)
        .resize(f, f, { fit: 'cover' })
        .blur(Math.max(1, 3 * k))
        .png()
        .toFile(join(dir, 'ic_launcher_background.png'));
      continue;
    }
    // Передний план адаптивной иконки: 108 dp, видимая зона — центральные 66 dp; эмблема ~60 dp.
    const e = Math.round(60 * k);
    const em = await sharp(emblem)
      .resize(e, e, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();
    await sharp({ create: { width: f, height: f, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: em, left: Math.round((f - e) / 2), top: Math.round((f - e) / 2) }])
      .png()
      .toFile(join(dir, 'ic_launcher_foreground.png'));
  }
  for (const [d, [w, h]] of Object.entries(SPLASH_LAND)) {
    for (const [o, ww, hh] of [
      ['land', w, h],
      ['port', h, w],
    ] as const) {
      const dir = join(ANDROID, `drawable-${o}-${d}`);
      mkdirSync(dir, { recursive: true });
      await sharp(await withLogo(art, ww, hh, o === 'land' ? 0.5 : 0.8, 0.1))
        .png()
        .toFile(join(dir, 'splash.png'));
    }
  }
  mkdirSync(join(ANDROID, 'drawable'), { recursive: true });
  await sharp(await withLogo(art, 1280, 720, 0.5, 0.1))
    .png()
    .toFile(join(ANDROID, 'drawable', 'splash.png'));
  if (scene) {
    // Задний план адаптивной иконки — картинка, а не цвет.
    const any = join(ANDROID, 'mipmap-anydpi-v26');
    mkdirSync(any, { recursive: true });
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
    writeFileSync(join(any, 'ic_launcher.xml'), xml);
    writeFileSync(join(any, 'ic_launcher_round.xml'), xml);
  }
  writeFileSync(
    join(ANDROID, 'ic_launcher_background.txt'),
    `${ICON_BG}\n— цвет фона адаптивной иконки (values/ic_launcher_background.xml)\n`,
  );
  console.log('brand: store/, public/brand/loading.jpg, art_extra/brand/android/');
}

await main();
