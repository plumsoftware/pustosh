import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import type { Registry } from '../../core/data/Registry';
import { Boss, type BossEvent, type Telegraph, type ZoneShape } from '../../core/entities/Boss';
import { armorReduce } from '../../core/systems/Combat';
import { moveCircle } from '../../core/world';
import { Rng } from '../../core/util/rng';
import { AdsController } from '../AdsController';
import { getAssetInfo } from '../assets/AssetIndex';
import { AssetLoader } from '../assets/AssetLoader';
import { spawnSprite } from '../assets/spawnSprite';
import { ctx } from '../GameContext';
import { DEPTH } from '../render/ChunkView';
import * as Fx from '../render/Fx';
import { TILE } from '../render/GroundTiles';
import { SceneKeys } from '../SceneKeys';
import type { MenuData } from '../scenes/MenuScene';
import { TOAST, type WorldScene } from '../scenes/WorldScene';

/** HUD: полоса HP босса (имя, доля, фаза) или null — боя нет. */
export const BOSS_BAR = 'boss-bar';

interface Zone {
  t: Telegraph;
  g: Phaser.GameObjects.Graphics;
}

interface View {
  img: Phaser.GameObjects.Image;
  base: number;
  shadow: Phaser.GameObjects.Image;
  part?: Phaser.GameObjects.Image;
  extra: Phaser.GameObjects.GameObject[];
  phase: number;
  lastHp: number;
  flashUntil: number;
  shield?: Phaser.GameObjects.Arc;
  /** Когда щит разбили (мс сцены) — 5 с без круга. */
  shieldOffAt?: number;
  /** Бугор над Пожирателем под землёй. */
  mound?: Phaser.GameObjects.Image;
}

/** Части атак поверх целого спрайта (rigs.json → boss.approach). */
const PARTS: Record<string, string> = {
  butcher: 'characters.bosses.butcher_hook_chain',
  queen: 'characters.bosses.queen_egg_sacs',
  tyrant: 'characters.bosses.tyrant_tail',
  devourer: 'characters.bosses.devourer_teeth_ring',
  frost: 'characters.bosses.frost_ice_shard',
  zero: 'characters.bosses.zero_tentacle',
};

/**
 * Боссы на аренах (TZ 9.2): спят до входа героя, бой с барьером (герой не выйдет до победы или смерти),
 * чекпоинт у костра, красные зоны предупреждений (заполняются за время замаха), полоса HP вверху,
 * фазы (вспышка, рёв, волна пыли), части атак, смерть, трофей, реклама boss_defeated → экран награды
 * с double_loot.
 */
export class BossManager {
  bosses: Boss[] = [];
  private views = new Map<string, View>();
  private zones: Zone[] = [];
  private active: Boss | null = null;
  private barrier: Phaser.GameObjects.Graphics;
  private rng = new Rng((Math.random() * 2 ** 32) >>> 0);
  private savedRespawn: { x: number; y: number } | null = null;
  private dust: Phaser.GameObjects.Particles.ParticleEmitter;
  private gold: Phaser.GameObjects.Particles.ParticleEmitter;
  private lastBar = '';
  private blockedHintAt = 0;
  /** Ограда арены на время боя (лист s27): камни с цепями по кругу. */
  private fence: Phaser.GameObjects.Image[] = [];
  private fenceArena: { x: number; y: number; r: number } | null = null;

