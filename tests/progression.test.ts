import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/core/data';
import { Boss, inZone, type BossEvent } from '../src/core/entities/Boss';
import { Vehicle } from '../src/core/entities/Vehicle';
import { hasSkill } from '../src/core/systems/Craft';
import { addXp, branchPoints, freePoints, learn, skillEffect, xpToNext } from '../src/core/systems/Progress';
import { emptyQuests, nextNote, onQuestEvent, refreshDaily, addExtraTask } from '../src/core/systems/Quests';
import { newTutorial, skipTutorial, tutorialEvent } from '../src/core/systems/Tutorial';
import { readAssetCatalog, readRawData } from '../tools/readGameFiles';

const reg = loadGameData(readRawData(), readAssetCatalog()).registry!;

describe('Опыт и навыки', () => {
  it('кривая 60 × level^1.45 с округлением до 5, уровни и очки', () => {
    expect(xpToNext(1)).toBe(60);
    expect(xpToNext(10) % 5).toBe(0);
    const s = { level: 1, xp: 0, skills: {} as Record<string, number> };
    expect(addXp(reg, s, 59)).toBe(0);
    expect(addXp(reg, s, 1 + xpToNext(2))).toBe(2);
    expect(s.level).toBe(3);
    expect(freePoints(reg, s)).toBe(2);
    expect(learn(reg, s, 'fighter_1')).toBe(true);
    expect(learn(reg, s, 'fighter_1')).toBe(true);
    expect(learn(reg, s, 'fighter_1')).toBe(false); // очков нет
    expect(skillEffect(reg, s.skills, 'meleeDamage')).toBeCloseTo(0.2);
  });

  it('requiresSkill «engineer_2» = 2 очка в ветке Инженер', () => {
    expect(hasSkill(reg, { engineer_1: 1 }, 'engineer_2')).toBe(false);
    expect(hasSkill(reg, { engineer_1: 1, engineer_3: 1 }, 'engineer_2')).toBe(true);
    expect(branchPoints(reg, { engineer_1: 1, fighter_1: 3 }, 'engineer')).toBe(1);
    expect(skillEffect(reg, { gatherer_1: 2 }, 'extraResourceChance')).toBeCloseTo(0.35);
  });

  it('уровень не выше 40', () => {
    const s = { level: 39, xp: 0, skills: {} };
    addXp(reg, s, 1e9);
    expect(s.level).toBe(40);
  });
});

describe('Боссы', () => {
  const ev: BossEvent[] = [];
  let seed = 0;
  const rng = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const run = (b: Boss, hero: { x: number; y: number }, sec: number, from = 0) => {
    for (let t = from; t < from + sec; t += 0.05)
      b.tick({ now: t, dt: 0.05, hero: { ...hero, alive: true }, rng, emit: (e) => ev.push(e) });
  };

  it('зоны: круг, конус, полоса', () => {
    expect(inZone({ kind: 'circle', x: 0, y: 0, r: 2 }, 1.5, 0)).toBe(true);
    expect(inZone({ kind: 'cone', x: 0, y: 0, r: 3, dir: 0, deg: 90 }, 2, 0.5)).toBe(true);
    expect(inZone({ kind: 'cone', x: 0, y: 0, r: 3, dir: 0, deg: 90 }, -2, 0)).toBe(false);
    expect(inZone({ kind: 'line', x0: 0, y0: 0, x1: 6, y1: 0, w: 1 }, 3, 0.4)).toBe(true);
    expect(inZone({ kind: 'line', x0: 0, y0: 0, x1: 6, y1: 0, w: 1 }, 3, 1.2)).toBe(false);
  });

  it('Мясник спит до входа, каждая атака — с красной зоной 0.8–1.2 с, фаза 2 зовёт 4 бродяг', () => {
    ev.length = 0;
    const b = new Boss(reg, reg.bosses.require('butcher'), 0, -2, { x: 0, y: 0, r: 9 });
    run(b, { x: 20, y: 0 }, 1);
    expect(b.state).toBe('sleep');
    run(b, { x: 0, y: 2 }, 8, 1);
    expect(b.state).toBe('fight');
    const tels = ev.filter((e) => e.type === 'telegraph');
    expect(tels.length).toBeGreaterThan(1);
    for (const e of tels)
      if (e.type === 'telegraph') {
        const d = e.t.end - e.t.start;
        expect(d).toBeGreaterThanOrEqual(0.8 - 1e-9);
        expect(d).toBeLessThanOrEqual(1.2 + 1e-9);
      }
    expect(ev.some((e) => e.type === 'hit')).toBe(true);
    b.hurt(b.maxHp * 0.55, 0, 2, { melee: true, now: 10 });
    run(b, { x: 0, y: 2 }, 0.2, 10);
    expect(b.phase).toBe(2);
    expect(ev.some((e) => e.type === 'summon' && e.id === 'walker' && e.n === 4)).toBe(true);
    b.hurt(1e6, 0, 2, { melee: true, now: 11 });
    run(b, { x: 0, y: 2 }, 0.1, 11);
    expect(b.state).toBe('dead');
    expect(ev.some((e) => e.type === 'died')).toBe(true);
  });

  it('щит «Мороза» снимает только электричество', () => {
    const b = new Boss(reg, reg.bosses.require('frost'), 0, 0, { x: 0, y: 0, r: 9 });
    b.state = 'fight';
    expect(b.hurt(100, 1, 0, { melee: true, now: 0 }).blocked).toBe(true);
    expect(b.hurt(100, 1, 0, { melee: false, now: 0, specials: ['shock_breaks_shield'] }).dmg).toBe(100);
  });

  it('Тиран: таран, укус, хвост, рёв; фазы на 60% и 25%', () => {
    ev.length = 0;
    const b = new Boss(reg, reg.bosses.require('tyrant'), 0, -2, { x: 0, y: 0, r: 9 });
    run(b, { x: 0, y: 1 }, 15);
    const kinds = new Set(
      ev.filter((e) => e.type === 'telegraph').map((e) => (e.type === 'telegraph' ? e.t.attack : '')),
    );
    expect(kinds.size).toBeGreaterThan(1);
    b.hurt(b.maxHp * 0.45, 0, 1, { melee: false, now: 15 });
    run(b, { x: 0, y: 1 }, 0.1, 15);
    expect(b.phase).toBe(2);
    b.hurt(b.maxHp * 0.4, 0, 1, { melee: false, now: 16 });
    run(b, { x: 0, y: 1 }, 0.1, 16);
    expect(b.phase).toBe(3);
  });
});

