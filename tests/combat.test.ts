import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/core/data';
import { makeStack } from '../src/core/inventory';
import { Enemy, enemyMaxHp, type EnemyCtx, type EnemyEvent } from '../src/core/entities/Enemy';
import {
  armorReduce,
  autoAim,
  canAttachMod,
  inSector,
  noiseRadius,
  rayTargets,
  weaponStats,
} from '../src/core/systems/Combat';
import { findPath } from '../src/core/systems/Pathfind';
import { BloodNight, pickEnemy, spawnDayMul, SpawnSystem } from '../src/core/systems/Spawn';
import { Rng } from '../src/core/util/rng';
import { readAssetCatalog, readRawData } from '../tools/readGameFiles';

const reg = loadGameData(readRawData(), readAssetCatalog()).registry!;

/** Поле без препятствий; walls — непроходимые клетки. */
function ctx(over: Partial<EnemyCtx> & { hero?: EnemyCtx['hero'] } = {}, walls = new Set<string>()) {
  const events: EnemyEvent[] = [];
  const rng = new Rng(7);
  const c: EnemyCtx = {
    now: 0,
    dt: 0.05,
    night: false,
    nightSpeedMul: reg.balance.dayNight.nightEnemySpeedMul as number,
    hero: { x: 0, y: 0, r: 0.22, alive: true },
    goal: null,
    noises: [],
    rng: () => rng.next(),
    inGrass: () => true,
    passable: (x, y) => !walls.has(`${x},${y}`),
    move: (e, dx, dy) => {
      const nx = e.x + dx;
      const ny = e.y + dy;
      return walls.has(`${Math.floor(nx)},${Math.floor(ny)}`) ? { x: e.x, y: e.y } : { x: nx, y: ny };
    },
    wallToBreak: () => null,
    wallBetween: () => false,
    wallStands: () => false,
    pack: () => [],
    emit: (ev) => events.push(ev),
    ...over,
  };
  return { c, events };
}

function run(e: Enemy, c: EnemyCtx, sec: number): void {
  for (let t = 0; t < sec; t += c.dt) {
    e.tick(c);
    c.now += c.dt;
  }
}

const enemy = (id: string, x: number, y: number, elite = false) =>
  new Enemy(reg, reg.enemies.require(id), id, x, y, elite);

describe('Оружие и моды', () => {
  it('кулаки, бита с гвоздями, сломанное оружие ×0.5', () => {
    expect(weaponStats(reg, null).kind).toBe('fist');
    const bat = makeStack(reg, 'bat_nails', 1);
    const w = weaponStats(reg, bat);
    expect(w.kind).toBe('melee_blunt');
    expect(w.specials).toContain('bleed');
    expect(weaponStats(reg, { ...bat, durability: 0 }).damage).toBe(w.damage * 0.5);
    expect(weaponStats(reg, makeStack(reg, 'sledgehammer', 1)).stamina).toBe(reg.combat.hero.staminaHeavy);
  });

  it('дробовик — 6 дробин, глушитель снижает шум ×0.3, прицел +30% дальности', () => {
    const sg = weaponStats(reg, makeStack(reg, 'shotgun_sawedoff', 1));
    expect(sg.pellets).toBe(6);
    const pistol = makeStack(reg, 'pistol', 1);
    const base = weaponStats(reg, pistol);
    expect(noiseRadius(reg, base)).toBe(10);
    expect(canAttachMod(reg, 'mod_silencer', pistol)).toBe(true);
    expect(canAttachMod(reg, 'mod_nails', pistol)).toBe(false);
    const modded = weaponStats(reg, { ...pistol, mods: ['mod_silencer', 'mod_scope'] });
    expect(noiseRadius(reg, modded)).toBeCloseTo(3);
    expect(modded.range).toBeCloseTo(base.range * 1.3);
    expect(canAttachMod(reg, 'mod_stock', { ...pistol, mods: ['a', 'b'] })).toBe(false); // 2 слота
    expect(weaponStats(reg, { ...makeStack(reg, 'machete', 1), mods: ['mod_battery'] }).specials).toContain(
      'stun',
    );
  });

  it('броня: dmg × 100/(100+armor)', () => {
    expect(armorReduce(50, 0)).toBe(50);
    expect(armorReduce(50, 100)).toBe(25);
  });

  it('сектор 90°, автонаведение и луч', () => {
    const ts = [
      { id: 'a', x: 1, y: 0, r: 0.3, hp: 10 },
      { id: 'b', x: 0, y: 1, r: 0.3, hp: 10 },
      { id: 'c', x: 3, y: 0.1, r: 0.3, hp: 10 },
    ];
    expect(inSector(0, 0, 0, 1.2, 90, ts).map((t) => t.id)).toEqual(['a']);
    expect(autoAim(0, 0, 0, 5, 90, ts)?.id).toBe('a');
    expect(rayTargets(0, 0, 0, 10, ts, () => false).hits.map((t) => t.id)).toEqual(['a', 'c']);
    expect(rayTargets(0, 0, 0, 10, ts, (x) => x > 2).hits.map((t) => t.id)).toEqual(['a']);
  });
});

