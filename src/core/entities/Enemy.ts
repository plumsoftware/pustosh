import type { Registry } from '../data/Registry';
import type { EnemyDef } from '../data/schemas';
import { angleDelta, angleOf } from '../systems/Combat';
import { findPath } from '../systems/Pathfind';

export type EnemyState = 'idle' | 'wander' | 'notice' | 'chase' | 'attack' | 'flee' | 'return' | 'dead';

export type EnemyEvent =
  | { type: 'melee'; e: Enemy; damage: number; poison?: [number, number] }
  | { type: 'wall'; e: Enemy; tx: number; ty: number; damage: number }
  | { type: 'spit'; e: Enemy; tx: number; ty: number }
  | { type: 'grenade'; e: Enemy; tx: number; ty: number }
  | { type: 'explode'; e: Enemy; radius: number; damage: number; kind: 'acid' | 'rad' }
  | { type: 'tongue'; e: Enemy; pull: number }
  | { type: 'grab'; e: Enemy; sec: number }
  | { type: 'aura'; e: Enemy; rad: number }
  | { type: 'helmet'; e: Enemy }
  | { type: 'reveal'; e: Enemy }
  | { type: 'leap'; e: Enemy; tx: number; ty: number }
  | { type: 'windup'; e: Enemy }
  | { type: 'died'; e: Enemy };

/** Мир глазами врага: герой, свет, трава, проходимость, движение с коллизиями, события. */
export interface EnemyCtx {
  now: number;
  dt: number;
  night: boolean;
  nightSpeedMul: number;
  hero: { x: number; y: number; r: number; alive: boolean };
  /** Куда идти, если героя не видно (тотем — в кровавую ночь). */
  goal: { x: number; y: number } | null;
  /** Шумы (выстрелы, тревога): точка и радиус. */
  noises: readonly { x: number; y: number; r: number }[];
  rng(): number;
  inGrass(x: number, y: number): boolean;
  passable(tx: number, ty: number): boolean;
  /** Сдвинуть с коллизиями (стены, объекты, двери игрока) — новая позиция. */
  move(e: Enemy, dx: number, dy: number): { x: number; y: number };
  /** Стена игрока для пролома по пути к цели (наименьшая прочность рядом) или null. */
  wallToBreak(e: Enemy, tx: number, ty: number): { tx: number; ty: number } | null;
  pack(e: Enemy): readonly Enemy[];
  emit(ev: EnemyEvent): void;
}

type Beh = Record<string, number | number[]>;

/**
 * Враг или зверь (TZ 8.3): данные enemies.json, элита, конечный автомат
 * Idle → Wander → Notice → Chase → Attack → Flee/Return, особые механики по id.
 */
export class Enemy {
  readonly def: EnemyDef;
  readonly elite: boolean;
  hp: number;
  readonly maxHp: number;
  readonly r: number;
  readonly damage: number;
  faceDeg = 0;
  state: EnemyState = 'idle';
  /** Стоит ли (капкан, хватка), замедлен, оглушён — как у защиты (Target). */
  rootedUntil = 0;
  slowUntil = 0;
  slowMul = 1;
  stunUntil = 0;
  bleedUntil = 0;
  poisonUntil = 0;
  poisonDps = 0;
  /** Засада в траве (ползун), в песке (скорпион) — невидим, пока герой не подойдёт. */
  hidden = false;
  /** Кабан: нейтрален, пока его не ударили. */
  angry = false;
  helmet = true;
  /** Анимационные флаги для вида: удар, плевок, выпад, замах тарана, раздувание. */
  anim: { kind: string; at: number } = { kind: '', at: 0 };
  moving = false;
  deadAt = 0;
  /** Ведёт стаю/пару: смещение угла окружения. */
  packAngle = 0;
  private home: { x: number; y: number };
  private wanderTo: { x: number; y: number } | null = null;
  private stateAt = 0;
  private attackCd = 0;
  private specialCd = 0;
  private lastSeenAt = -99;
  private lastSeen: { x: number; y: number } | null = null;
  private path: [number, number][] = [];
  private pathAt = -99;
  private wall: { tx: number; ty: number } | null = null;
  private charge: { dx: number; dy: number; until: number } | null = null;
  private zig = 0;
  readonly beh: Beh;

