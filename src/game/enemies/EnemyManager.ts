import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import type { Registry } from '../../core/data/Registry';
import { Enemy, type EnemyCtx, type EnemyEvent } from '../../core/entities/Enemy';
import {
  angleOf,
  armorReduce,
  autoAim,
  inSector,
  isMelee,
  noiseRadius,
  rayTargets,
  type WeaponStats,
} from '../../core/systems/Combat';
import { BloodNight, SpawnSystem } from '../../core/systems/Spawn';
import { Rng } from '../../core/util/rng';
import {
  edgeSolid,
  LAYER_WATER,
  moveCircle,
  segmentHitsEdge,
  WALL_DOOR,
  WALL_NONE,
  type EdgeRef,
  type WorldObject,
} from '../../core/world';
import { getAssetInfo } from '../assets/AssetIndex';
import { spawnSprite } from '../assets/spawnSprite';
import { DEPTH } from '../render/ChunkView';
import * as Fx from '../render/Fx';
import { TILE } from '../render/GroundTiles';
import { TEX } from '../render/textures';
import { UI_FONT } from '../ui/BitmapFont';
import { EnemyViews } from './EnemyViews';
import type { Boss } from '../../core/entities/Boss';
import { TOAST, type WorldScene } from '../scenes/WorldScene';

/** События HUD: волна кровавой ночи (номер, всего; 0 — закончилась). */
export const BLOOD_WAVE = 'blood-wave';

interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Высота над землёй (дуга) и вертикальная скорость. */
  z: number;
  vz: number;
  ttl: number;
  owner: 'hero' | 'enemy';
  kind: 'arrow' | 'stone' | 'slime' | 'grenade' | 'molotov' | 'egrenade';
  damage: number;
  specials: readonly string[];
  bounced?: boolean;
  img: Phaser.GameObjects.Image;
}

interface Area {
  x: number;
  y: number;
  r: number;
  until: number;
  dps: number;
  kind: 'fire' | 'poison' | 'acid' | 'rad' | 'ice';
  hitsEnemies: boolean;
  imgs: Phaser.GameObjects.GameObject[];
}

const GRAVITY = 18;

/**
 * Враги в мире (шаг 8): спавн по биомам и времени суток, ИИ, атаки по герою и стенам, снаряды
 * (стрелы, камни, плевки, гранаты, молотовы), площади огня/яда/кислоты, кровавая ночь, удары героя,
 * цифры урона, хит-стоп. Логика — в тиках GameClock (tick), отрисовка — в render.
 */
export class EnemyManager {
  enemies: Enemy[] = [];
  private views: EnemyViews;
  private spawn: SpawnSystem;
  readonly blood: BloodNight;
  private rng = new Rng((Math.random() * 2 ** 32) >>> 0);
  private seq = 1;
  private noises: { x: number; y: number; r: number; until: number }[] = [];
  private projectiles: Projectile[] = [];
  private areas: Area[] = [];
  private toBase = new Set<string>();
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private blood_: Phaser.GameObjects.Particles.ParticleEmitter;
  private wasBloodNight = false;
  /** Спавн выключен (галерея, тесты). */
  spawnEnabled = true;

