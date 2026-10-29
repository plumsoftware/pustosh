import Phaser from 'phaser';
import { ctx } from '../GameContext';
import { SceneKeys } from '../SceneKeys';
import { setTextRes } from '../ui/layout';

/**
 * Качество графики = масштаб рендера (пикселей канваса на CSS-пиксель). На слабом Android упираемся в
 * заполнение GPU (docs/PERF_BASELINE.md: rs 1 — 60 FPS, 1.5 — 47, 2 — 30), поэтому на телефоне по
 * умолчанию «Авто»: старт с высокого и шаг вниз, пока средний FPS в мире ниже AUTO_MIN_FPS.
 * Выбор — удобство игрока, хранится в браузере (как громкость).
 */
export type GraphicsQuality = 'auto' | 'low' | 'mid' | 'high';
export const QUALITIES: readonly GraphicsQuality[] = ['auto', 'low', 'mid', 'high'];

const KEY = 'pustosh.gfx';
/** Масштаб, до которого «Авто» опустилось на этом устройстве (следующий запуск начинается с него). */
const AUTO_KEY = 'pustosh.gfx.auto';
const SCALE: Record<Exclude<GraphicsQuality, 'auto'>, number> = { low: 1, mid: 1.5, high: 2 };
const STEPS = [2, 1.5, 1];
const AUTO_MIN_FPS = 50;
/** Прогрев после старта мира или смены масштаба и длительность замера, мс реального времени. */
const WARMUP_MS = 3000;
const MEASURE_MS = 5000;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* приватное окно — живём без запоминания */
  }
}

const dpr = (): number => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);

export function graphicsQuality(desktop: boolean): GraphicsQuality {
  const v = read(KEY);
  return (QUALITIES as readonly string[]).includes(v ?? '')
    ? (v as GraphicsQuality)
    : desktop
      ? 'high'
      : 'auto';
}

/** Масштаб рендера для качества: не выше devicePixelRatio (на обычном мониторе всегда 1). */
export function scaleFor(q: GraphicsQuality): number {
  const want = q === 'auto' ? Number(read(AUTO_KEY)) || STEPS[0]! : SCALE[q];
  return Math.max(1, Math.min(want, dpr()));
}

let game: Phaser.Game | null = null;

/** Поставить масштаб рендера: размер канваса, зум CSS, разрешение текста. */
export function applyRenderScale(rs: number): void {
  const c = ctx();
  c.renderScale = rs;
  setTextRes(rs);
  if (!game) return;
  game.scale.setZoom(1 / rs);
  fitCanvas(game, rs);
  // Мир, оверлей, меню и список игр слушают RESIZE сами; HUD и пауза раскладываются в create — заново.
  for (const key of RELAYOUT) if (game.scene.isActive(key)) game.scene.getScene(key)?.scene.restart();
}

const RELAYOUT = [SceneKeys.UI, SceneKeys.Pause];
/** Сцены, при которых «Авто» может менять масштаб: только мир с HUD, без окон. */
const QUIET = new Set<string>([SceneKeys.World, SceneKeys.WorldOverlay, SceneKeys.UI, SceneKeys.Debug]);

function quiet(): boolean {
  return !!game && game.scene.getScenes(true).every((sc) => QUIET.has(sc.scene.key));
}

/** Вызывается из main.ts после создания игры: окно меняет размер — канвас следом. */
export function installRenderScale(g: Phaser.Game): void {
  game = g;
  window.addEventListener('resize', () => fitCanvas(g, ctx().renderScale));
  g.events.once(Phaser.Core.Events.READY, () => fitCanvas(g, ctx().renderScale));
}

/**
 * Канвас rs × окно в пикселях, на странице — ровно окно. CSS-размер задаётся явно: Phaser в режиме
 * NONE обновляет его, только если он отличается от размера канваса, — при переходе на rs 1 оставался
 * старый (1.5× окна), и игра была увеличена и обрезана.
 */
function fitCanvas(g: Phaser.Game, rs: number): void {
  g.scale.resize(Math.round(innerWidth * rs), Math.round(innerHeight * rs));
  g.canvas.style.width = `${innerWidth}px`;
  g.canvas.style.height = `${innerHeight}px`;
}

export function setGraphicsQuality(q: GraphicsQuality, desktop: boolean): void {
  write(KEY, q);
  if (q === 'auto') write(AUTO_KEY, String(STEPS[0]));
  applyRenderScale(scaleFor(graphicsQuality(desktop)));
  autoFps.reset();
}

/**
 * Замер FPS для «Авто» (WorldScene.update): средний FPS за MEASURE_MS после прогрева; ниже порога —
 * масштаб на шаг вниз и новый замер. Вверх само не поднимается.
 */
class AutoFps {
  private elapsed = 0;
  private frames = 0;
  private done = false;

  reset(): void {
    this.elapsed = 0;
    this.frames = 0;
    this.done = false;
  }

  tick(deltaMs: number, desktop: boolean): void {
    if (this.done || graphicsQuality(desktop) !== 'auto') return;
    if (!quiet()) {
      this.reset();
      return;
    }
    // Длинный кадр (сворачивание, пауза, загрузка) — не про заполнение GPU, замер заново.
    if (deltaMs > 250) {
      this.reset();
      return;
    }
    this.elapsed += deltaMs;
    if (this.elapsed < WARMUP_MS) return;
    this.frames++;
    if (this.elapsed < WARMUP_MS + MEASURE_MS) return;
    const fps = (this.frames * 1000) / (this.elapsed - WARMUP_MS);
    const rs = ctx().renderScale;
    const next = STEPS.find((s) => s < rs - 0.01);
    if (fps >= AUTO_MIN_FPS || next === undefined) {
      this.done = true;
      return;
    }
    write(AUTO_KEY, String(next));
    applyRenderScale(next);
    this.reset();
  }
}

export const autoFps = new AutoFps();
