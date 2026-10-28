import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import { getAssetInfo } from '../assets/AssetIndex';
import { spawnSprite } from '../assets/spawnSprite';
import { BOSS_BAR } from '../bosses/BossManager';
import { registry } from '../GameContext';
import { NOTIFY, type Notice } from '../progress/GameProgress';
import { TILE } from '../render/GroundTiles';
import type { WorldScene } from '../scenes/WorldScene';
import { UI_FONT } from './BitmapFont';
import { uiScale } from './layout';

const NOTICE_MS = 2500;
const MINIMAP_PX = 84;
const MINIMAP_STEP = 1;
/** Цвета биомов на мини-карте (0 — море). */
const BIOME_COLORS = [0x1d4f7a, 0x5f8f3e, 0x4f6b3a, 0x6d6d6d, 0xc9a35a, 0xdfe8ee, 0x5b6b2a];

/**
 * Дополнения HUD (шаг 9): плашки уведомлений сверху (новый предмет, рецепт, уровень, задание — 2.5 с,
 * ANIMATIONS §11), полоса HP босса с именем, часы со стрелкой `clock_day_night`, счётчик до кровавой
 * ночи (пульсирует красным за игровой час), мини-карта (круг вокруг героя), подсказки обучения
 * (стрелка к цели покачивается, нужная кнопка пульсирует, «Пропустить»).
 */
export class HudExtras {
  private k: number;
  private queue: Notice[] = [];
  private showing: Phaser.GameObjects.Container | null = null;
  private bossBox: Phaser.GameObjects.Container;
  private bossFill: Phaser.GameObjects.Rectangle;
  private bossName: Phaser.GameObjects.BitmapText;
  private bossW: number;
  private bloodText: Phaser.GameObjects.BitmapText;
  private clockArrow: Phaser.GameObjects.Image | null = null;
  private mini: Phaser.Textures.CanvasTexture;
  private miniImg: Phaser.GameObjects.Image;
  private miniBase: ImageData | null = null;
  private miniTile = '';
  private miniAt = 0;
  private miniBaseAt = 0;
  private tutBox: Phaser.GameObjects.Container;
  private tutText: Phaser.GameObjects.BitmapText;
  private arrow: Phaser.GameObjects.Triangle;
  private pulse: Phaser.Tweens.Tween | null = null;
  private pulsed: Phaser.GameObjects.Image | null = null;