  constructor(
    private readonly reg: Registry,
    def: EnemyDef,
    readonly id: string,
    public x: number,
    public y: number,
    elite: boolean,
  ) {
    this.def = def;
    this.elite = elite;
    const el = def.elite;
    this.maxHp = def.hp * (elite && el ? el.hpMul : 1);
    this.hp = this.maxHp;
    this.damage = def.damage * (elite && el ? el.dmgMul : 1);
    const R = reg.combat.enemy.radiusTiles;
    this.r = (R[def.id] ?? R['default']!) * (elite && el ? el.scale : 1);
    this.home = { x, y };
    this.beh = reg.combat.behaviors[def.id] ?? {};
    if (def.id === 'crawler' || def.id === 'scorpion') this.hidden = true;
    this.packAngle = 0;
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  private num(k: string, d = 0): number {
    const v = this.beh[k];
    return typeof v === 'number' ? v : d;
  }

  get family(): string {
    return this.def.family;
  }

  /** Мирный зверь (олень, заяц, кабан): не нападает первым. */
  get passive(): boolean {
    return this.def.family === 'animal' && !(this.def.id === 'boar' && this.angry);
  }

  // ------------------------------------------------------------------ урон

  /**
   * Получить удар (TZ 8.1): фронтальная броня (солдат — ближний бой, броненосец — всё), удар в спину,
   * оглушение, отброс, кровотечение. Возвращает итоговый урон (для цифр) и крит/спина.
   */
  hurt(
    amount: number,
    fromX: number,
    fromY: number,
    opts: {
      melee: boolean;
      specials?: readonly string[];
      now: number;
      knock?: number;
      backstabMul?: number;
      ignoreArmor?: boolean;
    },
  ): { dmg: number; back: boolean; blocked: boolean } {
    if (!this.alive) return { dmg: 0, back: false, blocked: false };
    const front = Math.abs(angleDelta(this.faceDeg, angleOf(this.x, this.y, fromX, fromY))) < 70;
    const back = !front && Math.abs(angleDelta(this.faceDeg, angleOf(this.x, this.y, fromX, fromY))) > 100;
    let dmg = amount;
    let blocked = false;
    const fa = this.num('frontArmor');
    if (fa && front && !opts.ignoreArmor && (this.def.id !== 'soldier' || opts.melee)) {
      dmg *= 1 - fa;
      blocked = true;
    }
    if (back && opts.melee) dmg *= opts.backstabMul ?? 1.25;
    if (this.hidden) this.reveal();
    this.hp -= dmg;
    const sp = opts.specials ?? [];
    const S = this.reg.combat.specials;
    if (sp.includes('bleed')) this.bleedUntil = opts.now + S.bleed.sec;
    if (sp.includes('stun')) this.stunUntil = opts.now + S.stunSec;
    const resist = this.reg.combat.enemy.knockbackResist[this.def.id] ?? 0;
    const knock = (opts.knock ?? 0) * (1 - resist);
    if (knock > 0) {
      const a = Math.atan2(this.y - fromY, this.x - fromX);
      this.x += Math.cos(a) * knock;
      this.y += Math.sin(a) * knock;
    }
    if (this.def.id === 'boar') this.angry = true;
    this.lastSeen = { x: fromX, y: fromY };
    this.lastSeenAt = opts.now;
    if (this.def.family !== 'animal' || this.angry) this.setState('chase', opts.now);
    return { dmg, back, blocked };
  }

  private reveal(): void {
    this.hidden = false;
  }

  private setState(s: EnemyState, now: number): void {
    if (this.state === s || this.state === 'dead') return;
    this.state = s;
    this.stateAt = now;
    this.path = [];
  }

  // ------------------------------------------------------------------ тик

  tick(ctx: EnemyCtx): void {
    const now = ctx.now;
    const dt = ctx.dt;
    if (this.state === 'dead') return;
    // Кровотечение и яд.
    if (now < this.bleedUntil) this.hp -= this.reg.combat.specials.bleed.dps * dt;
    if (now < this.poisonUntil) this.hp -= this.poisonDps * dt;
    if (this.hp <= 0) {
      this.die(ctx);
      return;
    }
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.specialCd = Math.max(0, this.specialCd - dt);
    if (now >= this.slowUntil) this.slowMul = 1;
    this.moving = false;
    const id = this.def.id;
    const h = ctx.hero;
    const dh = Math.hypot(h.x - this.x, h.y - this.y);
    const E = this.reg.combat.enemy;

    // Особое: солдат теряет каску, светящийся облучает.
    if (id === 'soldier' && this.helmet && this.hp <= this.maxHp * this.num('helmetAtHp', 0.5)) {
      this.helmet = false;
      ctx.emit({ type: 'helmet', e: this });
    }
    if (id === 'glowing' && h.alive && dh <= this.num('auraTiles', 2))
      ctx.emit({ type: 'aura', e: this, rad: this.num('radPerSec', 3) * dt });

    // Засада: ползун в траве, скорпион в песке — показываются, когда герой подошёл.
    if (this.hidden) {
      const reveal = id === 'crawler' ? this.num('ambushTiles', 3) : this.num('buryRevealTiles', 3);
      if (h.alive && dh <= reveal) {
        this.reveal();
        ctx.emit({ type: 'reveal', e: this });
        if (id === 'crawler') ctx.emit({ type: 'grab', e: this, sec: this.num('grabRootSec', 1.5) });
        this.setState('attack', now);
      } else return;
    }
    if (now < this.stunUntil || now < this.rootedUntil) return;

    // Таран броненосца/кабана идёт по прямой.
    if (this.charge) {
      if (now >= this.charge.until) this.charge = null;
      else {
        this.step(ctx, this.charge.dx, this.charge.dy, this.speed(ctx) * this.num('chargeMul', 2.5));
        if (dh <= this.r + h.r + 0.3 && this.attackCd === 0) this.melee(ctx, 1.5);
        return;
      }
    }

    const vision = ctx.night ? E.visionNightTiles : E.visionDayTiles;
    const sees = h.alive && dh <= vision;
    if (sees) {
      this.lastSeen = { x: h.x, y: h.y };
      this.lastSeenAt = now;
    }
    // Шум выстрела или тревоги — идти на звук.
    for (const n of ctx.noises) {
      if (
        Math.hypot(n.x - this.x, n.y - this.y) <= n.r &&
        this.state !== 'chase' &&
        this.state !== 'attack'
      ) {
        this.lastSeen = { x: n.x, y: n.y };
        this.lastSeenAt = now;
        if (!this.passive) this.setState('notice', now);
      }
    }

    // Мирные звери и бегство.
    if (this.passive) {
      const flee = this.num('fleeTiles', 6);
      if (h.alive && dh <= flee) this.flee(ctx, h.x, h.y, id === 'hare');
      else this.wander(ctx);
      return;
    }
    const fleeAt = this.num('fleeAtHp', 0);
    if (fleeAt > 0 && this.hp <= this.maxHp * fleeAt) {
      this.flee(ctx, h.x, h.y, false);
      return;
    }

    const target =
      this.lastSeen && now - this.lastSeenAt <= E.loseSightSec ? this.lastSeen : (ctx.goal ?? null);
    if (!target) {
      this.wander(ctx);
      return;
    }
    if (this.state === 'idle' || this.state === 'wander') this.setState('notice', now);
    if (this.state === 'notice' && now - this.stateAt > 0.3) this.setState('chase', now);
    if (this.state === 'notice') {
      this.faceDeg = angleOf(this.x, this.y, target.x, target.y);
      return;
    }

    const chasingHero =
      sees || (this.lastSeen && now - this.lastSeenAt <= E.loseSightSec && target === this.lastSeen);
    const dist = Math.hypot(target.x - this.x, target.y - this.y);
    this.faceDeg = angleOf(this.x, this.y, target.x, target.y);

    // Особые атаки на расстоянии.
    if (chasingHero && h.alive && this.special(ctx, dh)) return;

    const reach = E.attackRangeTiles + this.r + h.r;
    if (chasingHero && h.alive && dh <= reach) {
      this.setState('attack', now);
      if (this.attackCd === 0) this.melee(ctx, 1);
      return;
    }
    this.setState('chase', now);
    // Стая окружает: точка на окружности вокруг цели.
    let gx = target.x;
    let gy = target.y;
    const circle = this.num('circleTiles');
    if (circle && dh > circle * 0.7 && this.attackCd > 0) {
      const a = (angleOf(target.x, target.y, this.x, this.y) * Math.PI) / 180 + this.packAngle;
      gx = target.x + Math.cos(a) * circle;
      gy = target.y + Math.sin(a) * circle;
    }
    if (id === 'raptor' && dh > 2) {
      // Рапторы обходят с флангов.
      const a = ((angleOf(target.x, target.y, this.x, this.y) + this.packAngle) * Math.PI) / 180;
      gx = target.x + Math.cos(a) * 1.5;
      gy = target.y + Math.sin(a) * 1.5;
    }
    this.goTo(ctx, gx, gy, dist);
  }

  /** Скорость с ночным множителем (заражённые), бегун — спринт ночью. */
  private speed(ctx: EnemyCtx): number {
    let s = this.def.speedTilesPerSec;
    if (ctx.night && this.def.family === 'infected') s *= ctx.nightSpeedMul;
    if (ctx.night && this.def.id === 'sprinter') s *= this.num('nightSprintMul', 1.3);
    if (ctx.now < this.slowUntil) s *= this.slowMul;
    return s;
  }

  private step(ctx: EnemyCtx, dx: number, dy: number, speed: number): void {
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) return;
    const k = (speed * ctx.dt) / l;
    const p = ctx.move(this, dx * k, dy * k);
    const moved = Math.hypot(p.x - this.x, p.y - this.y);
    this.x = p.x;
    this.y = p.y;
    this.moving = moved > 1e-4;
    this.faceDeg = angleOf(0, 0, dx, dy);
  }