  constructor(
    private readonly scene: WorldScene,
    private readonly reg: Registry,
  ) {
    this.views = new EnemyViews(scene, reg);
    this.spawn = new SpawnSystem(reg);
    this.blood = new BloodNight(reg);
    this.sparks = Fx.particles(scene, ['effects.spark_1', 'effects.spark_2', 'effects.spark_3'], {
      tint: 0xffe0a0,
      lifespan: 220,
      speed: { min: 60, max: 160 },
      scale: { start: 0.16, end: 0 },
      gravityY: 0,
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(DEPTH.glow + 1);
    this.blood_ = Fx.particles(scene, ['effects.dust_1'], {
      tint: 0x8a1010,
      lifespan: 400,
      speed: { min: 30, max: 90 },
      scale: { start: 0.14, end: 0 },
      gravityY: 300,
    }).setDepth(DEPTH.glow);
  }

  private get mobile(): boolean {
    return this.scene.sys.game.device.input.touch && !this.scene.sys.game.device.os.desktop;
  }

  private get night(): boolean {
    const d = this.scene.dayState;
    return d.phase === 'NIGHT' || d.darkness > 0.5;
  }

  get alive(): Enemy[] {
    return this.enemies.filter((e) => e.alive);
  }

  // ------------------------------------------------------------------ мир для ИИ

  /** Клетка проходима для врага: суша/вода, без стен префабов (двери проходимы), без твёрдых объектов. */
  passable = (tx: number, ty: number): boolean => {
    const w = this.scene.world;
    const c = w.cell(tx, ty);
    if (c.biome === 0 || !c.passable) return false;
    if (c.wall !== WALL_NONE && c.wallKind !== WALL_DOOR) return false;
    return w.collidersAt(tx, ty).length === 0;
  };

  /** Соседей разделяет стена игрока на ребре (дверь со створкой для врага закрыта). */
  wallBetween = (ax: number, ay: number, bx: number, by: number): boolean => {
    const bits = this.scene.world.edgeBetween(ax, ay, bx, by);
    return bits !== 0 && edgeSolid(bits, true);
  };

  /** Стена игрока с наименьшей прочностью у отрезка враг → цель (её ломают, когда путь закрыт). */
  private wallToBreak(e: Enemy, gx: number, gy: number): EdgeRef | null {
    const R = this.reg.combat.enemy.wallSearchTiles;
    const w = this.scene.world;
    let best: { e: EdgeRef; score: number } | null = null;
    const steps = Math.ceil(Math.hypot(gx - e.x, gy - e.y)) + 1;
    const seen = new Set<string>();
    for (let i = 0; i <= Math.min(steps, 24); i++) {
      const px = e.x + ((gx - e.x) * i) / steps;
      const py = e.y + ((gy - e.y) * i) / steps;
      for (let ty = Math.floor(py - R); ty <= Math.floor(py + R) + 1; ty++)
        for (let tx = Math.floor(px - R); tx <= Math.floor(px + R) + 1; tx++)
          for (const side of ['n', 'w'] as const) {
            const k = `${tx},${ty},${side}`;
            if (seen.has(k)) continue;
            seen.add(k);
            const wall = w.edgeAt({ tx, ty, side });
            if (!wall || (wall.kind === WALL_DOOR && !wall.leaf)) continue;
            const mx = side === 'n' ? tx + 0.5 : tx;
            const my = side === 'n' ? ty : ty + 0.5;
            const score = wall.hp + Math.hypot(mx - e.x, my - e.y) * 5;
            if (!best || score < best.score) best = { e: { tx, ty, side }, score };
          }
    }
    return best?.e ?? null;
  }

  private lit(x: number, y: number): boolean {
    const h = this.scene.hero.pos;
    const L = this.reg.worldgen.lights;
    if (Math.hypot(h.x - x, h.y - y) <= L.heroRadiusTiles) return true;
    return this.scene.objectsNear(x, y, 6).some((o) => o.light && Math.hypot(o.x - x, o.y - y) <= o.light);
  }

  /** Шум: выстрел, тревога — враги в радиусе идут на звук. */
  noise(x: number, y: number, r: number): void {
    if (r > 0) this.noises.push({ x, y, r, until: this.scene.dayNight.seconds + 0.5 });
  }

  // ------------------------------------------------------------------ спавн

  spawnEnemy(id: string, x: number, y: number, elite = false, toBase = false): Enemy | null {
    const def = this.reg.enemies.get(id);
    if (!def) return null;
    const biome = this.scene.world.layout.biomeAt(x, y);
    const e = new Enemy(this.reg, def, `en${this.seq++}`, x, y, elite, biome);
    e.packAngle = (this.rng.next() - 0.5) * 2.4;
    this.enemies.push(e);
    if (toBase) this.toBase.add(e.id);
    return e;
  }

  private free = (x: number, y: number): boolean => {
    const c = this.scene.world.cell(Math.floor(x), Math.floor(y));
    return c.biome > 0 && c.layer !== LAYER_WATER && this.passable(Math.floor(x), Math.floor(y));
  };

  // ------------------------------------------------------------------ тик

  tick(dt: number): void {
    const s = this.scene;
    const now = s.dayNight.seconds;
    const h = s.hero;
    this.noises = this.noises.filter((n) => n.until > now);
    const base = s.baseCore();
    const R = s.baseRadius();
    // Спавн
    // Обучение: первая ночь облегчённая — спавн вполовину (progression.json → tutorial.firstNightSpawnMul).
    if (this.spawnEnabled && !h.dead && this.rng.next() < s.progress.spawnMul) {
      for (const r of this.spawn.tick({
        now,
        dt,
        night: this.night,
        days: s.dayNight.seconds / this.reg.balance.dayNight.fullDaySec,
        hero: h.pos,
        alive: this.alive.length,
        mobile: this.mobile,
        biomeAt: (x, y) => s.world.layout.biomeAt(x, y),
        free: this.free,
        inBase: (x, y) => !!base && !this.night && Math.hypot(x - base.x, y - base.y) <= R,
        base: base ? { x: base.x, y: base.y, r: R } : null,
        rng: () => this.rng.next(),
      }))
        this.spawnEnemy(r.def.id, r.x, r.y, r.elite);
    }
    this.tickBloodNight();
    // ИИ
    const ctxBase: Omit<EnemyCtx, 'goal'> = {
      now,
      dt,
      night: this.night,
      nightSpeedMul: this.reg.balance.dayNight.nightEnemySpeedMul as number,
      senseMul: this.scene.hero.weather.senseMul ?? 1,
      hero: { x: h.pos.x, y: h.pos.y, r: 0.22, alive: !h.dead },
      noises: this.noises,
      rng: () => this.rng.next(),
      inGrass: () => true,
      passable: this.passable,
      wallBetween: this.wallBetween,
      wallStands: (e) => !!s.world.edgeAt(e),
      move: (e, dx, dy) => moveCircle(s.world, e.x, e.y, e.r, dx, dy, 0.75, true),
      wallToBreak: (e, x, y) => this.wallToBreak(e, x, y),
      pack: () => [],
      emit: (ev) => this.onEvent(ev),
    };
    for (const e of this.enemies) {
      const goal = this.toBase.has(e.id) && base ? { x: base.x, y: base.y } : null;
      e.tick({ ...ctxBase, goal });
      // Рык заражённых и мутантов рядом с героем — изредка.
      if (
        e.alive &&
        e.state === 'chase' &&
        e.def.family !== 'animal' &&
        this.rng.next() < dt * 0.08 &&
        Math.hypot(e.x - h.pos.x, e.y - h.pos.y) < 9
      )
        s.audio.play('growl', 'sfx', 0.5);
    }
    this.separate();
    // Мёртвые убираются через deathSec; дальние — деспавн.
    const D = this.reg.combat.enemy.deathSec;
    this.enemies = this.enemies.filter((e) => {
      if (!e.alive) return now - e.deadAt < D;
      if (
        this.spawn.shouldDespawn(
          e.x,
          e.y,
          h.pos,
          e.state === 'chase' || e.state === 'attack' || this.toBase.has(e.id),
        )
      )
        return false;
      return true;
    });
    this.tickProjectiles(dt, now);
    this.tickAreas(dt, now);
  }

  /** Враги не стоят друг в друге: попарное расталкивание (до 40 живых — дёшево). */
  private separate(): void {
    const list = this.enemies.filter((e) => e.alive && !e.hidden);
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = (a.r + b.r) * 0.9;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) / 2;
        const nx = dx / d;
        const ny = dy / d;
        // Прямой сдвиг (без полной проверки коллизий — следующий шаг движения поправит), но не в стену.
        if (this.passable(Math.floor(a.x - nx * push), Math.floor(a.y - ny * push))) {
          a.x -= nx * push;
          a.y -= ny * push;
        }
        if (this.passable(Math.floor(b.x + nx * push), Math.floor(b.y + ny * push))) {
          b.x += nx * push;
          b.y += ny * push;
        }
      }
    }
  }

  // ------------------------------------------------------------------ кровавая ночь

  private tickBloodNight(): void {
    const s = this.scene;
    const d = s.dayState;
    const wave = this.blood.tick(d.day, d.bloodNight, d.nightElapsed);
    if (wave) {
      const B = this.reg.combat.bloodNight;
      const nightNo = Math.floor(d.day / this.reg.balance.dayNight.bloodNightEvery);
      const roster = this.blood.roster(wave, nightNo, s.maxBiome, () => this.rng.next());
      const base = s.baseCore();
      const cx = base?.x ?? s.hero.pos.x;
      const cy = base?.y ?? s.hero.pos.y;
      const r = (base ? s.baseRadius() : 12) + 4;
      for (const def of roster) {
        for (let k = 0; k < 6; k++) {
          const a = this.rng.next() * Math.PI * 2;
          const x = cx + Math.cos(a) * (r + this.rng.next() * 4);
          const y = cy + Math.sin(a) * (r + this.rng.next() * 4);
          if (!this.free(x, y)) continue;
          this.spawnEnemy(def.id, x, y, this.rng.next() < (def.elite?.chance ?? 0), true);
          break;
        }
      }
      s.game.events.emit(BLOOD_WAVE, wave, B.waves);
      // Красная вспышка неба в начале волны.
      s.cameras.main.flash(500, 160, 20, 20);
      this.wasBloodNight = true;
    }
    if (this.wasBloodNight && !d.bloodNight) {
      this.wasBloodNight = false;
      if (!s.hero.dead) s.progress.count('bloodNights');
      s.game.events.emit(BLOOD_WAVE, 0, 0);
      this.supplyDrop();
    }
  }

  /** Награда утром после кровавой ночи — ящик снабжения у тотема. */
  private supplyDrop(): void {
    const s = this.scene;
    const base = s.baseCore();
    if (!base) return;
    const c = this.reg.objects.containers.get(this.reg.combat.bloodNight.rewardContainer);
    if (!c) return;
    const o = s.world.placeObject({
      ref: { type: 'container', id: c.id },
      kind: 'container',
      sprite: c.sprite,
      spriteAfter: c.openedSprite ?? undefined,
      x: base.x + 1.5,
      y: base.y + 1,
      biome: s.world.layout.biomeAt(base.x, base.y),
    });
    s.onObjectPlaced(o);
    s.game.events.emit(TOAST, t('combat.supply'));
  }

  // ------------------------------------------------------------------ события врагов

  private onEvent(ev: EnemyEvent): void {
    const s = this.scene;
    const h = s.hero;
    const e = ev.e;
    switch (ev.type) {
      case 'melee': {
        if (h.dead) break;
        const dmg = armorReduce(ev.damage, h.inv.stat('armor'));
        h.damage(dmg, e.x);
        if (ev.poison) h.vitals.conditions.poison = Math.max(h.vitals.conditions.poison, ev.poison[1]);
        break;
      }
      case 'wall': {
        const r = s.world.damageEdge(ev.edge, ev.damage);
        if (r === 'destroyed') s.wallBroken(ev.edge);
        else if (r) s.onBuilt([ev.edge], 'damage');
        break;
      }
      case 'spit':
        this.launch(e.x, e.y - 0.5, ev.tx, ev.ty, 'slime', 'enemy', e.damage, []);
        break;
      case 'grenade':
        this.launch(e.x, e.y - 0.5, ev.tx, ev.ty, 'egrenade', 'enemy', this.num(e, 'grenadeDamage', 50), []);
        break;
      case 'explode':
        if (ev.kind === 'acid') {
          this.explosion(e.x, e.y, ev.radius, ev.damage, true, 0x80ff40);
          this.areaAt(e.x, e.y, ev.radius * 0.7, 3, 6, 'acid', false);
        } else {
          // Радиационная вспышка светящегося.
          const d = Math.hypot(h.pos.x - e.x, h.pos.y - e.y);
          if (d <= ev.radius) h.vitals.radiation += ev.damage * (1 - h.inv.stat('radRes') / 100);
          s.cameras.main.flash(250, 120, 255, 120);
        }
        break;
      case 'tongue': {
        if (h.dead) break;
        const a = Math.atan2(e.y - h.pos.y, e.x - h.pos.x);
        h.pos = moveCircle(
          s.world,
          h.pos.x,
          h.pos.y,
          0.22,
          Math.cos(a) * ev.pull,
          Math.sin(a) * ev.pull,
          0.75,
        );
        h.damage(armorReduce(e.damage * 0.5, h.inv.stat('armor')), e.x);
        break;
      }
      case 'grab':
        h.rootedUntil = s.dayNight.seconds + ev.sec;
        s.game.events.emit(TOAST, t('combat.grabbed'));
        break;
      case 'aura':
        h.vitals.radiation += ev.rad * (1 - h.inv.stat('radRes') / 100);
        break;
      case 'helmet':
        this.views.helmet(e);
        break;
      case 'died':
        this.onDeath(e);
        break;
      default:
        break;
    }
  }

  private num(e: Enemy, k: string, d: number): number {
    const v = e.beh[k];
    return typeof v === 'number' ? v : d;
  }

  /** Смерть: дроп предметами (элита ×dropMul), опыт. */
  private onDeath(e: Enemy): void {
    const s = this.scene;
    s.onKill(e.def.id, e.elite);
    const mul = e.elite ? ((e.def.elite?.['dropMul'] as number | undefined) ?? 2) : 1;
    const drops: WorldObject[] = [];
    for (const [id, [lo, hi]] of Object.entries(e.def.drops)) {
      // «Свежевание»: со зверя больше шкур и меха.
      const extra = id === 'hide' || id === 'fur' ? Math.round(s.progress.effect('extraHide')) : 0;
      const n = Math.round((lo + Math.floor(this.rng.next() * (hi - lo + 1))) * mul) + extra;
      if (n <= 0 || !this.reg.items.has(id)) continue;
      drops.push(
        s.world.dropItem(
          { id, count: n },
          e.x + (this.rng.next() - 0.5) * 0.6,
          e.y + (this.rng.next() - 0.5) * 0.4,
          s.dayNight.seconds,
        ),
      );
    }
    s.onDropsAppeared(drops);
    s.addXp(e.def.xp * (e.elite ? 2 : 1));
    this.toBase.delete(e.id);
  }

  // ------------------------------------------------------------------ удары героя

  /** Цель для автонаведения в секторе перед героем. */
  aim(faceDeg: number, range: number): { x: number; y: number } | null {
    const h = this.scene.hero.pos;
    const e = autoAim(h.x, h.y, faceDeg, range, this.reg.combat.hero.autoAimSectorDeg, this.visible());
    return e ? { x: e.x, y: e.y } : null;
  }

  /** Цели ударов героя: видимые враги и босс в бою. */
  private visible(): (Enemy | Boss)[] {
    return [...this.enemies.filter((e) => e.alive && !e.hidden), ...(this.bossTargets?.() ?? [])];
  }

  /** Боссы в бою (BossManager). */
  bossTargets: (() => Boss[]) | null = null;

  /** Экранная позиция цели (враг — по виду, босс — по клетке). */
  private posOf(e: Enemy | Boss): { x: number; y: number; h: number } {
    return e instanceof Enemy
      ? this.views.pos(e)
      : { x: e.x * TILE, y: e.y * TILE, h: e.def.targetHeightPx * 0.8 };
  }

  /** Урон врагу от героя: крит, удар в спину, особые эффекты; цифры, искры, хит-стоп. */
  private hitEnemy(
    e: Enemy | Boss,
    w: WeaponStats,
    dmg: number,
    fromX: number,
    fromY: number,
    melee: boolean,
  ): void {
    const H = this.reg.combat.hero;
    const S = this.reg.combat.specials;
    const crit = this.rng.next() < H.critChance;
    const knock = w.specials.includes('knockback') ? S.knockbackTiles : melee ? 0.15 : 0.05;
    const r = e.hurt(dmg * (crit ? H.critMul : 1), fromX, fromY, {
      melee,
      specials: w.specials,
      now: this.scene.dayNight.seconds,
      knock,
      backstabMul: H.backstabMul * (1 + 0.25 * (this.scene.skills['fighter_4'] ?? 0)),
      ignoreArmor: w.specials.includes('ignore_armor'),
      stunnedMul: 1 + this.scene.progress.effect('stunnedDamage'),
    });
    this.scene.progress.count('damageDealt', r.dmg);
    const p = this.posOf(e);
    this.sparks.explode(r.blocked ? 3 : 6, p.x, p.y - p.h * 0.55);
    if (e instanceof Enemy && e.def.family !== 'reptile') this.blood_.explode(4, p.x, p.y - p.h * 0.5);
    this.scene.audio.play(r.blocked ? 'hit_metal' : 'hit_flesh', 'sfx', 0.8);
    this.number(p.x, p.y - p.h, r.dmg, crit || r.back ? 'crit' : 'normal');
    if (melee) Fx.hitStop(this.scene, H.hitStopMs);
    if (w.specials.includes('knockback')) Fx.cameraShake(this.scene, 120, 0.006);
  }

  /** Ближний бой на хит-кадре: все цели в секторе 90° и радиусе. Возвращает число попаданий. */
  melee(w: WeaponStats, faceDeg: number): number {
    const h = this.scene.hero.pos;
    this.scene.audio.play('swing', 'sfx', 0.7);
    const hits = inSector(h.x, h.y, faceDeg, w.range, this.reg.combat.hero.meleeSectorDeg, this.visible());
    for (const e of hits) this.hitEnemy(e, w, w.damage, h.x, h.y, true);
    // Манекены тоже получают удары.
    for (const d of this.scene.dummies)
      if (inSector(h.x, h.y, faceDeg, w.range, 90, [d]).length) d.hp -= w.damage;
    return hits.length;
  }

  /** Выстрел: огнестрел/энергия — лучи (дробь веером), лук/праща — снаряд; шум. */
  shoot(w: WeaponStats, faceDeg: number, muzzle: { x: number; y: number }): void {
    const s = this.scene;
    const h = s.hero.pos;
    if (w.kind === 'ranged') {
      const a = ((faceDeg + (this.rng.next() - 0.5) * w.spreadDeg) * Math.PI) / 180;
      const kind = w.ammo === 'stone' ? 'stone' : 'arrow';
      const sp =
        this.reg.combat.hero.projectileSpeed[w.ammo ?? 'default'] ??
        this.reg.combat.hero.projectileSpeed['default']!;
      this.projectile(
        h.x,
        h.y - 0.5,
        Math.cos(a) * sp,
        Math.sin(a) * sp,
        w.range / sp,
        kind,
        'hero',
        w.damage,
        w.specials,
      );
      return;
    }
    // Луч идёт на высоте груди (y − 0.3); стены на рёбрах проверяются у земли.
    const blocked = (x: number, y: number, px: number, py: number) => {
      const c = s.world.cell(Math.floor(x), Math.floor(y));
      if (c.wall !== WALL_NONE && c.wallKind !== WALL_DOOR) return true;
      return segmentHitsEdge(s.world, px, py + 0.3, x, y + 0.3);
    };
    for (let i = 0; i < w.pellets; i++) {
      const ang = faceDeg + (this.rng.next() - 0.5) * w.spreadDeg;
      const r = rayTargets(h.x, h.y - 0.3, ang, w.range, this.visible(), blocked);
      const hits = w.specials.includes('pierce_all') ? r.hits : r.hits.slice(0, 1);
      for (const e of hits) this.hitEnemy(e, w, w.damage, h.x, h.y, false);
      const end =
        hits[0] && !w.specials.includes('pierce_all')
          ? { x: hits[0].x, y: hits[0].y - 0.5 }
          : { x: r.endX, y: r.endY - 0.3 };
      this.tracer(muzzle.x, muzzle.y, end.x * TILE, end.y * TILE, w.kind === 'energy');
    }
    this.noise(h.x, h.y, noiseRadius(this.reg, w));
    this.scene.audio.play('shot', 'sfx', w.noiseMul < 0.5 ? 0.35 : 1);
  }

  /** Бросок: молотов — огонь на площади, граната — отскок и взрыв. Урон всем, включая героя. */
  throwAt(w: WeaponStats, tx: number, ty: number): void {
    const h = this.scene.hero.pos;
    const kind = w.specials.includes('fire_area') ? 'molotov' : 'grenade';
    this.launch(h.x, h.y - 0.6, tx, ty, kind, 'hero', w.damage, w.specials);
  }

  /** Огнемёт: конус перед героем, частицы пламени. */
  private jetAt = 0;
  private jetN = 0;

  flame(w: WeaponStats, faceDeg: number, dt: number): void {
    const h = this.scene.hero.pos;
    const S = this.reg.combat.specials;
    for (const e of inSector(h.x, h.y, faceDeg, w.range, S.flameConeDeg, this.visible())) {
      const r = e.hurt(w.damage * w.rate * dt, h.x, h.y, { melee: false, now: this.scene.dayNight.seconds });
      if (this.rng.next() < 0.2) {
        const p = this.posOf(e);
        this.number(p.x, p.y - p.h, r.dmg * 5, 'normal');
      }
    }
    // Струя огня (s32): два кадра поочерёдно от ствола по направлению взгляда.
    const now = this.scene.time.now;
    if (now >= this.jetAt) {
      this.jetAt = now + 90;
      Fx.burst(
        this.scene,
        `effects.flame_jet_${(this.jetN = (this.jetN % 2) + 1)}`,
        h.x * TILE,
        h.y * TILE - 34,
        {
          from: w.range * TILE * 0.7,
          to: w.range * TILE,
          ms: 160,
          depth: DEPTH.glow,
          add: true,
          rotation: (faceDeg * Math.PI) / 180,
          origin: [0, 0.5],
        },
      );
    }
    if (this.rng.next() < 0.6 && this.scene.anims.exists('fx-flame')) {
      const a = (faceDeg * Math.PI) / 180 + (this.rng.next() - 0.5) * 0.5;
      const f = this.scene.add
        .sprite(h.x * TILE + Math.cos(a) * 20, h.y * TILE - 30 + Math.sin(a) * 20, 'effects')
        .play('fx-flame')
        .setScale(0.35)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(DEPTH.glow);
      this.scene.tweens.add({
        targets: f,
        x: f.x + Math.cos(a) * w.range * TILE,
        y: f.y + Math.sin(a) * w.range * TILE,
        scale: 0.7,
        alpha: 0,
        duration: 450,
        onComplete: () => f.destroy(),
      });
    }
  }

  // ------------------------------------------------------------------ снаряды и площади

  private iconOf(kind: Projectile['kind']): string {
    const m: Record<string, string> = {
      arrow: this.reg.items.get('sticks')?.icon ?? '',
      stone: this.reg.items.get('stone')?.icon ?? '',
      molotov: this.reg.items.get('molotov')?.icon ?? '',
      grenade: this.reg.items.get('grenade')?.icon ?? '',
      egrenade: this.reg.items.get('grenade')?.icon ?? '',
      slime: 'effects.slime_1',
    };
    return m[kind]!;
  }

  private projectile(
    x: number,
    y: number,
    vx: number,
    vy: number,
    ttl: number,
    kind: Projectile['kind'],
    owner: Projectile['owner'],
    damage: number,
    specials: readonly string[],
    vz = 0,
  ): void {
    const icon = this.iconOf(kind);
    const img = getAssetInfo(icon)
      ? spawnSprite(this.scene, x * TILE, y * TILE, icon, { depth: DEPTH.glow - 3 })
      : this.scene.add.image(x * TILE, y * TILE, TEX.dot).setDepth(DEPTH.glow - 3);
    img.setOrigin(0.5).setScale(kind === 'slime' ? 0.3 : 0.28);
    if (kind === 'slime') img.setTint(0x80ff40);
    this.projectiles.push({ x, y, vx, vy, z: 0.5, vz, ttl, owner, kind, damage, specials, img });
  }

  /** Бросок по дуге к точке (граната, молотов, плевок). */
  private launch(
    x: number,
    y: number,
    tx: number,
    ty: number,
    kind: Projectile['kind'],
    owner: Projectile['owner'],
    damage: number,
    specials: readonly string[],
  ): void {
    const d = Math.min(Math.hypot(tx - x, ty - y), kind === 'slime' ? 7 : 6);
    const a = Math.atan2(ty - y, tx - x);
    const T = Math.max(0.35, d / (kind === 'slime' ? 7 : 8));
    this.projectile(
      x,
      y,
      (Math.cos(a) * d) / T,
      (Math.sin(a) * d) / T,
      kind === 'grenade' || kind === 'egrenade' ? T + this.reg.combat.hero.throwFuseSec : T + 0.05,
      kind,
      owner,
      damage,
      specials,
      (GRAVITY * T) / 2,
    );
  }

  private tickProjectiles(dt: number, now: number): void {
    const s = this.scene;
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      p.ttl -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const arc = p.kind !== 'arrow' && p.kind !== 'stone';
      if (arc) {
        p.vz -= GRAVITY * dt;
        p.z += p.vz * dt;
        if (p.z <= 0) {
          p.z = 0;
          // Граната отскакивает один раз и катится до взрыва.
          if ((p.kind === 'grenade' || p.kind === 'egrenade') && !p.bounced) {
            p.bounced = true;
            p.vz = 3;
            p.vx *= 0.35;
            p.vy *= 0.35;
          } else if (p.kind === 'grenade' || p.kind === 'egrenade') {
            p.vx *= 0.8;
            p.vy *= 0.8;
          } else {
            this.land(p, now);
            p.img.destroy();
            continue;
          }
        }
      }
      // Попадание прямых снарядов.
      let hit = false;
      if (!arc) {
        const c = s.world.cell(Math.floor(p.x), Math.floor(p.y));
        if (c.wall !== WALL_NONE && c.wallKind !== WALL_DOOR) hit = true;
        // Снаряд летит на высоте ~0.3 клетки над землёй; стены на рёбрах — у земли.
        else if (segmentHitsEdge(s.world, p.x - p.vx * dt, p.y - p.vy * dt + 0.3, p.x, p.y + 0.3)) hit = true;
        if (p.owner === 'hero')
          for (const e of this.visible())
            if (Math.hypot(e.x - p.x, e.y - 0.4 - p.y) <= e.r + 0.15) {
              this.hitEnemy(
                e,
                { specials: p.specials } as WeaponStats,
                p.damage,
                p.x - p.vx,
                p.y - p.vy,
                false,
              );
              hit = true;
              break;
            }
      }
      if (hit || p.ttl <= 0) {
        if (p.kind === 'grenade' || p.kind === 'egrenade') this.land(p, now);
        p.img.destroy();
        continue;
      }
      // Вращение по направлению, мигание гранаты.
      p.img.setPosition(p.x * TILE, (p.y - p.z) * TILE);
      if (arc) p.img.rotation += dt * 12;
      else p.img.setRotation(Math.atan2(p.vy, p.vx));
      if (p.kind === 'grenade' || p.kind === 'egrenade')
        p.img.setTint(Math.floor(now * 8) % 2 ? 0xff4040 : 0xffffff);
      keep.push(p);
    }
    this.projectiles = keep;
  }

  /** Приземление: молотов — огонь, плевок — лужа яда и урон, граната — взрыв. */
  private land(p: Projectile, now: number): void {
    const s = this.scene;
    const S = this.reg.combat.specials;
    if (p.kind === 'molotov')
      this.areaAt(p.x, p.y, S.fireArea.radiusTiles, S.fireArea.sec, S.fireArea.dps, 'fire', true);
    else if (p.kind === 'slime') {
      const B = this.reg.combat.behaviors['spitter'] ?? {};
      const h = s.hero;
      if (Math.hypot(h.pos.x - p.x, h.pos.y - p.y) < 0.7) {
        h.damage(armorReduce(p.damage, h.inv.stat('armor')), p.x);
        h.vitals.conditions.poison = Math.max(h.vitals.conditions.poison, (B['poisonSec'] as number) ?? 5);
      }
      this.areaAt(
        p.x,
        p.y,
        0.7,
        (B['puddleSec'] as number) ?? 3,
        (B['poisonDps'] as number) ?? 4,
        'poison',
        false,
      );
    } else if (p.kind === 'grenade' || p.kind === 'egrenade') {
      const r =
        p.kind === 'grenade'
          ? S.explosionArea.radiusTiles
          : ((this.reg.combat.behaviors['soldier']?.['grenadeRadius'] as number) ?? 2);
      this.explosion(p.x, p.y, r, p.damage, true, 0xffffff);
    }
    void now;
  }

  /** Взрыв: урон всем (и герою) с затуханием, стены игрока рядом, кадры, тряска, пятно. */
  explosion(x: number, y: number, radius: number, damage: number, hitsHero: boolean, tint: number): void {
    const s = this.scene;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d > radius + e.r) continue;
      const dmg = damage * Math.max(0.25, 1 - d / radius);
      e.hurt(dmg, x, y, { melee: false, now: s.dayNight.seconds });
      const pp = this.views.pos(e);
      this.number(pp.x, pp.y - pp.h, dmg, 'normal');
    }
    const h = s.hero;
    const dh = Math.hypot(h.pos.x - x, h.pos.y - y);
    if (hitsHero && dh <= radius)
      h.damage(armorReduce(damage * Math.max(0.25, 1 - dh / radius), h.inv.stat('armor')), x);
    s.explosionFx(x, y, radius, tint);
    s.audio.play('explosion', 'sfx');
    for (let ty = Math.floor(y - radius); ty <= Math.floor(y + radius) + 1; ty++)
      for (let tx = Math.floor(x - radius); tx <= Math.floor(x + radius) + 1; tx++)
        for (const side of ['n', 'w'] as const) {
          const d = side === 'n' ? Math.hypot(tx + 0.5 - x, ty - y) : Math.hypot(tx - x, ty + 0.5 - y);
          if (d > radius) continue;
          const e = { tx, ty, side };
          const r = s.world.damageEdge(e, damage * 0.5);
          if (r === 'destroyed') s.wallBroken(e);
          else if (r) s.onBuilt([e], 'damage');
        }
    this.noise(x, y, this.reg.combat.hero.noiseRadiusTiles);
  }

  /** Площадь огня/яда/кислоты на sec секунд. */
  areaAt(
    x: number,
    y: number,
    r: number,
    sec: number,
    dps: number,
    kind: Area['kind'],
    hitsEnemies: boolean,
  ): void {
    const s = this.scene;
    const imgs: Phaser.GameObjects.GameObject[] = [];
    const tint =
      kind === 'fire'
        ? 0x401000
        : kind === 'poison'
          ? 0x40a020
          : kind === 'rad'
            ? 0x9aff30
            : kind === 'ice'
              ? 0xa0e0ff
              : 0x80c020;
    imgs.push(
      s.add
        .image(x * TILE, y * TILE, TEX.shadow)
        .setDisplaySize(r * 2 * TILE, r * TILE)
        .setTint(tint)
        .setAlpha(kind === 'fire' ? 0.7 : 0.8)
        .setDepth(DEPTH.shadow + 1),
    );
    if (kind === 'fire' && s.anims.exists('fx-flame'))
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        imgs.push(
          s.add
            .sprite(
              x * TILE + Math.cos(a) * r * TILE * 0.5,
              y * TILE + Math.sin(a) * r * TILE * 0.3,
              'effects',
            )
            .play({ key: 'fx-flame', startFrame: i })
            .setOrigin(0.5, 1)
            .setScale(0.45)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setDepth(y * TILE + 1),
        );
      }
    this.areas.push({ x, y, r, until: s.dayNight.seconds + sec, dps, kind, hitsEnemies, imgs });
  }

  private tickAreas(dt: number, now: number): void {
    const s = this.scene;
    const h = s.hero;
    this.areas = this.areas.filter((a) => {
      if (now >= a.until) {
        for (const i of a.imgs)
          s.tweens.add({ targets: i, alpha: 0, duration: 400, onComplete: () => i.destroy() });
        return false;
      }
      if (Math.hypot(h.pos.x - a.x, h.pos.y - a.y) <= a.r) {
        if (a.kind === 'poison') h.vitals.conditions.poison = Math.max(h.vitals.conditions.poison, 1);
        // Радиация: dps — единиц радиации в секунду, режется защитой (противогаз, костюм).
        else if (a.kind === 'rad')
          h.vitals.radiation += a.dps * dt * Math.max(0, 1 - h.inv.stat('radRes') / 100);
        // Изморозь: урон и холод.
        else if (a.kind === 'ice') {
          h.damage(a.dps * dt);
          h.vitals.temperature -= 1.5 * dt;
        } else h.damage(a.dps * dt);
      }
      if (a.hitsEnemies)
        for (const e of this.enemies)
          if (e.alive && Math.hypot(e.x - a.x, e.y - a.y) <= a.r + e.r)
            e.hurt(a.dps * dt, a.x, a.y, { melee: false, now });
      return true;
    });
  }

  // ------------------------------------------------------------------ эффекты

  /** Цифра урона: белая, крит — жёлтая и крупнее; всплывает и гаснет за 0.8 с. */
  number(x: number, y: number, v: number, kind: 'normal' | 'crit' | 'heal'): void {
    const N = this.reg.combat.numbers;
    const txt = this.scene.add
      .bitmapText(x, y, UI_FONT, String(Math.max(1, Math.round(v))), kind === 'crit' ? 22 : 16)
      .setOrigin(0.5)
      .setTint(kind === 'crit' ? 0xffd040 : kind === 'heal' ? 0x70e070 : 0xffffff)
      .setDepth(DEPTH.glow + 5);
    this.scene.tweens.add({
      targets: txt,
      y: y - N.riseTiles * TILE,
      alpha: 0,
      duration: N.sec * 1000,
      ease: 'Quad.Out',
      onComplete: () => txt.destroy(),
    });
  }

  /** Трассер 60 мс. */
  private tracer(x0: number, y0: number, x1: number, y1: number, energy: boolean): void {
    const g = this.scene.add.graphics().setDepth(DEPTH.glow + 1);
    g.lineStyle(energy ? 3 : 2, energy ? 0x80e0ff : 0xffe080, 0.9).lineBetween(x0, y0, x1, y1);
    this.scene.time.delayedCall(60, () => g.destroy());
    if (energy && getAssetInfo('effects.rad_aura')) {
      const a = spawnSprite(this.scene, x1, y1, 'effects.rad_aura', { depth: DEPTH.glow })
        .setOrigin(0.5)
        .setScale(0.3)
        .setTint(0x80e0ff)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({
        targets: a,
        alpha: 0,
        scale: 0.5,
        duration: 200,
        onComplete: () => a.destroy(),
      });
    }
  }

  render(time: number): void {
    const s = this.scene;
    this.views.update(
      time,
      s.dayNight.seconds,
      this.enemies,
      this.night,
      (x, y) => this.lit(x, y),
      s.hero.pos,
    );
  }

  /** Цели защиты: живые враги. */
  get defenseTargets(): Enemy[] {
    return this.enemies.filter((e) => e.alive);
  }

  destroy(): void {
    this.views.destroy();
    for (const p of this.projectiles) p.img.destroy();
    for (const a of this.areas) for (const i of a.imgs) i.destroy();
    this.sparks.destroy();
    this.blood_.destroy();
  }

  get isMelee(): (k: WeaponStats['kind']) => boolean {
    return isMelee;
  }

  angle(x0: number, y0: number, x1: number, y1: number): number {
    return angleOf(x0, y0, x1, y1);
  }
}
