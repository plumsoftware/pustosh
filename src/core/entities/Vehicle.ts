import type { Registry } from '../data/Registry';
import type { VehicleDef } from '../data/schemas';
import type { ItemStack } from '../world/types';

/** Сохраняемое состояние машины. */
export interface VehicleSave {
  uid: string;
  id: string;
  x: number;
  y: number;
  /** Смотрит вправо (1) или влево (-1) — спрайты сбоку. */
  dir: 1 | -1;
  hp: number;
  fuel: number;
  trunk: (ItemStack | null)[];
  mods: string[];
  /** Пройдено всего — угол колёс и прокрутка гусеницы. */
  odo: number;
}

/**
 * Машина (TZ 9.4): инерция (разгон accelSec, торможение brakeSec), скорость × speedMul, на чужой местности
 * ×offTerrainMul, расход топлива fuelPer100Tiles, поломка при ударах, таран врагов (мото, пикап).
 */
export class Vehicle {
  readonly def: VehicleDef;
  vx = 0;
  vy = 0;
  /** Последний шаг: ускорение (для наклона корпуса) и местность. */
  accel = 0;
  terrain = '';
  constructor(
    private readonly reg: Registry,
    readonly s: VehicleSave,
  ) {
    this.def = reg.vehicles.require(s.id);
  }

  static create(reg: Registry, id: string, uid: string, x: number, y: number): Vehicle {
    const def = reg.vehicles.require(id);
    return new Vehicle(reg, {
      uid,
      id,
      x,
      y,
      dir: 1,
      hp: def.hp,
      fuel: def.fuelPer100Tiles > 0 ? 5 : 0,
      trunk: Array.from({ length: def.trunkSlots }, () => null),
      mods: [],
      odo: 0,
    });
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  get maxSpeed(): number {
    return this.reg.prog.vehicles.baseSpeedTilesPerSec * this.def.speedMul;
  }

  get needsFuel(): boolean {
    return this.def.fuelPer100Tiles > 0;
  }

  get broken(): boolean {
    return this.s.hp <= 0;
  }

  /** Местность под колёсами по имени тайла (progression.json → vehicles.terrainOfTile). */
  terrainOf(tile: string): string {
    for (const [t, tiles] of Object.entries(this.reg.prog.vehicles.terrainOfTile))
      if (tiles.includes(tile)) return t;
    return 'dirt';
  }

  /** Своя ли местность (terrain машины). */
  fits(terrain: string): boolean {
    return this.def.terrain.includes(terrain);
  }

  /**
   * Шаг управления: ввод (стик/клавиши, длина ≤ 1) → целевая скорость; инерция; топливо.
   * move(dx, dy) — сдвиг с коллизиями, возвращает фактический сдвиг; удар о препятствие ломает машину.
   */
  tick(
    input: { x: number; y: number },
    tile: string,
    dt: number,
    move: (dx: number, dy: number) => { dx: number; dy: number },
    fuelMul = 1,
  ): { moved: number; crash: number } {
    const V = this.reg.prog.vehicles;
    this.terrain = this.terrainOf(tile);
    const terrainMul = this.fits(this.terrain) ? 1 : V.offTerrainMul;
    const noFuel = this.needsFuel && this.s.fuel <= 0;
    const max = this.broken || noFuel ? 0 : this.maxSpeed * terrainMul;
    const len = Math.min(1, Math.hypot(input.x, input.y));
    const tx = len > 0.05 ? (input.x / (Math.hypot(input.x, input.y) || 1)) * max * len : 0;
    const ty = len > 0.05 ? (input.y / (Math.hypot(input.x, input.y) || 1)) * max * len : 0;
    const before = this.speed;
    const rate = (len > 0.05 ? this.maxSpeed / V.accelSec : this.maxSpeed / V.brakeSec) * dt;
    const step = (cur: number, want: number) =>
      Math.abs(want - cur) <= rate ? want : cur + Math.sign(want - cur) * rate;
    this.vx = step(this.vx, tx);
    this.vy = step(this.vy, ty);
    this.accel = (this.speed - before) / Math.max(dt, 1e-6);
    if (Math.abs(this.vx) > 0.1) this.s.dir = this.vx < 0 ? -1 : 1;
    const want = { dx: this.vx * dt, dy: this.vy * dt };
    const got = move(want.dx, want.dy);
    const moved = Math.hypot(got.dx, got.dy);
    this.s.x += got.dx;
    this.s.y += got.dy;
    this.s.odo += moved;
    // Упёрлись — удар: урон от потерянной скорости.
    const lost = Math.hypot(want.dx - got.dx, want.dy - got.dy) / Math.max(dt, 1e-6);
    let crash = 0;
    if (lost > 2) {
      crash = lost * V.collisionDamagePerSpeed * dt * 10;
      this.s.hp = Math.max(0, this.s.hp - crash);
      this.vx *= 0.3;
      this.vy *= 0.3;
    }
    if (this.needsFuel)
      this.s.fuel = Math.max(0, this.s.fuel - (moved / 100) * this.def.fuelPer100Tiles * fuelMul);
    return { moved, crash };
  }

  /** Таранит ли слабых врагов (мото, пикап) на текущей скорости — урон. */
  ramDamage(): number {
    const V = this.reg.prog.vehicles;
    if (!V.ramIds.includes(this.def.id) || this.speed < V.ramMinSpeed) return 0;
    return this.speed * V.ramDamagePerSpeed;
  }

  /** Ремонт ключом: +repairPerHit от максимума. */
  repair(): boolean {
    if (this.s.hp >= this.def.hp) return false;
    this.s.hp = Math.min(this.def.hp, this.s.hp + this.def.hp * this.reg.prog.vehicles.repairPerHit);
    return true;
  }
}
