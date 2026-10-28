/**
 * Упаковка спрайтов в атласы Phaser (шаг 2.2). Запуск: npm run pack-assets [-- --webp] [-- --force]
 *
 * art/assets_manifest.json + art/assets/** → public/atlases/<group>.png|json, asset_index.json,
 * atlas_groups.json, .cache.json; отчёт — docs/ASSET_REPORT.md.
 * Исходники в art/ не меняются. Размер в атласе — targetPx × 2 (логический размер × 2).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MaxRectsPacker, type IRectangle } from 'maxrects-packer';
import sharp from 'sharp';

// ---------------------------------------------------------------- настройки

const ROOT = resolve(import.meta.dirname, '..');
const ART = join(ROOT, 'art');
const MANIFEST = join(ART, 'assets_manifest.json');
const OUT = join(ROOT, 'public/atlases');
const REPORT = join(ROOT, 'docs/ASSET_REPORT.md');

const WEBP = process.argv.includes('--webp');
const FORCE = process.argv.includes('--force');

/** Атласы хранятся в 2x для чётких экранов телефонов. */
const ATLAS_SCALE = 2;
const SHEET_MAX = 2048;
const PADDING = 2;
const EXTRUDE = 1;
const EXTRUDE_TILES = 2;
/** Части персонажей не ресайзятся, но не больше этого размера по длинной стороне. */
const RIG_MAX_SIDE = 512;
/** Доля высоты языка в animals/toad_tongue_and_sac (ASSETS.md §6). */
const TOAD_TONGUE_FRAC = 0.25;
/** Цель для первой загрузки (ТЗ шаг 2.2.8). */
const FIRST_LOAD_BUDGET_MB = 15;

/** Версия логики упаковки — входит в хеш кэша; менять при изменении алгоритма. */
const PACKER_VERSION = 3;

type Load = 'start' | 'lazy';
const GROUPS: Record<string, Load> = {
  ui: 'start',
  icons: 'start',
  tiles: 'start',
  walls: 'start',
  interior: 'start',
  biome1: 'start',
  biome2: 'lazy',
  biome3: 'lazy',
  biome4: 'lazy',
  biome5: 'lazy',
  biome6: 'lazy',
  hero: 'start',
  enemies: 'start',
  animals: 'start',
  bosses: 'lazy',
  vehicles: 'lazy',
  effects: 'start',
};

const PIVOT_ORIGIN: Record<string, [number, number]> = {
  bottom_center: [0.5, 1],
  center: [0.5, 0.5],
  top_left: [0, 0],
  rig: [0.5, 0.5],
};

/** Детали стен (building.json → pieces): лица по ширине, верх и пол квадратом, обломки по ширине. */
const WALL_FACE_PIECES = new Set([
  'face',
  'window',
  'window_boarded',
  'door_opening',
  'door',
  'fence',
  'damage_overlay',
]);
const WALL_SQUARE_PIECES = new Set(['top_cap', 'floor']);
const WALL_WIDTH_PIECES = new Set(['rubble']);

// ---------------------------------------------------------------- типы

interface ManifestEntry {
  id: string;
  path: string;
  folder: string;
  name: string;
  srcSize: [number, number];
  status: 'ok' | 'replaced' | 'alternative';
  scaleMode: 'height' | 'width' | 'fit_box' | 'exact' | 'special' | 'rig';
  targetPx: number;
  pivot: string;
  replacedBy?: string;
}

interface Sprite {
  id: string;
  group: string;
  /** Путь к исходнику относительно art/. */
  src: string;
  /** Вырезать часть исходника (доли высоты) — для составных файлов. */
  crop?: { top: number; bottom: number };
  /** Размер в атласе (2x). */
  w: number;
  h: number;
  origin: [number, number];
  scaleMode: ManifestEntry['scaleMode'];
  extrude: number;
  derivedFrom?: string;
}

export interface AssetIndexEntry {
  group: string;
  frame: string;
  origin: [number, number];
  /** Логический размер (1x). */
  size: [number, number];
  /** Часть персонажа: масштаб задаёт риг, size — справочно. */
  rig?: true;
}

