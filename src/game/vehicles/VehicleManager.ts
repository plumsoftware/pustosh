import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import type { Registry } from '../../core/data/Registry';
import { Vehicle, type VehicleSave } from '../../core/entities/Vehicle';
import { Inventory } from '../../core/inventory';
import { moveCircle } from '../../core/world';
import { getAssetInfo } from '../assets/AssetIndex';
import { AssetLoader } from '../assets/AssetLoader';
import { spawnSprite } from '../assets/spawnSprite';
import { DEPTH } from '../render/ChunkView';
import * as Fx from '../render/Fx';
import { TILE } from '../render/GroundTiles';
import { SceneKeys } from '../SceneKeys';
import type { MenuData, MenuItem } from '../scenes/MenuScene';
import { TOAST, type WorldScene } from '../scenes/WorldScene';

/** Где колёса (доля ширины корпуса от левого края, морда вправо). */
const WHEELS: Record<string, [number, number]> = {
  bicycle: [0.2, 0.79],
  moped: [0.23, 0.82],
  quad: [0.2, 0.78],
  moto_sidecar: [0.2, 0.83],
  pickup: [0.27, 0.8],
  buggy: [0.22, 0.8],
};
const R = 0.5;

interface View {
  body: Phaser.GameObjects.Image;
  wheels: Phaser.GameObjects.Image[];
  track?: Phaser.GameObjects.TileSprite;
  mods: Phaser.GameObjects.Image[];
  shadow: Phaser.GameObjects.Image;
  nextSmoke: number;
  /** Герой за рулём (лист s28) — только у машины, на которой едут. */
  driver?: Phaser.GameObjects.Image;
}

/**
 * Транспорт в мире (TZ 9.4): машины стоят там, где их оставили (сохраняются), посадка действием рядом,
 * управление стиком/клавишами с инерцией, проходимость, топливо, ремонт ключом, багажник, моды пикапа,
 * таран врагов. Отрисовка (ANIMATIONS §10): колёса вращаются по пройденному пути, гусеница прокручивается,
 * корпус покачивается и наклоняется при разгоне, пыль/брызги из-под колёс, дым при HP < 30%.
 */
export class VehicleManager {
  list: Vehicle[] = [];
  driving: Vehicle | null = null;
  private views = new Map<string, View>();
  private seq = 1;
  private dust: Phaser.GameObjects.Particles.ParticleEmitter;
  private splash: Phaser.GameObjects.Particles.ParticleEmitter;
  private smoke: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(
    private readonly scene: WorldScene,
    private readonly reg: Registry,
    save: VehicleSave[] = [],
  ) {
    for (const s of save) {
      if (!reg.vehicles.has(s.id)) continue;
      this.list.push(new Vehicle(reg, s));
      const n = Number(s.uid.replace(/\D/g, ''));
      if (n >= this.seq) this.seq = n + 1;
    }
    this.dust = Fx.particles(scene, ['effects.dust_1', 'effects.dust_2'], {
      tint: 0x9a8a70,
      lifespan: 500,
      speed: { min: 20, max: 60 },
      angle: { min: 200, max: 340 },
      scale: { start: 0.22, end: 0 },
      gravityY: 60,
    }).setDepth(DEPTH.glow - 1);
    this.splash = Fx.particles(scene, ['effects.water_splash'], {
      lifespan: 400,
      speed: { min: 30, max: 80 },
      angle: { min: 220, max: 320 },
      scale: { start: 0.2, end: 0 },
      gravityY: 200,
    }).setDepth(DEPTH.glow - 1);
    this.smoke = Fx.particles(scene, ['effects.smoke_1'], {
      lifespan: 1200,
      speed: { min: 8, max: 20 },
      angle: { min: 250, max: 290 },
      scale: { start: 0.15, end: 0.4 },
      alpha: { start: 0.4, end: 0 },
      gravityY: -10,
    }).setDepth(DEPTH.glow - 1);
    void AssetLoader.ensureGroup(scene, 'vehicles');
  }

  toSave(): VehicleSave[] {
    return this.list.map((v) => JSON.parse(JSON.stringify(v.s)) as VehicleSave);
  }

  /** Поставить машину из инвентаря рядом с героем. */
  place(id: string): boolean {
    const h = this.scene.hero;
    if (!h.inv.consume({ [id]: 1 })) return false;
    const v = Vehicle.create(
      this.reg,
      id,
      `veh${this.seq++}`,
      h.pos.x + h.move.faceX * 2,
      h.pos.y + h.move.faceY * 2 + 0.3,
    );
    this.list.push(v);
    this.scene.game.events.emit(TOAST, t('veh.placed', { name: v.def.name_ru }));
    return true;
  }

