import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import { outOfComfort } from '../../core/systems/Survival';
import { getAssetInfo } from '../assets/AssetIndex';
import { spawnSprite } from '../assets/spawnSprite';
import { registry } from '../GameContext';
import { ensureFxTextures, TEX } from '../render/textures';
import { SceneKeys } from '../SceneKeys';
import { UI_FONT } from '../ui/BitmapFont';
import { Button } from '../ui/Button';
import { uiScale } from '../ui/layout';
import { raritySlot } from '../world/rarity';
import { BUILD_MODE, GAME_SAVED, TOAST, type WorldScene } from './WorldScene';
import { BLOOD_WAVE } from '../enemies/EnemyManager';
import { HudExtras } from '../ui/HudExtras';

/** Анимации интерфейса (ANIMATIONS §11). */
const BAR_SMOOTH_SEC = 0.25;
const BAR_TAIL_SEC = 0.5;
const BLINK_MS = 400;
const PRESS_SCALE = 0.92;
/** Бег — стик оттянут дальше основания: доля радиуса основания (было 1.4, отодвинуто на 30%). */
const STICK_RUN_PULL = 1.82;
const PRESS_MS = 120;
const TOAST_MS = 2000;
/** Как часто пересчитывать предмет для кнопки «Аптечка», мс. */
const HEAL_PICK_MS = 500;
/** Температура, при которой кольцо заполнено (|t|). */
const TEMP_RING_FULL = 8;

interface Stat {
  key: 'hunger' | 'thirst' | 'stamina' | 'temperature' | 'radiation';
  icon: string;
  color: number;
  img: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  shown: number;
}

/**
 * HUD поверх мира: здоровье, показатели выживания с кольцами, состояния, часы, сообщения,
 * эффекты низких показателей; на телефоне — плавающий стик слева и кнопки справа.
 */
export class UIScene extends Phaser.Scene {
  private clockText!: Phaser.GameObjects.BitmapText;
  private lastClock = '';
  private savedText!: Phaser.GameObjects.BitmapText;
  private toast!: Phaser.GameObjects.BitmapText;
  private hpFill!: Phaser.GameObjects.Image;
  private hpTail!: Phaser.GameObjects.Image;
  private hpText!: Phaser.GameObjects.BitmapText;
  private hpShown = 1;
  private hpTailShown = 1;
  private stats: Stat[] = [];
  private conds!: Phaser.GameObjects.Container;
  private condKey = '';
  private vignette!: Phaser.GameObjects.Image;
  private radVignette!: Phaser.GameObjects.Image;
  private grain!: Phaser.GameObjects.TileSprite;
  private k = 1;
  // Стик
  private stickBase: Phaser.GameObjects.Image | null = null;
  private stickKnob: Phaser.GameObjects.Image | null = null;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickR = 60;
  private buttons: Phaser.GameObjects.Image[] = [];
  private actionBtn: Phaser.GameObjects.Image | null = null;
  private actionOverlay: Phaser.GameObjects.Image | null = null;
  private hotbar!: Phaser.GameObjects.Container;
  private hotbarKey = '';
  /** Что применит кнопка «Аптечка» (пересчёт раз в HEAL_PICK_MS). */
  private healPick: string | null = null;
  private healPickAt = 0;

  constructor() {
    super(SceneKeys.UI);
  }

  private get world(): WorldScene {
    return this.scene.get(SceneKeys.World) as WorldScene;
  }

  create(): void {
    this.k = uiScale(this);
    const k = this.k;
    const { width, height } = this.scale;
    const touch = this.sys.game.device.input.touch && !this.sys.game.device.os.desktop;
    this.stats = [];
    this.buttons = [];
    ensureFxTextures(this);
    // Режим строительства: кнопки действий и пояс прячутся — внизу панель стройки.
    const onBuild = (on: boolean) => {
      for (const b of this.buttons) b.setVisible(!on);
      this.actionLabel?.setVisible(!on);
      this.attackLabel?.setVisible(!on);
      this.actionOverlay?.setVisible(false);
      this.hotbar?.setVisible(!on);
    };
    this.game.events.on(BUILD_MODE, onBuild);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off(BUILD_MODE, onBuild));