describe('Боссы 4–6 (полные)', () => {
  const evs: BossEvent[] = [];
  let seed = 7;
  const rng = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const run = (b: Boss, hero: { x: number; y: number }, sec: number, from = 0) => {
    for (let t = from; t < from + sec; t += 0.05)
      b.tick({ now: t, dt: 0.05, hero: { ...hero, alive: true }, rng, emit: (e) => evs.push(e) });
  };
  const attacks = () =>
    new Set(evs.filter((e) => e.type === 'telegraph').map((e) => (e.type === 'telegraph' ? e.t.attack : '')));

  it('Пожиратель: атаки с поверхности → под землю бугром → выход под героем; в броне урон ×armorMul', () => {
    evs.length = 0;
    const b = new Boss(reg, reg.bosses.require('devourer'), 0, -2, { x: 0, y: 0, r: 9 });
    run(b, { x: 0, y: 1.5 }, 40);
    const a = attacks();
    expect(a.has('emerge')).toBe(true);
    expect(a.has('burrow')).toBe(true);
    expect(a.has('sweep') || a.has('spit')).toBe(true);
    // Вне окна уязвимости — броня.
    const b2 = new Boss(reg, reg.bosses.require('devourer'), 0, 0, { x: 0, y: 0, r: 9 });
    b2.state = 'fight';
    const armor = (reg.prog.bosses['devourer'] as Record<string, number>)['armorMul']!;
    expect(b2.hurt(100, 0, 1, { melee: false, now: 100 }).dmg).toBeCloseTo(100 * armor);
  });

  it('Мороз: удар в щит — событие blocked; дыхание холодит; во 2-й фазе урон по ядру ×coreDamageMul', () => {
    evs.length = 0;
    const b = new Boss(reg, reg.bosses.require('frost'), 0, -2, { x: 0, y: 0, r: 9 });
    run(b, { x: 0, y: 0.5 }, 0.2);
    b.hurt(10, 0, 0, { melee: true, now: 0.2 });
    expect(evs.some((e) => e.type === 'blocked')).toBe(true);
    run(b, { x: 0, y: 0.5 }, 30, 0.3);
    expect(attacks().has('stomp')).toBe(true);
    expect(evs.some((e) => e.type === 'chill')).toBe(true);
    b.phase = 2;
    b.shield = false;
    const mul = (reg.prog.bosses['frost'] as Record<string, number>)['coreDamageMul']!;
    expect(b.hurt(10, 0, 0, { melee: false, now: 40 }).dmg).toBeCloseTo(10 * mul);
  });

  it('Пациент Ноль: щупальца из труб по краю арены, сферы оставляют радиацию, сектора — с фазы 2', () => {
    evs.length = 0;
    const b = new Boss(reg, reg.bosses.require('zero'), 0, -2, { x: 0, y: 0, r: 9 });
    run(b, { x: 0, y: 4 }, 25);
    expect(attacks().has('tentacles')).toBe(true);
    const tent = evs.find((e) => e.type === 'telegraph' && e.t.attack === 'tentacles');
    if (tent?.type === 'telegraph' && tent.t.shape.kind === 'line')
      expect(Math.hypot(tent.t.shape.x0, tent.t.shape.y0)).toBeCloseTo(9, 3);
    expect(attacks().has('sectors')).toBe(false);
    expect(evs.some((e) => e.type === 'pools' && e.kind === 'rad')).toBe(true);
  });
});