export interface AtlasGroupInfo {
  load: Load;
  /** atlas — один лист, multiatlas — несколько. */
  type: 'atlas' | 'multiatlas';
  json: string;
  images: string[];
  bytes: number;
  frames: number;
}

// ---------------------------------------------------------------- сборка списка спрайтов

function groupOf(e: ManifestEntry): string | null {
  const f = e.folder;
  if (f === 'ui') return 'ui';
  if (f.startsWith('icons/')) return 'icons';
  if (f === 'replacements') return e.scaleMode === 'fit_box' ? 'icons' : 'interior';
  if (f === 'tiles') return 'tiles';
  if (f === 'building/walls') return 'walls';
  if (f === 'world/interior' || f === 'world/defense') return 'interior';
  const bm = /^world\/biome(\d)_/.exec(f);
  if (bm) return `biome${bm[1]}`;
  if (f === 'characters/hero') return 'hero';
  if (f === 'characters/enemies') return 'enemies';
  if (f === 'characters/animals') return 'animals';
  if (f === 'characters/bosses') return 'bosses';
  if (f === 'vehicles') return 'vehicles';
  if (f === 'effects') return 'effects';
  return null;
}

/** Целевой размер в атласе (2x). */
function targetSize(e: ManifestEntry, srcW: number, srcH: number): [number, number] {
  const T = e.targetPx * ATLAS_SCALE;
  const prop = (w: number, h: number): [number, number] => [
    Math.max(1, Math.round(w)),
    Math.max(1, Math.round(h)),
  ];
  switch (e.scaleMode) {
    case 'height':
      return prop((srcW * T) / srcH, T);
    case 'width':
      return prop(T, (srcH * T) / srcW);
    case 'fit_box': {
      const k = Math.min(T / srcW, T / srcH);
      return prop(srcW * k, srcH * k);
    }
    case 'exact':
      return [T, T];
    case 'special': {
      const piece = e.name.slice(e.name.indexOf('_') + 1);
      if (WALL_SQUARE_PIECES.has(piece)) return [T, T];
      if (WALL_FACE_PIECES.has(piece) || WALL_WIDTH_PIECES.has(piece)) return prop(T, (srcH * T) / srcW);
      throw new Error(`${e.id}: неизвестная деталь стены «${piece}»`);
    }
    case 'rig': {
      const k = Math.min(1, RIG_MAX_SIDE / Math.max(srcW, srcH));
      return prop(srcW * k, srcH * k);
    }
  }
}

function originOf(e: ManifestEntry): [number, number] {
  if (e.scaleMode === 'special') return [0, 0]; // детали стен выкладываются по сетке от левого верхнего угла
  const o = PIVOT_ORIGIN[e.pivot];
  if (!o) throw new Error(`${e.id}: неизвестный pivot «${e.pivot}»`);
  return o;
}

// ---------------------------------------------------------------- кэш

function sha1(data: string | Buffer): string {
  return createHash('sha1').update(data).digest('hex');
}

function sourcesHash(entries: ManifestEntry[]): string {
  const h = createHash('sha1');
  h.update(readFileSync(MANIFEST));
  h.update(readFileSync(import.meta.filename));
  h.update(
    JSON.stringify({
      PACKER_VERSION,
      WEBP,
      ATLAS_SCALE,
      SHEET_MAX,
      PADDING,
      EXTRUDE,
      EXTRUDE_TILES,
      RIG_MAX_SIDE,
    }),
  );
  for (const e of entries) {
    const p = join(ART, e.path);
    const st = statSync(p);
    h.update(`${e.path}:${st.size}:${st.mtimeMs}`);
  }
  return h.digest('hex');
}

// ---------------------------------------------------------------- упаковка

