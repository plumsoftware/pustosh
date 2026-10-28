import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import { revealedBosses } from '../../core/systems/Quests';
import { getAssetInfo } from '../assets/AssetIndex';
import { spawnSprite } from '../assets/spawnSprite';
import { ctx, registry } from '../GameContext';
import { SceneKeys } from '../SceneKeys';
import { Button } from '../ui/Button';
import { COLORS, FONT, TEXT_RES, uiScale } from '../ui/layout';
import { ensureWorldMapTexture } from './WorldMapScene';
import type { WorldScene } from './WorldScene';

/**
 * Карта игрока (TZ 9.6): туман войны по посещённым чанкам, биомы цветом, метки — тотем, аванпосты,
 * места смерти, арены боссов (`ui/marker_boss`: из записок или увиденные), найденные места
 * (`ui/marker_pin`). Тап по тотему/аванпосту — телепорт (реклама teleport, шаг 7). Колесо/щипок — зум.
 */
export class MapScene extends Phaser.Scene {
  private zoom = 1;

  constructor() {
    super(SceneKeys.Map);
  }

  private get world(): WorldScene {
    return this.scene.get(SceneKeys.World) as WorldScene;
  }

  create(): void {
    ctx().clock.pause('DIALOG');
    const w = this.world;
    w.controls.enabled = false;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      ctx().clock.resume('DIALOG');
      w.controls.clear();
      w.controls.enabled = true;
    });
    this.zoom = 1;
    this.draw();
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyM') this.scene.stop();
    });
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.zoom = Phaser.Math.Clamp(this.zoom * (dy > 0 ? 0.85 : 1.18), 1, 4);
      this.draw();
    });
  }

  private draw(): void {
    this.children.removeAll(true);
    const reg = registry();
    const w = this.world;
    const g = w.progress;
    const k = uiScale(this);
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x0b0a08, 0.92).setOrigin(0).setInteractive();
    const N = w.world.size;
    const size = (Math.min(width, height) - 60 * k) * this.zoom;
    const h = w.hero.pos;
    // Центр — герой (при зуме), иначе вся карта.
    const ox = width / 2 - (this.zoom > 1 ? (h.x / N) * size : size / 2);
    const oy = height / 2 + 10 * k - (this.zoom > 1 ? (h.y / N) * size : size / 2);
    const s = size / N;
    const key = ensureWorldMapTexture(this, w.world);
    this.add.image(ox, oy, key).setOrigin(0).setScale(s);
    // Туман войны: непосещённые чанки закрыты.
    const fog = this.add.graphics();
    const n = w.world.chunkTiles;
    const cps = w.world.chunksPerSide;
    fog.fillStyle(0x0b0a08, 1);
    for (let cy = 0; cy < cps; cy++)
      for (let cx = 0; cx < cps; cx++)
        if (!g.isVisited(cx, cy))
          fog.fillRect(ox + cx * n * s - 0.5, oy + cy * n * s - 0.5, n * s + 1, n * s + 1);
    // Метки.
    const marker = (id: string, x: number, y: number, tint: number, sz = 22, onTap?: () => void) => {
      if (!getAssetInfo(id)) return;
      const m = spawnSprite(this, ox + x * s, oy + y * s, id, { depth: false })
        .setOrigin(0.5, 1)
        .setTint(tint);
      m.setScale((sz * k) / Math.max(m.frame.width, m.frame.height));
      if (onTap) m.setInteractive({ useHandCursor: true }).on('pointerup', onTap);
    };
    const bosses = revealedBosses(reg, g.quests);
    for (const p of w.world.layout.prefabs) {
      const cx = Math.floor(p.x / n);
      const cy = Math.floor(p.y / n);
      if (p.kind === 'arena') {
        const b = reg.bosses.byBiome(p.biome);
        if (!b || (!bosses.has(b.id) && !g.isVisited(cx, cy))) continue;
        marker('ui.marker_boss', p.x, p.y, g.bosses.has(b.id) ? 0x777777 : 0xffffff, 26);
      } else if (p.kind === 'ruin' && g.poiSet.has(`ruin_${Math.round(p.x)}_${Math.round(p.y)}`))
        marker('ui.marker_pin', p.x, p.y, 0xd0c090, 16);
    }
    const tp = (x: number, y: number) => () => {
      this.scene.stop();
      void w.teleportTo(x, y + 1);
    };
    const core = w.baseCore();
    if (core) marker('ui.marker_pin', core.x, core.y, 0xff5040, 26, tp(core.x, core.y));
    for (const o of w.outposts()) marker('ui.marker_pin', o.x, o.y, 0x40c0ff, 22, tp(o.x, o.y));
    for (const [x, y] of g.map.deaths) {
      const c = this.add
        .text(ox + x * s, oy + y * s, '✕', {
          fontFamily: FONT,
          resolution: TEXT_RES,
          fontSize: `${Math.round(16 * k)}px`,
          color: '#ff4040',
        })
        .setOrigin(0.5);
      void c;
    }
    this.add.circle(ox + h.x * s, oy + h.y * s, 5 * k, 0x00e5ff).setStrokeStyle(2, 0x000000);
    this.add
      .text(20 * k, 14 * k, t('map.title'), {
        fontFamily: FONT,
        resolution: TEXT_RES,
        fontSize: `${Math.round(18 * k + 2)}px`,
        color: COLORS.text,
        fontStyle: '700',
      })
      .setDepth(5);
    this.add
      .text(20 * k, 40 * k, t('map.legend'), {
        fontFamily: FONT,
        resolution: TEXT_RES,
        fontSize: `${Math.round(11 * k + 2)}px`,
        color: COLORS.textDim,
        wordWrap: { width: 260 * k },
      })
      .setDepth(5);
    new Button(this, width - 34 * k, 30 * k, '✕', () => this.scene.stop(), 44 * k, 44 * k).setDepth(5);
    new Button(
      this,
      width - 34 * k,
      84 * k,
      '+',
      () => {
        this.zoom = Math.min(4, this.zoom * 1.5);
        this.draw();
      },
      44 * k,
      44 * k,
    ).setDepth(5);
    new Button(
      this,
      width - 34 * k,
      134 * k,
      '−',
      () => {
        this.zoom = Math.max(1, this.zoom / 1.5);
        this.draw();
      },
      44 * k,
      44 * k,
    ).setDepth(5);
  }
}