  constructor(
    private readonly ui: Phaser.Scene,
    private readonly world: WorldScene,
    private readonly findButton: (id: string) => Phaser.GameObjects.Image | null,
    private readonly clockText: Phaser.GameObjects.BitmapText,
  ) {
    const k = (this.k = uiScale(ui));
    const { width } = ui.scale;
    const ev = ui.game.events;
    const onNotify = (n: Notice) => {
      this.queue.push(n);
      if (!this.showing) this.next();
    };
    ev.on(NOTIFY, onNotify);
    // Полоса HP босса.
    this.bossW = Math.min(width * 0.5, 520 * k);
    const bg = ui.add.rectangle(0, 0, this.bossW + 4, 16 * k, 0x000000, 0.75).setOrigin(0.5);
    this.bossFill = ui.add.rectangle(-this.bossW / 2, 0, this.bossW, 12 * k, 0xc02a1a).setOrigin(0, 0.5);
    this.bossName = ui.add
      .bitmapText(0, -16 * k, UI_FONT, '', Math.round(15 * k + 4))
      .setOrigin(0.5, 1)
      .setTint(0xffd0c0);
    this.bossBox = ui.add
      .container(width / 2, 64 * k, [bg, this.bossFill, this.bossName])
      .setDepth(70)
      .setVisible(false);
    const onBoss = (b: { name: string; frac: number; phase: number } | null) => {
      this.bossBox.setVisible(!!b);
      if (!b) return;
      this.bossName.setText(`${b.name}${b.phase > 1 ? ` · ${t('boss.phase_n', { n: b.phase })}` : ''}`);
      ui.tweens.add({ targets: this.bossFill, width: Math.max(0, this.bossW * b.frac), duration: 250 });
    };
    ev.on(BOSS_BAR, onBoss);
    // Счётчик кровавой ночи — под часами.
    this.bloodText = ui.add
      .bitmapText(
        clockText.x,
        clockText.y + clockText.fontSize * 0.5 + 10 * k + 2, // текст часов ещё пуст — от кегля
        UI_FONT,
        '',
        Math.round(12 * k + 3),
      )
      .setOrigin(1, 0.5)
      .setDepth(60);
    if (getAssetInfo('ui.clock_day_night')) {
      this.clockArrow = spawnSprite(ui, 0, clockText.y, 'ui.clock_day_night', {
        depth: 60,
      }).setOrigin(0.5);
      this.clockArrow.setScale(
        (30 * k) / Math.max(this.clockArrow.frame.width, this.clockArrow.frame.height),
      );
    }
    // Мини-карта: круг справа сверху.
    const key = 'hud-minimap';
    if (ui.textures.exists(key)) ui.textures.remove(key);
    this.mini = ui.textures.createCanvas(key, MINIMAP_PX, MINIMAP_PX)!;
    const mx = width - (MINIMAP_PX * k) / 2 - 12 * k;
    const my = this.bloodText.y + 14 * k + (MINIMAP_PX * k) / 2;
    this.miniImg = ui.add
      .image(mx, my, key)
      .setDisplaySize(MINIMAP_PX * k, MINIMAP_PX * k)
      .setDepth(55);
    // Круг — прозрачностью в самой текстуре (drawMinimap): маска-трафарет на телефоне стоит ~10 мс кадра.
    // Обучение: панель сверху, стрелка, «Пропустить».
    // Между строкой состояний слева и мини-картой справа, ниже отсчёта до кровавой ночи.
    const tl = width * 0.22;
    const tr = mx - (MINIMAP_PX * k) / 2 - 10 * k;
    const tw = tr - tl;
    const th = 46 * k;
    const skipW = 110 * k;
    this.tutText = ui.add
      .bitmapText(-skipW / 2 - 6 * k, 0, UI_FONT, '', Math.round(14 * k + 4))
      .setOrigin(0.5)
      .setMaxWidth(tw - skipW - 24 * k);
    // Фон и «Пропустить» — из атласа ui и BitmapText: Graphics/Text рвут пакет отрисовки (~1.5 мс на телефоне).
    const pi = getAssetInfo('ui.panel_9slice')!;
    const tbg = ui.add.nineslice(0, 0, pi.group, pi.frame, tw, th, 14, 14, 14, 14).setTint(0xffd9a0);
    const skip = ui.add
      .bitmapText(tw / 2 - skipW / 2 - 6 * k, 0, UI_FONT, t('tut.skip'), Math.round(12 * k + 4))
      .setOrigin(0.5)
      .setTint(0xe0a040)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => this.world.progress.skipTutorial());
    skip.input!.hitArea.setTo(-10 * k, -12 * k, skip.width + 20 * k, skip.height + 24 * k);
    const ty = Math.max(108 * k, this.bloodText.y + 16 * k + th / 2);
    this.tutBox = ui.add.container(tl + tw / 2, ty, [tbg, this.tutText, skip]).setDepth(65);
    this.arrow = ui.add
      .triangle(0, 0, 0, 0, 22 * k, 0, 11 * k, 22 * k, 0xffd040)
      .setDepth(66)
      .setStrokeStyle(2, 0x000000);
    const onStep = () => this.syncTutorial();
    ev.on('tutorial-step', onStep);
    this.syncTutorial();
    ui.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      ev.off(NOTIFY, onNotify);
      ev.off(BOSS_BAR, onBoss);
      ev.off('tutorial-step', onStep);
    });
  }

  private get touch(): boolean {
    return this.ui.sys.game.device.input.touch && !this.ui.sys.game.device.os.desktop;
  }

  // ------------------------------------------------------------------ уведомления

  private next(): void {
    let n = this.queue.shift();
    if (!n) {
      this.showing = null;
      return;
    }
    const ui = this.ui;
    const k = this.k;
    const { width } = ui.scale;
    const txt = ui.add.bitmapText(0, 0, UI_FONT, n.text, Math.round(14 * k + 4)).setOrigin(0, 0.5);
    // Без своего значка — значок по виду уведомления.
    const byKind: Partial<Record<Notice['kind'], string>> = {
      level: 'ui.icon_level_up',
      quest: 'ui.icon_task_done',
      note: 'ui.icon_note',
    };
    if (!n.icon || !getAssetInfo(n.icon)) n = { ...n, icon: byKind[n.kind] };
    const hasIcon = !!n.icon && !!getAssetInfo(n.icon);
    const w = txt.width + (hasIcon ? 44 * k : 0) + 28 * k;
    const color =
      n.kind === 'level'
        ? 0xffd040
        : n.kind === 'recipe'
          ? 0x60b0ff
          : n.kind === 'quest'
            ? 0x8fd46a
            : n.kind === 'note'
              ? 0x5ab4ff
              : 0xe0a040;
    const bg = ui.add.rectangle(0, 0, w, 40 * k, 0x1d1a16, 0.95).setStrokeStyle(2, color);
    const parts: Phaser.GameObjects.GameObject[] = [bg];
    let x = -w / 2 + 14 * k;
    if (hasIcon) {
      const ic = spawnSprite(ui, x + 14 * k, 0, n.icon!, { depth: false }).setOrigin(0.5);
      ic.setScale((28 * k) / Math.max(ic.frame.width, ic.frame.height));
      parts.push(ic);
      x += 36 * k;
    }
    txt.setPosition(x, 0);
    parts.push(txt);
    const box = ui.add.container(width / 2, -30 * k, parts).setDepth(80);
    this.showing = box;
    ui.tweens.add({ targets: box, y: 26 * k, duration: 220, ease: 'Back.Out' });
    ui.time.delayedCall(NOTICE_MS, () =>
      ui.tweens.add({
        targets: box,
        y: -30 * k,
        alpha: 0,
        duration: 220,
        onComplete: () => {
          box.destroy();
          this.next();
        },
      }),
    );
  }

  // ------------------------------------------------------------------ обучение

  private syncTutorial(): void {
    const st = this.world.progress.tutorialStep;
    this.pulse?.stop();
    if (this.pulsed) this.pulsed.setScale((this.pulsed.getData('baseScale') as number) ?? this.pulsed.scale);
    this.pulse = null;
    this.pulsed = null;
    if (!st) {
      this.tutBox.setVisible(false);
      this.arrow.setVisible(false);
      return;
    }
    this.tutBox.setVisible(true);
    const key = `tut.${st.id}${this.touch ? '.touch' : ''}`;
    const text = t(key) === key ? t(`tut.${st.id}`) : t(key);
    this.tutText.setText(text);
    // Нужная кнопка пульсирует.
    const btn: Record<string, string> = {
      craft_tools: 'craft',
      fight: 'ui.btn_attack',
      build_base: 'ui.btn_build',
      gather_hands: 'ui.btn_action',
      chop_campfire: 'ui.btn_action',
    };
    const b = btn[st.id] ? this.findButton(btn[st.id]!) : null;
    if (b) {
      b.setData('baseScale', b.scale);
      this.pulsed = b;
      this.pulse = this.ui.tweens.add({
        targets: b,
        scale: b.scale * 1.15,
        duration: 450,
        yoyo: true,
        repeat: -1,
      });
    }
  }

  /** Цель стрелки в мире для шага обучения. */
  private tutorialTarget(): { x: number; y: number } | null {
    const st = this.world.progress.tutorialStep;
    if (!st) return null;
    const w = this.world;
    const h = w.hero.pos;
    const find = (pred: (id: string, kind: string) => boolean) => {
      let best: { x: number; y: number } | null = null;
      let bd = Infinity;
      for (const o of w.objectsNear(h.x, h.y, 14)) {
        if (o.state !== 'intact' || !pred(o.ref.id, o.kind)) continue;
        const d = Math.hypot(o.x - h.x, o.y - h.y);
        if (d < bd) {
          bd = d;
          best = { x: o.x, y: o.y };
        }
      }
      return best;
    };
    if (st.id === 'gather_hands')
      return find(
        (id, kind) =>
          kind === 'bush' || kind === 'grass' || id.includes('rock_remains') || id.includes('sticks'),
      );
    if (st.id === 'chop_campfire') return find((_id, kind) => kind === 'tree');
    if (st.id === 'fight') {
      const e = w.enemies.alive.find((x) => !x.passive);
      return e ? { x: e.x, y: e.y } : null;
    }
    return null;
  }

  // ------------------------------------------------------------------ кадр

  update(time: number): void {
    const w = this.world;
    if (!w.dayState) return;
    const reg = registry();
    const dn = reg.balance.dayNight;
    // Часы: стрелка вращается плавно по времени суток.
    this.clockArrow
      ?.setX(this.clockText.x - this.clockText.width - 22 * this.k)
      .setRotation(((w.dayNight.seconds % dn.fullDaySec) / dn.fullDaySec) * Math.PI * 2);
    // До кровавой ночи (каждая bloodNightEvery-я): пульс красным за игровой час.
    const every = dn.bloodNightEvery;
    const day = w.dayState.day;
    const bd = Math.ceil(day / every) * every;
    const startSec = (bd - 1) * dn.fullDaySec + dn.daySec;
    const left = startSec - w.dayNight.seconds;
    const hour = dn.fullDaySec / 24;
    if (w.dayState.bloodNight) this.bloodText.setText('');
    else if (left > 0) {
      const txt =
        left > dn.fullDaySec
          ? t('hud.blood_in_days', { n: Math.ceil(left / dn.fullDaySec) })
          : t('hud.blood_in_hours', { n: Math.ceil(left / hour) });
      if (this.bloodText.text !== txt) this.bloodText.setText(txt);
      const soon = left <= hour;
      this.bloodText.setTint(soon ? 0xff4030 : 0xd09080).setScale(soon ? 1 + 0.08 * Math.sin(time / 120) : 1);
    }
    // Мини-карта 5 раз в секунду, всё — в одной канве: фон (биомы, туман) — при смене клетки героя
    // или раз в секунду, поверх — точки и рамка.
    if (time >= this.miniAt) {
      this.miniAt = time + 200;
      const h = w.hero.pos;
      const tile = `${Math.floor(h.x)},${Math.floor(h.y)}`;
      if (!this.miniBase || tile !== this.miniTile || time >= this.miniBaseAt) {
        this.miniTile = tile;
        this.miniBaseAt = time + 1000;
        this.miniBase = this.drawMinimap(Math.floor(h.x) + 0.5, Math.floor(h.y) + 0.5);
      }
      this.drawMiniDots(Math.floor(h.x) + 0.5, Math.floor(h.y) + 0.5);
    }
    // Стрелка обучения к цели в мире покачивается.
    const tg = this.tutorialTarget();
    const cam = w.cameras.main;
    if (tg) {
      const sx = (tg.x * TILE - cam.worldView.x) * cam.zoom;
      const sy = (tg.y * TILE - 70 - cam.worldView.y) * cam.zoom + Math.sin(time / 200) * 6;
      this.arrow.setVisible(true).setPosition(sx - 11 * this.k, sy - 22 * this.k);
    } else this.arrow.setVisible(false);
  }

  private drawMinimap(hx: number, hy: number): ImageData {
    const w = this.world;
    const img = this.mini.context.createImageData(MINIMAP_PX, MINIMAP_PX);
    const h = { x: hx, y: hy };
    const half = (MINIMAP_PX / 2) * MINIMAP_STEP;
    const n = w.world.chunkTiles;
    const L = w.world.layout;
    const R2 = (MINIMAP_PX / 2) ** 2;
    for (let py = 0; py < MINIMAP_PX; py++) {
      for (let px = 0; px < MINIMAP_PX; px++) {
        const x = Math.floor(h.x - half + px * MINIMAP_STEP);
        const y = Math.floor(h.y - half + py * MINIMAP_STEP);
        let c = 0x0b0a08;
        if (w.progress.isVisited(Math.floor(x / n), Math.floor(y / n))) {
          c = BIOME_COLORS[L.biomeAt(x + 0.5, y + 0.5)] ?? 0;
          if (L.roads.has(L.cellIndex(x, y))) c = 0x3a3a3a;
          const st = L.stamps.get(L.cellIndex(x, y));
          if (st && (st.kind === 'wall' || st.kind === 'fence')) c = 0x8b2a1a;
        }
        const o = (py * MINIMAP_PX + px) * 4;
        const dx = px + 0.5 - MINIMAP_PX / 2;
        const dy = py + 0.5 - MINIMAP_PX / 2;
        if (dx * dx + dy * dy > R2) continue; // вне круга — прозрачно
        img.data[o] = (c >> 16) & 255;
        img.data[o + 1] = (c >> 8) & 255;
        img.data[o + 2] = c & 255;
        img.data[o + 3] = 255;
      }
    }
    return img;
  }

  private drawMiniDots(hx: number, hy: number): void {
    const w = this.world;
    const c = this.mini.context;
    c.putImageData(this.miniBase!, 0, 0);
    const R = MINIMAP_PX / 2;
    const dot = (x: number, y: number, color: string, r: number) => {
      const dx = (x - hx) / MINIMAP_STEP;
      const dy = (y - hy) / MINIMAP_STEP;
      if (Math.hypot(dx, dy) > R - r) return; // вне круга мини-карты
      c.fillStyle = color;
      c.beginPath();
      c.arc(R + dx, R + dy, r, 0, Math.PI * 2);
      c.fill();
    };
    const core = w.baseCore();
    if (core) dot(core.x, core.y, '#ff5040', 3);
    for (const o of w.outposts()) dot(o.x, o.y, '#40c0ff', 3);
    for (const e of w.enemies.alive) if (!e.hidden && !e.passive) dot(e.x, e.y, '#ff3030', 1.6);
    for (const b of w.bosses.bosses)
      if (b.alive && Math.hypot(b.x - hx, b.y - hy) < 60) dot(b.x, b.y, '#ffd040', 3);
    const h = w.hero.pos;
    dot(h.x, h.y, '#00e5ff', 2.6);
    c.strokeStyle = '#5a4a35';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(R, R, R - 1, 0, Math.PI * 2);
    c.stroke();
    this.mini.refresh();
  }
}