  constructor(
    private readonly scene: WorldScene,
    private readonly reg: Registry,
  ) {
    const limit = ctx().config.mvpBiomeLimit;
    for (const p of scene.world.layout.prefabs) {
      if (p.kind !== 'arena') continue;
      const def = reg.bosses.byBiome(p.biome);
      if (!def || scene.progress.bosses.has(def.id) || p.biome > Math.max(limit, 6)) continue;
      const R = reg.prog.bosses.arenaRadiusTiles;
      this.bosses.push(new Boss(reg, def, p.x, p.y - 2, { x: p.x, y: p.y, r: R }));
    }
    this.barrier = scene.add.graphics().setDepth(DEPTH.glow - 2);
    this.dust = Fx.particles(scene, ['effects.dust_1', 'effects.dust_2', 'effects.dust_3'], {
      tint: 0x9a8a70,
      lifespan: 900,
      speed: { min: 80, max: 220 },
      scale: { start: 0.4, end: 0 },
      gravityY: 40,
    }).setDepth(DEPTH.glow - 1);
    this.gold = Fx.particles(scene, ['effects.sparkle_1', 'effects.sparkle_2'], {
      tint: 0xffd040,
      lifespan: 1200,
      speed: { min: 30, max: 90 },
      scale: { start: 0.3, end: 0 },
      gravityY: -30,
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(DEPTH.glow + 2);
  }

  /** Босс как цель ударов героя (EnemyManager). */
  get targets(): Boss[] {
    return this.bosses.filter((b) => b.alive && b.state === 'fight' && !b.hidden);
  }

  get fighting(): boolean {
    return !!this.active && this.active.state === 'fight';
  }

  tick(dt: number): void {
    const s = this.scene;
    const h = s.hero;
    const now = s.dayNight.seconds;
    for (const b of this.bosses) {
      const near = Math.hypot(h.pos.x - b.arena.x, h.pos.y - b.arena.y) < b.arena.r + 30;
      if (!near && b.state !== 'fight') continue;
      if (near) void AssetLoader.ensureGroup(s, 'bosses');
      const wasSleep = b.state === 'sleep';
      b.tick({
        now,
        dt,
        hero: { x: h.pos.x, y: h.pos.y, alive: !h.dead },
        rng: () => this.rng.next(),
        emit: (ev) => this.onEvent(b, ev),
      });
      if (wasSleep && b.state === 'fight') this.startFight(b);
    }
    const a = this.active;
    this.syncFence(a && a.state === 'fight' ? a.arena : null);
    if (a && a.state === 'fight') {
      // Барьер: из арены не выйти, пока бой.
      const d = Math.hypot(h.pos.x - a.arena.x, h.pos.y - a.arena.y);
      const R = a.arena.r - 0.5;
      // Героя унесло далеко (телепорт, смерть с возрождением) — бой сброшен, а не возврат через полкарты.
      if (d > a.arena.r + 6) {
        // Ушёл, а не погиб — чекпоинт арены больше не нужен.
        if (!h.dead && this.savedRespawn) h.respawn = this.savedRespawn;
        this.lose(a);
        return;
      }
      if (d > R && !h.dead)
        h.teleport(a.arena.x + ((h.pos.x - a.arena.x) / d) * R, a.arena.y + ((h.pos.y - a.arena.y) / d) * R);
      if (h.dead) this.lose(a);
    }
    this.zones = this.zones.filter((z) => {
      if (now <= z.t.end + 0.15) return true;
      z.g.destroy();
      return false;
    });
  }

  private startFight(b: Boss): void {
    const s = this.scene;
    this.active = b;
    // Чекпоинт у костра арены — возрождение рядом при смерти в бою.
    this.savedRespawn = s.hero.respawn;
    s.hero.respawn = { x: b.arena.x, y: b.arena.y + 8.2 + this.reg.prog.bosses.checkpointRespawnTiles };
    s.game.events.emit(TOAST, t('boss.enter', { name: b.def.name_ru }));
    s.audio.play('growl', 'sfx', 1, 0.7);
    Fx.cameraShake(s, 300, 0.008);
  }

  /** Герой погиб в бою или ушёл: босс восстанавливается, барьер снят. */
  private lose(b: Boss): void {
    b.reset();
    this.active = null;
    this.syncFence(null);
    for (const z of this.zones) z.g.destroy();
    this.zones = [];
    this.scene.game.events.emit(BOSS_BAR, null);
    this.lastBar = '';
  }

  // ------------------------------------------------------------------ события боя

  private onEvent(b: Boss, ev: BossEvent): void {
    const s = this.scene;
    const h = s.hero;
    switch (ev.type) {
      case 'telegraph':
        this.zone(ev.t);
        break;
      case 'resolve': {
        const z = this.zones.find((q) => q.t.id === ev.t.id);
        if (z) {
          z.g.destroy();
          this.zones = this.zones.filter((q) => q !== z);
        }
        this.attackFx(b, ev.t);
        break;
      }
      case 'hit':
        h.damage(armorReduce(ev.damage, h.inv.stat('armor')), ev.fromX);
        if (ev.damage >= 25) Fx.cameraShake(s, 160, 0.008);
        break;
      case 'pull': {
        const d = Math.hypot(ev.toX - h.pos.x, ev.toY - h.pos.y) || 1;
        const k = Math.min(ev.tiles, d - 1.2) / d;
        if (k > 0)
          h.pos = moveCircle(
            s.world,
            h.pos.x,
            h.pos.y,
            0.22,
            (ev.toX - h.pos.x) * k,
            (ev.toY - h.pos.y) * k,
            0.75,
          );
        break;
      }
      case 'stun':
        h.rootedUntil = s.dayNight.seconds + ev.sec;
        break;
      case 'summon':
        for (let i = 0; i < ev.n; i++) {
          const a = (i / ev.n) * Math.PI * 2;
          const e = s.enemies.spawnEnemy(
            ev.id,
            b.arena.x + Math.cos(a) * (b.arena.r - 2),
            b.arena.y + Math.sin(a) * (b.arena.r - 2),
          );
          if (e) e.hidden = false;
          // Королева откладывает яйца — из них и вылезают (s31).
          if (e && b.def.id === 'queen' && getAssetInfo('world.common.queen_egg')) {
            const egg = spawnSprite(s, e.x * TILE, e.y * TILE + 2, 'world.common.queen_egg');
            s.time.delayedCall(450, () => {
              const open = getAssetInfo('world.common.queen_egg_open')!;
              egg.setTexture(open.group, open.frame);
              s.tweens.add({
                targets: egg,
                alpha: 0,
                delay: 1500,
                duration: 600,
                onComplete: () => egg.destroy(),
              });
            });
          }
        }
        break;
      case 'phase':
        this.phaseFx(b);
        break;
      case 'pools':
        for (const [x, y] of ev.pts) s.enemies.areaAt(x, y, ev.r, ev.sec, ev.dps, ev.kind ?? 'poison', false);
        break;
      case 'chill':
        // Ледяное дыхание: тело резко остывает (холод замедляет и ранит по правилам выживания).
        h.vitals.temperature -= ev.deg * Math.max(0.2, 1 - h.inv.stat('coldRes') / 10);
        Fx.burst(s, 'effects.snow_puff', h.pos.x * TILE, h.pos.y * TILE - 40, {
          from: 30,
          to: 60,
          ms: 600,
          depth: DEPTH.glow,
          add: true,
        });
        break;
      case 'blocked':
        // Щит «Мороза» — подсказка, чем его снять (не чаще раза в 8 с).
        if (s.time.now >= this.blockedHintAt) {
          this.blockedHintAt = s.time.now + 8000;
          s.game.events.emit(TOAST, t('boss.shield_hint'));
        }
        break;
      case 'plates':
        this.platesFx(b);
        break;
      case 'shot':
        this.shotFx(ev);
        break;
      case 'charge':
        for (let i = 0; i <= 10; i++) {
          const x = Math.floor(ev.x0 + ((ev.x1 - ev.x0) * i) / 10);
          const y = Math.floor(ev.y0 + ((ev.y1 - ev.y0) * i) / 10);
          for (const r of s.world.damageEdgesOfCell(x, y, 9999))
            if (r.result === 'destroyed') s.wallBroken(r.e);
        }
        Fx.cameraShake(s, 250, 0.01);
        break;
      case 'dive':
        this.diveFx(b, ev.on);
        break;
      case 'roar':
        Fx.cameraShake(s, 400, 0.012);
        this.dust.explode(30, b.x * TILE, b.y * TILE);
        s.audio.play('growl', 'sfx', 1, 0.6);
        break;
      case 'shield':
        if (!ev.on) {
          s.game.events.emit(TOAST, t('boss.shield_down'));
          // Щит разбивается: ледяные осколки во все стороны.
          Fx.burst(s, 'effects.ice_burst', b.x * TILE, b.y * TILE - 50, {
            from: 60,
            to: 150,
            ms: 600,
            depth: DEPTH.glow,
            add: true,
          });
          const v = this.views.get(b.id);
          if (v) v.shieldOffAt = s.time.now;
        }
        break;
      case 'died':
        this.win(b);
        break;
    }
  }

  // ------------------------------------------------------------------ победа

  private win(b: Boss): void {
    const s = this.scene;
    const reg = this.reg;
    this.active = null;
    for (const z of this.zones) z.g.destroy();
    this.zones = [];
    s.game.events.emit(BOSS_BAR, null);
    this.lastBar = '';
    if (this.savedRespawn !== undefined) s.hero.respawn = this.savedRespawn;
    this.deathFx(b);
    s.progress.bosses.add(b.def.id);
    s.progress.count('bosses');
    s.progress.xp(reg.prog.xp.bossPerNumber * b.def.biome);
    // Трофей выпадает предметом с отскоком и золотыми блёстками.
    const drop = s.world.dropItem({ id: b.def.trophy.item, count: 1 }, b.x, b.y + 0.4, s.dayNight.seconds);
    s.onDropsAppeared([drop]);
    this.gold.explode(40, b.x * TILE, b.y * TILE - 30);
    Fx.cameraShake(s, 500, 0.01);
    s.time.delayedCall(2500, () => void this.reward(b));
    void s.saveNow();
  }

  /**
   * Что открыла победа — для экрана награды: без проходов между биомами (граница мягкая, ворот нет),
   * «рецепт <id>» — названием предмета или станка.
   */
  private unlocksText(b: Boss): string {
    const reg = this.reg;
    const name = (id: string) => reg.items.get(id)?.name_ru ?? reg.stations.get(id)?.name_ru ?? id;
    return b.def.unlocks
      .filter((u) => !/\(биом \d\)|ворот|мост|пропуск|доступ в|ключ-карт/i.test(u))
      .map((u) =>
        u.replace(
          /рецепт ([a-z0-9_]+)(?: и ([a-z0-9_]+))?/i,
          (_m, x: string, y?: string) => `рецепт: ${name(x)}${y ? `, ${name(y)}` : ''}`,
        ),
      )
      .join('; ');
  }

  /** Межстраничная реклама boss_defeated → экран награды (что открылось) → ×2 ресурсов за рекламу double_loot. */
  private async reward(b: Boss): Promise<void> {
    const s = this.scene;
    await AdsController.interstitial('boss_defeated');
    const res = this.reg.prog.bosses.reward[b.def.id] ?? {};
    const give = (mul: number) => {
      for (const [id, n] of Object.entries(res)) if (this.reg.items.has(id)) s.give({ id, count: n * mul });
    };
    const list = Object.entries(res)
      .map(([id, n]) => `${this.reg.items.get(id)?.name_ru ?? id} ×${n}`)
      .join(', ');
    s.scene.launch(SceneKeys.Menu, {
      title: t('boss.victory', { name: b.def.name_ru }),
      subtitle: `${t('boss.unlocks')}: ${this.unlocksText(b)}\n${t('boss.reward')}: ${list}`,
      items: [
        { label: t('boss.take'), fn: () => give(1) },
        {
          label: t('boss.double_ad'),
          fn: () =>
            void AdsController.rewarded('double_loot').then((r) =>
              give(r === 'rewarded' ? this.reg.prog.bosses.rewardDoubleMul : 1),
            ),
        },
      ],
    } satisfies MenuData);
  }

  // ------------------------------------------------------------------ отрисовка

  /** Красная зона: заполнение растёт за время предупреждения. */
  private zone(tel: Telegraph): void {
    const g = this.scene.add.graphics().setDepth(DEPTH.shadow + 2);
    this.zones.push({ t: tel, g });
  }

  private drawZone(z: Zone, now: number): void {
    const p = Phaser.Math.Clamp((now - z.t.start) / Math.max(0.01, z.t.end - z.t.start), 0, 1);
    const g = z.g;
    g.clear();
    const sh = z.t.shape;
    // Облучение секторов у Пациента Ноль — зелёное (ANIMATIONS §3), остальное — красное.
    const green = z.t.attack === 'sectors';
    const draw = (alpha: number, fill: boolean, scale = 1) => {
      if (fill) g.fillStyle(green ? 0x60ff40 : 0xff2a1a, alpha);
      else g.lineStyle(3, green ? 0x80ff60 : 0xff3020, 0.9);
      if (sh.kind === 'circle') {
        if (fill) g.fillCircle(sh.x * TILE, sh.y * TILE, sh.r * TILE * scale);
        else g.strokeCircle(sh.x * TILE, sh.y * TILE, sh.r * TILE);
      } else if (sh.kind === 'cone') {
        const a0 = ((sh.dir - sh.deg / 2) * Math.PI) / 180;
        const a1 = ((sh.dir + sh.deg / 2) * Math.PI) / 180;
        g.beginPath();
        g.moveTo(sh.x * TILE, sh.y * TILE);
        g.arc(sh.x * TILE, sh.y * TILE, sh.r * TILE * scale, a0, a1);
        g.closePath();
        if (fill) g.fillPath();
        else g.strokePath();
      } else {
        const dx = sh.x1 - sh.x0;
        const dy = sh.y1 - sh.y0;
        const l = Math.hypot(dx, dy) || 1;
        const nx = (-dy / l) * (sh.w / 2);
        const ny = (dx / l) * (sh.w / 2);
        const ex = sh.x0 + dx * scale;
        const ey = sh.y0 + dy * scale;
        const pts = [
          new Phaser.Math.Vector2((sh.x0 + nx) * TILE, (sh.y0 + ny) * TILE),
          new Phaser.Math.Vector2((ex + nx) * TILE, (ey + ny) * TILE),
          new Phaser.Math.Vector2((ex - nx) * TILE, (ey - ny) * TILE),
          new Phaser.Math.Vector2((sh.x0 - nx) * TILE, (sh.y0 - ny) * TILE),
        ];
        if (fill) g.fillPoints(pts, true);
        else g.strokePoints(pts, true);
      }
    };
    draw(0.18, true);
    draw(0.35, true, p);
    draw(1, false);
  }

  private makeView(b: Boss): View | null {
    if (!AssetLoader.isLoaded(this.scene, 'bosses')) return null;
    const img = spawnSprite(this.scene, 0, 0, b.def.sprites['idle']!).setOrigin(0.5, 1);
    const base = b.def.targetHeightPx / img.frame.height;
    img.setScale(base);
    const shadow = this.scene.add
      .image(0, 0, 'fx-shadow')
      .setDisplaySize(img.displayWidth * 0.8, 34)
      .setDepth(DEPTH.shadow);
    const v: View = { img, base, shadow, extra: [], phase: 1, lastHp: b.hp, flashUntil: 0 };
    if (b.def.id === 'queen' && getAssetInfo(PARTS['queen']!)) {
      v.part = spawnSprite(this.scene, 0, 0, PARTS['queen']!, { depth: false }).setOrigin(0.5);
      v.part.setScale((img.displayWidth * 0.45) / v.part.frame.width);
    }
    if (b.def.id === 'devourer' && getAssetInfo(PARTS['devourer']!)) {
      v.part = spawnSprite(this.scene, 0, 0, PARTS['devourer']!, { depth: false }).setOrigin(0.5);
      v.part.setScale((img.displayWidth * 0.5) / v.part.frame.width);
    }
    if (b.def.id === 'frost')
      v.shield = this.scene.add
        .circle(0, 0, img.displayWidth * 0.6, 0x80d0ff, 0.18)
        .setStrokeStyle(3, 0xa0e0ff, 0.8);
    return v;
  }

  /** Камни вырастают из земли при начале боя и уходят обратно после; между ними — цепи. */
  private syncFence(arena: { x: number; y: number; r: number } | null): void {
    if (arena === this.fenceArena) return;
    const s = this.scene;
    for (const img of this.fence) {
      s.tweens.add({ targets: img, y: img.y + 40, alpha: 0, duration: 400, onComplete: () => img.destroy() });
    }
    this.fence = [];
    this.fenceArena = arena;
    if (!arena || !getAssetInfo('world.common.arena_stone')) return;
    const r = arena.r * TILE;
    const n = Math.max(8, Math.round((Math.PI * 2 * arena.r) / 2.6));
    const stone = (x: number, y: number, id: string, scale: number, delay: number) => {
      const img = spawnSprite(s, x, y + 40, id).setAlpha(0);
      img.setScale(img.scaleX * scale, img.scaleY * scale);
      s.tweens.add({ targets: img, y, alpha: 1, duration: 350, delay, ease: 'Back.Out' });
      this.fence.push(img);
    };
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = arena.x * TILE + Math.cos(a) * r;
      const y = arena.y * TILE + Math.sin(a) * r;
      stone(x, y, 'world.common.arena_stone', 0.55, i * 25);
      // Цепь между соседними камнями — только по бокам круга, где она почти горизонтальна.
      const b = ((i + 0.5) / n) * Math.PI * 2;
      if (Math.abs(Math.sin(b)) > 0.75 && getAssetInfo('world.common.arena_chain'))
        stone(
          arena.x * TILE + Math.cos(b) * r,
          arena.y * TILE + Math.sin(b) * r,
          'world.common.arena_chain',
          0.4,
          i * 25 + 60,
        );
    }
  }

  render(time: number): void {
    const s = this.scene;
    const now = s.dayNight.seconds;
    for (const z of this.zones) this.drawZone(z, now);
    // Барьер — красная пульсирующая граница арены во время боя.
    this.barrier.clear();
    const a = this.active;
    if (a && a.state === 'fight') {
      this.barrier
        .lineStyle(4, 0xff3020, 0.5 + 0.3 * Math.sin(time / 200))
        .strokeCircle(a.arena.x * TILE, a.arena.y * TILE, a.arena.r * TILE);
      const sig = `${Math.ceil((a.hp / a.maxHp) * 200)}:${a.phase}`;
      if (sig !== this.lastBar) {
        this.lastBar = sig;
        s.game.events.emit(BOSS_BAR, { name: a.def.name_ru, frac: a.hp / a.maxHp, phase: a.phase });
      }
    }
    for (const b of this.bosses) {
      const near = Math.hypot(s.hero.pos.x - b.x, s.hero.pos.y - b.y) < 40;
      let v = this.views.get(b.id);
      if (!near) {
        if (v) this.dropView(b.id);
        continue;
      }
      if (!v) {
        const nv = this.makeView(b);
        if (!nv) continue;
        v = nv;
        this.views.set(b.id, v);
      }
      if (b.state === 'dead') continue;
      const x = b.x * TILE;
      const y = b.y * TILE;
      // Фаза 2 — другой спрайт.
      if (b.phase >= 2 && v.phase < 2 && b.def.sprites['phase2']) {
        v.phase = 2;
        const info = getAssetInfo(b.def.sprites['phase2'])!;
        v.img.setTexture(info.group, info.frame);
        v.base = b.def.targetHeightPx / v.img.frame.height;
      }
      // Дыхание, наклон к цели, рывок при атаке, тряска при ударе.
      const right = Math.cos((b.faceDeg * Math.PI) / 180) >= 0;
      const breathe = 1 + Math.sin(time / 600) * 0.02;
      const age = now - b.anim.at;
      const lunge =
        !b.anim.kind.startsWith('wind_') && age < 0.25 ? Math.sin((age / 0.25) * Math.PI) * 14 : 0;
      const wind = b.anim.kind.startsWith('wind_') ? Math.sin(time / 30) * 1.5 : 0;
      if (b.hp < v.lastHp) {
        v.flashUntil = time + 90;
        v.lastHp = b.hp;
      }
      v.img
        .setFlipX(!right)
        .setScale(v.base, v.base * breathe)
        .setPosition(x + (right ? lunge : -lunge) + wind, y)
        .setAngle(b.moving ? Math.sin(time / 120) * 2 : (right ? 1 : -1) * 2)
        .setDepth(y)
        .setAlpha(b.hidden ? 0 : 1);
      if (time < v.flashUntil) v.img.setTintFill(0xffffff);
      else v.img.clearTint();
      v.shadow.setPosition(x, y).setAlpha(b.hidden ? 0.9 : 1);
      if (v.part) {
        if (b.def.id === 'queen')
          v.part
            .setPosition(v.img.x + (right ? -1 : 1) * v.img.displayWidth * 0.2, y - v.img.displayHeight * 0.4)
            .setScale(v.part.scale)
            .setAlpha(b.hidden ? 0 : 0.8 + 0.2 * Math.sin(time / 300))
            .setDepth(y + 0.1);
        else
          v.part
            .setPosition(v.img.x, y - v.img.displayHeight * 0.75)
            .setRotation(time / 200)
            .setAlpha(b.hidden ? 0 : 1)
            .setDepth(y + 0.1);
      }
      // Пожиратель под землёй — бугор из камней ползёт к герою, за ним пыль.
      if (b.def.id === 'devourer') {
        if (b.hidden && !v.mound && getAssetInfo('world.common.devourer_mound'))
          v.mound = spawnSprite(s, x, y, 'world.common.devourer_mound');
        if (v.mound) {
          v.mound
            .setVisible(b.hidden)
            .setPosition(x, y + 6)
            .setDepth(y);
          if (b.hidden && b.moving && Math.random() < 0.3) this.dust.explode(2, x, y + 4);
        }
      }
      const shieldOff = v.shieldOffAt !== undefined && s.time.now - v.shieldOffAt < 5000;
      v.shield
        ?.setPosition(x, y - v.img.displayHeight * 0.5)
        .setVisible(b.shield && b.phase < 2 && !shieldOff)
        .setDepth(y + 0.2)
        .setAlpha(0.6 + 0.3 * Math.sin(time / 150));
    }
  }

  /** Атака частями: крюк на цепи, язык, хвост, осколки, щупальце — по зоне атаки. */
  private attackFx(b: Boss, tel: Telegraph): void {
    const s = this.scene;
    const v = this.views.get(b.id);
    const sh: ZoneShape = tel.shape;
    const x0 = b.x * TILE;
    const y0 = b.y * TILE - (v ? v.img.displayHeight * 0.5 : 60);
    if (sh.kind === 'line' && b.def.id === 'devourer') return; // плевок — снарядом (shotFx)
    if (sh.kind === 'line' && b.def.id === 'zero') {
      // Щупальце — из своей трубы (начало линии), не обязательно от босса.
      this.chainFx(PARTS['zero']!, sh.x0 * TILE, sh.y0 * TILE - 20, sh.x1 * TILE, sh.y1 * TILE - 20);
      return;
    }
    if (sh.kind === 'line') {
      const id = b.def.id === 'queen' ? 'characters.animals.toad_tongue_and_sac' : PARTS[b.def.id];
      if (!id || !getAssetInfo(id)) return;
      // Цепь = повтор сегмента; язык/щупальце — растяжение.
      const x1 = sh.x1 * TILE;
      const y1 = sh.y1 * TILE - 30;
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const len = Math.hypot(x1 - x0, y1 - y0);
      const parts: Phaser.GameObjects.Image[] = [];
      if (b.def.id === 'butcher' || b.def.id === 'zero') {
        const seg = spawnSprite(s, 0, 0, id, { depth: false });
        const sl = Math.max(16, seg.displayWidth * 0.5);
        seg.destroy();
        const n = Math.ceil(len / sl);
        for (let i = 0; i < n; i++) {
          const p = spawnSprite(s, x0, y0, id, { depth: DEPTH.glow - 2 })
            .setOrigin(0.5)
            .setRotation(ang)
            .setScale(0.6);
          parts.push(p);
          s.tweens.add({
            targets: p,
            x: x0 + Math.cos(ang) * sl * i,
            y: y0 + Math.sin(ang) * sl * i,
            duration: 200,
            yoyo: true,
            hold: 120,
          });
        }
      } else if (b.def.id === 'frost') {
        const p = spawnSprite(s, x0, y0, id, { depth: DEPTH.glow - 2 })
          .setOrigin(0.5)
          .setRotation(ang + Math.PI / 2)
          .setScale(0.6);
        parts.push(p);
        s.tweens.add({ targets: p, x: x1, y: y1, duration: 300 });
      } else {
        const p = spawnSprite(s, x0, y0, id, { depth: DEPTH.glow - 2 })
          .setOrigin(0, 0.5)
          .setRotation(ang);
        p.setScale(0.01, 0.6);
        parts.push(p);
        s.tweens.add({ targets: p, scaleX: len / p.frame.width, duration: 180, yoyo: true, hold: 80 });
      }
      s.time.delayedCall(700, () => parts.forEach((p) => p.destroy()));
    } else if (b.def.id === 'tyrant' && tel.attack === 'tail' && getAssetInfo(PARTS['tyrant']!)) {
      const tail = spawnSprite(s, x0, y0 + 30, PARTS['tyrant']!, { depth: DEPTH.glow - 2 })
        .setOrigin(0, 0.5)
        .setScale(1.6);
      tail.setRotation(((sh.kind === 'cone' ? sh.dir : 0) * Math.PI) / 180 - 1);
      s.tweens.add({
        targets: tail,
        rotation: tail.rotation + 2,
        duration: 300,
        onComplete: () => tail.destroy(),
      });
    } else if (sh.kind === 'circle') {
      const cx = sh.x * TILE;
      const cy = sh.y * TILE;
      this.dust.explode(16, cx, cy);
      if (sh.r >= 2) Fx.cameraShake(s, 180, 0.008);
      // Ударная волна по земле (s32) и особые следы атак (s31).
      Fx.burst(s, 'effects.shockwave', cx, cy, {
        from: sh.r * TILE,
        to: sh.r * TILE * 2.4,
        ms: 450,
        depth: DEPTH.shadow + 3,
        add: true,
      });
      if (b.def.id === 'frost') {
        Fx.burst(s, 'effects.ice_burst', cx, cy - 20, {
          from: 50,
          to: 110,
          ms: 500,
          depth: cy + 1,
          add: true,
        });
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const r = sh.r * TILE * 0.6;
          this.rise('world.common.frost_spikes', cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0.55, 700);
        }
      }
      if (b.def.id === 'devourer') this.rise('world.common.devourer_hole', cx, cy + 10, 1, 1400, true);
    } else if (sh.kind === 'cone' && b.def.id === 'frost') {
      // Ледяное дыхание — холодный конус от пасти.
      Fx.burst(s, 'effects.cold_breath', x0, y0, {
        from: sh.r * TILE * 0.5,
        to: sh.r * TILE * 1.1,
        ms: 600,
        depth: DEPTH.glow - 2,
        add: true,
        rotation: (sh.dir * Math.PI) / 180,
        origin: [0, 0.5],
      });
    }
    if (sh.kind === 'line' && b.def.id === 'zero')
      this.rise('world.common.zero_tentacle_rubble', sh.x1 * TILE, sh.y1 * TILE, 0.8, 900);
  }

