import type Phaser from 'phaser';

/** Текстуры, которые рисуются кодом (картинок для них нет): тень, мягкий свет, свечение. */
export const TEX = {
  shadow: 'fx-shadow',
  light: 'fx-light',
  glow: 'fx-glow',
  dot: 'fx-dot',
  /** Виньетка: прозрачный центр, белые края (окрашивается тинтом). */
  vignette: 'fx-vignette',
  /** «Зерно» радиации. */
  grain: 'fx-grain',
} as const;

/** Радиус текстуры света в пикселях. */
export const LIGHT_TEX_R = 128;

function radial(scene: Phaser.Scene, key: string, w: number, h: number, stops: [number, string][]): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h)!;
  const ctx = tex.context;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(w / 2, h / 2);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
  tex.refresh();
}

export function ensureFxTextures(scene: Phaser.Scene): void {
  // Тень: эллипс, чёрный 22% в центре, мягкий край.
  radial(scene, TEX.shadow, 128, 48, [
    [0, 'rgba(0,0,0,0.22)'],
    [0.6, 'rgba(0,0,0,0.2)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
  // Свет: стирает маску ночи; плато в центре и плавный спад без резкого края.
  radial(scene, TEX.light, LIGHT_TEX_R * 2, LIGHT_TEX_R * 2, [
    [0, 'rgba(255,255,255,1)'],
    [0.35, 'rgba(255,255,255,0.95)'],
    [0.7, 'rgba(255,255,255,0.45)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  // Свечение (режим ADD, окрашивается тинтом).
  radial(scene, TEX.glow, 128, 128, [
    [0, 'rgba(255,255,255,0.9)'],
    [0.4, 'rgba(255,255,255,0.35)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  if (!scene.textures.exists(TEX.vignette)) {
    const tex = scene.textures.createCanvas(TEX.vignette, 256, 256)!;
    const c = tex.context;
    const g = c.createRadialGradient(128, 128, 60, 128, 128, 182);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 256);
    tex.refresh();
  }
  if (!scene.textures.exists(TEX.grain)) {
    const tex = scene.textures.createCanvas(TEX.grain, 128, 128)!;
    const c = tex.context;
    for (let i = 0; i < 700; i++) {
      c.fillStyle = `rgba(110,255,90,${0.2 + Math.random() * 0.6})`;
      c.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5);
    }
    tex.refresh();
  }
  radial(scene, TEX.dot, 16, 16, [
    [0, 'rgba(255,255,255,1)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
}
