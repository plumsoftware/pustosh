import type { Registry } from '../data/Registry';
import type { BossDef } from '../data/schemas';
import { angleDelta, angleOf } from '../systems/Combat';

/** Красная зона на земле (TZ 9.2.3): круг, конус или полоса. */
export type ZoneShape =
  | { kind: 'circle'; x: number; y: number; r: number }
  | { kind: 'cone'; x: number; y: number; r: number; dir: number; deg: number }
  | { kind: 'line'; x0: number; y0: number; x1: number; y1: number; w: number };

export interface Telegraph {
  id: number;
  attack: string;
  shape: ZoneShape;
  start: number;
  end: number;
}

export type BossEvent =
  | { type: 'telegraph'; t: Telegraph }
  | { type: 'resolve'; t: Telegraph }
  | { type: 'hit'; damage: number; attack: string; fromX: number; fromY: number }
  | { type: 'pull'; toX: number; toY: number; tiles: number }
  | { type: 'stun'; sec: number }
  | { type: 'summon'; id: string; n: number }
  | { type: 'phase'; n: number }
  | { type: 'pools'; pts: [number, number][]; r: number; sec: number; dps: number }
  | { type: 'charge'; x0: number; y0: number; x1: number; y1: number }
  | { type: 'dive'; on: boolean }
  | { type: 'roar' }
  | { type: 'shield'; on: boolean }
  | { type: 'died' };

/** Точка внутри зоны (с запасом r — радиус героя). */
export function inZone(s: ZoneShape, x: number, y: number, r = 0): boolean {
  if (s.kind === 'circle') return Math.hypot(x - s.x, y - s.y) <= s.r + r;
  if (s.kind === 'cone') {
    const d = Math.hypot(x - s.x, y - s.y);
    if (d > s.r + r) return false;
    if (d < 0.5) return true;
    return Math.abs(angleDelta(s.dir, angleOf(s.x, s.y, x, y))) <= s.deg / 2;
  }
  const dx = s.x1 - s.x0;
  const dy = s.y1 - s.y0;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - s.x0) * dx + (y - s.y0) * dy) / len2));
  return Math.hypot(x - (s.x0 + dx * t), y - (s.y0 + dy * t)) <= s.w / 2 + r;
}

export interface BossCtx {
  now: number;
  dt: number;
  hero: { x: number; y: number; alive: boolean };
  rng(): number;
  emit(ev: BossEvent): void;
}

type Params = Record<string, number | Record<string, number>>;

interface AttackSpec {
  id: string;
  /** Можно ли сейчас (дистанция, фаза). */
  ok?: (d: number) => boolean;
  /** Зона(ы) и время предупреждения. */
  make: () => { shapes: ZoneShape[]; sec: number };
  /** Срабатывание после предупреждения. */
  resolve: (shapes: ZoneShape[]) => void;
}

/**
 * Босс (TZ 9.2): спит до входа героя на арену, затем бой — движение к герою внутри арены, атаки с
 * красной зоной за 0.8–1.2 с (progression.json → bosses.telegraphSec), фазы по порогам HP, призыв,
 * щит «Мороза» (снимает электричество), подземный Пожиратель (уязвим 2 с после выхода).
 */
export class Boss {
  readonly def: BossDef;
  readonly id: string;
  hp: number;
  readonly maxHp: number;
  readonly r: number;
  faceDeg = 180;
  phase = 1;
  state: 'sleep' | 'fight' | 'dead' = 'sleep';
  hidden = false;
  shield = false;
  moving = false;
  /** Для защиты (Target). */
  rootedUntil = 0;
  slowUntil = 0;
  slowMul = 1;
  deadAt = 0;
  /** Последняя атака (для анимации частей): id и время. */
  anim: { kind: string; at: number; data?: ZoneShape } = { kind: '', at: 0 };
  private nextAt = 0;
  private pending: { spec: AttackSpec; shapes: ZoneShape[]; at: number; tel: Telegraph[] } | null = null;
  private telSeq = 1;
  private vulnerableUntil = 0;
  private shieldOffUntil = 0;
  private ctx: BossCtx | null = null;
  readonly p: Params;