  /** Цепь сегментов (щупальце) от точки к точке: вылетает и возвращается. */
  private chainFx(id: string, x0: number, y0: number, x1: number, y1: number): void {
    if (!getAssetInfo(id)) return;
    const s = this.scene;
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const len = Math.hypot(x1 - x0, y1 - y0);
    const seg = spawnSprite(s, 0, 0, id, { depth: false });
    const sl = Math.max(16, seg.displayWidth * 0.5);
    seg.destroy();
    const parts: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < Math.ceil(len / sl); i++) {
      const p = spawnSprite(s, x0, y0, id, { depth: DEPTH.glow - 2 })
        .setOrigin(0.5)
        .setRotation(ang)
        .setScale(0.6);
      parts.push(p);
      s.tweens.add({
        targets: p,
        x: x0 + Math.cos(ang) * sl * i,
        y: y0 + Math.sin(ang) * sl * i,
        duration: 200,
        yoyo: true,
        hold: 140,
      });
    }
    s.time.delayedCall(700, () => parts.forEach((p) => p.destroy()));
    this.rise('world.common.zero_tentacle_rubble', x0, y0 + 20, 0.7, 500);
  }

  /** Снаряд босса: камень Пожирателя или сфера радиации Пациента Ноль. */
  private shotFx(ev: Extract<BossEvent, { type: 'shot' }>): void {
    const s = this.scene;
    const orb = ev.attack === 'orb';
    const info = getAssetInfo(orb ? 'effects.rad_aura' : 'world.biome1_suburb.boulder');
    if (!info) return;
    const img = s.add.image(ev.x0 * TILE, ev.y0 * TILE - 40, info.group, info.frame).setDepth(DEPTH.glow - 1);
    img.setScale((orb ? 44 : 28) / Math.max(img.frame.width, img.frame.height));
    if (orb) img.setBlendMode(Phaser.BlendModes.ADD);
    s.tweens.add({
      targets: img,
      x: ev.x1 * TILE,
      y: ev.y1 * TILE - (orb ? 30 : 10),
      angle: orb ? 0 : 540,
      duration: ev.sec * 1000,
      onComplete: () => {
        img.destroy();
        if (orb)
          Fx.burst(s, 'effects.toxic_haze', ev.x1 * TILE, ev.y1 * TILE, {
            from: 40,
            to: 110,
            ms: 700,
            depth: DEPTH.glow - 1,
            add: true,
          });
        else this.dust.explode(10, ev.x1 * TILE, ev.y1 * TILE);
      },
    });
  }

  /** Пожиратель, 2-я фаза: пластины брони отлетают и падают. */
  private platesFx(b: Boss): void {
    const s = this.scene;
    if (!getAssetInfo('characters.bosses.devourer_armor_plate')) return;
    for (let i = 0; i < 4; i++) {
      const p = spawnSprite(s, b.x * TILE, b.y * TILE - 50, 'characters.bosses.devourer_armor_plate');
      p.setScale(p.scaleX * 0.5).setDepth(b.y * TILE + 1);
      const a = (i / 4) * Math.PI * 2 + 0.4;
      s.tweens.add({
        targets: p,
        x: p.x + Math.cos(a) * 70,
        y: p.y + 40 + Math.sin(a) * 20,
        angle: 360 * (i % 2 ? 1 : -1),
        duration: 600,
        ease: 'Quad.Out',
      });
      s.tweens.add({ targets: p, alpha: 0, delay: 2500, duration: 800, onComplete: () => p.destroy() });
    }
    Fx.cameraShake(s, 250, 0.01);
  }

  /** Объект из земли (шипы, яма, щупальце): вырастает и уходит обратно. */
  private rise(id: string, x: number, y: number, scale: number, holdMs: number, flat = false): void {
    if (!getAssetInfo(id)) return;
    const s = this.scene;
    const img = spawnSprite(s, x, y, id);
    const k = img.scaleX * scale;
    img.setScale(k, flat ? k : 0.01);
    s.tweens.add({
      targets: img,
      scaleY: k,
      duration: 160,
      ease: 'Back.Out',
      onComplete: () =>
        s.tweens.add({
          targets: img,
          alpha: 0,
          delay: holdMs,
          duration: 300,
          onComplete: () => img.destroy(),
        }),
    });
  }

  /** Фаза: вспышка, рёв (тряска), круговая волна пыли. */
  private phaseFx(b: Boss): void {
    const s = this.scene;
    s.cameras.main.flash(this.reg.prog.bosses['phase2FlashMs'] as number, 255, 255, 255);
    Fx.cameraShake(s, 500, 0.014);
    const x = b.x * TILE;
    const y = b.y * TILE;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.dust.explode(2, x + Math.cos(a) * 30, y + Math.sin(a) * 15);
    }
    s.game.events.emit(TOAST, t('boss.phase', { name: b.def.name_ru, n: b.phase }));
  }

  /** Ныряние/закапывание: спрайт уходит вниз, круги на воде / пыль. */
  private diveFx(b: Boss, on: boolean): void {
    const s = this.scene;
    const x = b.x * TILE;
    const y = b.y * TILE;
    if (b.def.id === 'queen')
      for (let i = 0; i < 3; i++)
        s.time.delayedCall(i * 150, () => Fx.ripple(s, x + (Math.random() - 0.5) * 40, y, DEPTH.shadow + 1));
    else this.dust.explode(on ? 12 : 24, x, y);
    if (!on) Fx.cameraShake(s, 200, 0.008);
    // Пожиратель под землёй — бугор из камней; выход — яма.
    if (b.def.id === 'devourer')
      this.rise(
        on ? 'world.common.devourer_mound' : 'world.common.devourer_hole',
        x,
        y + 6,
        1,
        on ? 2000 : 1200,
        true,
      );
  }

  private dropView(id: string): void {
    const v = this.views.get(id);
    if (!v) return;
    v.img.destroy();
    v.shadow.destroy();
    v.part?.destroy();
    v.shield?.destroy();
    v.mound?.destroy();
    this.views.delete(id);
  }

  /** Смерть: падение (поворот), затемнение, дым — растворение. */
  deathFx(b: Boss): void {
    const v = this.views.get(b.id);
    if (!v) return;
    const s = this.scene;
    s.tweens.add({ targets: v.img, angle: v.img.flipX ? -90 : 90, duration: 600, ease: 'Quad.In' });
    v.img.setTint(0x666666);
    s.tweens.add({
      targets: [v.img, v.shadow, v.part].filter(Boolean),
      alpha: 0,
      delay: 1500,
      duration: 1500,
    });
  }

  destroy(): void {
    for (const id of [...this.views.keys()]) this.dropView(id);
    for (const z of this.zones) z.g.destroy();
    this.barrier.destroy();
    for (const img of this.fence) img.destroy();
    this.fence = [];
    this.dust.destroy();
    this.gold.destroy();
  }
}