describe('Задания и записки', () => {
  it('3 ежедневных задания в сутки, прогресс по событиям, +1 за рекламу', () => {
    const q = emptyQuests();
    expect(refreshDaily(reg, q, 1, 100, 2)).toBe(true);
    expect(q.daily.length).toBe(3);
    expect(refreshDaily(reg, q, 1, 100, 2)).toBe(false);
    const g = q.daily.find((t) => t.type === 'gather') ?? q.daily[0]!;
    g.type = 'gather';
    g.target = 'wood';
    g.n = 5;
    const done = onQuestEvent(q, { type: 'gather', item: 'wood', n: 6 });
    expect(done).toContain(g);
    expect(addExtraTask(reg, q, 1, 2)).not.toBeNull();
    expect(addExtraTask(reg, q, 1, 2)).toBeNull();
    expect(q.daily.length).toBe(4);
  });

  it('записки: сначала стартовая, потом по биомам; 12–18 штук', () => {
    expect(reg.prog.notes.length).toBeGreaterThanOrEqual(12);
    expect(reg.prog.notes.length).toBeLessThanOrEqual(18);
    const q = emptyQuests();
    expect(nextNote(reg, q, 1)?.at).toBe('start');
    q.notesRead.push('n01');
    expect(nextNote(reg, q, 1)?.biome).toBe(1);
  });
});

describe('Обучение', () => {
  it('шаги засчитываются по событиям; можно пропустить', () => {
    const t = newTutorial();
    expect(tutorialEvent(reg, t, { type: 'moved', tiles: 3 })).toBe(true);
    expect(tutorialEvent(reg, t, { type: 'gather', item: 'fiber', n: 5 })).toBe(false);
    expect(tutorialEvent(reg, t, { type: 'gather', item: 'sticks', n: 4 })).toBe(true);
    expect(t.step).toBe(2);
    skipTutorial(t);
    expect(t.done).toBe(true);
  });
});

describe('Транспорт', () => {
  const free = (dx: number, dy: number) => ({ dx, dy });
  it('разгон с инерцией, чужая местность ×0.3, топливо по пути', () => {
    const v = Vehicle.create(reg, 'pickup', 'v1', 0, 0);
    v.s.fuel = 10;
    v.tick({ x: 1, y: 0 }, 'asphalt_cracked', 0.1, free);
    expect(v.speed).toBeLessThan(v.maxSpeed);
    for (let i = 0; i < 20; i++) v.tick({ x: 1, y: 0 }, 'asphalt_cracked', 0.05, free);
    expect(v.speed).toBeCloseTo(v.maxSpeed);
    expect(v.s.fuel).toBeLessThan(10);
    const q = Vehicle.create(reg, 'pickup', 'v2', 0, 0);
    q.s.fuel = 10;
    for (let i = 0; i < 40; i++) q.tick({ x: 1, y: 0 }, 'snow', 0.05, free);
    expect(q.speed).toBeCloseTo(q.maxSpeed * reg.prog.vehicles.offTerrainMul);
    expect(Vehicle.create(reg, 'snowcat', 'v3', 0, 0).fits('snow')).toBe(true);
  });

  it('без топлива стоит, велосипеду не нужно; удар ломает; ключ чинит', () => {
    const m = Vehicle.create(reg, 'moped', 'v4', 0, 0);
    m.s.fuel = 0;
    for (let i = 0; i < 20; i++) m.tick({ x: 1, y: 0 }, 'dirt', 0.05, free);
    expect(m.speed).toBe(0);
    const b = Vehicle.create(reg, 'bicycle', 'v5', 0, 0);
    for (let i = 0; i < 20; i++) b.tick({ x: 1, y: 0 }, 'dirt', 0.05, free);
    expect(b.speed).toBeGreaterThan(0);
    const hp = b.s.hp;
    b.tick({ x: 1, y: 0 }, 'dirt', 0.05, () => ({ dx: 0, dy: 0 }));
    expect(b.s.hp).toBeLessThan(hp);
    expect(b.repair()).toBe(true);
  });

  it('все 7 машин собираются на смотровой яме', () => {
    for (const v of reg.vehicles.all) {
      const r = reg.recipes.byOutput(v.id)[0];
      expect(r?.station, v.id).toBe('repair_pit');
    }
  });
});