  constructor(
    private readonly reg: Registry,
    def: BossDef,
    public x: number,
    public y: number,
    readonly arena: { x: number; y: number; r: number },
  ) {
    this.def = def;
    this.id = `boss_${def.id}`;
    this.maxHp = def.hp;
    this.hp = def.hp;
    this.r = 0.9;
    this.p = (reg.prog.bosses[def.id] as Params | undefined) ?? {};
    if (def.id === 'frost') this.shield = true;
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  private n(k: string, d = 0): number {
    const v = this.p[k];
    return typeof v === 'number' ? v : d;
  }

  private get speed(): number {
    let s = this.n('speed', 1);
    if (this.phase >= 2) s *= this.n('phase2Speed', 1);
    if (this.phase >= 3) s *= this.n('phase3Speed', 1);
    return s;
  }

  /** Урон боссу. Щит «Мороза» пропускает только электричество; Пожиратель под землёй неуязвим. */
  hurt(
    amount: number,
    fromX: number,
    fromY: number,
    opts: { melee: boolean; specials?: readonly string[]; now: number },
  ): { dmg: number; back: boolean; blocked: boolean } {
    if (!this.alive || this.state === 'sleep') return { dmg: 0, back: false, blocked: true };
    const sp = opts.specials ?? [];
    if (this.hidden) return { dmg: 0, back: false, blocked: true };
    if (this.def.id === 'devourer' && opts.now > this.vulnerableUntil) amount *= 0.2;
    if (this.shield && opts.now >= this.shieldOffUntil) {
      if (sp.includes('shock_breaks_shield') || sp.includes('stun')) {
        this.shieldOffUntil = opts.now + 5;
        this.ctx?.emit({ type: 'shield', on: false });
      } else return { dmg: 0, back: false, blocked: true };
    }
    const back = Math.abs(angleDelta(this.faceDeg, angleOf(this.x, this.y, fromX, fromY))) > 110;
    const dmg = amount * (back && opts.melee ? 1.25 : 1);
    this.hp -= dmg;
    return { dmg, back, blocked: false };
  }

  // ------------------------------------------------------------------ тик

  tick(ctx: BossCtx): void {
    this.ctx = ctx;
    const now = ctx.now;
    if (this.state === 'dead') return;
    const h = ctx.hero;
    if (this.state === 'sleep') {
      if (h.alive && Math.hypot(h.x - this.arena.x, h.y - this.arena.y) <= this.arena.r - 1) {
        this.state = 'fight';
        this.nextAt = now + 1.2;
      } else return;
    }
    if (this.hp <= 0) {
      this.state = 'dead';
      this.hp = 0;
      this.deadAt = now;
      ctx.emit({ type: 'died' });
      return;
    }
    this.checkPhase(ctx);
    if (this.shield && now >= this.shieldOffUntil && this.anim.kind === 'shield_off')
      this.anim = { kind: '', at: now };
    this.moving = false;
    const d = Math.hypot(h.x - this.x, h.y - this.y);
    if (!this.hidden) this.faceDeg = angleOf(this.x, this.y, h.x, h.y);
    // Предупреждение идёт — ждём и срабатываем.
    if (this.pending) {
      if (now >= this.pending.at) {
        const pd = this.pending;
        this.pending = null;
        for (const t of pd.tel) ctx.emit({ type: 'resolve', t });
        this.anim = { kind: pd.spec.id, at: now, data: pd.shapes[0] };
        pd.spec.resolve(pd.shapes);
        const [a, b] = this.reg.prog.bosses.attackPauseSec;
        this.nextAt = now + (a + ctx.rng() * (b - a)) / this.speed;
      }
      return;
    }
    // Ближе к герою (внутри арены), затем следующая атака.
    if (d > 2.2 && !this.hidden) this.step(h.x - this.x, h.y - this.y, this.speed * ctx.dt);
    if (now < this.nextAt || !h.alive) return;
    const list = this.attacks().filter((a) => !a.ok || a.ok(d));
    if (!list.length) return;
    const spec = list[Math.floor(ctx.rng() * list.length)]!;
    const { shapes, sec } = spec.make();
    const tel = shapes.map((shape) => ({
      id: this.telSeq++,
      attack: spec.id,
      shape,
      start: now,
      end: now + sec,
    }));
    for (const t of tel) ctx.emit({ type: 'telegraph', t });
    this.pending = { spec, shapes, at: now + sec, tel };
    this.anim = { kind: `wind_${spec.id}`, at: now };
  }

  private step(dx: number, dy: number, len: number): void {
    const l = Math.hypot(dx, dy) || 1;
    let nx = this.x + (dx / l) * len;
    let ny = this.y + (dy / l) * len;
    const ar = this.arena;
    const da = Math.hypot(nx - ar.x, ny - ar.y);
    if (da > ar.r - 1) {
      nx = ar.x + ((nx - ar.x) / da) * (ar.r - 1);
      ny = ar.y + ((ny - ar.y) / da) * (ar.r - 1);
    }
    this.x = nx;
    this.y = ny;
    this.moving = len > 0;
  }

  private checkPhase(ctx: BossCtx): void {
    const frac = this.hp / this.maxHp;
    const p2 = this.n('phase2At', this.def.id === 'frost' ? this.n('shieldUntil', 0.5) : 0);
    const p3 = this.n('phase3At', 0);
    if (this.phase < 2 && p2 && frac <= p2) {
      this.phase = 2;
      ctx.emit({ type: 'phase', n: 2 });
      ctx.emit({ type: 'roar' });
      if (this.def.id === 'frost') {
        this.shield = false;
        ctx.emit({ type: 'shield', on: false });
      }
      this.summon(ctx, 'phase2Summon');
      if (this.def.id === 'queen') ctx.emit({ type: 'summon', id: 'spitter', n: this.n('tadpoles', 3) });
      if (this.def.id === 'zero') this.summon(ctx, 'summon');
    } else if (this.phase < 3 && p3 && frac <= p3) {
      this.phase = 3;
      ctx.emit({ type: 'phase', n: 3 });
      ctx.emit({ type: 'roar' });
      if (this.def.id === 'zero') this.summon(ctx, 'summon');
    }
  }

  private summon(ctx: BossCtx, key: string): void {
    const s = this.p[key];
    if (s && typeof s === 'object')
      for (const [id, n] of Object.entries(s)) ctx.emit({ type: 'summon', id, n });
  }

  // ------------------------------------------------------------------ атаки

  private hit(attack: string, damage: number, shapes: ZoneShape[]): boolean {
    const c = this.ctx!;
    if (!c.hero.alive || !shapes.some((s) => inZone(s, c.hero.x, c.hero.y, 0.22))) return false;
    c.emit({ type: 'hit', damage, attack, fromX: this.x, fromY: this.y });
    return true;
  }

  private line(len: number, w: number, dir = this.faceDeg): ZoneShape {
    const a = (dir * Math.PI) / 180;
    return {
      kind: 'line',
      x0: this.x,
      y0: this.y,
      x1: this.x + Math.cos(a) * len,
      y1: this.y + Math.sin(a) * len,
      w,
    };
  }

  private telSec(bias = 0.5): number {
    const [a, b] = this.reg.prog.bosses.telegraphSec;
    return a + (b - a) * bias;
  }

  private attacks(): AttackSpec[] {
    const c = this.ctx!;
    const h = c.hero;
    const id = this.def.id;
    const n = (k: string, d = 0) => this.n(k, d);
    const circleAtHero = (r: number): ZoneShape => ({ kind: 'circle', x: h.x, y: h.y, r });
    if (id === 'butcher')
      return [
        {
          id: 'hook',
          ok: (d) => d > 2 && d <= n('hookRange', 6),
          make: () => ({ shapes: [this.line(n('hookRange', 6), 0.9)], sec: this.telSec(0.6) }),
          resolve: (s) => {
            if (this.hit('hook', n('hookDamage', 14), s))
              c.emit({ type: 'pull', toX: this.x, toY: this.y, tiles: n('hookPull', 4) });
          },
        },
        {
          id: 'slam',
          ok: (d) => d <= n('slamRadius', 2) + 1,
          make: () => ({
            shapes: [{ kind: 'circle', x: this.x, y: this.y, r: n('slamRadius', 2) }],
            sec: this.telSec(0.7),
          }),
          resolve: (s) => void this.hit('slam', n('slamDamage', 26), s),
        },
        {
          id: 'swing',
          ok: (d) => d <= n('swingRange', 2.4) + 0.5,
          make: () => ({
            shapes: [
              {
                kind: 'cone',
                x: this.x,
                y: this.y,
                r: n('swingRange', 2.4),
                dir: this.faceDeg,
                deg: n('swingDeg', 120),
              },
            ],
            sec: this.telSec(0.3),
          }),
          resolve: (s) => void this.hit('swing', n('swingDamage', 18), s),
        },
      ];
    if (id === 'queen')
      return [
        {
          id: 'tongue',
          ok: (d) => d > 2 && d <= n('tongueRange', 5),
          make: () => ({ shapes: [this.line(n('tongueRange', 5), 0.8)], sec: this.telSec(0.5) }),
          resolve: (s) => {
            if (this.hit('tongue', n('tongueDamage', 12), s))
              c.emit({ type: 'pull', toX: this.x, toY: this.y, tiles: n('tonguePull', 3) });
          },
        },
        {
          id: 'leap',
          make: () => ({ shapes: [circleAtHero(n('leapRadius', 2.5))], sec: this.telSec(0.8) }),
          resolve: (s) => {
            const z = s[0] as Extract<ZoneShape, { kind: 'circle' }>;
            this.x = z.x;
            this.y = z.y;
            this.hit('leap', n('leapDamage', 30), s);
          },
        },
        {
          id: 'pools',
          make: () => {
            const pts: ZoneShape[] = [];
            for (let i = 0; i < n('poolCount', 3); i++) {
              const a = c.rng() * Math.PI * 2;
              const r = i === 0 ? 0 : 1.5 + c.rng() * 2;
              pts.push({
                kind: 'circle',
                x: h.x + Math.cos(a) * r,
                y: h.y + Math.sin(a) * r,
                r: n('poolRadius', 1.2),
              });
            }
            return { shapes: pts, sec: this.telSec(0.6) };
          },
          resolve: (s) =>
            c.emit({
              type: 'pools',
              pts: s.map((z) => [(z as { x: number }).x, (z as { y: number }).y]),
              r: n('poolRadius', 1.2),
              sec: n('poolSec', 6),
              dps: n('poolDps', 6),
            }),
        },
        {
          id: 'dive',
          ok: () => this.phase === 1,
          make: () => {
            this.hidden = true;
            c.emit({ type: 'dive', on: true });
            return { shapes: [circleAtHero(n('leapRadius', 2.5))], sec: n('diveSec', 2) * 0.6 };
          },
          resolve: (s) => {
            const z = s[0] as Extract<ZoneShape, { kind: 'circle' }>;
            this.x = z.x;
            this.y = z.y;
            this.hidden = false;
            c.emit({ type: 'dive', on: false });
            this.hit('leap', n('leapDamage', 30), s);
          },
        },
      ];
    if (id === 'tyrant')
      return [
        {
          id: 'charge',
          ok: (d) => d > 3,
          make: () => ({
            shapes: [this.line(n('chargeLen', 10), n('chargeWidth', 1.6))],
            sec: this.telSec(1),
          }),
          resolve: (s) => {
            const z = s[0] as Extract<ZoneShape, { kind: 'line' }>;
            this.hit('charge', n('chargeDamage', 40), s);
            c.emit({ type: 'charge', x0: z.x0, y0: z.y0, x1: z.x1, y1: z.y1 });
            const ar = this.arena;
            let ex = z.x1;
            let ey = z.y1;
            const da = Math.hypot(ex - ar.x, ey - ar.y);
            if (da > ar.r - 1) {
              ex = ar.x + ((ex - ar.x) / da) * (ar.r - 1);
              ey = ar.y + ((ey - ar.y) / da) * (ar.r - 1);
            }
            this.x = ex;
            this.y = ey;
          },
        },
        {
          id: 'bite',
          ok: (d) => d <= n('biteRange', 2.6) + 0.5,
          make: () => ({
            shapes: [
              {
                kind: 'cone',
                x: this.x,
                y: this.y,
                r: n('biteRange', 2.6),
                dir: this.faceDeg,
                deg: n('biteDeg', 70),
              },
            ],
            sec: this.telSec(0.2),
          }),
          resolve: (s) => void this.hit('bite', n('biteDamage', 30), s),
        },
        {
          id: 'tail',
          ok: (d) => d <= n('tailRange', 3) + 1,
          make: () => ({
            shapes: [
              {
                kind: 'cone',
                x: this.x,
                y: this.y,
                r: n('tailRange', 3),
                dir: this.faceDeg + 180,
                deg: n('tailDeg', 120),
              },
            ],
            sec: this.telSec(0.4),
          }),
          resolve: (s) => void this.hit('tail', n('tailDamage', 22), s),
        },
        {
          id: 'roar',
          ok: (d) => d <= n('roarRadius', 4),
          make: () => ({
            shapes: [{ kind: 'circle', x: this.x, y: this.y, r: n('roarRadius', 4) }],
            sec: this.telSec(0.6),
          }),
          resolve: (s) => {
            c.emit({ type: 'roar' });
            if (c.hero.alive && inZone(s[0]!, h.x, h.y, 0.22))
              c.emit({ type: 'stun', sec: n('roarStun', 1) });
          },
        },
      ];
    if (id === 'devourer')
      return [
        {
          id: 'emerge',
          make: () => {
            this.hidden = true;
            c.emit({ type: 'dive', on: true });
            return { shapes: [circleAtHero(n('emergeRadius', 2.5))], sec: this.telSec(0.8) };
          },
          resolve: (s) => {
            const z = s[0] as Extract<ZoneShape, { kind: 'circle' }>;
            this.x = z.x;
            this.y = z.y;
            this.hidden = false;
            this.vulnerableUntil = c.now + n('vulnerableSec', 2);
            c.emit({ type: 'dive', on: false });
            this.hit('emerge', n('emergeDamage', 35), s);
          },
        },
      ];
    if (id === 'frost')
      return [
        {
          id: 'shards',
          make: () => {
            const k = n('shardCount', 7);
            const shapes: ZoneShape[] = [];
            for (let i = 0; i < k; i++) shapes.push(this.line(7, 0.6, this.faceDeg + (i - (k - 1) / 2) * 12));
            return { shapes, sec: this.telSec(0.6) };
          },
          resolve: (s) => void this.hit('shards', n('shardDamage', 14), s),
        },
        {
          id: 'breath',
          ok: (d) => d <= n('coneRange', 5),
          make: () => ({
            shapes: [
              {
                kind: 'cone',
                x: this.x,
                y: this.y,
                r: n('coneRange', 5),
                dir: this.faceDeg,
                deg: n('coneDeg', 50),
              },
            ],
            sec: this.telSec(0.7),
          }),
          resolve: (s) => void this.hit('breath', n('coneDps', 20), s),
        },
      ];
    // zero
    return [
      {
        id: 'whip',
        ok: (d) => d <= n('whipRange', 5),
        make: () => ({ shapes: [this.line(n('whipRange', 5), 0.9)], sec: this.telSec(0.4) }),
        resolve: (s) => void this.hit('whip', n('whipDamage', 25), s),
      },
      {
        id: 'sectors',
        ok: () => this.phase >= 2,
        make: () => {
          const a0 = c.rng() * 360;
          const shapes: ZoneShape[] = [0, 180].map((o) => ({
            kind: 'cone',
            x: this.arena.x,
            y: this.arena.y,
            r: this.arena.r,
            dir: a0 + o,
            deg: 90,
          }));
          return { shapes, sec: this.telSec(1) };
        },
        resolve: (s) =>
          c.emit({
            type: 'pools',
            pts: s.map((z) => {
              const cz = z as Extract<ZoneShape, { kind: 'cone' }>;
              const a = (cz.dir * Math.PI) / 180;
              return [cz.x + Math.cos(a) * cz.r * 0.5, cz.y + Math.sin(a) * cz.r * 0.5] as [number, number];
            }),
            r: this.arena.r * 0.45,
            sec: 4,
            dps: n('sectorDps', 8),
          }),
      },
    ];
  }

  /** Бой сброшен (герой погиб или вышел): здоровье и фаза — заново. */
  reset(): void {
    if (this.state === 'dead') return;
    this.hp = this.maxHp;
    this.phase = 1;
    this.state = 'sleep';
    this.pending = null;
    this.hidden = false;
    this.shield = this.def.id === 'frost';
    this.x = this.arena.x;
    this.y = this.arena.y - 2;
  }
}