async function renderSprite(s: Sprite): Promise<Buffer> {
  let img = sharp(join(ART, s.src)).ensureAlpha();
  if (s.crop) {
    const meta = await sharp(join(ART, s.src)).metadata();
    const H = meta.height ?? 0;
    const top = Math.round(H * s.crop.top);
    const bottom = Math.round(H * s.crop.bottom);
    img = sharp(
      await img.extract({ left: 0, top, width: meta.width ?? 0, height: bottom - top }).toBuffer(),
    ).trim({
      threshold: 1,
    });
    img = sharp(await img.png().toBuffer());
  }
  const resized = await img.resize(s.w, s.h, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
  if (s.extrude === 0) return resized;
  return sharp(resized)
    .extend({ top: s.extrude, bottom: s.extrude, left: s.extrude, right: s.extrude, extendWith: 'copy' })
    .png()
    .toBuffer();
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

interface PackRect extends IRectangle {
  sprite: Sprite;
  buf: Buffer;
}

interface SheetOut {
  file: string;
  w: number;
  h: number;
  bytes: number;
  frames: { sprite: Sprite; x: number; y: number }[];
}

async function packGroup(group: string, sprites: Sprite[]): Promise<SheetOut[]> {
  const bufs = await mapLimit(sprites, 8, renderSprite);
  const packer = new MaxRectsPacker<PackRect>(SHEET_MAX, SHEET_MAX, PADDING, {
    smart: true,
    pot: false,
    square: false,
    allowRotation: false,
    border: 0,
  });
  const rects: PackRect[] = sprites.map((s, i) => ({
    x: 0,
    y: 0,
    width: s.w + s.extrude * 2,
    height: s.h + s.extrude * 2,
    sprite: s,
    buf: bufs[i]!,
  }));
  // Крупные сначала — плотнее раскладка.
  rects.sort((a, b) => b.width * b.height - a.width * a.height);
  for (const r of rects) {
    if (r.width > SHEET_MAX || r.height > SHEET_MAX)
      throw new Error(`${r.sprite.id}: не влезает в лист ${SHEET_MAX}`);
  }
  packer.addArray(rects);

  const ext = WEBP ? 'webp' : 'png';
  const sheets: SheetOut[] = [];
  for (const [i, bin] of packer.bins.entries()) {
    const file = packer.bins.length === 1 ? `${group}.${ext}` : `${group}-${i}.${ext}`;
    const w = Math.max(...bin.rects.map((r) => r.x + r.width));
    const h = Math.max(...bin.rects.map((r) => r.y + r.height));
    const canvas = sharp({
      create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    });
    const composed = canvas.composite(bin.rects.map((r) => ({ input: r.buf, left: r.x, top: r.y })));
    const data = WEBP
      ? await composed.webp({ quality: 90, alphaQuality: 100, effort: 5 }).toBuffer()
      : await composed.png({ compressionLevel: 9, effort: 8 }).toBuffer();
    writeFileSync(join(OUT, file), data);
    sheets.push({
      file,
      w,
      h,
      bytes: data.length,
      frames: bin.rects.map((r) => ({
        sprite: r.sprite,
        x: r.x + r.sprite.extrude,
        y: r.y + r.sprite.extrude,
      })),
    });
  }
  return sheets;
}

function frameJson(f: SheetOut['frames'][number]) {
  const { w, h } = f.sprite;
  return {
    frame: { x: f.x, y: f.y, w, h },
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w, h },
    sourceSize: { w, h },
  };
}

function writeAtlasJson(group: string, sheets: SheetOut[]): string {
  const file = `${group}.json`;
  if (sheets.length === 1) {
    const s = sheets[0]!;
    const frames = Object.fromEntries(s.frames.map((f) => [f.sprite.id, frameJson(f)]));
    const json = {
      frames,
      meta: { app: 'pustosh pack-assets', image: s.file, size: { w: s.w, h: s.h }, scale: '1' },
    };
    writeFileSync(join(OUT, file), JSON.stringify(json));
  } else {
    const textures = sheets.map((s) => ({
      image: s.file,
      format: 'RGBA8888',
      size: { w: s.w, h: s.h },
      scale: 1,
      frames: s.frames.map((f) => ({ filename: f.sprite.id, ...frameJson(f) })),
    }));
    writeFileSync(join(OUT, file), JSON.stringify({ textures, meta: { app: 'pustosh pack-assets' } }));
  }
  return file;
}

// ---------------------------------------------------------------- отчёт

const kb = (b: number) => `${(b / 1024).toFixed(0)} КБ`;
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(2)} МБ`;

function writeReport(
  groups: Record<string, AtlasGroupInfo>,
  sheetsByGroup: Record<string, SheetOut[]>,
  replaced: ManifestEntry[],
  derived: Sprite[],
  index: Record<string, AssetIndexEntry>,
  manifest: ManifestEntry[],
): void {
  const total = Object.values(groups).reduce((a, g) => a + g.bytes, 0);
  const first = Object.values(groups)
    .filter((g) => g.load === 'start')
    .reduce((a, g) => a + g.bytes, 0);
  const dataBytes = readdirSync(join(ROOT, 'public/data'))
    .filter((f) => f.endsWith('.json'))
    .reduce((a, f) => a + statSync(join(ROOT, 'public/data', f)).size, 0);
  const indexBytes = statSync(join(OUT, 'asset_index.json')).size;
  const firstAll = first + dataBytes + indexBytes;

  const L: string[] = [];
  L.push('# Отчёт об упаковке ассетов', '');
  L.push(
    `Создан \`npm run pack-assets\`${WEBP ? ' --webp' : ''}. Формат листов: **${WEBP ? 'WebP' : 'PNG'}**, масштаб атласов 2x, лист до ${SHEET_MAX}×${SHEET_MAX}, отступ ${PADDING} px, выдавливание края ${EXTRUDE} px (тайлы ${EXTRUDE_TILES} px).`,
    '',
  );
  L.push('## Итог', '');
  L.push('| Что | Вес |', '| --- | --- |');
  L.push(`| Все атласы | ${mb(total)} |`);
  L.push(`| **Первая загрузка** (группы «при старте» + данные + индекс) | **${mb(firstAll)}** |`);
  L.push(`| — из них атласы | ${mb(first)} |`);
  L.push(`| — данные \`public/data\` | ${kb(dataBytes)} |`);
  L.push(`| — \`asset_index.json\` | ${kb(indexBytes)} |`);
  L.push(`| Ленивые группы (биомы 2–6, боссы, транспорт) | ${mb(total - first)} |`);
  L.push(`| Спрайтов в индексе | ${Object.keys(index).length} |`);
  L.push('');
  L.push(
    firstAll <= FIRST_LOAD_BUDGET_MB * 1024 * 1024
      ? `Первая загрузка укладывается в цель ~${FIRST_LOAD_BUDGET_MB} МБ.`
      : `**Первая загрузка больше цели ~${FIRST_LOAD_BUDGET_MB} МБ.** Варианты: \`npm run pack-assets -- --webp\` (WebP поддерживается Safari 14+ / iOS 14+), понижение 2x → 1.5x для крупных групп (персонажи, биомы).`,
  );
  L.push('');
  L.push('## Атласы', '');
  L.push(
    '| Группа | Загрузка | Листы | Размер листов, px | Кадров | Вес |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const [g, info] of Object.entries(groups)) {
    const sheets = sheetsByGroup[g] ?? [];
    L.push(
      `| \`${g}\` | ${info.load === 'start' ? 'при старте' : 'лениво'} | ${sheets.length} | ${sheets.map((s) => `${s.w}×${s.h}`).join(', ')} | ${info.frames} | ${kb(info.bytes)} |`,
    );
  }
  L.push('');
  L.push(`## Пропущены (status: replaced) — ${replaced.length}`, '');
  for (const r of replaced) L.push(`- \`${r.id}\` → \`${r.replacedBy ?? '?'}\``);
  L.push('');
  L.push('## Разрезанные составные файлы', '');
  for (const d of derived)
    L.push(
      `- \`${d.derivedFrom}\` → \`${d.id}\` (${d.crop ? `${d.crop.top * 100}–${d.crop.bottom * 100}% высоты` : ''})`,
    );
  L.push('');

  // Сравнение масштабов с эталоном героя (критерий приёмки шага 2).
  const hero = manifest.find((e) => e.id === 'characters.hero.ref_idle');
  if (hero) {
    const heroH = hero.targetPx;
    const heroW = (hero.srcSize[0] * heroH) / hero.srcSize[1];
    const size = (id: string) => index[id]?.size;
    /** measure: h — высота спрайта к росту героя; w — ширина спрайта к росту героя. */
    const row = (
      label: string,
      ids: string[],
      measure: 'h' | 'w',
      want: string,
      ok: (k: number) => boolean,
    ) => {
      for (const id of ids) {
        const s = size(id);
        if (!s) continue;
        const k = (measure === 'h' ? s[1] : s[0]) / heroH;
        L.push(
          `| ${label} | \`${id}\` | ${s[0].toFixed(0)}×${s[1].toFixed(0)} | ${k.toFixed(2)} | ${want} | ${ok(k) ? 'да' : '**нет**'} |`,
        );
      }
    };
    L.push('## Масштаб относительно героя', '');
    L.push(
      `Эталон \`characters.hero.ref_idle\`: рост ${heroH} px, ширина ≈ ${heroW.toFixed(0)} px (логический размер). ` +
        'Критерий «машина в 1.5–2 раза шире героя» считается от **роста** героя: от ширины фигуры (≈ 42 px) машина вышла бы ниже пояса.',
      '',
    );
    L.push(
      '| Проверка | Спрайт | Размер, px | Отношение к росту | Нужно | Ок |',
      '| --- | --- | --- | --- | --- | --- |',
    );
    const ids = (re: RegExp) =>
      Object.keys(index)
        .filter((id) => re.test(id))
        .sort();
    row(
      'дерево ≈ 2 роста',
      ids(/^world\.biome1_suburb\.(pine|birch|oak|dead_tree)$/),
      'h',
      '1.6–2.4 роста',
      (k) => k >= 1.6 && k <= 2.4,
    );
    row(
      'машина: ширина 1.5–2 роста',
      ids(/^vehicles\.(pickup|buggy|snowcat)_body$/),
      'w',
      '1.5–2',
      (k) => k >= 1.5 && k <= 2,
    );
    row(
      'обломок машины сбоку',
      ids(/^world\.biome1_suburb\.(car_hatchback|car_frame)$/),
      'w',
      '1.5–2',
      (k) => k >= 1.5 && k <= 2,
    );
    row(
      'двухколёсные/квадроцикл ниже героя',
      ids(/^vehicles\.(bicycle|moped|moto|quad)_body$/),
      'h',
      '< 0.7',
      (k) => k < 0.7,
    );
    row('ящик ниже пояса', ids(/^world\.interior\.crate_/), 'h', '< 0.5 роста', (k) => k < 0.5);
    L.push('');
  }

  writeFileSync(REPORT, L.join('\n'));
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  const t0 = performance.now();
  const manifest = (JSON.parse(readFileSync(MANIFEST, 'utf8')) as { assets: ManifestEntry[] }).assets;
  const replaced = manifest.filter((e) => e.status === 'replaced');
  const used = manifest.filter((e) => e.status !== 'replaced');

  const hash = sourcesHash(used);
  const cacheFile = join(OUT, '.cache.json');
  if (!FORCE && existsSync(cacheFile) && existsSync(join(OUT, 'asset_index.json'))) {
    const cache = JSON.parse(readFileSync(cacheFile, 'utf8')) as { hash: string };
    if (cache.hash === hash) {
      console.log('pack-assets: исходники не менялись, атласы актуальны.');
      return;
    }
  }

  // Спрайты
  const sprites: Sprite[] = [];
  const derived: Sprite[] = [];
  for (const e of used) {
    const group = groupOf(e);
    if (!group) throw new Error(`${e.id}: не определена группа атласа для папки ${e.folder}`);
    if (!(group in GROUPS)) throw new Error(`${e.id}: группа ${group} не описана`);
    const [w, h] = targetSize(e, e.srcSize[0], e.srcSize[1]);
    const base: Sprite = {
      id: e.id,
      group,
      src: e.path,
      w,
      h,
      origin: originOf(e),
      scaleMode: e.scaleMode,
      extrude: group === 'tiles' ? EXTRUDE_TILES : EXTRUDE,
    };
    sprites.push(base);

    // Составной файл жабы: язык (верх) и горловой мешок (остальное). Исходный кадр остаётся.
    if (e.id === 'characters.animals.toad_tongue_and_sac') {
      for (const [suffix, crop] of [
        ['toad_tongue', { top: 0, bottom: TOAD_TONGUE_FRAC }],
        ['toad_sac', { top: TOAD_TONGUE_FRAC, bottom: 1 }],
      ] as const) {
        // Размер после обрезки по альфе известен только после чтения — считаем заранее.
        // sharp выполняет trim раньше extract, поэтому — два отдельных конвейера.
        const cut = await sharp(join(ART, e.path))
          .extract({
            left: 0,
            top: Math.round(e.srcSize[1] * crop.top),
            width: e.srcSize[0],
            height: Math.round(e.srcSize[1] * crop.bottom) - Math.round(e.srcSize[1] * crop.top),
          })
          .png()
          .toBuffer();
        const part = await sharp(cut).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
        const d: Sprite = {
          ...base,
          id: `characters.animals.${suffix}`,
          crop,
          w: part.info.width,
          h: part.info.height,
          derivedFrom: e.id,
        };
        sprites.push(d);
        derived.push(d);
      }
    }
  }

  // Чистим выход (кроме кэша) и пакуем
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) if (f !== '.cache.json') rmSync(join(OUT, f));

  const groups: Record<string, AtlasGroupInfo> = {};
  const sheetsByGroup: Record<string, SheetOut[]> = {};
  const index: Record<string, AssetIndexEntry> = {};
  for (const group of Object.keys(GROUPS)) {
    const list = sprites.filter((s) => s.group === group);
    if (list.length === 0) continue;
    const sheets = await packGroup(group, list);
    sheetsByGroup[group] = sheets;
    const json = writeAtlasJson(group, sheets);
    groups[group] = {
      load: GROUPS[group]!,
      type: sheets.length === 1 ? 'atlas' : 'multiatlas',
      json,
      images: sheets.map((s) => s.file),
      bytes: sheets.reduce((a, s) => a + s.bytes, 0) + statSync(join(OUT, json)).size,
      frames: list.length,
    };
    for (const s of list) {
      index[s.id] = {
        group,
        frame: s.id,
        origin: s.origin,
        size: [s.w / ATLAS_SCALE, s.h / ATLAS_SCALE],
        ...(s.scaleMode === 'rig' ? { rig: true as const } : {}),
      };
    }
    console.log(`  ${group}: ${list.length} кадров, ${sheets.length} лист(а), ${kb(groups[group].bytes)}`);
  }

  const sortedIndex = Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(join(OUT, 'asset_index.json'), JSON.stringify(sortedIndex));
  writeFileSync(join(OUT, 'atlas_groups.json'), JSON.stringify({ scale: ATLAS_SCALE, groups }, null, 1));
  mkdirSync(join(ROOT, 'docs'), { recursive: true });
  writeReport(groups, sheetsByGroup, replaced, derived, sortedIndex, manifest);
  writeFileSync(
    cacheFile,
    JSON.stringify({ hash, version: PACKER_VERSION, sha: sha1(JSON.stringify(sortedIndex)) }),
  );

  console.log(
    `pack-assets: ${Object.keys(index).length} спрайтов, ${((performance.now() - t0) / 1000).toFixed(1)} с. Отчёт: docs/ASSET_REPORT.md`,
  );
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