describe('Враги: ИИ и особые механики', () => {
  it('бродяга замечает героя в 7 клетках днём и бьёт вплотную; ночью быстрее', () => {
    const { c, events } = ctx();
    const e = enemy('walker', 6, 0);
    run(e, c, 8);
    expect(events.some((x) => x.type === 'melee')).toBe(true);
    const far = enemy('walker', 9, 0);
    const day = ctx();
    run(far, day.c, 1);
    expect(['idle', 'wander', 'return']).toContain(far.state); // 9 клеток днём не видит
    const night = ctx({ night: true });
    const n = enemy('walker', 9, 0);
    run(n, night.c, 1);
    expect(n.state).toBe('chase'); // ночью видит 10 клеток
    // Погода (буря, senseMul 0.6): ночью 10 × 0.6 = 6 клеток — в 9 не видит.
    const storm = ctx({ night: true, senseMul: 0.6 });
    const s = enemy('walker', 9, 0);
    run(s, storm.c, 1);
    expect(s.state).not.toBe('chase');
  });

  it('«Добивание»: оглушённый получает больше урона', () => {
    const e = enemy('walker', 3, 0);
    e.stunUntil = 10;
    const r1 = e.hurt(10, 0, 0, { melee: false, now: 5, stunnedMul: 2 });
    const r2 = e.hurt(10, 0, 0, { melee: false, now: 20, stunnedMul: 2 });
    expect(r1.dmg).toBeCloseTo(r2.dmg * 2, 5);
  });

  it('ползун невидим в траве, хватает героя в 3 клетках', () => {
    const { c, events } = ctx();
    const e = enemy('crawler', 5, 0);
    run(e, c, 1);
    expect(e.hidden).toBe(true);
    e.x = 2.5;
    run(e, c, 0.2);
    expect(e.hidden).toBe(false);
    expect(events.some((x) => x.type === 'grab')).toBe(true);
  });

  it('болотник держит дистанцию и плюётся после раздувания мешка', () => {
    const { c, events } = ctx();
    const e = enemy('spitter', 4, 0);
    run(e, c, 4);
    expect(events.some((x) => x.type === 'spit')).toBe(true);
    expect(Math.hypot(e.x, e.y)).toBeGreaterThan(3.5);
  });

  it('толстяк взрывается при смерти, светящийся — радиацией', () => {
    for (const [id, kind] of [
      ['bloated', 'acid'],
      ['glowing', 'rad'],
    ] as const) {
      const { c, events } = ctx();
      const e = enemy(id, 3, 0);
      e.hurt(1e6, 0, 0, { melee: true, now: 0 });
      e.tick(c);
      const ex = events.find((x) => x.type === 'explode');
      expect(ex?.type === 'explode' && ex.kind).toBe(kind);
    }
  });

  it('солдат: спереди ближний бой −50%, каска слетает на 50% HP, граната', () => {
    const { c, events } = ctx();
    const e = enemy('soldier', 4, 0);
    e.faceDeg = 180; // смотрит на героя
    expect(e.hurt(20, 0, 0, { melee: true, now: 0 }).dmg).toBe(10);
    expect(e.hurt(20, 0, 0, { melee: false, now: 0 }).dmg).toBe(20);
    e.hp = e.maxHp * 0.4;
    run(e, c, 0.5);
    expect(events.some((x) => x.type === 'helmet')).toBe(true);
    expect(events.some((x) => x.type === 'grenade')).toBe(true);
  });

  it('броненосец: спереди −80%, в спину +25%', () => {
    const e = enemy('armored_lizard', 2, 0);
    e.faceDeg = 180;
    expect(e.hurt(100, 0, 0, { melee: true, now: 0 }).dmg).toBeCloseTo(20);
    expect(e.hurt(100, 4, 0, { melee: true, now: 0 }).dmg).toBeCloseTo(125);
  });

  it('олень убегает, кабан нейтрален до удара', () => {
    const { c } = ctx();
    const deer = enemy('deer', 3, 0);
    run(deer, c, 1);
    expect(deer.x).toBeGreaterThan(4);
    const boar = enemy('boar', 2, 0);
    const b = ctx();
    run(boar, b.c, 1);
    expect(b.events.some((x) => x.type === 'melee')).toBe(false);
    boar.hurt(5, 0, 0, { melee: true, now: 1 });
    run(boar, b.c, 4);
    expect(b.events.some((x) => x.type === 'melee')).toBe(true);
  });

  it('элита: ×1.5 HP, ×1.3 урон', () => {
    const e = enemy('walker', 0, 0, true);
    expect(e.maxHp).toBe(60);
    expect(e.damage).toBeCloseTo(7.8);
  });

  it('A* обходит стену; закрыт со всех сторон — ломает стену', () => {
    const walls = new Set<string>();
    for (let y = -3; y <= 3; y++) walls.add(`3,${y}`);
    const p = findPath(6, 0, 0, 0, 20, (x, y) => !walls.has(`${x},${y}`))!;
    expect(p.at(-1)).toEqual([0, 0]);
    expect(p.some(([x, y]) => x === 3 && Math.abs(y) >= 4)).toBe(true);
    // Герой в коробке
    const box = new Set<string>();
    for (let i = -2; i <= 2; i++) for (const k of [`${i},-2`, `${i},2`, `-2,${i}`, `2,${i}`]) box.add(k);
    // Стена игрока на ребре между клетками 2 и 3 (клетки коробки непроходимы).
    const { c, events } = ctx(
      { wallToBreak: () => ({ tx: 3, ty: 0, side: 'w' }), wallStands: () => true },
      box,
    );
    const e = enemy('walker', 6, 0.5);
    run(e, c, 8);
    expect(events.some((x) => x.type === 'wall')).toBe(true);
  });
});

