import Phaser from 'phaser';
import type { Registry } from '../../core/data/Registry';
import type { HitResult } from '../../core/systems/Harvest';
import type { ItemStack, WorldObject } from '../../core/world';
import type { ObjView } from '../render/ChunkView';
import * as Fx from '../render/Fx';
import { TILE } from '../render/GroundTiles';
import { UI_FONT } from '../ui/BitmapFont';

/** Частицы по материалу (ANIMATIONS §6): дерево — бурые щепки, камень — серые осколки, металл — жёлтые искры. */
const MATERIAL: Record<string, { frames: string[]; tint: number; add: boolean }> = {
  wood: { frames: ['effects.dust_1', 'effects.dust_2'], tint: 0x8a5a2b, add: false },
  plant: { frames: ['effects.dust_1', 'effects.dust_3'], tint: 0x6aa83a, add: false },
  stone: { frames: ['effects.spark_1', 'effects.spark_2'], tint: 0x9a9a9a, add: false },
  metal: { frames: ['effects.spark_1', 'effects.spark_3'], tint: 0xffd040, add: true },
  cloth: { frames: ['effects.dust_2'], tint: 0xe8e0d0, add: false },
};
/** Падение дерева: 0.6 с, ease in (ANIMATIONS §6). */
const TREE_FALL_MS = 600;
const PICKUP_FLY_MS = 280;

/**
 * Эффекты добычи и подбора в мире: тряска, частицы, падение дерева, раскол камня,
 * детали машины, дроп летит к герою, «+N предмет» над героем.
 */
export class WorldFx {
  private emitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly reg: Registry,
  ) {
    for (const [k, m] of Object.entries(MATERIAL)) {
      const e = Fx.particles(scene, m.frames, {
        tint: m.tint,
        lifespan: 450,
        speed: { min: 60, max: 160 },
        angle: { min: 200, max: 340 },
        scale: { start: 0.22, end: 0 },
        gravityY: 300,
        blendMode: m.add ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL,
      }).setDepth(1e6 - 1);
      this.emitters.set(k, e);
    }
  }

  private material(o: WorldObject): string {
    return this.reg.harvest.particles[o.kind] ?? 'wood';
  }

  /** Удар по объекту: тряска ±2 px и частицы; конец — падение, раскол или смена спрайта (делает вызывающий). */
  hit(o: WorldObject, view: ObjView | undefined, _hit: HitResult, heroX: number): void {
    const x = o.x * TILE;
    const y = o.y * TILE;
    const h = view ? view.img.displayHeight : TILE;
    const m = this.material(o);
    this.emitters
      .get(m)
      ?.explode(o.kind === 'vehicle_wreck' ? 4 : 6, x + (heroX < x ? -10 : 10), y - Math.min(h * 0.4, 40));
    if (view) Fx.shake(this.scene, view.img, 2);
  }

  /** Дерево заваливается от основания на 90° от героя, пыль и лёгкая тряска камеры; вид объекта уже сменился на пень. */
  treeFall(view: ObjView, heroX: number): void {
    const src = view.img;
    const g = this.scene.add
      .image(src.x, src.y, src.texture.key, src.frame.name)
      .setOrigin(src.originX, src.originY)
      .setScale(src.scaleX, src.scaleY)
      .setFlipX(src.flipX)
      .setDepth(src.depth + 0.5);
    const dir = heroX < src.x ? 1 : -1;
    this.scene.tweens.add({
      targets: g,
      angle: 90 * dir,
      duration: TREE_FALL_MS,
      ease: 'Quad.In',
      onComplete: () => {
        this.emitters.get('wood')?.explode(14, src.x + dir * g.displayHeight * 0.5, src.y - 6);
        Fx.cameraShake(this.scene, 140, 0.004);
        this.scene.tweens.add({ targets: g, alpha: 0, duration: 300, onComplete: () => g.destroy() });
      },
    });
  }

  /** Камень раскалывается: разлёт осколков (смену на *_mined делает вид объекта). */
  rockCrack(o: WorldObject): void {
    this.emitters.get('stone')?.explode(16, o.x * TILE, o.y * TILE - 20);
  }

  /** Новый дроп: отскок и парение (рамка редкости — у вида дропа). */
  dropAppear(view: ObjView): void {
    Fx.popIn(this.scene, view.img);
  }

  /** Подбор: предмет летит к герою и уменьшается; «+N предмет» всплывает над героем. */
  pickup(view: ObjView | null, stack: ItemStack, heroX: number, heroY: number): void {
    if (view) {
      const img = view.img;
      view.shadow?.destroy();
      view.glow?.destroy();
      this.scene.tweens.add({
        targets: img,
        x: heroX,
        y: heroY - 40,
        scale: img.scale * 0.3,
        duration: PICKUP_FLY_MS,
        ease: 'Quad.In',
        onComplete: () => img.destroy(),
      });
    }
    const name = this.reg.items.get(stack.id)?.name_ru ?? stack.id;
    const t = this.scene.add
      .bitmapText(heroX, heroY - 100, UI_FONT, `+${stack.count} ${name}`, 14)
      .setOrigin(0.5)
      .setDepth(2e6 - 1);
    this.scene.tweens.add({
      targets: t,
      y: t.y - 30,
      alpha: 0,
      delay: 500,
      duration: 700,
      onComplete: () => t.destroy(),
    });
  }

  /** Открытие контейнера: смена спрайта с отскоком, у шкафов — короткая тряска. */
  containerOpen(view: ObjView | undefined): void {
    if (!view) return;
    const sx = view.img.scaleX;
    const sy = view.img.scaleY;
    this.scene.tweens.add({
      targets: view.img,
      scaleX: sx * 1.08,
      scaleY: sy * 1.08,
      duration: 90,
      yoyo: true,
      ease: 'Back.Out',
    });
    Fx.shake(this.scene, view.img, 1.5);
  }

  destroy(): void {
    for (const e of this.emitters.values()) e.destroy();
  }
}