  /** Движение к точке: прямо, если видно; иначе A* (до pathRadius); путь закрыт — ломать стену. */
  private goTo(ctx: EnemyCtx, gx: number, gy: number, dist: number): void {
    const E = this.reg.combat.enemy;
    if (this.wall) {
      const w = this.wall;
      const wx = w.tx + 0.5;
      const wy = w.ty + 0.5;
      if (!ctx.passable(w.tx, w.ty)) {
        if (Math.hypot(wx - this.x, wy - this.y) <= this.r + 0.9) {
          this.faceDeg = angleOf(this.x, this.y, wx, wy);
          if (this.attackCd === 0) {
            this.attackCd = E.attackCooldownSec;
            this.anim = { kind: 'attack', at: ctx.now };
            ctx.emit({ type: 'wall', e: this, tx: w.tx, ty: w.ty, damage: this.damage });
          }
        } else this.step(ctx, wx - this.x, wy - this.y, this.speed(ctx));
        return;
      }
      this.wall = null;
      this.path = [];
    }
    const sx = Math.floor(this.x);
    const sy = Math.floor(this.y);
    const tx = Math.floor(gx);
    const ty = Math.floor(gy);
    if (this.lineClear(ctx, sx, sy, tx, ty)) {
      this.path = [];
      this.step(ctx, gx - this.x, gy - this.y, this.speed(ctx));
      return;
    }
    if (ctx.now - this.pathAt > E.repathSec || this.path.length === 0) {
      this.pathAt = ctx.now;
      const R = Math.min(E.pathRadiusTiles, Math.ceil(dist) + 4);
      const p = dist <= E.pathRadiusTiles ? findPath(sx, sy, tx, ty, R, ctx.passable, 900) : null;
      if (p) this.path = p;
      else {
        this.path = [];
        const w = ctx.wallToBreak(this, gx, gy);
        if (w) {
          this.wall = w;
          return;
        }
      }
    }
    if (this.path.length) {
      const [px, py] = this.path[0]!;
      if (Math.floor(this.x) === px && Math.floor(this.y) === py) this.path.shift();
      const n = this.path[0];
      if (n) this.step(ctx, n[0] + 0.5 - this.x, n[1] + 0.5 - this.y, this.speed(ctx));
      return;
    }
    this.step(ctx, gx - this.x, gy - this.y, this.speed(ctx));
  }