describe('Спавн и ночи', () => {
  it('враги своего биома; ночью — без мирных зверей', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 200; i++) {
      const d = pickEnemy(reg, 2, true, rng.next())!;
      expect(reg.biomes.get(2)!.enemies).toContain(d.id);
      expect(d.family).not.toBe('animal');
    }
  });

  it('лимит живых и спавн в кольце вне базы', () => {
    const sp = new SpawnSystem(reg);
    const rng = new Rng(5);
    let total = 0;
    for (let i = 0; i < 400; i++) {
      const out = sp.tick({
        now: i,
        dt: 1,
        night: false,
        hero: { x: 100, y: 100 },
        alive: total,
        mobile: false,
        biomeAt: () => 1,
        free: () => true,
        inBase: (x) => x < 100,
        base: null,
        rng: () => rng.next(),
      });
      for (const r of out) {
        const d = Math.hypot(r.x - 100, r.y - 100);
        expect(d).toBeGreaterThan(10);
        expect(d).toBeLessThan(26);
        expect(r.x).toBeGreaterThanOrEqual(99);
      }
      total += out.length;
    }
    expect(total).toBeLessThanOrEqual(reg.combat.spawn.limitDay);
    expect(total).toBeGreaterThan(5);
  });

  it('кровавая ночь: 3 волны по 60 с, состав растёт', () => {
    const bn = new BloodNight(reg);
    const waves: number[] = [];
    for (let t = 0; t < 240; t += 1) {
      const w = bn.tick(7, true, t);
      if (w) waves.push(w);
    }
    expect(waves).toEqual([1, 2, 3]);
    expect(bn.count(3, 2, 3)).toBeGreaterThan(bn.count(1, 1, 1));
  });
});

describe('Баланс ТЗ 8.5', () => {
  it('HP врага по биому: дальше — крепче; элита ×eliteHpMul', () => {
    const w = reg.enemies.require('walker');
    expect(enemyMaxHp(reg, w, 3, false)).toBeGreaterThan(enemyMaxHp(reg, w, 1, false));
    const cfg = reg.combat['enemyHp'] as { eliteHpMul: number };
    expect(enemyMaxHp(reg, w, 1, true)).toBeCloseTo(enemyMaxHp(reg, w, 1, false) * cfg.eliteHpMul, -1);
    // Звери (семейство animal) — со своим hp.
    expect(enemyMaxHp(reg, reg.enemies.require('hare'), 5, false)).toBe(reg.enemies.require('hare').hp);
  });

  it('оружие тира биома: обычный враг — 3–6 ударов, элита — 8–12', () => {
    const bad: string[] = [];
    for (const b of reg.biomes.all)
      for (const wDef of reg.items.all.filter(
        (i) =>
          i.category === 'weapon' &&
          i.tier === b.id &&
          !['throwable', 'flame'].includes(String(i['weaponKind'])),
      )) {
        const st = weaponStats(reg, makeStack(reg, wDef.id, 1));
        const dmg = st.damage * st.pellets;
        for (const id of b.enemies) {
          const e = reg.enemies.require(id);
          if (e.family === 'animal') continue;
          const n = Math.ceil(enemyMaxHp(reg, e, b.id, false) / dmg);
          const el = Math.ceil(enemyMaxHp(reg, e, b.id, true) / dmg);
          if (n < 3 || n > 6 || el < 8 || el > 12) bad.push(`${wDef.id}→${id}@${b.id}: ${n}/${el}`);
        }
      }
    expect(bad).toEqual([]);
  });
});

describe('Плотность врагов по дням', () => {
  it('первые 7 дней меньше, дальше плавно растёт каждые 3 дня, с потолком', () => {
    const m = (d: number) => spawnDayMul(reg, d);
    expect(m(0)).toBeLessThan(m(6.9));
    expect(m(6.9)).toBeLessThan(1);
    expect(m(10)).toBeGreaterThan(m(7));
    // Плавно: соседние моменты почти равны, скачков нет.
    for (let d = 0; d < 40; d += 0.5) expect(Math.abs(m(d + 0.01) - m(d))).toBeLessThan(0.01);
    expect(m(100)).toBe(m(200));
  });
});