    // Эффекты экрана — под всем HUD.
    this.vignette = this.add
      .image(width / 2, height / 2, TEX.vignette)
      .setDisplaySize(width, height)
      .setTint(0xd01818)
      .setAlpha(0);
    this.radVignette = this.add
      .image(width / 2, height / 2, TEX.vignette)
      .setDisplaySize(width, height)
      .setTint(0x50ff40)
      .setAlpha(0);
    this.grain = this.add
      .tileSprite(0, 0, width, height, TEX.grain)
      .setOrigin(0)
      .setAlpha(0)
      .setBlendMode(Phaser.BlendModes.ADD);

    // Пауза и часы
    const s = 56 * k;
    if (getAssetInfo('ui.icon_pause')) {
      const pb = spawnSprite(this, width - s / 2 - 12, s / 2 + 12, 'ui.icon_pause', { depth: false });
      pb.setScale(s / Math.max(pb.frame.width, pb.frame.height)).setInteractive({ useHandCursor: true });
      pb.on('pointerup', () => this.world.openPause());
    } else new Button(this, width - s / 2 - 12, s / 2 + 12, 'II', () => this.world.openPause(), s, s);
    this.clockText = this.add
      .bitmapText(width - s - 24, 12 + s / 2, UI_FONT, '', Math.round(18 * k + 4))
      .setOrigin(1, 0.5)
      .setTint(0xf2e6c9);

    this.buildHealth();
    this.buildStats();
    this.extras = new HudExtras(
      this,
      this.world,
      (id) => {
        const b = this.buttons.find((x) => x.frame.name.includes(id));
        if (b) return b;
        return (
          (this.hotbar?.list.find((o) => (o as Phaser.GameObjects.Image).name === id) as
            Phaser.GameObjects.Image | undefined) ?? null
        );
      },
      this.clockText,
    );
    this.conds = this.add.container(0, 0);

