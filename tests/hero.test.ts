import { describe, expect, it } from 'vitest';
import { createPlatformConfig } from '../src/core/config/PlatformConfig';
import { loadGameData } from '../src/core/data';
import { createMoveState, stepMovement } from '../src/core/systems/Movement';
import {
  createVitals,
  maxHp,
  stepSurvival,
  survivalSpeedMul,
  targetTemperature,
  type SurvivalEnv,
} from '../src/core/systems/Survival';
import { readAssetCatalog, readRawData } from '../tools/readGameFiles';

const reg = loadGameData(readRawData(), readAssetCatalog()).registry!;
const def = reg.survival;
const p = reg.balance.player;
const TICK = 0.05;
const env = (o: Partial<SurvivalEnv> = {}): SurvivalEnv => ({
  biome: 1,
  night: false,
  day: true,
  nearFire: false,
  coldRes: 0,
  heatRes: 0,
  radRes: 0,
  ...o,
});

describe('Выживание', () => {
  for (const platform of ['yandex', 'android']) {
    it(`голод и жажда за 10 игровых минут (${platform})`, () => {
      const rates = createPlatformConfig(reg.balance, platform, false).survival;
      const v = createVitals(p.hp, def);
      for (let i = 0; i < (10 * 60) / TICK; i++) stepSurvival(v, def, rates, p.hp, env(), TICK);
      expect(v.hunger).toBeCloseTo(100 - rates.hungerPerMin * 10, 3);
      expect(v.thirst).toBeCloseTo(100 - rates.thirstPerMin * 10, 3);
      expect(v.hp).toBe(p.hp);
    });
  }

  it('в пустыне днём жажда ×1.5', () => {
    const rates = createPlatformConfig(reg.balance, 'yandex', false).survival;
    const v = createVitals(p.hp, def);
    for (let i = 0; i < 60 / TICK; i++) stepSurvival(v, def, rates, p.hp, env({ biome: 4 }), TICK);
    expect(100 - v.thirst).toBeCloseTo(rates.thirstPerMin * 1.5, 3);
  });

  it('у костра ночью в тундре температура не уходит в урон', () => {
    const rates = createPlatformConfig(reg.balance, 'yandex', false).survival;
    const v = createVitals(p.hp, def);
    const e = env({ biome: 5, night: true, day: false, nearFire: true });
    expect(targetTemperature(def, e)).toBeGreaterThanOrEqual(def.temperature.comfort[0]);
    for (let i = 0; i < 120 / TICK; i++) stepSurvival(v, def, rates, p.hp, e, TICK);
    expect(v.hp).toBe(p.hp);
    // Без костра — холод, урон и замедление
    const cold = createVitals(p.hp, def);
    for (let i = 0; i < 120 / TICK; i++)
      stepSurvival(cold, def, rates, p.hp, env({ biome: 5, night: true, day: false }), TICK);
    expect(cold.hp).toBeLessThan(p.hp);
    expect(survivalSpeedMul(def, cold)).toBeCloseTo(def.temperature.outOfRangeSpeedMul);
  });

  it('у костра в тёплом биоме нет перегрева и урона', () => {
    const rates = createPlatformConfig(reg.balance, 'yandex', false).survival;
    const v = createVitals(p.hp, def);
    const e = env({ biome: 1, nearFire: true });
    expect(targetTemperature(def, e)).toBeLessThanOrEqual(def.temperature.comfort[1]);
    for (let i = 0; i < 120 / TICK; i++) stepSurvival(v, def, rates, p.hp, e, TICK);
    expect(v.hp).toBe(p.hp);
  });

  it('голод на нуле отнимает HP, радиация снижает максимум HP', () => {
    const rates = createPlatformConfig(reg.balance, 'yandex', false).survival;
    const v = createVitals(p.hp, def);
    v.hunger = 0;
    stepSurvival(v, def, rates, p.hp, env(), 1);
    expect(v.hp).toBeCloseTo(p.hp - def.needs.zeroHpLossPerSec);
    const r = createVitals(p.hp, def);
    for (let i = 0; i < 10 / TICK; i++) stepSurvival(r, def, rates, p.hp, env({ biome: 6 }), TICK);
    expect(r.radiation).toBeCloseTo(20, 3);
    expect(maxHp(p.hp, r)).toBeCloseTo(80, 3);
    expect(r.hp).toBeLessThanOrEqual(80 + 1e-9);
  });

  it('кровотечение и отравление; смерть', () => {
    const rates = { hungerPerMin: 0, thirstPerMin: 0, coldDmgPerSec: 0 };
    const v = createVitals(p.hp, def);
    v.conditions.poison = def.conditions.poison.durationSec;
    for (let i = 0; i < 20 / TICK; i++) stepSurvival(v, def, rates, p.hp, env(), TICK);
    expect(v.hp).toBeCloseTo(p.hp - def.conditions.poison.hpPerSec * def.conditions.poison.durationSec, 3);
    v.conditions.bleeding = true;
    let dead = false;
    for (let i = 0; i < 200 / TICK && !dead; i++) dead = stepSurvival(v, def, rates, p.hp, env(), TICK);
    expect(dead).toBe(true);
    expect(v.hp).toBe(0);
  });
});

