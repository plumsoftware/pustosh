import Phaser from 'phaser';
import { ctx } from '../GameContext';
import { SceneKeys } from '../SceneKeys';
import { COLORS, FONT, TEXT_RES } from '../ui/layout';
import type { WorldScene } from './WorldScene';

/** Цвета биомов на отладочной карте (0 — море). */
const BIOME_COLORS = [0x1d4f7a, 0x5f8f3e, 0x4f6b3a, 0x6d6d6d, 0xc9a35a, 0xdfe8ee, 0x5b6b2a];
const ROAD = 0x3a3a3a;
const WALL = 0x8b2a1a;
const FENCE = 0x2a1a0a;
const MAP_KEY = 'world-map';

/**
 * Отладочная карта всего мира (F5): биомы, дороги, руины, арены, ворота, бункер; клик — телепорт.
 * Пока открыта — пауза DIALOG.
 */
export class WorldMapScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.WorldMap);
  }

  create(): void {
    const { clock } = ctx();
    clock.pause('DIALOG');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => clock.resume('DIALOG'));
    const world = (this.scene.get(SceneKeys.World) as WorldScene).world;
    const L = world.layout;
    const N = world.size;

    ensureWorldMapTexture(this, world);
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x000000, 0.85).setOrigin(0).setInteractive();
    const size = Math.min(width, height) - 40;
    const k = size / N;
    const ox = (width - size) / 2;
    const oy = (height - size) / 2;
    const map = this.add
      .image(ox, oy, MAP_KEY)
      .setOrigin(0)
      .setScale(k)
      .setInteractive({ useHandCursor: true });
    const g = this.add.graphics();
    for (const p of L.prefabs) {
      const color =
        p.kind === 'arena'
          ? 0xff3030
          : p.kind === 'gate'
            ? 0xffd23a
            : p.kind === 'bunker'
              ? 0x40ff70
              : 0xffffff;
      g.fillStyle(color, 1).fillCircle(ox + p.x * k, oy + p.y * k, p.kind === 'arena' ? 5 : 3);
    }
    const ws = this.scene.get(SceneKeys.World) as WorldScene;
    g.fillStyle(0x00e5ff, 1).fillCircle(ox + ws.hero.pos.x * k, oy + ws.hero.pos.y * k, 5);
    this.add
      .text(
        ox,
        oy - 4,
        'F5 — закрыть · клик — телепорт · белые — руины, красные — арены, жёлтые — ворота, зелёный — бункер',
        {
          fontFamily: FONT,
          resolution: TEXT_RES,
          fontSize: '13px',
          color: COLORS.text,
        },
      )
      .setOrigin(0, 1);
    map.on('pointerup', (p: Phaser.Input.Pointer) => {
      ws.teleport((p.x - ox) / k, (p.y - oy) / k);
      this.scene.stop();
    });
    this.input.keyboard?.on('keydown-ESC', () => this.scene.stop());
  }
}

/** Текстура карты мира 1 пиксель = 1 клетка: биомы, дороги, заборы, стены (общая для отладочной и игровой карты). */
export function ensureWorldMapTexture(scene: Phaser.Scene, world: WorldScene['world']): string {
  const L = world.layout;
  const N = world.size;
  if (!scene.textures.exists(MAP_KEY)) {
    const tex = scene.textures.createCanvas(MAP_KEY, N, N)!;
    const img = tex.context.createImageData(N, N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const idx = L.cellIndex(x, y);
        const st = L.stamps.get(idx);
        let c = BIOME_COLORS[L.biomeAt(x + 0.5, y + 0.5)] ?? 0;
        if (L.roads.has(idx)) c = ROAD;
        if (st && st.kind === 'fence') c = FENCE;
        else if (st && st.kind !== 'clear' && st.kind !== 'floor') c = WALL;
        const o = idx * 4;
        img.data[o] = (c >> 16) & 255;
        img.data[o + 1] = (c >> 8) & 255;
        img.data[o + 2] = c & 255;
        img.data[o + 3] = 255;
      }
    }
    tex.context.putImageData(img, 0, 0);
    tex.refresh();
  }
  return MAP_KEY;
}