    this.savedText = this.add
      .bitmapText(width - 12, height - 10, UI_FONT, t('saves.saved'), Math.round(14 * k + 4))
      .setOrigin(1, 1)
      .setTint(0x9fd36b)
      .setAlpha(0);
    this.toast = this.add
      .bitmapText(width / 2, 90 * k, UI_FONT, '', Math.round(18 * k + 4))
      .setOrigin(0.5)
      .setAlpha(0);
    this.game.events.on(GAME_SAVED, this.showSaved, this);
    this.game.events.on(TOAST, this.showToast, this);
    // Кровавая ночь: «волна N/3» вверху по центру.
    this.bloodText = this.add
      .bitmapText(width / 2, 70 * k, UI_FONT, '', Math.round(20 * k + 4))
      .setOrigin(0.5)
      .setTint(0xff5040)
      .setDepth(60)
      .setVisible(false);
    const onWave = (n: number, max: number) => {
      if (n > 0) this.bloodText!.setText(t('combat.blood_wave', { n, max })).setVisible(true);
      else {
        this.bloodText!.setVisible(false);
        this.showToast(t('combat.blood_end'));
      }
    };
    this.game.events.on(BLOOD_WAVE, onWave);
    // Патроны в магазине у оружия в руке.
    this.magText = this.add
      .bitmapText(0, 0, UI_FONT, '', Math.round(13 * k + 3))
      .setOrigin(0.5, 1)
      .setDepth(60);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off(BLOOD_WAVE, onWave));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(GAME_SAVED, this.showSaved, this);
      this.game.events.off(TOAST, this.showToast, this);
    });

    this.hotbar = this.add.container(0, 0);
    this.hotbarKey = '';
    if (touch) this.buildTouchControls();
    else
      this.add
        .bitmapText(12, height - 10, UI_FONT, t('ui.hint_pause'), 14)
        .setOrigin(0, 1)
        .setTint(0xb7a98a);
  }

  // ------------------------------------------------------------------ здоровье и показатели

  private hpBottom = 0;
  private statsBottom = 0;

  private buildHealth(): void {
    const k = this.k;
    const frame = getAssetInfo('ui.bar_frame')!;
    const w = 260 * k;
    const h = (w * frame.size[1]) / frame.size[0];
    const x = 14;
    const y = 14;
    const f = spawnSprite(this, x, y, 'ui.bar_frame', { depth: false }).setOrigin(0).setDisplaySize(w, h);
    // Низ рамки HP: от него раскладываются статы и значки состояний.
    this.hpBottom = y + h;
    const fill = getAssetInfo('ui.bar_fill_red')!;
    const fw = (w * fill.size[0]) / frame.size[0];
    const fh = (h * fill.size[1]) / frame.size[1];
    const fx = x + (w - fw) / 2;
    const fy = y + (h - fh) / 2;
    this.hpTail = spawnSprite(this, fx, fy, 'ui.bar_fill_red', { depth: false })
      .setOrigin(0)
      .setDisplaySize(fw, fh)
      .setTintFill(0xffffff)
      .setAlpha(0.85);
    this.hpFill = spawnSprite(this, fx, fy, 'ui.bar_fill_red', { depth: false })
      .setOrigin(0)
      .setDisplaySize(fw, fh);
    // Рамка с тёмной серединой — под заливкой; заливка и «хвост» поверх.
    f.setDepth(0);
    this.hpTail.setDepth(1);
    this.hpFill.setDepth(2);
    this.hpText = this.add
      .bitmapText(x + w / 2, y + h / 2, UI_FONT, '', Math.round(13 * k + 3))
      .setOrigin(0.5)
      .setDepth(3);
  }

  private buildStats(): void {
    const k = this.k;
    const defs: [Stat['key'], string, number][] = [
      ['hunger', 'ui.icon_hunger', 0xe0943a],
      ['thirst', 'ui.icon_thirst', 0x4aa8ff],
      ['stamina', 'ui.icon_stamina', 0xb8e04a],
      ['temperature', 'ui.icon_temperature', 0x9ad0ff],
      ['radiation', 'ui.icon_radiation', 0x6aff4a],
    ];
    const size = 40 * k;
    const y = this.hpBottom + 6 * k + size / 2;
    this.statsBottom = y + size / 2;
    defs.forEach(([key, icon, color], i) => {
      const x = 14 + size / 2 + i * (size + 8 * k);
      this.add.circle(x, y, size / 2, 0x000000, 0.45);
      const ring = this.add.graphics();
      const img = spawnSprite(this, x, y, icon, { depth: false });
      img.setScale((size * 0.62) / Math.max(img.frame.width, img.frame.height));
      this.stats.push({ key, icon, color, img, ring, x, y, shown: 1 });
    });
  }

  /** Кольцо показателя: доля 0…1, цвет; мигает, если показатель низкий. */
  private drawRing(s: Stat, frac: number, color: number, blink: boolean, time: number): void {
    const r = 20 * this.k;
    s.shown += (frac - s.shown) * Math.min(1, this.game.loop.delta / 1000 / BAR_SMOOTH_SEC);
    s.ring.clear();
    s.ring.lineStyle(3.5 * this.k, 0x000000, 0.5).strokeCircle(s.x, s.y, r);
    if (s.shown > 0.005) {
      s.ring.lineStyle(3.5 * this.k, color, 1).beginPath();
      s.ring
        .arc(s.x, s.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, s.shown), false)
        .strokePath();
    }
    const a = blink ? 0.35 + 0.65 * Math.abs(Math.sin((time / BLINK_MS) * Math.PI)) : 1;
    s.img.setAlpha(a);
    s.ring.setAlpha(a);
  }

  private updateConditions(): void {
    const c = this.world.hero.vitals.conditions;
    const list: string[] = [];
    if (c.bleeding) list.push('bleeding');
    if (c.poison > 0) list.push('poison');
    if (c.infection) list.push('infection');
    if (c.fracture) list.push('fracture');
    const key = list.join();
    if (key === this.condKey) return;
    this.condKey = key;
    this.conds.removeAll(true);
    const k = this.k;
    const y = this.statsBottom + 18 * k;
    const size = 30 * k;
    list.forEach((name, i) => {
      const x = 14 + size / 2 + i * (size + 6 * k);
      const id = `ui.icon_${name}`;
      if (getAssetInfo(id)) {
        const icon = spawnSprite(this, x, y, id, { depth: false });
        icon.setScale(size / Math.max(icon.frame.width, icon.frame.height));
        this.conds.add(icon);
      } else {
        // Запасной вариант без атласа — плашка с названием.
        const label = this.add
          .bitmapText(x, y, UI_FONT, t(`cond.${name}`), Math.round(12 * k + 3))
          .setOrigin(0.5);
        this.conds.add(label);
      }
    });
  }

  // ------------------------------------------------------------------ сенсорное управление

  private buildTouchControls(): void {
    const k = this.k;
    const { width, height } = this.scale;
    const btn = (
      id: string,
      x: number,
      y: number,
      size: number,
      onPress: () => void,
      hold: ((v: boolean) => void) | null = null,
    ): Phaser.GameObjects.Image => {
      const b = spawnSprite(this, x, y, id, { depth: 50 }).setInteractive();
      b.setScale(size / Math.max(b.frame.width, b.frame.height));
      const base = b.scale;
      if (hold) {
        // Удержание — серия ударов (добыча / атака).
        const release = () => hold(false);
        b.on('pointerup', release);
        b.on('pointerout', release);
      }
      b.on('pointerdown', () => {
        if (hold) hold(true);
        onPress();
        this.tweens.add({ targets: b, scale: base * PRESS_SCALE, duration: PRESS_MS / 2, yoyo: true });
        b.setTint(0xbbbbbb);
        this.time.delayedCall(PRESS_MS, () => b.clearTint());
      });
      this.buttons.push(b);
      return b;
    };
    const big = 104 * k;
    const mid = 80 * k;
    const ax = width - big / 2 - 22 * k;
    const ay = height - big / 2 - 22 * k;
    const controls = () => this.world.controls;
    this.actionBtn = btn(
      'ui.btn_action',
      ax,
      ay,
      big,
      () => controls().push({ type: 'action' }),
      (v) => controls().setActionHold(v),
    );
    this.actionOverlay = this.add.image(ax, ay, 'ui').setDepth(51).setVisible(false);
    const atk = btn(
      'ui.btn_attack',
      ax - big * 0.95,
      ay + 6 * k,
      mid,
      () => controls().push({ type: 'attack' }),
      (v) => controls().setAttackHold(v),
    );
    // Подписи: «Собрать/Открыть» и «Удар» — чтобы не путать кнопки.
    const label = (x: number, y: number, text: string) =>
      this.add
        .bitmapText(x, y, UI_FONT, text, Math.round(12 * k + 3))
        .setOrigin(0.5, 0)
        .setDepth(52)
        .setDropShadow(1, 1, 0x000000, 0.8);
    this.actionLabel = label(ax, ay + big / 2 - 4 * k, t('hud.gather'));
    this.attackLabel = label(atk.x, atk.y + mid / 2 - 4 * k, t('hud.attack'));
    btn('ui.btn_dodge', ax - big * 0.15, ay - big * 0.95, mid, () => controls().push({ type: 'dodge' }));
    btn('ui.btn_build', ax - big * 1.05, ay - big * 0.8, mid * 0.85, () =>
      controls().push({ type: 'build' }),
    );

    // Плавающий стик: появляется там, где палец коснулся левой половины экрана.
    this.stickR = 62 * k;
    this.input.addPointer(2);
    this.input.on(
      Phaser.Input.Events.POINTER_DOWN,
      (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        if (this.stickId !== null || p.x > width / 2 || over.length > 0) return;
        this.stickId = p.id;
        this.stickOrigin = { x: p.x, y: p.y };
        this.showStick(p.x, p.y);
      },
    );
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      if (p.id !== this.stickId || !this.stickKnob) return;
      let dx = p.x - this.stickOrigin.x;
      let dy = p.y - this.stickOrigin.y;
      const len = Math.hypot(dx, dy);
      // Ходьба — в пределах основания; оттянул дальше, за кольцо бега, — бег (ручка оранжевая).
      const run = len > this.stickR * STICK_RUN_PULL;
      const max = this.stickR * STICK_RUN_PULL * 1.1;
      if (len > max) {
        dx = (dx / len) * max;
        dy = (dy / len) * max;
      }
      this.stickKnob.setPosition(this.stickOrigin.x + dx, this.stickOrigin.y + dy);
      // Направление — от пальца, сила — до 1 на краю основания.
      const l = Math.min(1, len / this.stickR);
      const ux = len > 0 ? (p.x - this.stickOrigin.x) / len : 0;
      const uy = len > 0 ? (p.y - this.stickOrigin.y) / len : 0;
      controls().setStick(ux * l, uy * l, run);
      this.setStickRun(run);
    });
    const release = (p: Phaser.Input.Pointer) => {
      if (p.id !== this.stickId) return;
      this.stickId = null;
      controls().setStick(0, 0);
      this.setStickRun(false);
      // Ручка возвращается в центр с пружиной, основание гаснет.
      if (this.stickKnob)
        this.tweens.add({
          targets: this.stickKnob,
          x: this.stickOrigin.x,
          y: this.stickOrigin.y,
          duration: 180,
          ease: 'Back.Out',
        });
      if (this.stickBase)
        this.tweens.add({
          targets: [this.stickBase, this.stickKnob, this.runRing].filter(Boolean),
          alpha: 0,
          delay: 150,
          duration: 200,
        });
    };
    this.input.on(Phaser.Input.Events.POINTER_UP, release);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, release);
  }

  private showStick(x: number, y: number): void {
    const k = this.k;
    if (!this.stickBase) {
      this.stickBase = spawnSprite(this, x, y, 'ui.joystick_base', { depth: 40 });
      this.stickBase.setScale((150 * k) / Math.max(this.stickBase.frame.width, this.stickBase.frame.height));
      this.stickKnob = spawnSprite(this, x, y, 'ui.joystick_knob', { depth: 41 });
      this.stickKnob.setScale((70 * k) / Math.max(this.stickKnob.frame.width, this.stickKnob.frame.height));
    }
    this.tweens.killTweensOf([this.stickBase, this.stickKnob!]);
    this.stickBase.setPosition(x, y).setAlpha(0.85);
    this.stickKnob!.setPosition(x, y).setAlpha(1);
    // Кольцо бега вокруг основания: за ним — бег.
    if (!this.runRing) {
      this.runRing = this.add.graphics().setDepth(39);
      this.runText = this.add
        .bitmapText(0, 0, UI_FONT, t('hud.run'), Math.round(12 * this.k + 3))
        .setOrigin(0.5, 1)
        .setDepth(42)
        .setTint(0xffb040);
      if (getAssetInfo('ui.icon_sprint')) {
        this.runIcon = spawnSprite(this, 0, 0, 'ui.icon_sprint', { depth: false })
          .setOrigin(0.5, 1)
          .setDepth(42);
        this.runIcon.setScale((30 * this.k) / Math.max(this.runIcon.frame.width, this.runIcon.frame.height));
      }
    }
    this.runRing.setPosition(x, y).setAlpha(1);
    const ry = y - this.stickR * STICK_RUN_PULL - 6;
    this.runText!.setPosition(x, ry).setVisible(false);
    this.runIcon?.setPosition(x, ry - this.runText!.height - 2).setVisible(false);
    this.drawRunRing(false);
  }

  private runRing: Phaser.GameObjects.Graphics | null = null;
  private runText: Phaser.GameObjects.BitmapText | null = null;
  private runIcon: Phaser.GameObjects.Image | null = null;
  private stickRunning = false;
  private actionLabel: Phaser.GameObjects.BitmapText | null = null;
  private attackLabel: Phaser.GameObjects.BitmapText | null = null;

  private drawRunRing(on: boolean): void {
    const g = this.runRing;
    if (!g) return;
    g.clear();
    const r = this.stickR * STICK_RUN_PULL;
    g.lineStyle(on ? 4 : 2, on ? 0xffa030 : 0xffffff, on ? 0.95 : 0.35).strokeCircle(0, 0, r);
  }

  /** Бег со стика: ручка и кольцо оранжевые, над стиком «Бег». */
  private setStickRun(run: boolean): void {
    if (run === this.stickRunning) return;
    this.stickRunning = run;
    this.drawRunRing(run);
    this.stickKnob?.setTint(run ? 0xffa030 : 0xffffff);
    if (!run) this.stickKnob?.clearTint();
    this.runText?.setVisible(run);
    this.runIcon?.setVisible(run);
  }

  // ------------------------------------------------------------------ пояс и «умная» кнопка

  /** Пояс 6 слотов снизу по центру (GDD §14) + кнопка рюкзака; перерисовка только при изменении. */
  private updateHotbar(): void {
    const inv = this.world.hero.inv;
    if (this.time.now >= this.healPickAt) {
      this.healPickAt = this.time.now + HEAL_PICK_MS;
      this.healPick = this.world.healItem();
    }
    const heal = this.healPick;
    const key =
      inv.hotbar.slots.map((s) => (s ? `${s.id}:${s.count}:${s.durability ?? ''}` : '-')).join('|') +
      `#${inv.selected}#${heal ?? ''}:${heal ? inv.count(heal) : 0}`;
    if (key === this.hotbarKey) return;
    this.hotbarKey = key;
    this.hotbar.removeAll(true);
    const reg = registry();
    const k = this.k;
    const cell = Math.round(50 * k);
    const n = inv.hotbar.size;
    const { width, height } = this.scale;
    const x0 = width / 2 - ((n + 2) * (cell + 4)) / 2;
    const y = height - cell / 2 - 10;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (cell + 4) + cell / 2;
      const s = inv.hotbar.slots[i];
      const def = s ? reg.items.get(s.id) : undefined;
      const bg = spawnSprite(this, x, y, def ? raritySlot(def.tier) : 'ui.slot', { depth: false })
        .setDisplaySize(cell, cell)
        .setInteractive();
      bg.on('pointerdown', () => (inv.selected = i));
      this.hotbar.add(bg);
      if (i === inv.selected)
        this.hotbar.add(
          spawnSprite(this, x, y, 'ui.slot_selected', { depth: false }).setDisplaySize(cell, cell),
        );
      if (def && s) {
        const ic = spawnSprite(this, x, y, def.icon, { depth: false });
        ic.setScale((cell * 0.74) / Math.max(ic.frame.width, ic.frame.height));
        if (s.durability === 0) ic.setAlpha(0.55);
        this.hotbar.add(ic);
        if (s.count > 1)
          this.hotbar.add(
            this.add
              .bitmapText(x + cell / 2 - 4, y + cell / 2 - 2, UI_FONT, String(s.count), 13)
              .setOrigin(1, 1),
          );
        if (s.durability !== undefined && def.durability) {
          const f = s.durability / def.durability;
          const g = this.add.graphics();
          g.fillStyle(0x000000, 0.6).fillRect(x - cell * 0.35, y + cell / 2 - 7, cell * 0.7, 4);
          g.fillStyle(f > 0.5 ? 0x7ad04a : f > 0.2 ? 0xe0c040 : 0xd04030, 1).fillRect(
            x - cell * 0.35,
            y + cell / 2 - 7,
            cell * 0.7 * f,
            4,
          );
          this.hotbar.add(g);
        }
      }
      this.hotbar.add(
        this.add.bitmapText(x - cell / 2 + 4, y - cell / 2 + 2, UI_FONT, String(i + 1), 11).setTint(0xb7a98a),
      );
    }
    // «Аптечка» слева от пояса (H на ПК): лучшее лекарство или еда для лечения — иконка и сколько есть.
    const hx = x0 - cell / 2 - 10;
    const hb = spawnSprite(this, hx, y, 'ui.slot', { depth: false })
      .setDisplaySize(cell, cell)
      .setInteractive({ useHandCursor: true });
    hb.on('pointerdown', () => {
      this.world.quickHeal();
      this.healPickAt = 0;
    });
    hb.setName('heal');
    const hIcon = heal ? reg.items.require(heal).icon : 'icons.base.medkit';
    const hi = spawnSprite(this, hx, y, hIcon, { depth: false });
    hi.setScale((cell * 0.72) / Math.max(hi.frame.width, hi.frame.height));
    if (!heal) hi.setAlpha(0.35);
    this.hotbar.add([hb, hi]);
    if (heal)
      this.hotbar.add(
        this.add
          .bitmapText(
            hx + cell / 2 - 4,
            y + cell / 2 - 2,
            UI_FONT,
            String(inv.count(heal)),
            Math.round(12 * k + 3),
          )
          .setOrigin(1, 1),
      );
    // Зелёный плюс в углу — знак кнопки (атлас эффектов может ещё грузиться).
    if (this.textures.exists('effects') && getAssetInfo('effects.heal_plus'))
      this.hotbar.add(
        spawnSprite(this, hx - cell / 2 + cell * 0.2, y - cell / 2 + cell * 0.2, 'effects.heal_plus', {
          depth: false,
        })
          .setDisplaySize(cell * 0.32, cell * 0.32)
          .setAlpha(heal ? 1 : 0.4),
      );
    // Кнопка рюкзака — инвентарь (Tab / I на ПК).
    const bx = x0 + n * (cell + 4) + cell / 2 + 6;
    const bag = spawnSprite(this, bx, y, 'ui.slot', { depth: false })
      .setDisplaySize(cell, cell)
      .setInteractive({ useHandCursor: true });
    bag.on('pointerdown', () => this.world.openInventory());
    const bi = spawnSprite(this, bx, y, 'icons.base.small_backpack', { depth: false });
    bi.setScale((cell * 0.74) / Math.max(bi.frame.width, bi.frame.height));
    this.hotbar.add([bag, bi]);
    // Кнопка книги крафтов (C на ПК).
    const cx = bx + cell + 4;
    const cb = spawnSprite(this, cx, y, 'ui.slot', { depth: false })
      .setDisplaySize(cell, cell)
      .setInteractive({ useHandCursor: true });
    cb.on('pointerdown', () => this.world.openCraft(null));
    cb.setName('craft');
    const bookId = getAssetInfo('ui.icon_craft_book') ? 'ui.icon_craft_book' : 'world.interior.workbench_1';
    const ci = spawnSprite(this, cx, y, bookId, { depth: false }).setOrigin(0.5);
    ci.setScale((cell * 0.8) / Math.max(ci.frame.width, ci.frame.height));
    this.hotbar.add([cb, ci]);
  }

  /** «Умная» кнопка (TZ 4.1.2): рука — открыть/подобрать, кулак — ударить, иконка инструмента — добыть. */
  private updateActionButton(): void {
    if (!this.actionBtn) return;
    const tg = this.world.hero.target;
    this.actionBtn.setAlpha(tg ? 1 : 0.55);
    const lbl = tg?.kind === 'container' ? t('hud.open') : t('hud.gather');
    if (this.actionLabel && this.actionLabel.text !== lbl) this.actionLabel.setText(lbl);
    const icon = this.world.actionIcon() ?? 'ui.btn_action';
    const isUi = icon.startsWith('ui.');
    const info = getAssetInfo(isUi ? icon : 'ui.btn_action')!;
    if (this.actionBtn.frame.name !== info.frame) this.actionBtn.setFrame(info.frame);
    const ov = this.actionOverlay;
    if (!ov) return;
    if (isUi) {
      ov.setVisible(false);
      return;
    }
    const oi = getAssetInfo(icon);
    if (!oi) return;
    if (ov.texture.key !== oi.group || ov.frame.name !== oi.frame) ov.setTexture(oi.group, oi.frame);
    ov.setScale((this.actionBtn.displayWidth * 0.55) / Math.max(ov.frame.width, ov.frame.height)).setVisible(
      true,
    );
  }

  // ------------------------------------------------------------------ сообщения

  private bloodText: Phaser.GameObjects.BitmapText | null = null;
  private magText: Phaser.GameObjects.BitmapText | null = null;
  private magKey = '';

  /** Патроны в магазине над выбранным слотом пояса; «…» — перезарядка. */
  private updateMag(): void {
    if (!this.world?.hero || !this.world.build) return;
    const m = this.world.hero.magInfo;
    const key = m ? `${m.mag}${m.reloading ? 'r' : ''}:${this.world.hero.inv.selected}` : '';
    if (key === this.magKey || !this.magText) return;
    this.magKey = key;
    if (!m) {
      this.magText.setVisible(false);
      return;
    }
    const k = this.k;
    const cell = Math.round(50 * k);
    const n = this.world.hero.inv.hotbar.size;
    const x0 = this.scale.width / 2 - ((n + 2) * (cell + 4)) / 2;
    const x = x0 + this.world.hero.inv.selected * (cell + 4) + cell / 2;
    this.magText
      .setText(m.reloading ? '…' : String(m.mag))
      .setPosition(x, this.scale.height - cell - 14)
      .setTint(m.mag === 0 ? 0xff6050 : 0xffffff)
      .setVisible(!this.world.build.active);
  }

  private showSaved(): void {
    this.savedText.setAlpha(1);
    this.tweens.killTweensOf(this.savedText);
    this.tweens.add({ targets: this.savedText, alpha: 0, delay: 1200, duration: 600 });
  }

  private showToast(text: string): void {
    this.toast.setText(text).setAlpha(1);
    this.tweens.killTweensOf(this.toast);
    this.tweens.add({ targets: this.toast, alpha: 0, delay: TOAST_MS, duration: 400 });
  }

  // ------------------------------------------------------------------ кадр

  private extras: HudExtras | null = null;

  override update(time: number, delta: number): void {
    this.updateMag();
    this.extras?.update(time);
    const world = this.world;
    const s = world.dayState;
    if (!s || !world.hero) return;
    const reg = registry();
    const cfg = world.dayNight.cfg;
    // Часы: 6:00 — начало суток (рассвет), сутки = 24 «часа».
    const hours = (6 + (s.timeOfDay / cfg.fullDaySec) * 24) % 24;
    const hh = Math.floor(hours);
    const mm = Math.floor((hours - hh) * 60);
    const blood = s.bloodNight ? ` · ${t('hud.blood_night')}` : '';
    const text = `${t('hud.day', { n: s.day })} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · ${t(`hud.phase.${s.phase}`)}${blood}`;
    if (text !== this.lastClock) {
      this.lastClock = text;
      this.clockText.setText(text);
    }

    // Здоровье: плавно 0.25 с, белый «хвост» догоняет за 0.5 с.
    const hero = world.hero;
    const v = hero.vitals;
    const max = reg.balance.player.hp;
    const frac = Phaser.Math.Clamp(v.hp / max, 0, 1);
    const dt = delta / 1000;
    this.hpShown += (frac - this.hpShown) * Math.min(1, dt / BAR_SMOOTH_SEC);
    if (this.hpTailShown < this.hpShown) this.hpTailShown = this.hpShown;
    else this.hpTailShown += (this.hpShown - this.hpTailShown) * Math.min(1, dt / BAR_TAIL_SEC);
    this.hpFill.setCrop(0, 0, this.hpFill.frame.width * this.hpShown, this.hpFill.frame.height);
    this.hpTail.setCrop(0, 0, this.hpTail.frame.width * this.hpTailShown, this.hpTail.frame.height);
    const hpText = t('hud.hp', { hp: Math.ceil(v.hp), max: Math.round(hero.maxHp) });
    if (this.hpText.text !== hpText) this.hpText.setText(hpText);

    // Показатели
    const low = reg.survival.needs.lowFrac;
    const needMax = reg.survival.needs.max;
    for (const st of this.stats) {
      if (st.key === 'hunger')
        this.drawRing(st, v.hunger / needMax, st.color, v.hunger / needMax < low, time);
      else if (st.key === 'thirst')
        this.drawRing(st, v.thirst / needMax, st.color, v.thirst / needMax < low, time);
      else if (st.key === 'stamina')
        this.drawRing(
          st,
          hero.stamina / reg.balance.player.stamina,
          st.color,
          hero.stamina / reg.balance.player.stamina < low,
          time,
        );
      else if (st.key === 'temperature') {
        const color = v.temperature < 0 ? 0x6ab4ff : 0xff9a3a;
        this.drawRing(
          st,
          Math.min(1, Math.abs(v.temperature) / TEMP_RING_FULL),
          color,
          outOfComfort(reg.survival, v),
          time,
        );
      } else
        this.drawRing(
          st,
          v.radiation / reg.survival.radiation.max,
          st.color,
          v.radiation > reg.survival.radiation.max * 0.5,
          time,
        );
    }
    this.updateConditions();

    this.updateHotbar();
    this.updateActionButton();

    // Низкие показатели (ANIMATIONS §1): красная виньетка с пульсом, зелёное зерно радиации.
    const hpLow = frac < low && !hero.dead;
    this.vignette.setAlpha(hpLow ? 0.35 + 0.3 * Math.abs(Math.sin(time / 450)) : 0);
    const rad = v.radiation / reg.survival.radiation.max;
    this.radVignette.setAlpha(Math.min(0.5, rad * 1.2));
    this.grain.setAlpha(Math.min(0.35, rad)).setTilePosition(Math.random() * 128, Math.random() * 128);
  }
}
