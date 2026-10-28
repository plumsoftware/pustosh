import type Phaser from 'phaser';
import { FONT } from './layout';

/**
 * Растровый шрифт, собранный кодом при запуске: все глифы в одной текстуре.
 * Нужен для часто меняющегося текста (часы HUD, счётчики, отладка): обычный Phaser Text при каждом
 * setText перезаливает текстуру в GPU, и на PowerVR (Unisoc T603) видеопамять от этого не освобождается —
 * за минуту игры уходили сотни МБ. BitmapText ничего не загружает.
 */
export const UI_FONT = 'ui-font';
export const UI_FONT_MONO = 'ui-font-mono';

const CHARS =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~' +
  'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя' +
  '«»—–…·×№°';
/** Размер глифов в текстуре; на экране шрифт масштабируется (setFontSize). */
const BASE_SIZE = 32;
const PAD = 3;
const STROKE = 4;

interface CharData {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  xOffset: number;
  yOffset: number;
  xAdvance: number;
  data: object;
  kerning: object;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

function build(scene: Phaser.Scene, key: string, family: string, weight: string): void {
  if (scene.textures.exists(key)) return;
  const font = `${weight} ${BASE_SIZE}px ${family}`;
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = font;
  const lineHeight = Math.ceil(BASE_SIZE * 1.3);
  const cellH = lineHeight + PAD * 2;
  const glyphs = [...CHARS].map((ch) => ({ ch, w: Math.ceil(measure.measureText(ch).width) }));
  const maxW = 1024;
  let x = 0;
  let y = 0;
  const pos: { ch: string; w: number; x: number; y: number }[] = [];
  for (const g of glyphs) {
    const cw = g.w + PAD * 2;
    if (x + cw > maxW) {
      x = 0;
      y += cellH;
    }
    pos.push({ ...g, x, y });
    x += cw;
  }
  const texH = y + cellH;
  const tex = scene.textures.createCanvas(key, maxW, texH)!;
  const ctx = tex.context;
  ctx.font = font;
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.lineWidth = STROKE;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.fillStyle = '#ffffff';
  const chars: Record<number, CharData> = {};
  for (const p of pos) {
    const gx = p.x + PAD;
    const gy = p.y + PAD + Math.round((lineHeight - BASE_SIZE) / 2);
    // Тёмная обводка — текст читается на любом фоне; тинт BitmapText окрашивает белую заливку.
    ctx.strokeText(p.ch, gx, gy);
    ctx.fillText(p.ch, gx, gy);
    const w = p.w + PAD * 2;
    chars[p.ch.codePointAt(0)!] = {
      x: p.x,
      y: p.y,
      width: w,
      height: cellH,
      centerX: Math.floor(w / 2),
      centerY: Math.floor(cellH / 2),
      xOffset: -PAD,
      yOffset: 0,
      xAdvance: p.w,
      data: {},
      kerning: {},
      u0: p.x / maxW,
      v0: p.y / texH,
      u1: (p.x + w) / maxW,
      v1: (p.y + cellH) / texH,
    };
  }
  tex.refresh();
  scene.cache.bitmapFont.add(key, {
    data: { font: key, size: BASE_SIZE, lineHeight: cellH, retroFont: false, chars },
    texture: key,
    frame: null,
  });
}

/** Создаёт растровые шрифты (один раз за игру). */
export function ensureBitmapFonts(scene: Phaser.Scene): void {
  build(scene, UI_FONT, FONT, '600');
  build(scene, UI_FONT_MONO, 'ui-monospace, Menlo, Consolas, monospace', '500');
}