  near(x: number, y: number): Vehicle | null {
    const Rr = this.reg.prog.vehicles.enterRadiusTiles;
    let best: Vehicle | null = null;
    let bd = Infinity;
    for (const v of this.list) {
      const d = Math.hypot(v.s.x - x, v.s.y - y);
      if (d <= Rr && d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ меню машины

  /** Действие рядом с машиной: сесть, багажник, заправить, починить, моды пикапа. */
  openMenu(v: Vehicle): void {
    const reg = this.reg;
    const s = this.scene;
    const inv = s.hero.inv;
    const items: MenuItem[] = [
      { label: t('veh.enter'), fn: () => this.enter(v), disabled: v.broken, icon: 'ui.icon_vehicle_enter' },
    ];
    if (v.def.trunkSlots > 0 || v.s.trunk.length)
      items.push({ label: t('veh.trunk'), fn: () => this.openTrunk(v), icon: 'ui.icon_trunk' });
    if (v.needsFuel)
      items.push({
        label: t('veh.refuel'),
        fn: () => this.refuel(v),
        icon: 'ui.icon_refuel',
        disabled: inv.count('crude_oil') === 0,
      });
    const hasWrench = inv.count('wrench') > 0;
    items.push({
      label: t('veh.repair'),
      fn: () => this.repair(v),
      icon: 'ui.icon_repair',
      disabled: !hasWrench || v.s.hp >= this.maxHp(v),
    });
    if (v.def.id === 'pickup') {
      const M = reg.prog.vehicles['pickupMods'] as
        Record<string, { cost: Record<string, number> }> | undefined;
      for (const [mod, cfg] of Object.entries(M ?? {})) {
        if (v.s.mods.includes(mod)) continue;
        const cost = Object.entries(cfg.cost)
          .map(([id, n]) => `${reg.items.get(id)?.name_ru ?? id} ${n}`)
          .join(', ');
        items.push({
          label: t(`veh.mod.${mod}`, { cost }),
          fn: () => this.addMod(v, mod),
          disabled: !inv.has(cfg.cost),
        });
      }
    }
    items.push({ label: t('ui.back'), fn: () => {} });
    const fuel = v.needsFuel ? t('veh.fuel', { n: v.s.fuel.toFixed(1) }) : t('veh.no_fuel_needed');
    s.scene.launch(SceneKeys.Menu, {
      title: v.def.name_ru,
      subtitle: `${t('veh.hp', { hp: Math.round(v.s.hp), max: this.maxHp(v) })} · ${fuel} · ${t('veh.terrain', { list: v.def.terrain.map((x) => t(`terrain.${x}`)).join(', ') })}`,
      items,
    } satisfies MenuData);
  }

  private maxHp(v: Vehicle): number {
    const M = this.reg.prog.vehicles['pickupMods'] as Record<string, { hpMul?: number }> | undefined;
    return Math.round(v.def.hp * (v.s.mods.includes('armor') ? (M?.['armor']?.hpMul ?? 1) : 1));
  }

  private openTrunk(v: Vehicle): void {
    const inv = new Inventory(this.reg, v.s.trunk.length, v.s.trunk);
    // Изменения багажника — сразу в состояние машины (окно меняет inv на месте).
    v.s.trunk = inv.slots;
    this.scene.scene.launch(SceneKeys.Inventory, {
      mode: 'container',
      storage: { title: v.def.name_ru, inv },
    });
  }

  private refuel(v: Vehicle): void {
    const inv = this.scene.hero.inv;
    const n = inv.count('crude_oil');
    if (!n) return;
    inv.consume({ crude_oil: n });
    v.s.fuel += n;
    this.scene.game.events.emit(TOAST, t('veh.refueled', { n: v.s.fuel.toFixed(1) }));
  }

  private repair(v: Vehicle): void {
    let k = 0;
    while (v.s.hp < this.maxHp(v) && k < 10) {
      v.s.hp = Math.min(this.maxHp(v), v.s.hp + v.def.hp * this.reg.prog.vehicles.repairPerHit);
      k++;
    }
    this.scene.audio.play('hit_metal', 'sfx');
  }

  private addMod(v: Vehicle, mod: string): void {
    const M = this.reg.prog.vehicles['pickupMods'] as Record<
      string,
      { cost: Record<string, number>; trunkAdd?: number }
    >;
    const cfg = M[mod];
    if (!cfg || !this.scene.hero.inv.consume(cfg.cost)) return;
    v.s.mods.push(mod);
    if (cfg.trunkAdd) for (let i = 0; i < cfg.trunkAdd; i++) v.s.trunk.push(null);
    this.dropView(v.s.uid);
  }

  /** Вызов к аванпосту (TZ 9.4.5): ближайшая машина переезжает к аванпосту за нефть. */
  callTo(x: number, y: number): boolean {
    const inv = this.scene.hero.inv;
    const fuel = this.reg.prog.vehicles.callFuel;
    const v = this.list
      .filter((q) => q !== this.driving)
      .sort((a, b) => Math.hypot(a.s.x - x, a.s.y - y) - Math.hypot(b.s.x - x, b.s.y - y))[0];
    if (!v) {
      this.scene.game.events.emit(TOAST, t('veh.none'));
      return false;
    }
    if (!inv.consume({ crude_oil: fuel })) {
      this.scene.game.events.emit(TOAST, t('veh.call_fuel', { n: fuel }));
      return false;
    }
    v.s.x = x + 1.5;
    v.s.y = y + 1;
    this.scene.game.events.emit(TOAST, t('veh.called', { name: v.def.name_ru }));
    return true;
  }

  // ------------------------------------------------------------------ вождение

  enter(v: Vehicle): void {
    if (v.broken) return;
    this.driving = v;
    this.scene.hero.inVehicle = true;
    this.scene.game.events.emit(TOAST, t('veh.drive_hint'));
  }

  exit(): void {
    const v = this.driving;
    if (!v) return;
    this.driving = null;
    const h = this.scene.hero;
    h.inVehicle = false;
    const p = moveCircle(this.scene.world, v.s.x, v.s.y + 0.9, 0.22, 0, 0.01, 0.75);
    h.teleport(p.x, p.y);
    v.vx = 0;
    v.vy = 0;
  }

  /** Тик: управление машиной, таран, герой «сидит внутри». */
  tick(dt: number): void {
    const v = this.driving;
    if (!v) return;
    const s = this.scene;
    const c = s.world.cell(Math.floor(v.s.x), Math.floor(v.s.y));
    const tile = s.world.tileNames[c.tile] ?? '';
    const fuelMul = 1 + s.progress.effect('fuel');
    const r = v.tick(
      s.controls.move,
      tile,
      dt,
      (dx, dy) => {
        const p = moveCircle(s.world, v.s.x, v.s.y, R, dx, dy, 0.75, true);
        return { dx: p.x - v.s.x, dy: p.y - v.s.y };
      },
      fuelMul,
    );
    if (r.crash > 5) Fx.cameraShake(s, 120, 0.006);
    if (v.needsFuel && v.s.fuel <= 0 && Math.random() < dt) s.game.events.emit(TOAST, t('veh.out_of_fuel'));
    // Таран слабых врагов.
    const ram = v.ramDamage();
    if (ram > 0)
      for (const e of s.enemies.alive) {
        if (Math.hypot(e.x - v.s.x, e.y - v.s.y) > R + e.r + 0.2) continue;
        e.hurt(ram, v.s.x - v.vx, v.s.y - v.vy, { melee: true, now: s.dayNight.seconds, knock: 1.2 });
        Fx.cameraShake(s, 150, 0.008);
        s.audio.play('hit_flesh', 'sfx');
      }
    s.hero.teleport(v.s.x, v.s.y);
  }

  // ------------------------------------------------------------------ отрисовка

  private makeView(v: Vehicle): View | null {
    if (!AssetLoader.isLoaded(this.scene, 'vehicles')) return null;
    const d = v.def;
    const body = spawnSprite(this.scene, 0, 0, d.body);
    const wheels: Phaser.GameObjects.Image[] = [];
    if (d.wheel)
      for (let i = 0; i < 2; i++) wheels.push(spawnSprite(this.scene, 0, 0, d.wheel).setOrigin(0.5, 0.5));
    let track: Phaser.GameObjects.TileSprite | undefined;
    if (d.track) {
      const info = getAssetInfo(d.track)!;
      track = this.scene.add
        .tileSprite(0, 0, info.size[0], info.size[1], info.group, info.frame)
        .setOrigin(0.5, 1);
      track.setTileScale(info.size[0] / (track.frame.width || info.size[0]));
    }
    const mods: Phaser.GameObjects.Image[] = [];
    const M = d.mods ?? {};
    if (v.s.mods.includes('armor') && M['armor']) mods.push(spawnSprite(this.scene, 0, 0, M['armor']));
    if (v.s.mods.includes('roofRack') && M['roofRack'])
      mods.push(spawnSprite(this.scene, 0, 0, M['roofRack']));
    const shadow = this.scene.add
      .image(0, 0, 'fx-shadow')
      .setDisplaySize(body.displayWidth * 0.9, 18)
      .setDepth(DEPTH.shadow);
    return { body, wheels, track, mods, shadow, nextSmoke: 0 };
  }

  private dropView(uid: string): void {
    const v = this.views.get(uid);
    if (!v) return;
    v.body.destroy();
    v.wheels.forEach((w) => w.destroy());
    v.track?.destroy();
    v.mods.forEach((m) => m.destroy());
    v.shadow.destroy();
    v.driver?.destroy();
    this.views.delete(uid);
  }

  /** Поза «за рулём» на сиденье из progression.json → vehicles.seats. */
  private renderDriver(v: Vehicle, view: View, b: Phaser.GameObjects.Image, flip: boolean, y: number): void {
    const on = v === this.driving;
    if (!on) {
      view.driver?.destroy();
      view.driver = undefined;
      return;
    }
    const V = this.reg.prog.vehicles as { seats?: Record<string, unknown>; seatScale?: number };
    const seat = V.seats?.[v.def.id] as [number, number, number] | undefined;
    if (!seat || !getAssetInfo('characters.hero.hero_pose_drive')) return;
    if (!view.driver) {
      view.driver = spawnSprite(this.scene, 0, 0, 'characters.hero.hero_pose_drive');
      view.driver.setScale(view.driver.scaleX * (V.seatScale ?? 1));
    }
    const w = b.displayWidth;
    const fx = flip ? 1 - seat[0] : seat[0];
    view.driver
      .setPosition(b.x - w / 2 + fx * w, b.y - b.displayHeight * seat[1])
      .setFlipX(flip)
      .setAngle(b.angle)
      .setDepth(seat[2] ? y - 0.5 : y + 0.3);
  }

  render(time: number): void {
    const seen = new Set<string>();
    for (const v of this.list) {
      seen.add(v.s.uid);
      let view = this.views.get(v.s.uid);
      if (!view) {
        const nv = this.makeView(v);
        if (!nv) continue;
        view = nv;
        this.views.set(v.s.uid, view);
      }
      const x = v.s.x * TILE;
      const y = v.s.y * TILE + 10;
      const flip = v.s.dir < 0;
      const moving = v.speed > 0.2;
      const bob = moving ? Math.round(Math.sin(time / 60) * 1) : 0;
      // Наклон при разгоне/торможении ±2°.
      const tilt = Phaser.Math.Clamp(-v.accel * 0.6, -2, 2) * (flip ? -1 : 1);
      const b = view.body
        .setPosition(x, y - (v.def.track ? 10 : 8) + bob)
        .setFlipX(flip)
        .setAngle(tilt)
        .setDepth(y);
      const w = b.displayWidth;
      const pos = WHEELS[v.def.id] ?? [0.22, 0.8];
      view.wheels.forEach((wh, i) => {
        const fx = flip ? 1 - pos[i]! : pos[i]!;
        // Колёса вращаются по пройденному пути: угол = путь / радиус.
        const rad = wh.displayHeight / 2 / TILE;
        wh.setPosition(x - w / 2 + fx * w, y - wh.displayHeight / 2)
          .setRotation((v.s.odo / Math.max(0.05, rad)) * (flip ? -1 : 1))
          .setDepth(y + 0.1);
      });
      if (view.track)
        view.track.setPosition(x, y).setDepth(y + 0.1).tilePositionX = v.s.odo * TILE * (flip ? -1 : 1);
      view.mods.forEach((m) =>
        m
          .setPosition(b.x, b.y)
          .setFlipX(flip)
          .setAngle(tilt)
          .setDepth(y + 0.2),
      );
      view.shadow.setPosition(x, y);
      this.renderDriver(v, view, b, flip, y);
      // Пыль/брызги/снег из-под колёс по местности.
      if (moving && Math.random() < 0.5) {
        const back = x + (flip ? 1 : -1) * w * 0.35;
        if (v.terrain === 'water_shallow' || v.terrain === 'swamp_mud') this.splash.explode(1, back, y - 4);
        else
          this.dust
            .setParticleTint(v.terrain === 'snow' || v.terrain === 'ice' ? 0xffffff : 0x9a8a70)
            .explode(1, back, y - 4);
      }
      // Дым из капота при поломке.
      if (v.s.hp < this.maxHp(v) * 0.3 && time >= view.nextSmoke) {
        view.nextSmoke = time + 300;
        this.smoke.explode(1, x + (flip ? -1 : 1) * w * 0.3, y - b.displayHeight * 0.7);
      }
    }
    for (const uid of [...this.views.keys()]) if (!seen.has(uid)) this.dropView(uid);
  }

  destroy(): void {
    for (const uid of [...this.views.keys()]) this.dropView(uid);
    this.dust.destroy();
    this.splash.destroy();
    this.smoke.destroy();
  }
}