  private lineClear(ctx: EnemyCtx, x0: number, y0: number, x1: number, y1: number): boolean {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 1; i < n; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / n);
      const y = Math.round(y0 + ((y1 - y0) * i) / n);
      if (!ctx.passable(x, y)) return false;
    }
    return true;
  }

  private melee(ctx: EnemyCtx, mul: number): void {
    this.attackCd = this.reg.combat.enemy.attackCooldownSec;
    this.anim = { kind: 'attack', at: ctx.now };
    const poison =
      this.def.id === 'scorpion'
        ? ([this.num('poisonDps', 3), this.num('poisonSec', 4)] as [number, number])
        : undefined;
    ctx.emit({ type: 'melee', e: this, damage: this.damage * mul, poison });
  }

  /** Особые атаки (true — ход занят). */
  private special(ctx: EnemyCtx, dh: number): boolean {
    const id = this.def.id;
    const h = ctx.hero;
    const now = ctx.now;
    if (id === 'spitter') {
      const keep = this.num('keepTiles', 5);
      if (this.anim.kind === 'sac' && now - this.anim.at >= this.num('sacSec', 0.6)) {
        this.anim = { kind: 'spit', at: now };
        ctx.emit({ type: 'spit', e: this, tx: h.x, ty: h.y });
        return true;
      }
      if (this.anim.kind === 'sac') return true;
      if (dh <= keep + 2 && this.specialCd === 0) {
        this.specialCd = this.num('spitEverySec', 3);
        this.anim = { kind: 'sac', at: now };
        return true;
      }
      if (dh < keep - 0.5) {
        this.step(ctx, this.x - h.x, this.y - h.y, this.speed(ctx));
        return true;
      }
      return dh <= keep + 0.5;
    }
    if (id === 'soldier' && this.specialCd === 0 && dh > 2.5 && dh < 7) {
      this.specialCd = this.num('grenadeEverySec', 10);
      this.anim = { kind: 'throw', at: now };
      ctx.emit({ type: 'grenade', e: this, tx: h.x, ty: h.y });
      return true;
    }
    if (id === 'sprinter' && this.specialCd === 0 && dh > 1.2 && dh <= this.num('lungeTiles', 2.5)) {
      this.specialCd = this.num('lungeEverySec', 3);
      this.leap(ctx, h.x, h.y, dh - 0.6);
      return true;
    }
    if (id === 'toad') {
      if (this.specialCd === 0 && dh <= this.num('tongueTiles', 4) && dh > 1.2) {
        this.specialCd = this.num('tongueEverySec', 5);
        this.anim = { kind: 'tongue', at: now };
        ctx.emit({ type: 'tongue', e: this, pull: this.num('pullTiles', 2) });
        return true;
      }
      if (this.attackCd === 0 && dh > 2 && dh < 5 && ctx.rng() < 0.02) {
        this.leap(ctx, h.x, h.y, Math.min(this.num('leapTiles', 2), dh - 1));
        return true;
      }
    }
    if (id === 'raptor' && this.specialCd === 0 && dh <= this.num('pounceTiles', 3) && dh > 1.2) {
      this.specialCd = this.num('pounceEverySec', 4);
      this.leap(ctx, h.x, h.y, dh - 0.5);
      return true;
    }
    if (
      (id === 'armored_lizard' || (id === 'boar' && this.angry)) &&
      this.specialCd === 0 &&
      dh > 2 &&
      dh < this.num('chargeTiles', 6)
    ) {
      if (this.anim.kind !== 'windup') {
        this.anim = { kind: 'windup', at: now };
        ctx.emit({ type: 'windup', e: this });
        return true;
      }
      if (now - this.anim.at < this.num('chargeWindupSec', 0.4)) return true;
      this.specialCd = this.num('chargeEverySec', 6);
      const l = dh || 1;
      this.charge = {
        dx: (h.x - this.x) / l,
        dy: (h.y - this.y) / l,
        until: now + Math.min(1.5, dh / (this.def.speedTilesPerSec * 2)),
      };
      this.anim = { kind: 'charge', at: now };
      return true;
    }
    return false;
  }

  /** Прыжок/выпад: мгновенный бросок к цели (вид анимирует дугу), удар при приземлении. */
  private leap(ctx: EnemyCtx, tx: number, ty: number, len: number): void {
    const a = Math.atan2(ty - this.y, tx - this.x);
    const fromX = this.x;
    const fromY = this.y;
    const p = ctx.move(this, Math.cos(a) * len, Math.sin(a) * len);
    this.x = p.x;
    this.y = p.y;
    this.anim = { kind: 'leap', at: ctx.now };
    ctx.emit({ type: 'leap', e: this, tx: fromX, ty: fromY });
    if (Math.hypot(ctx.hero.x - this.x, ctx.hero.y - this.y) <= this.r + ctx.hero.r + 0.6)
      this.melee(ctx, 1.2);
  }

  private flee(ctx: EnemyCtx, fx: number, fy: number, zigzag: boolean): void {
    this.setState('flee', ctx.now);
    let dx = this.x - fx;
    let dy = this.y - fy;
    if (zigzag) {
      this.zig += ctx.dt;
      const s = Math.sign(Math.sin((this.zig / this.num('zigzagSec', 0.4)) * Math.PI));
      [dx, dy] = [dx - dy * 0.8 * s, dy + dx * 0.8 * s];
    }
    this.step(ctx, dx, dy, this.speed(ctx));
  }

  private wander(ctx: EnemyCtx): void {
    const E = this.reg.combat.enemy;
    if (this.state !== 'wander' && this.state !== 'idle') this.setState('return', ctx.now);
    if (!this.wanderTo || Math.hypot(this.wanderTo.x - this.x, this.wanderTo.y - this.y) < 0.3) {
      if (ctx.rng() < 0.6 * ctx.dt) {
        const a = ctx.rng() * Math.PI * 2;
        const d = ctx.rng() * E.wanderRadiusTiles;
        this.wanderTo = { x: this.home.x + Math.cos(a) * d, y: this.home.y + Math.sin(a) * d };
        this.state = 'wander';
      } else {
        if (this.state === 'return') this.state = 'idle';
        return;
      }
    }
    this.step(ctx, this.wanderTo.x - this.x, this.wanderTo.y - this.y, this.speed(ctx) * 0.5);
  }

  private die(ctx: EnemyCtx): void {
    this.state = 'dead';
    this.deadAt = ctx.now;
    this.hp = 0;
    if (this.def.id === 'bloated')
      ctx.emit({
        type: 'explode',
        e: this,
        radius: this.num('explodeRadius', 2),
        damage: this.num('explodeDamage', 40),
        kind: 'acid',
      });
    if (this.def.id === 'glowing')
      ctx.emit({
        type: 'explode',
        e: this,
        radius: this.num('deathRadTiles', 3),
        damage: this.num('deathRad', 20),
        kind: 'rad',
      });
    ctx.emit({ type: 'died', e: this });
  }
}
