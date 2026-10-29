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
import { pickHealItem, useItem } from '../src/core/systems/Consumables';
import { Rng } from '../src/core/util/rng';
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

  it('погода: холод сверх биома, жажда, радиация — противогаз защищает', () => {
    const rates = createPlatformConfig(reg.balance, 'yandex', false).survival;
    const W = reg.worldgen['weather'] as { types: Record<string, { effects?: Record<string, number> }> };
    // Метель в тундре ночью холоднее, чем без неё.
    const snow = env({ biome: 5, night: true, day: false, weather: W.types['snow']!.effects });
    expect(targetTemperature(def, snow)).toBeLessThan(
      targetTemperature(def, env({ biome: 5, night: true, day: false })),
    );
    // Буря: жажда ×1.3.
    const a = createVitals(p.hp, def);
    const b = createVitals(p.hp, def);
    for (let i = 0; i < 60 / TICK; i++) {
      stepSurvival(a, def, rates, p.hp, env({ biome: 1 }), TICK);
      stepSurvival(b, def, rates, p.hp, env({ biome: 1, weather: { thirstMul: 1.3 } }), TICK);
    }
    expect(100 - b.thirst).toBeCloseTo((100 - a.thirst) * 1.3, 3);
    // Ядовитая дымка: радиация растёт; противогаз (radRes) режет её.
    const r1 = createVitals(p.hp, def);
    const r2 = createVitals(p.hp, def);
    for (let i = 0; i < 10 / TICK; i++) {
      stepSurvival(r1, def, rates, p.hp, env({ biome: 1, weather: { radPerSec: 1 } }), TICK);
      stepSurvival(r2, def, rates, p.hp, env({ biome: 1, radRes: 0.9, weather: { radPerSec: 1 } }), TICK);
    }
    expect(r1.radiation).toBeCloseTo(10, 3);
    expect(r2.radiation).toBeCloseTo(1, 3);
  });

  it('навыки: «Выносливый желудок» медленнее голод, «Лекарь» сильнее лечит', () => {
    const rates = createPlatformConfig(reg.balance, 'yandex', false).survival;
    const a = createVitals(p.hp, def);
    const b = createVitals(p.hp, def);
    for (let i = 0; i < 60 / TICK; i++) {
      stepSurvival(a, def, rates, p.hp, env(), TICK);
      stepSurvival(b, def, rates, p.hp, env({ needsMul: 0.7 }), TICK);
    }
    expect(100 - b.hunger).toBeCloseTo((100 - a.hunger) * 0.7, 3);
    const v1 = createVitals(p.hp, def);
    const v2 = createVitals(p.hp, def);
    v1.hp = 10;
    v2.hp = 10;
    const m = createMoveState(p);
    useItem(reg, 'bandage', v1, m, new Rng(1));
    useItem(reg, 'bandage', v2, m, new Rng(1), 1.6);
    expect(v2.hp - 10).toBeCloseTo((v1.hp - 10) * 1.6, 3);
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

describe('Кнопка «Аптечка» и еда', () => {
  const bag = (items: Record<string, number>) => (id: string) => items[id] ?? 0;

  it('хорошая еда лечит больше простой', () => {
    const hp = (id: string) => Number(reg.items.require(id)['health'] ?? 0);
    expect(hp('berries')).toBeGreaterThan(0);
    expect(hp('meat_grilled')).toBeGreaterThan(hp('meat_raw'));
    expect(hp('ration')).toBeGreaterThan(hp('canned_food'));
    expect(hp('canned_food')).toBeGreaterThan(hp('berries'));
  });

  it('сначала лекарство, которого хватает; без лекарств — еда; при полном здоровье — ничего', () => {
    const v = createVitals(p.hp, def);
    const have = bag({ bandage: 2, medkit: 1, berries: 5 });
    expect(pickHealItem(reg, have, v)).toBeNull();
    v.hp = p.hp - 10;
    expect(pickHealItem(reg, have, v)).toBe('bandage');
    v.hp = p.hp - 50;
    expect(pickHealItem(reg, have, v)).toBe('medkit');
    expect(pickHealItem(reg, bag({ berries: 5, meat_grilled: 1 }), v)).toBe('meat_grilled');
    expect(pickHealItem(reg, bag({}), v)).toBeNull();
    // Кровотечение — то, что его останавливает, даже при полном здоровье.
    v.hp = p.hp;
    v.conditions.bleeding = true;
    expect(pickHealItem(reg, bag({ herbal_poultice: 1, bandage: 1 }), v)).toBe('bandage');
  });
});