describe('Движение', () => {
  const m = def.movement;
  it('шаг со скоростью игрока, бег ×sprintMul и трата выносливости 10/с', () => {
    const st = createMoveState(p);
    let x = 0;
    for (let i = 0; i < 20; i++)
      x += stepMovement(st, { x: 1, y: 0, sprint: false, dodge: false }, p, m, 1, true, TICK).dx;
    expect(x).toBeCloseTo(p.speedTilesPerSec, 5);
    x = 0;
    for (let i = 0; i < 20; i++)
      x += stepMovement(st, { x: 1, y: 0, sprint: true, dodge: false }, p, m, 1, true, TICK).dx;
    expect(x).toBeCloseTo(p.speedTilesPerSec * p.sprintMul, 5);
    expect(st.stamina).toBeCloseTo(p.stamina - m.sprintStaminaPerSec, 5);
  });

  it('без выносливости и при жажде на нуле бег отключается', () => {
    const st = createMoveState(p);
    st.stamina = 0;
    expect(stepMovement(st, { x: 1, y: 0, sprint: true, dodge: false }, p, m, 1, true, TICK).sprinting).toBe(
      false,
    );
    const st2 = createMoveState(p);
    expect(
      stepMovement(st2, { x: 1, y: 0, sprint: true, dodge: false }, p, m, 1, false, TICK).sprinting,
    ).toBe(false);
  });

  it('перекат: 1.5 клетки за 0.35 с, неуязвимость, стоимость', () => {
    const st = createMoveState(p);
    let x = 0;
    const first = stepMovement(st, { x: 1, y: 0, sprint: false, dodge: true }, p, m, 1, true, TICK);
    x += first.dx;
    expect(first.dodgeStarted).toBe(true);
    expect(st.iframes).toBeCloseTo(p.dodgeIFramesSec);
    expect(st.stamina).toBe(p.stamina - p.dodgeStamina);
    for (let i = 0; i < 20; i++)
      x += stepMovement(st, { x: 0, y: 0, sprint: false, dodge: false }, p, m, 1, true, TICK).dx;
    expect(x).toBeCloseTo(m.dodgeDistanceTiles, 5);
    expect(st.dodge).toBeNull();
  });

  it('местность и холод замедляют', () => {
    const st = createMoveState(p);
    const r = stepMovement(
      st,
      { x: 1, y: 0, sprint: false, dodge: false },
      p,
      m,
      m.terrainSpeedMul['water_shallow']!,
      true,
      1,
    );
    expect(r.dx).toBeCloseTo(p.speedTilesPerSec * 0.6, 5);
  });

  it('выносливость восстанавливается после паузы', () => {
    const st = createMoveState(p);
    st.stamina = 50;
    st.sinceStaminaUse = 0;
    for (let i = 0; i < 40; i++)
      stepMovement(st, { x: 0, y: 0, sprint: false, dodge: false }, p, m, 1, true, TICK);
    // Восстановление начинается после паузы staminaRegenDelaySec (с точностью до тика).
    expect(Math.abs(st.stamina - (50 + m.staminaRegenPerSec * (2 - m.staminaRegenDelaySec)))).toBeLessThan(
      m.staminaRegenPerSec * TICK * 1.5,
    );
  });
});

describe('Еда и медицина', async () => {
  const { useItem } = await import('../src/core/systems/Consumables');
  const { Rng } = await import('../src/core/util/rng');
  it('еда восполняет голод и жажду, бинт останавливает кровь, антирадин снимает радиацию', () => {
    const v = createVitals(p.hp, def);
    const st = createMoveState(p);
    v.hunger = 20;
    v.thirst = 10;
    expect(useItem(reg, 'canned_food', v, st, new Rng(1))).toBe('used');
    expect(v.hunger).toBe(50);
    expect(v.thirst).toBe(15);
    v.conditions.bleeding = true;
    v.hp = 50;
    useItem(reg, 'bandage', v, st, new Rng(1));
    expect(v.conditions.bleeding).toBe(false);
    expect(v.hp).toBe(65);
    v.radiation = 70;
    useItem(reg, 'antirad', v, st, new Rng(1));
    expect(v.radiation).toBe(20);
    expect(useItem(reg, 'wood', v, st, new Rng(1))).toBe('not_usable');
  });
});
