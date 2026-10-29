import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import { ctx } from '../GameContext';
import { audio } from '../audio/AudioBus';
import { SceneKeys } from '../SceneKeys';
import { Button } from '../ui/Button';
import { getAssetInfo } from '../assets/AssetIndex';
import { spawnSprite } from '../assets/spawnSprite';
import * as Fx from '../render/Fx';
import { ensureFlameAnim } from '../render/Fx';
import { ensureFxTextures, TEX } from '../render/textures';
import { COLORS, uiScale } from '../ui/layout';
import { titleText, uiText } from '../ui/Styled';

/** Затемнение меню: прозрачно у костра (radius), к краям экрана — почти чёрное. */
function darkness(scene: Phaser.Scene, w: number, h: number, cx: number, cy: number, radius: number): string {
  const key = 'menu-darkness';
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, Math.ceil(w), Math.ceil(h))!;
  const c = tex.context;
  const far = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
  const g = c.createRadialGradient(cx, cy, radius * 0.3, cx, cy, far);
  g.addColorStop(0, 'rgba(5,6,10,0)');
  g.addColorStop(Math.min(0.9, (radius * 1.6) / far), 'rgba(5,6,10,0.55)');
  g.addColorStop(1, 'rgba(5,6,10,0.93)');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  tex.refresh();
  return key;
}

/** Интерфейс меню — над сценой фона. */
const UI_DEPTH = 3e5;

/** Главное меню: «Играть» (после межстраничной рекламы menu_to_game) и «Настройки». */
export class MainMenuScene extends Phaser.Scene {
  private starting = false;

  constructor() {
    super(SceneKeys.MainMenu);
  }

  create(): void {
    this.starting = false;
    audio()?.stopLoops();
    audio()?.playMusic('music_menu');
    audio()?.loadInBackground(this, () => {
      if (this.scene.isActive()) audio()?.playMusic('music_menu');
    });
    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this),
    );
  }

  private layout(): void {
    this.children.removeAll(true);
    const { width, height } = this.scale;
    const k = uiScale(this);
    this.cameras.main.setBackgroundColor('#0d0b09');
    this.backdrop(width, height, k);

    // Заголовок и меню — справа, сцена у костра — слева.
    const mx = width * 0.7;
    titleText(this, mx, height * 0.2, t('game.title'), 92 * k)
      .setOrigin(0.5)
      .setDepth(UI_DEPTH)
      .setShadow(0, 5, '#000', 10, true, true);
    uiText(this, mx, height * 0.2 + 52 * k, t('menu.subtitle'), 15 * k, { color: '#c9a86a' })
      .setOrigin(0.5)
      .setDepth(UI_DEPTH);

    const bw = 300 * k;
    const bh = 64 * k;
    const y0 = height * 0.5;
    new Button(this, mx, y0, t('ui.play'), () => void this.play(), bw, bh).setVariant('primary');
    new Button(
      this,
      mx,
      y0 + bh * 1.3,
      t('ui.settings'),
      () => this.scene.launch(SceneKeys.Settings),
      bw,
      bh,
    ).setIcon('ui.icon_settings');

    const c = ctx();
    if (c.debug) {
      const small = 180 * k;
      const sh = 38 * k;
      new Button(
        this,
        width - small / 2 - 12,
        height - sh * 2.3,
        'Stress test',
        () => this.scene.start(SceneKeys.Stress),
        small,
        sh,
      );
      new Button(
        this,
        width - small / 2 - 12,
        height - sh * 1.1,
        'Галерея (F2)',
        () => this.scene.launch(SceneKeys.Gallery),
        small,
        sh,
      );
    }
    uiText(this, 12, height - 8, `v${c.version} · ${c.platform.id}`, 12, { color: COLORS.textDim })
      .setOrigin(0, 1)
      .setDepth(UI_DEPTH);
    // Кнопки — над сценой фона и затемнением.
    for (const o of this.children.list) if (o instanceof Button) o.setDepth(UI_DEPTH);
  }

  /**
   * Фон меню — ночная стоянка из игровых спрайтов: трава, утоптанная земля, костёр с огнём и
   * искрами, герой у огня, деревья и брошенная машина; по краям — темнота.
   */
  private backdrop(width: number, height: number, k: number): void {
    ensureFxTextures(this);
    ensureFlameAnim(this);
    const s = Math.max(0.8, k) * 1.15;
    const grass = getAssetInfo('tiles.grass');
    if (grass)
      this.add
        .tileSprite(0, 0, width, height, grass.group, grass.frame)
        .setOrigin(0)
        .setTileScale(0.5 * s)
        .setTint(0x7a806a);
    const fx = width * 0.28;
    const fy = height * 0.64;
    const put = (id: string, x: number, y: number, scale = 1, flip = false) => {
      if (!getAssetInfo(id)) return null;
      const o = spawnSprite(this, x, y, id).setFlipX(flip);
      o.setScale(o.scaleX * s * scale).setDepth(y);
      return o;
    };
    put('world.biome1_suburb.oak', fx - 150 * s, fy - 40 * s);
    put('world.biome1_suburb.pine', fx + 120 * s, fy - 70 * s, 0.9);
    put('world.biome1_suburb.power_pole', fx - 20 * s, fy - 110 * s, 0.8);
    put('world.biome1_suburb.car_hatchback', fx + 130 * s, fy + 50 * s, 0.85, true);
    put('world.biome1_suburb.dead_tree', fx - 200 * s, fy + 70 * s, 0.8);
    put('world.biome1_suburb.tall_grass', fx + 30 * s, fy + 70 * s);
    put('world.biome1_suburb.scrap_pile', fx - 110 * s, fy + 80 * s, 0.7);
    // Костёр: угли, огонь, свет, искры; герой греет руки.
    put('world.interior.campfire_coals', fx, fy);
    if (this.anims.exists('fx-flame')) {
      const f = this.add
        .sprite(fx, fy - 6 * s, 'effects')
        .play('fx-flame')
        .setOrigin(0.5, 1)
        .setDepth(fy + 1);
      f.setScale((40 * s) / Math.max(1, f.height));
    }
    put('characters.hero.hero_pose_drive', fx - 52 * s, fy + 4 * s, 0.7);
    const glow = this.add
      .image(fx, fy - 12 * s, TEX.glow)
      .setDisplaySize(380 * s, 300 * s)
      .setTint(0xff9a40)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(1e5)
      .setAlpha(0.5);
    this.tweens.add({ targets: glow, alpha: 0.3, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    Fx.particles(this, ['effects.sparkle_1', 'effects.sparkle_2'], {
      tint: 0xffa040,
      lifespan: 1600,
      speed: { min: 25, max: 55 },
      angle: { min: 255, max: 285 },
      scale: { start: 0.16 * s, end: 0 },
      frequency: 200,
      emitting: true,
      gravityY: 0,
      blendMode: Phaser.BlendModes.ADD,
    })
      .setPosition(fx, fy - 26 * s)
      .setDepth(1e5 + 1);
    // Темнота: свет только у костра — одна текстура на весь экран с градиентом от огня.
    this.add
      .image(0, 0, darkness(this, width, height, fx, fy - 20 * s, 120 * s))
      .setOrigin(0)
      .setDepth(2e5);
  }

  private async play(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    // Выбор сохранения; реклама menu_to_game — при запуске игры из списка.
    this.scene.start(SceneKeys.Saves);
  }
}
