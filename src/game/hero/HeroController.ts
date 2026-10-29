import type { WeatherFx } from '../render/Weather';
import type { Registry } from '../../core/data/Registry';
import type { PlatformConfig } from '../../core/config/PlatformConfig';
import { createMoveState, stepMovement, type MoveState } from '../../core/systems/Movement';
import {
  applyDamage,
  createVitals,
  maxHp,
  outOfComfort,
  stepSurvival,
  survivalSpeedMul,
  type Vitals,
} from '../../core/systems/Survival';
import type { DayNightState } from '../../core/systems/DayNight';
import { moveCircle, type ItemStack, type World, type WorldObject } from '../../core/world';
import { PlayerInventory, type PlayerInventorySave } from '../../core/inventory';
import {
  findInteractable,
  hitObject,
  respawnSec,
  rollDrops,
  type HitResult,
  type Interactable,
} from '../../core/systems/Harvest';
import { containerInfo } from '../../core/systems/Loot';
import { isCraftStation } from '../../core/systems/Craft';
import { isDefenseInteractable } from '../../core/systems/Defense';
import { Rng } from '../../core/util/rng';
import { GameClock } from '../../core/util/GameClock';
import { t } from '../../core/i18n/i18n';
import type { InputMapper } from '../input/InputMapper';
import { TILE } from '../render/GroundTiles';
import type { AnimName } from '../rig/Animations';
import { HeroView } from './HeroView';
import { angleOf, isGun, isMelee, weaponStats, type WeaponStats } from '../../core/systems/Combat';
import { skillEffect } from '../../core/systems/Progress';

/** Что из героя попадает в сохранение (SaveGame.hero). */
export interface HeroSave {
  x: number;
  y: number;
  vitals?: Vitals;
  stamina?: number;
  /** Точка возрождения (кровать/спальник — шаг 7); нет — бункер старта. */
  respawn?: { x: number; y: number } | null;
  inventory?: PlayerInventorySave;
}

/** Бой героя (шаг 8): цели и разрешение ударов — у EnemyManager. */
export interface HeroCombat {
  aim(faceDeg: number, range: number): { x: number; y: number } | null;
  melee(w: WeaponStats, faceDeg: number): number;
  shoot(w: WeaponStats, faceDeg: number, muzzle: { x: number; y: number }): void;
  throwAt(w: WeaponStats, tx: number, ty: number): void;
  flame(w: WeaponStats, faceDeg: number, dt: number): void;
  skills(): Readonly<Record<string, number>>;
}

/** Анимация героя по виду оружия. */
const ATTACK_ANIM: Record<string, AnimName> = {
  fist: 'attack_blunt',
  melee_blunt: 'attack_blunt',
  melee_slash: 'attack_slash',
  melee_pierce: 'attack_pierce',
  ranged: 'shoot',
  firearm: 'shoot',
  energy: 'shoot',
  throwable: 'throw',
  flame: 'shoot',
};

export interface HeroEvents {
  onDeath(): void;
  /** Удар по объекту; finished — объект добыт, drops — выпавшие на землю предметы. */
  onHarvest(o: WorldObject, hit: HitResult, finished: boolean, drops: WorldObject[]): void;
  onPickup(drop: WorldObject, stack: ItemStack): void;
  onOpenContainer(o: WorldObject): void;
  /** Подсказка игроку (ключ строки и параметры). */
  onHint(key: string, params?: Record<string, string | number>): void;
  /** «Собрать» без цели: машина рядом, ворота… true — действие обработано. */
  onFreeAction?(): boolean;
  /** Герой получил урон (для статистики). */
  onDamaged?(amount: number): void;
}

/** Анимация добычи по типу инструмента (ANIMATIONS §1). */
const GATHER_ANIM: Record<string, AnimName> = {
  pickaxe: 'gather_dig',
  shovel: 'gather_dig',
  wrench: 'gather_wrench',
  knife: 'gather_knife',
};
/** Подсказки повторяются не чаще, тиков. */
const HINT_COOLDOWN_TICKS = 40;

/**
 * Герой: движение (бег, перекат, местность), выживание, действия, смерть и возрождение.
 * Логика — в тиках GameClock; вид (HeroView) обновляется каждый кадр с интерполяцией.
 */
