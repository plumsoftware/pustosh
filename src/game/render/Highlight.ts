import Phaser from 'phaser';
import type { Registry } from '../../core/data/Registry';
import { harvestDefOf, type Interactable } from '../../core/systems/Harvest';
import { containerInfo } from '../../core/systems/Loot';
import { getAssetInfo } from '../assets/AssetIndex';
import type { ChunkView, ObjView } from './ChunkView';
import { TILE } from './GroundTiles';

/** Цвета контура (TZ 5.5): белый — добываемое, жёлтый — контейнер, синий — записка/чертёж. */
const COLOR_HARVEST = 0xffffff;
const COLOR_CONTAINER = 0xffd04a;
const COLOR_NOTE = 0x5ab4ff;
const PULSE_MS = 1500;
const GLOW_STRENGTH = 1.6;
const GLOW_TARGET = 3;
/** Сколько контуров одновременно (каждый — отдельный проход шейдера). */
const MAX_GLOWS = 10;

interface Lit {
  view: ObjView;
  fx: Phaser.FX.Glow | null;
  /** Без шейдеров: увеличенная копия под объектом. */
  copy: Phaser.GameObjects.Image | null;
  color: number;
}

/**
 * Подсветка находок (TZ 5.5): в радиусе highlightRadiusTiles у интерактивных объектов мягкий контур
 * (шейдер Glow по альфе спрайта) с пульсом 1.5 с; ближайшая цель — ярче, над ней иконка действия.
 */
export class Highlight {
  /** Доп. радиус подсветки от навыка «Чутьё», клеток. */
  bonusTiles = 0;

  private lit = new Map<string, Lit>();
  private icon: Phaser.GameObjects.Image;
  private shader: boolean;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly reg: Registry,
  ) {
    this.shader = scene.game.renderer.type === Phaser.WEBGL;
    this.icon = scene.add
      .image(0, 0, 'ui')
      .setVisible(false)
      .setDepth(2e6 - 2);
  }

  /** Цвет контура объекта или null (не интерактивный, обысканный, добытый). */
  private colorOf(v: ObjView): number | null {
    const o = v.obj;
    const c = containerInfo(this.reg, o);
    if (c) {
      if (c.type === 'storage') return COLOR_CONTAINER;
      if (o.state !== 'intact') return null;
      return c.note ? COLOR_NOTE : COLOR_CONTAINER;
    }
    if (o.state === 'intact' && harvestDefOf(this.reg, o)) return COLOR_HARVEST;
    return null;
  }

  update(
    time: number,
    views: Iterable<ChunkView>,
    heroX: number,
    heroY: number,
    target: Interactable | null,
    actionIcon: string | null,
  ): void {
    // «Чутьё» добавляет клетки радиуса (bonusTiles задаёт WorldScene).
    const R = ((this.reg.balance.player['highlightRadiusTiles'] as number) + this.bonusTiles) * TILE;
    const want: { v: ObjView; color: number; d: number }[] = [];
    for (const cv of views) {
      for (const v of cv.objects) {
        const d = Math.hypot(v.img.x - heroX, v.img.y - heroY);
        if (d > R) continue;
        const color = this.colorOf(v);
        if (color !== null) want.push({ v, color, d });
      }
    }
    want.sort((a, b) => a.d - b.d);
    const keep = new Set<string>();
    for (const w of want.slice(0, MAX_GLOWS)) {
      keep.add(w.v.obj.uid);
      let l = this.lit.get(w.v.obj.uid);
      if (l && (l.view !== w.v || l.color !== w.color)) {
        this.clear(l);
        l = undefined;
      }
      if (!l) {
        l = { view: w.v, color: w.color, fx: null, copy: null };
        if (this.shader && w.v.img.preFX)
          l.fx = w.v.img.preFX.addGlow(w.color, GLOW_STRENGTH, 0, false, 0.1, 8);
        else {
          l.copy = this.scene.add
            .image(w.v.img.x, w.v.img.y, w.v.img.texture.key, w.v.img.frame.name)
            .setOrigin(w.v.img.originX, w.v.img.originY)
            .setScale(w.v.img.scaleX * 1.08, w.v.img.scaleY * 1.05)
            .setTintFill(w.color)
            .setAlpha(0.35)
            .setDepth(w.v.img.depth - 0.1);
        }
        this.lit.set(w.v.obj.uid, l);
      }
      const isTarget = target?.obj === w.v.obj;
      const pulse = 0.65 + 0.35 * Math.sin((time / PULSE_MS) * Math.PI * 2);
      if (l.fx) l.fx.outerStrength = (isTarget ? GLOW_TARGET : GLOW_STRENGTH) * pulse;
      if (l.copy) l.copy.setAlpha((isTarget ? 0.55 : 0.3) * pulse);
    }
    for (const [uid, l] of this.lit) {
      if (!keep.has(uid)) {
        this.clear(l);
        this.lit.delete(uid);
      }
    }
    // Иконка действия над ближайшей целью, покачивается.
    const tv = target ? want.find((w) => w.v.obj === target.obj)?.v : undefined;
    const info = actionIcon ? getAssetInfo(actionIcon) : undefined;
    if (tv && info) {
      if (this.icon.texture.key !== info.group || this.icon.frame.name !== info.frame)
        this.icon.setTexture(info.group, info.frame);
      this.icon.setScale(26 / Math.max(this.icon.frame.width, this.icon.frame.height));
      this.icon
        .setPosition(tv.img.x, tv.img.y - Math.min(tv.img.displayHeight, 150) - 14 + Math.sin(time / 250) * 3)
        .setVisible(true);
    } else this.icon.setVisible(false);
  }

  private clear(l: Lit): void {
    if (l.fx && l.view.img.preFX) l.view.img.preFX.remove(l.fx);
    l.copy?.destroy();
  }

  destroy(): void {
    for (const l of this.lit.values()) this.clear(l);
    this.lit.clear();
    this.icon.destroy();
  }
}