export class HeroController {
  pos = { x: 0, y: 0 };
  prev = { x: 0, y: 0 };
  readonly move: MoveState;
  vitals: Vitals;
  readonly view: HeroView;
  dead = false;
  respawn: { x: number; y: number } | null = null;
  /** Хватка ползуна: стоит до этого момента (игровые секунды). */
  rootedUntil = 0;
  /** Сидит в машине: не ходит и не бьёт, не рисуется; команды уходят WorldScene. */
  inVehicle = false;
  /** Погода вокруг (ставит WorldScene; в укрытии — пусто): температура, жажда, радиация, скорость. */
  weather: WeatherFx = {};
  combat: HeroCombat | null = null;
  /** Патроны в магазине по id оружия (перезарядка — reloadSec). */
  private mags = new Map<string, number>();
  private reloadUntil = 0;
  private fuelAcc = 0;
  private strike: { ticks: number; w: WeaponStats; face: number } | null = null;
  /** Куда целится ПК (мир, px) для бросков. */
  private aimPoint: { x: number; y: number } | null = null;
  private facing: 1 | -1 = 1;
  private moving = false;
  get isMoving(): boolean {
    return this.moving;
  }
  private sprinting = false;
  private dodging = false;
  private readonly baseHp: number;
  private readonly radius: number;
  readonly inv: PlayerInventory;
  /** Ближайшая цель действия (подсветка ярче, иконка над ней, «умная» кнопка). */
  target: Interactable | null = null;
  private actionCd = 0;
  private pending: { target: Interactable; ticks: number } | null = null;
  /** Прогресс добычи по объектам (не сохраняется: незаконченная добыча сбрасывается). */
  private progress = new Map<string, { p: number; wrong: boolean }>();
  private hintCd = 0;
  /** Выброшенное игроком не подбирается, пока герой не отойдёт за радиус подбора. */
  private readonly ignorePickup = new Set<string>();
  private heldShown: string | null | undefined = undefined;
  private headShown: string | null | undefined = undefined;
  private readonly rng = new Rng((Math.random() * 2 ** 32) >>> 0);
  /** Игровые секунды мира (срок жизни дропа, восстановление ресурсов). */
  nowSec = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly reg: Registry,
    private readonly config: PlatformConfig,
    private readonly world: World,
    private readonly faceDepth: number,
    saved: HeroSave,
    private readonly events: HeroEvents,
  ) {
    const p = reg.balance.player;
    this.baseHp = p.hp;
    this.move = createMoveState(p);
    this.vitals = saved.vitals ? structuredClone(saved.vitals) : createVitals(p.hp, reg.survival);
    if (saved.stamina !== undefined) this.move.stamina = saved.stamina;
    this.respawn = saved.respawn ?? null;
    this.pos = { x: saved.x, y: saved.y };
    this.prev = { ...this.pos };
    const col = reg.worldgen.colliders['hero'];
    this.radius = col && 'radiusTiles' in col ? (col.radiusTiles as number) : 0.22;
    this.view = new HeroView(scene, reg, this.pos.x * TILE, this.pos.y * TILE);
    this.inv = new PlayerInventory(reg, saved.inventory);
  }

  /** +HP от навыка «Живучесть» (шаг 9). */
  bonusHp = 0;

  get maxHp(): number {
    return maxHp(this.baseHp + this.bonusHp, this.vitals);
  }

  get stamina(): number {
    return this.move.stamina;
  }

  toSave(): HeroSave {
    return {
      x: this.pos.x,
      y: this.pos.y,
      vitals: structuredClone(this.vitals),
      stamina: this.move.stamina,
      respawn: this.respawn,
      inventory: this.inv.toJSON(),
    };
  }

  teleport(x: number, y: number): void {
    this.pos = { x, y };
    this.prev = { x, y };
  }

  // ------------------------------------------------------------------ тик

  tick(
    dt: number,
    input: InputMapper,
    day: DayNightState,
    aimWorld: { x: number; y: number } | null,
    nowSec: number,
  ): void {
    this.prev = { ...this.pos };
    this.nowSec = nowSec;
    if (this.dead) return;
    const reg = this.reg;
    const cell = this.world.cell(Math.floor(this.pos.x), Math.floor(this.pos.y));
    this.actionCd = Math.max(0, this.actionCd - 1);
    this.hintCd = Math.max(0, this.hintCd - 1);

    // Действия из очереди ввода (остальные команды разбирает WorldScene).
    let dodge = false;
    for (const c of input.take()) {
      if (this.inVehicle) {
        this.passthrough.push(c);
        continue;
      }
      if (c.type === 'dodge') dodge = true;
      else if (c.type === 'attack' || c.type === 'action')
        this.startAction(c.type, c.aim ?? (c.type === 'attack' ? aimWorld : null));
      else this.passthrough.push(c);
    }
    // Зажатая «Собрать» повторяет добычу цели, зажатый «Удар» — атаку (раздельно).
    if (this.actionCd === 0 && !this.pending && !this.strike && !this.inVehicle) {
      if (input.attackHeld) this.startAction('attack', aimWorld);
      else if (input.actionHeld && this.target?.kind === 'harvest') this.startAction('action', null);
    }
    this.tickPending();
    this.tickStrike();

    // Движение: местность (вода, грязь, снег) × тело (холод, перелом).
    const tileName = this.world.tileNames[cell.tile] ?? '';
    const terrain = cell.floor ? 1 : (reg.survival.movement.terrainSpeedMul[tileName] ?? 1);
    const mv = nowSec < this.rootedUntil || this.inVehicle ? { x: 0, y: 0 } : input.move;
    const r = stepMovement(
      this.move,
      { x: mv.x, y: mv.y, sprint: input.sprint, dodge },
      // «Ловкость»: перекат дешевле по выносливости.
      {
        ...reg.balance.player,
        dodgeStamina: reg.balance.player.dodgeStamina * Math.max(0, 1 + this.skill('dodgeStamina')),
      },
      reg.survival.movement,
      terrain * survivalSpeedMul(reg.survival, this.vitals) * (this.weather.speedMul ?? 1),
      this.vitals.thirst > 0,
      dt,
    );
    this.moving = Math.hypot(mv.x, mv.y) > 0.05;
    this.sprinting = r.sprinting;
    this.dodging = r.dodging;
    if (r.dodgeStarted) this.view.dodge();
    if (Math.abs(mv.x) > 0.05 && !r.dodging) this.facing = mv.x < 0 ? -1 : 1;
    if (r.dx || r.dy)
      this.pos = moveCircle(this.world, this.pos.x, this.pos.y, this.radius, r.dx, r.dy, this.faceDepth);

    // Выживание
    const near = this.nearFire();
    const died = stepSurvival(
      this.vitals,
      reg.survival,
      this.config.survival,
      this.baseHp + this.bonusHp,
      {
        biome: cell.biome,
        night: day.phase === 'NIGHT' || day.darkness > 0.5,
        day: day.phase === 'DAY',
        nearFire: near,
        // «Закалка» +3 к холоду и жаре, «Иммунитет» −15% радиации за уровень.
        coldRes: this.inv.stat('coldRes') + this.skill('tempRes'),
        heatRes: this.inv.stat('heatRes') + this.skill('tempRes'),
        radRes: Math.min(0.95, this.inv.stat('radRes') / 100 - this.skill('radPoison')),
        weather: this.weather,
        // «Выносливый желудок»: голод и жажда медленнее.
        needsMul: Math.max(0, 1 + this.skill('needsRate')),
      },
      dt,
    );
    if (died) this.die();

    this.target = findInteractable(
      this.world,
      reg,
      this.pos.x,
      this.pos.y,
      this.move.faceX,
      this.move.faceY,
      (o) =>
        !!containerInfo(reg, o) ||
        isCraftStation(reg, o) ||
        isDefenseInteractable(reg, o) ||
        o.kind === 'gate',
    );
    this.autoPickup();
  }

  /** Команды, которые герой не обрабатывает (пауза, карта…) — забирает WorldScene. */
  passthrough: ReturnType<InputMapper['take']> = [];

  private hint(key: string, params?: Record<string, string | number>): void {
    if (this.hintCd > 0) return;
    this.hintCd = HINT_COOLDOWN_TICKS;
    this.events.onHint(key, params);
  }

  /**
   * Действие: открыть контейнер, ударить по добываемому объекту (удар — на хит-кадре анимации, в тиках),
   * без цели — взмах (бой — шаг 8). aim — точка мыши: герой поворачивается к ней.
   */
  private startAction(kind: 'action' | 'attack', aim: { x: number; y: number } | null): void {
    if (this.actionCd > 0 || this.pending || this.move.dodge) return;
    if (aim) {
      const dx = aim.x / TILE - this.pos.x;
      const dy = aim.y / TILE - this.pos.y;
      const d = Math.hypot(dx, dy) || 1;
      this.move.faceX = dx / d;
      this.move.faceY = dy / d;
      this.facing = dx < 0 ? -1 : 1;
      this.target = findInteractable(
        this.world,
        this.reg,
        this.pos.x,
        this.pos.y,
        this.move.faceX,
        this.move.faceY,
        (o) =>
          !!containerInfo(this.reg, o) ||
          isCraftStation(this.reg, o) ||
          isDefenseInteractable(this.reg, o) ||
          o.kind === 'gate',
      );
    } else if (Math.abs(this.move.faceX) > 0.05) this.facing = this.move.faceX < 0 ? -1 : 1;
    // «Удар» — всегда бой (даже если перед героем дерево); «Собрать» — только добыча и открытие.
    if (kind === 'attack') {
      this.attack(aim);
      return;
    }
    const gatherLoop =
      (this.reg.rigs.humanoid['animations'] as Record<string, { loopSec?: number }>)['gather']?.loopSec ??
      0.6;
    const cycle = Math.round((gatherLoop * 1000) / GameClock.TICK_MS);
    const t = this.target;
    if (t?.kind === 'container') {
      this.events.onOpenContainer(t.obj);
      this.actionCd = cycle;
      return;
    }
    if (t?.kind === 'harvest') {
      const held = this.inv.held;
      const tool = held ? this.reg.items.get(held.id)?.toolType : undefined;
      if (t.obj.x !== this.pos.x) this.facing = t.obj.x < this.pos.x ? -1 : 1;
      this.view.act(GATHER_ANIM[tool ?? ''] ?? 'gather');
      this.pending = { target: t, ticks: Math.round(cycle * 0.55) };
      this.actionCd = cycle;
      return;
    }
    if (this.events.onFreeAction?.()) return;
    this.hint('hint.nothing_here');
  }

  // ------------------------------------------------------------------ бой (шаг 8)

  /** Эффект навыков героя (progression.json → skillEffects). */
  private skill(key: string): number {
    const s = this.combat?.skills();
    return s ? skillEffect(this.reg, s, key) : 0;
  }

  private get faceDeg(): number {
    return angleOf(0, 0, this.move.faceX, this.move.faceY);
  }

  private setFace(deg: number): void {
    const a = (deg * Math.PI) / 180;
    this.move.faceX = Math.cos(a);
    this.move.faceY = Math.sin(a);
    if (Math.abs(this.move.faceX) > 0.05) this.facing = this.move.faceX < 0 ? -1 : 1;
  }

  private wear(): void {
    const held = this.inv.held;
    if (held?.durability === undefined || held.durability <= 0) return;
    held.durability -= 1;
    if (held.durability === 0)
      this.hint('hint.tool_broken', { name: this.reg.items.require(held.id).name_ru });
  }

  /**
   * Атака оружием в руке (TZ 8.1): автонаведение на ближайшую цель в секторе 90°; ближний бой — удар на
   * хит-кадре; огнестрел/энергия — магазин и перезарядка; лук/праща — снаряд за 1 боеприпас;
   * метательное — по дуге к прицелу; огнемёт — конус, тратит топливо.
   */
  private attack(aim: { x: number; y: number } | null): void {
    const reg = this.reg;
    const C = reg.combat;
    const w = weaponStats(reg, this.inv.held, this.combat?.skills() ?? {});
    this.aimPoint = aim;
    let face = this.faceDeg;
    const target = this.combat?.aim(face, Math.max(w.range, 2));
    if (target) face = angleOf(this.pos.x, this.pos.y, target.x, target.y);
    this.setFace(face);
    const rateTicks = Math.max(1, Math.round(1000 / (w.rate * GameClock.TICK_MS)));
    if (isMelee(w.kind)) {
      if (this.move.stamina < w.stamina) {
        this.hint('hint.no_stamina');
        return;
      }
      this.move.stamina -= w.stamina;
      this.move.sinceStaminaUse = 0;
      this.view.act(ATTACK_ANIM[w.kind]!);
      this.strike = { ticks: Math.max(2, Math.round(rateTicks * 0.45)), w, face };
      this.actionCd = rateTicks;
      return;
    }
    const muzzle = {
      x: this.pos.x * TILE + this.move.faceX * 26,
      y: this.pos.y * TILE - 46 + this.move.faceY * 10,
    };
    if (isGun(w.kind)) {
      if (this.nowSec < this.reloadUntil) return;
      const id = w.id!;
      const mag = this.mags.get(id) ?? 0;
      if (mag <= 0) {
        this.reload(w);
        return;
      }
      this.mags.set(id, mag - 1);
      this.view.act('shoot');
      this.combat?.shoot(w, face, muzzle);
      this.wear();
      this.actionCd = rateTicks;
      if (mag - 1 <= 0) this.reload(w);
      return;
    }
    if (w.kind === 'ranged') {
      if (!w.ammo || !this.inv.consume({ [w.ammo]: 1 })) {
        this.hint('combat.no_ammo', { ammo: reg.items.get(w.ammo ?? '')?.name_ru ?? '' });
        return;
      }
      this.view.act('shoot');
      this.combat?.shoot(w, face, muzzle);
      this.wear();
      this.actionCd = rateTicks;
      return;
    }
    if (w.kind === 'throwable') {
      const slot = this.inv.selected;
      const st = this.inv.hotbar.slots[slot];
      if (!st) return;
      this.inv.hotbar.take(slot, 1);
      this.view.act('throw');
      const tx = aim ? aim.x / TILE : this.pos.x + this.move.faceX * w.range;
      const ty = aim ? aim.y / TILE : this.pos.y + this.move.faceY * w.range;
      const d = Math.min(w.range, Math.hypot(tx - this.pos.x, ty - this.pos.y));
      const a = Math.atan2(ty - this.pos.y, tx - this.pos.x);
      this.combat?.throwAt(w, this.pos.x + Math.cos(a) * d, this.pos.y + Math.sin(a) * d);
      this.actionCd = Math.max(rateTicks, 10);
      return;
    }
    if (w.kind === 'flame') {
      const fuel = w.ammo ?? 'crude_oil';
      if (this.inv.count(fuel) <= 0 && this.fuelAcc <= 0) {
        this.hint('combat.no_ammo', { ammo: reg.items.get(fuel)?.name_ru ?? fuel });
        return;
      }
      this.fuelAcc -= C.specials.fuelPerShot;
      if (this.fuelAcc < 0) {
        this.inv.consume({ [fuel]: 1 });
        this.fuelAcc += 1;
      }
      this.combat?.flame(w, face, 1 / w.rate);
      this.actionCd = rateTicks;
    }
  }

  /** Перезарядка 1.2 с: патроны из инвентаря в магазин; энергия — 1 батарея на 1/batteryPerShot выстрелов. */
  private reload(w: WeaponStats): void {
    const reg = this.reg;
    if (!w.ammo || !w.id) return;
    const have = this.inv.count(w.ammo);
    if (have <= 0) {
      this.hint('combat.no_ammo', { ammo: reg.items.get(w.ammo)?.name_ru ?? w.ammo });
      return;
    }
    let n: number;
    if (w.kind === 'energy') {
      this.inv.consume({ [w.ammo]: 1 });
      n = Math.round(1 / (reg.combat.specials.batteryPerShot[w.id] ?? 0.05));
    } else {
      const need = w.magazine - (this.mags.get(w.id) ?? 0);
      n = Math.min(need, have);
      this.inv.consume({ [w.ammo]: n });
      n += this.mags.get(w.id) ?? 0;
    }
    this.mags.set(w.id, n);
    this.reloadUntil = this.nowSec + reg.combat.hero.reloadSec;
    this.hint('combat.reload');
  }

  /** Сколько патронов в магазине оружия в руке (для HUD). */
  get magInfo(): { mag: number; reloading: boolean } | null {
    const w = weaponStats(this.reg, this.inv.held);
    if (!isGun(w.kind) || !w.id) return null;
    return { mag: this.mags.get(w.id) ?? 0, reloading: this.nowSec < this.reloadUntil };
  }

  /** Хит-кадр ближнего удара. */
  private tickStrike(): void {
    const s = this.strike;
    if (!s || --s.ticks > 0) return;
    this.strike = null;
    const hits = this.combat?.melee(s.w, s.face) ?? 0;
    if (hits > 0) this.wear();
  }

  /** Хит-кадр добычи: прогресс, износ, выносливость; в конце — дроп и «добыто». */
  private tickPending(): void {
    const p = this.pending;
    if (!p || --p.ticks > 0) return;
    this.pending = null;
    if (p.target.kind !== 'harvest') return;
    const o = p.target.obj;
    if (o.state !== 'intact') return;
    const def = p.target.def;
    const held = this.inv.held;
    const hit = hitObject(this.reg, def, held && this.reg.items.get(held.id)?.toolType ? held : null);
    if (this.move.stamina < hit.stamina) {
      this.hint('hint.no_stamina');
      return;
    }
    this.move.stamina -= hit.stamina;
    this.move.sinceStaminaUse = 0;
    if (held?.durability !== undefined && hit.wear > 0) {
      const before = held.durability;
      // «Бережливость»: −15% износа за уровень.
      held.durability = Math.max(0, held.durability - hit.wear * Math.max(0, 1 + this.skill('toolWear')));
      if (before > 0 && held.durability === 0)
        this.hint('hint.tool_broken', { name: this.reg.items.require(held.id).name_ru });
    }
    const st = this.progress.get(o.uid) ?? { p: 0, wrong: false };
    st.p += hit.progress;
    st.wrong ||= !hit.proper;
    this.progress.set(o.uid, st);
    if (hit.need) this.hint('hint.need_tool', { tool: this.toolName(hit.need.tool), tier: hit.need.tier });
    const finished = st.p >= def.hits - 1e-9;
    let drops: WorldObject[] = [];
    if (finished) {
      this.progress.delete(o.uid);
      const items = rollDrops(this.reg, def, this.rng, st.wrong);
      // «Жадность»: шанс +1 ресурса с добычи.
      const greed = this.skill('extraResourceChance');
      for (const it of items) if (greed > 0 && this.rng.next() < greed) it.count++;
      // Дроп падает со стороны героя — так он гарантированно в радиусе автоподбора.
      const dx = this.pos.x - o.x;
      const dy = this.pos.y - o.y;
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.max(0.3, d - 0.7) / d;
      const cx = o.x + dx * k;
      const cy = o.y + dy * k;
      drops = items.map((it, i) => {
        const a = (i / Math.max(1, items.length)) * Math.PI * 2 + this.rng.next();
        return this.world.dropItem(it, cx + Math.cos(a) * 0.35, cy + Math.sin(a) * 0.25, this.nowSec);
      });
      this.world.markHarvested(o, this.nowSec + respawnSec(this.reg, o, this.rng));
    }
    this.events.onHarvest(o, hit, finished, drops);
  }

  private toolName(tool: string): string {
    return t(`tool.${tool}`);
  }

  /** Автоподбор дропа в радиусе pickupRadiusTiles; если места нет — «Нет места». */
  private autoPickup(): void {
    const R = this.reg.balance.player['pickupRadiusTiles'] as number;
    for (let ty = Math.floor(this.pos.y - R); ty <= Math.floor(this.pos.y + R); ty++) {
      for (let tx = Math.floor(this.pos.x - R); tx <= Math.floor(this.pos.x + R); tx++) {
        for (const o of this.world.objectsAt(tx, ty)) {
          if (o.kind !== 'drop' || !o.item) continue;
          if (Math.hypot(o.x - this.pos.x, o.y - this.pos.y) > R) {
            this.ignorePickup.delete(o.uid);
            continue;
          }
          if (this.ignorePickup.has(o.uid)) continue;
          if (this.inv.room(o.item) < o.item.count) {
            this.hint('hint.no_room');
            continue;
          }
          const stack = { ...o.item };
          this.inv.add(stack);
          this.world.pickUp(o);
          this.events.onPickup(o, stack);
        }
      }
    }
  }

  /** Предмет выбросили сами — не подбирать, пока не отойдём. */
  ignoreForPickup(uid: string): void {
    this.ignorePickup.add(uid);
  }

  /** Вид героя по инвентарю: предмет в руке (инструмент/оружие), головной убор. */
  private backpackShown: string | null | undefined = undefined;
  private bodyShown: string | null | undefined = undefined;

  private syncLook(): void {
    const held = this.inv.held;
    const def = held ? this.reg.items.get(held.id) : undefined;
    const icon = def && (def.category === 'tool' || def.category === 'weapon') ? def.icon : null;
    if (icon !== this.heldShown) {
      this.heldShown = icon;
      this.view.setHeldItem(icon);
    }
    const head = this.inv.equip.head ? (this.reg.items.get(this.inv.equip.head.id)?.heroHead ?? null) : null;
    if (head !== this.headShown) {
      this.headShown = head;
      this.view.setHeadgear(head);
    }
    const bp = this.inv.equip.backpack
      ? (this.reg.items.get(this.inv.equip.backpack.id)?.heroBackpack ?? null)
      : null;
    if (bp !== this.backpackShown) {
      this.backpackShown = bp;
      this.view.setBackpack(bp);
    }
    const body = this.inv.equip.body?.id ?? null;
    if (body !== this.bodyShown) {
      this.bodyShown = body;
      const hex = body ? this.reg.combat.bodyTint[body] : undefined;
      this.view.setBodyTint(hex ? parseInt(hex.slice(1), 16) : null);
    }
  }

  /** Горящий костёр в радиусе campfireRadiusTiles. */
  private nearFire(): boolean {
    const R = this.reg.survival.temperature.campfireRadiusTiles;
    for (let y = Math.floor(this.pos.y - R); y <= Math.floor(this.pos.y + R); y++) {
      for (let x = Math.floor(this.pos.x - R); x <= Math.floor(this.pos.x + R); x++) {
        for (const o of this.world.collidersAt(x, y)) {
          if (o.light && o.ref.type === 'station' && Math.hypot(o.x - this.pos.x, o.y - this.pos.y) <= R)
            return true;
        }
      }
    }
    return false;
  }

  /** Урон извне (враги — шаг 8; сейчас — отладка F10): гримаса, тинт, отброс. */
  damage(amount: number, fromX?: number): void {
    if (this.dead || this.move.iframes > 0) return;
    const dir = fromX !== undefined ? Math.sign(this.pos.x - fromX) || -this.facing : -this.facing;
    const k = this.reg.survival.movement.hurtKnockbackTiles;
    this.pos = moveCircle(this.world, this.pos.x, this.pos.y, this.radius, dir * k, 0, this.faceDepth);
    this.view.hurt();
    this.events.onDamaged?.(amount);
    if (applyDamage(this.vitals, amount)) this.die();
  }

  private die(): void {
    if (this.dead) return;
    this.dead = true;
    this.view.die(() => this.events.onDeath());
  }

  /**
   * Возрождение (ТЗ 4.5): на месте (за рекламу) — полное здоровье; иначе у кровати или в бункере,
   * здоровье × respawnHpMul. Голод и жажда — не ниже половины, состояния снимаются.
   */
  revive(inPlace: boolean, spawn: { x: number; y: number }): void {
    const max = this.maxHp;
    const s = this.reg.survival;
    this.vitals.hp = inPlace ? max : max * s.death.respawnHpMul;
    this.vitals.hunger = Math.max(this.vitals.hunger, s.needs.max / 2);
    this.vitals.thirst = Math.max(this.vitals.thirst, s.needs.max / 2);
    this.vitals.temperature = 0;
    this.vitals.conditions = { bleeding: false, poison: 0, infection: false, fracture: false };
    if (!inPlace) this.teleport(spawn.x, spawn.y);
    this.dead = false;
    this.pending = null;
    this.view.revive();
  }

  // ------------------------------------------------------------------ кадр

  render(dt: number, alpha: number): { x: number; y: number } {
    this.syncLook();
    this.view.displayObject.setVisible(!this.inVehicle);
    const x = (this.prev.x + (this.pos.x - this.prev.x) * alpha) * TILE;
    const y = (this.prev.y + (this.pos.y - this.prev.y) * alpha) * TILE;
    this.view.update(dt, x, y, {
      moving: this.moving && !this.dead,
      sprinting: this.sprinting,
      dodging: this.dodging,
      facing: this.facing,
      cold: outOfComfort(this.reg.survival, this.vitals) && this.vitals.temperature < 0,
    });
    return { x, y };
  }

  destroy(): void {
    this.view.destroy();
  }
}
