import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import { log } from '../../core/util/Log';
import { DayNightSystem, type DayNightState } from '../../core/systems/DayNight';
import { GameClock } from '../../core/util/GameClock';
import { World, type WorldDelta } from '../../core/world';
import type { SaveGame } from '../../core/save';
import { atlasGroups, getAssetInfo } from '../assets/AssetIndex';
import { AssetLoader } from '../assets/AssetLoader';
import { ctx, registry } from '../GameContext';
import { ChunkView, DEPTH, OCCLUDE_ALPHA, OCCLUDE_MS, ROOM_SOUTH_ALPHA } from '../render/ChunkView';
import { cameraShake, ensureFlameAnim, popIn, ripple, shake } from '../render/Fx';
import { buildGroundTileset, TILE, type GroundTileset } from '../render/GroundTiles';
import type { LightSource } from '../render/Lighting';
import type { WorldOverlayScene } from './WorldOverlayScene';
import { ensureFxTextures } from '../render/textures';
import { SceneKeys } from '../SceneKeys';
import { AdsController } from '../AdsController';
import { HeroController, type HeroSave } from '../hero/HeroController';
import { fallbackForced, setFallbackForced } from '../hero/HeroView';
import { InputMapper, type Command } from '../input/InputMapper';
import { Highlight } from '../render/Highlight';
import { WorldFx } from '../world/WorldFx';
import { makeStack } from '../../core/inventory';
import type { HitResult } from '../../core/systems/Harvest';
import type { ItemStack, WorldObject } from '../../core/world';
import { Inventory } from '../../core/inventory';
import {
  blueprintRecipe,
  BASE_STATIONS,
  consumeFrom,
  disassembleReturn,
  type StationState,
  isCraftStation,
  noticeRecipes,
  Stations,
  trophyRecipes,
  type CraftSource,
  type SkillLevels,
  type StationsSave,
} from '../../core/systems/Craft';
import { containerInfo } from '../../core/systems/Loot';
import { StationViews } from '../world/StationViews';
import { DefenseViews } from '../world/DefenseViews';
import { EnemyManager } from '../enemies/EnemyManager';
import { GameProgress } from '../progress/GameProgress';
import { VehicleManager } from '../vehicles/VehicleManager';
import { BossManager } from '../bosses/BossManager';
import type { VehicleSave } from '../../core/entities/Vehicle';
import { audio, type AudioBus } from '../audio/AudioBus';
import { BuildController, type BuildSel } from '../build/BuildController';
import {
  Dummy,
  effectOf,
  explosion,
  isOneShot,
  loadItemOf,
  tickDefense,
  type DefenseEnv,
  type DefenseEvent,
  type Target,
} from '../../core/systems/Defense';
import { enclosure, fullRepairCost } from '../../core/world';
import { canSleep, nextMorning } from '../../core/systems/DayNight';
import type { MenuData, MenuItem } from './MenuScene';
import { spawnSprite } from '../assets/spawnSprite';

/** Свободная камера (F3): скорость, клеток/с. */
const FREE_CAM_TILES_PER_SEC = 24;
/** Ускорение времени суток (F4). */
const FAST_TIME = 10;
/** Как часто появляется блик на воде, мс. */
const RIPPLE_EVERY_MS = 250;
/** События игры: попросить сохранить (пауза, сворачивание) и «сохранено» (для HUD). */
export const SAVE_REQUEST = 'save-request';
export const GAME_SAVED = 'game-saved';
/** Короткое сообщение в HUD (строка). */
export const TOAST = 'toast';
/** Режим строительства включён/выключен (boolean) — HUD прячет кнопки. */
export const BUILD_MODE = 'build-mode';

/** Отладочный урон (F10). */
const DEBUG_DAMAGE = 15;
/** Шаг зума клавишами +/− и щипком. */
const ZOOM_STEP = 1.08;
/** Затемнение экрана при смерти, мс. */
const DEATH_FADE_MS = 800;

/**
 * Мир: чанки вокруг камеры, Y-сортировка, тени, перекрытие, день/ночь со светом (шаг 3);
 * герой с ригом, вводом, выживанием, смертью и возрождением (шаг 4).
 */
export class WorldScene extends Phaser.Scene {
  world!: World;
  dayNight!: DayNightSystem;
  private ts!: GroundTileset;
  private views = new Map<string, ChunkView>();
  hero!: HeroController;
  /** Ввод: клавиатура, мышь, стик и кнопки телефона (UIScene). */
  controls!: InputMapper;
  /** Выбранный слот пояса (пояс — шаг 5). */
  selectedSlot = 0;
  private heroDrawX = 0;
  private heroDrawY = 0;
  private deathPos: { x: number; y: number } | null = null;
  private fx!: WorldFx;
  private offPause: () => void = () => {};
  private highlight!: Highlight;
  private overlay!: WorldOverlayScene;
  private debugOn = false;
  private zoomUser = 1;
  private freeCam = false;
  private debugGfx!: Phaser.GameObjects.Graphics;
  private faceDepth = 0.75;
  private heroR = 0.22;
  /** Самая долгая постройка чанка (мс) — для отладки подвисаний. */
  maxChunkBuildMs = 0;
  dayState!: DayNightState;
  /** Станки мира и крафт руками (шаг 6). */
  stations!: Stations;
  /** Известные рецепты: чертежи, трофеи, «замеченные» по первому подбору ресурса. */
  known = new Set<string>();
  /** Станки, которые игрок видел (вкладки книги крафтов). */
  seenStations = new Set<string>();
  private stationViews!: StationViews;
  private craftAcc = 0;
  private scanAcc = 0;
  /** Транспорт и боссы (шаг 9). */
  vehicles!: VehicleManager;
  bosses!: BossManager;
  /** Режим строительства (шаг 7). */
  build!: BuildController;
  private defenseViews!: DefenseViews;
  /** Манекены-мишени (до врагов шага 8). */
  dummies: Dummy[] = [];
  private dummySeq = 1;
  /** Враги и звери (шаг 8). */
  enemies!: EnemyManager;
  private debugEnemy = 0;
  private contactCd = new Map<string, number>();
  private defenseCache: WorldObject[] | null = null;
  private defenseAcc = 0;
  private baseAcc = 0;
  /** Комната игрока вокруг героя: клетка героя и южный ряд стен. */
  private roomKey = '';
  private playerSouth = new Set<string>();

  constructor() {
    super(SceneKeys.World);
  }

  create(): void {
    const { clock, platform } = ctx();
    const reg = registry();
    const tilePx = reg.balance.world.tilePx;
    ensureFxTextures(this);
    ensureFlameAnim(this);

    this.world = new World(reg, {
      sizeOf: (id) => {
        const s = getAssetInfo(id)?.size;
        return s ? [s[0] / tilePx, s[1] / tilePx] : undefined;
      },
    });
    this.ts = buildGroundTileset(this, this.world.tileNames);
    this.views = new Map();
    this.faceDepth = (getAssetInfo(reg.building.materials[0]!.sprites.face)?.size[1] ?? 48) / tilePx;
    const heroCol = reg.worldgen.colliders['hero'];
    if (heroCol && 'radiusTiles' in heroCol) this.heroR = heroCol.radiusTiles as number;

    const dn = reg.balance.dayNight;
    const transitionSec = reg.worldgen.dayNight.transitionSec;
    // Старт — утро первого дня (после рассвета).
    this.dayNight = new DayNightSystem({ ...dn, transitionSec }, transitionSec + 30);
    this.dayState = this.dayNight.state;

    // Герой: из сохранения или у бункера старта.
    const heroSave = this.applySave(ctx().currentSave) ?? { ...this.world.start };
    this.controls = new InputMapper();
    // Команды, нажатые на паузе (Esc в меню паузы, Tab в инвентаре), не должны сработать после неё.
    this.offPause = clock.onPauseChange((paused) => {
      if (!paused) this.controls.clear();
    });
    this.hero = new HeroController(this, reg, ctx().config, this.world, this.faceDepth, heroSave, {
      onDeath: () => this.onHeroDeath(),
      onHarvest: (o, hit, finished, drops) => this.onHarvest(o, hit, finished, drops),
      onPickup: (o, stack) => this.onPickup(o, stack),
      onOpenContainer: (o) => this.openContainer(o),
      onHint: (key, params) => this.game.events.emit(TOAST, t(key, params)),
      onFreeAction: () => this.freeAction(),
    });
    this.fx = new WorldFx(this, reg);
    this.stationViews = new StationViews(this, reg, this.stations);
    this.defenseViews = new DefenseViews(this, reg);
    this.build = new BuildController(this);
    this.enemies = new EnemyManager(this, reg);
    this.vehicles = new VehicleManager(this, reg, (ctx().currentSave?.vehicles ?? []) as VehicleSave[]);
    this.bosses = new BossManager(this, reg);
    this.enemies.bossTargets = () => this.bosses.targets;
    void AssetLoader.ensureGroup(this, 'bosses');
    audio()?.loadInBackground(this);
    this.enemies.spawnEnabled = !new URLSearchParams(location.search).has('nospawn');
    this.hero.combat = {
      aim: (face, range) => this.enemies.aim(face, range),
      melee: (w, face) => this.enemies.melee(w, face),
      shoot: (w, face, muzzle) => this.enemies.shoot(w, face, muzzle),
      throwAt: (w, x, y) => this.enemies.throwAt(w, x, y),
      flame: (w, face, dt) => this.enemies.flame(w, face, dt),
      skills: () => this.skills,
    };
    this.dummies = [];
    this.highlight = new Highlight(this, reg);
    this.onSkillsChanged();
    this.heroDrawX = this.hero.pos.x * TILE;
    this.heroDrawY = this.hero.pos.y * TILE;

    const cam = this.cameras.main;
    cam.setBackgroundColor('#000000');
    cam.setBounds(0, 0, this.world.size * TILE, this.world.size * TILE);
    cam.setRoundPixels(true);
    this.applyZoom();
    cam.centerOn(this.heroDrawX, this.heroDrawY - 32);
    // Маска света и отладочный текст — в сцене-оверлее: камера без зума.
    this.scene.launch(SceneKeys.WorldOverlay);
    this.overlay = this.scene.get(SceneKeys.WorldOverlay) as WorldOverlayScene;

    this.events.on('request-pause', () => this.openPause());
    // ПК: ЛКМ — действие в сторону курсора, мышь задаёт направление; колесо — пояс 1–6.
    const touchUi = this.sys.game.device.input.touch && !this.sys.game.device.os.desktop;
    if (!touchUi) {
      this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
        if (!p.leftButtonDown() || this.build.active) return;
        this.controls.push({ type: 'attack', aim: { x: p.worldX, y: p.worldY } });
        this.controls.setAttackHold(true);
      });
      this.input.on(Phaser.Input.Events.POINTER_UP, () => this.controls.setAttackHold(false));
      this.input.on(
        Phaser.Input.Events.POINTER_MOVE,
        (p: Phaser.Input.Pointer) => (this.controls.aim = { x: p.worldX, y: p.worldY }),
      );
    }
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.controls.push({ type: 'slotStep', delta: dy > 0 ? 1 : -1 });
    });
    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyZoom, this);

    this.debugGfx = this.add.graphics().setDepth(DEPTH.debug);
    if (ctx().debug) this.installDebugKeys();

    // Все чанки вокруг старта — сразу, остальные — по одному за кадр.
    this.streamChunks(Infinity);

    this.scene.launch(SceneKeys.UI);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.shutdown());
    if (clock.isPaused) this.scene.pause();
    else platform.onGameplayStart();
  }

  private shutdown(): void {
    // Выход в меню — сохранить игру (данные снимаются сразу, запись идёт в фоне).
    void this.saveNow();
    this.game.events.off(SAVE_REQUEST, this.onSaveRequest, this);
    this.offPause();
    this.controls.destroy();
    this.hero.destroy();
    this.fx.destroy();
    this.highlight.destroy();
    this.stationViews.destroy();
    this.defenseViews.destroy();
    this.build.destroy();
    this.enemies.destroy();
    this.vehicles.destroy();
    this.bosses.destroy();
    audio()?.stopLoops();
    audio()?.playMusic(null);
    this.scene.stop(SceneKeys.Skills);
    this.scene.stop(SceneKeys.Journal);
    this.scene.stop(SceneKeys.Map);
    this.scene.stop(SceneKeys.Build);
    this.scene.stop(SceneKeys.Menu);
    this.scene.stop(SceneKeys.Craft);
    this.scene.stop(SceneKeys.Inventory);
    this.scene.stop(SceneKeys.Death);
    this.scene.stop(SceneKeys.UI);
    this.scene.stop(SceneKeys.WorldMap);
    this.scene.stop(SceneKeys.WorldOverlay);
    ctx().platform.onGameplayStop();
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    this.scale.off(Phaser.Scale.Events.RESIZE, this.applyZoom, this);
  }

  /** Базовый зум: в кадре ~16×9 клеток на ПК и ~11×6 на телефоне; колесо — 0.75…1.25 от него. */
  private applyZoom(): void {
    const c = registry().worldgen.camera;
    const view = ctx().platform.device === 'desktop' ? c.viewTilesDesktop : c.viewTilesMobile;
    const { width, height } = this.scale;
    const base = Math.min(width / (view[0] * TILE), height / (view[1] * TILE));
    this.cameras.main.setZoom(base * this.zoomUser);
  }

  openPause(): void {
    if (this.hero.dead || this.scene.isActive(SceneKeys.Pause) || this.scene.isActive(SceneKeys.WorldMap))
      return;
    this.scene.launch(SceneKeys.Pause);
  }

  // ------------------------------------------------------------------ логика (тики)

  private tick(): void {
    const reg = registry();
    this.dayNight.tick(GameClock.TICK_MS / 1000);
    this.worldUpdateAcc += GameClock.TICK_MS / 1000;
    this.playTimeSec += GameClock.TICK_MS / 1000;
    this.autosaveAcc += GameClock.TICK_MS / 1000;
    if (this.autosaveAcc >= reg.worldgen.persistence.autosaveEverySec) {
      this.autosaveAcc = 0;
      void this.saveNow();
    }
    if (this.worldUpdateAcc >= registry().worldgen.persistence.updateEverySec) {
      this.worldUpdateAcc = 0;
      this.applyWorldChanges();
    }
    this.tickCraft(GameClock.TICK_MS / 1000);
    if (this.freeCam) {
      this.controls.take();
      return;
    }
    this.defenseAcc += GameClock.TICK_MS / 1000;
    if (this.defenseAcc >= 0.5) {
      this.defenseAcc = 0;
      this.defenseCache = null;
    }
    this.vehicles.tick(GameClock.TICK_MS / 1000);
    this.bosses.tick(GameClock.TICK_MS / 1000);
    this.enemies.tick(GameClock.TICK_MS / 1000);
    this.tickDefense(GameClock.TICK_MS / 1000);
    this.baseAcc += GameClock.TICK_MS / 1000;
    if (this.baseAcc >= registry().build.base.autoCollectEverySec) {
      this.baseAcc = 0;
      this.baseAutoCollect();
    }
    this.hero.tick(
      GameClock.TICK_MS / 1000,
      this.controls,
      this.dayState,
      this.controls.aim,
      this.dayNight.seconds,
    );
    for (const c of this.hero.passthrough.splice(0)) this.command(c);
    const biome = this.world.cell(Math.floor(this.hero.pos.x), Math.floor(this.hero.pos.y)).biome;
    if (biome > this.progress.maxBiome) this.progress.maxBiome = biome;
    this.tickProgress(GameClock.TICK_MS / 1000);
  }

  /** Команды, которые относятся к миру и интерфейсу, а не к герою. */
  private command(c: Command): void {
    switch (c.type) {
      case 'pause':
        // Esc в режиме строительства — выход из него, а не пауза.
        if (this.build.active) this.exitBuild();
        else this.openPause();
        break;
      case 'zoom': {
        const z = registry().worldgen.camera;
        this.zoomUser = Phaser.Math.Clamp(
          this.zoomUser * (c.delta > 0 ? ZOOM_STEP : 1 / ZOOM_STEP),
          z.zoomMin,
          z.zoomMax,
        );
        this.applyZoom();
        break;
      }
      case 'slot':
        this.hero.inv.selected = c.index;
        break;
      case 'slotStep': {
        const n = registry().balance.player.hotbarSlots;
        this.hero.inv.selected = (this.hero.inv.selected + c.delta + n) % n;
        break;
      }
      case 'map':
        if (!this.scene.isActive(SceneKeys.Map)) this.scene.launch(SceneKeys.Map);
        break;
      case 'skills':
        if (!this.scene.isActive(SceneKeys.Skills)) this.scene.launch(SceneKeys.Skills);
        break;
      case 'journal':
        if (!this.scene.isActive(SceneKeys.Journal)) this.scene.launch(SceneKeys.Journal);
        break;
      case 'inventory':
        this.openInventory();
        break;
      case 'action':
        // В машине «Собрать» — выйти.
        if (this.vehicles.driving) this.vehicles.exit();
        break;
      case 'craft':
        this.openCraft(null);
        break;
      case 'build':
        if (this.build.active) this.exitBuild();
        else this.enterBuild();
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ кадр

  override update(time: number, delta: number): void {
    const { clock } = ctx();
    clock.advance(delta, () => this.tick());
    this.dayState = this.dayNight.state;

    // Интерполяция героя между тиками
    const { x: hx, y: hy } = this.hero.render(delta / 1000, clock.alpha);
    this.heroDrawX = hx;
    this.heroDrawY = hy;

    this.updateCamera(delta, hx, hy);
    this.streamChunks(registry().worldgen.streaming.frameBudgetMs);
    this.ts.updateWater(time);
    this.waterRipples(time);
    this.manageAtlases(time);

    const darkness = this.dayState.darkness;
    for (const v of this.visibleViews()) v.animate(time, darkness, 1);
    this.updateOcclusion(delta, hx, hy);
    this.highlight.update(time, this.visibleViews(), hx, hy, this.hero.target, this.actionIcon());
    this.stationViews.update(time, this.visibleViews(), this.dayNight.seconds, (o) =>
      this.viewOf(o)?.refreshObject(o),
    );
    this.enemies.render(time);
    this.vehicles.render(time);
    this.bosses.render(time);
    this.defenseViews.update(time, this.visibleViews(), this.dummies, (o) =>
      this.viewOf(o)?.refreshObject(o),
    );
    this.build.update(time, delta / 1000);
    this.updateDoors(hx, hy);
    this.overlay.lighting?.update(this.dayState, this.collectLights(hx, hy));
    if (this.debugOn) this.drawDebug();
  }

  private nextRipple = 0;
  private playTimeSec = 0;
  private autosaveAcc = 0;
  /** Опыт, навыки, задания, обучение, карта (шаг 9). */
  progress!: GameProgress;
  private saving: Promise<void> = Promise.resolve();

  /** Загрузка выбранной игры: изменения мира, герой, время суток, прогресс. Без сохранения — отладочный запуск. */
  private applySave(save: SaveGame | null): HeroSave | null {
    this.game.events.on(SAVE_REQUEST, this.onSaveRequest, this);
    this.playTimeSec = save?.playTimeSec ?? 0;
    this.autosaveAcc = 0;
    const reg = registry();
    this.progress = new GameProgress(this, reg, save);
    this.stations = new Stations(reg, save?.craft?.stations as StationsSave | undefined);
    this.known = new Set(save?.craft?.known ?? []);
    this.seenStations = new Set((save?.craft?.['seen'] as string[] | undefined) ?? []);
    // Обучения пока нет (шаг 10) — его рецепты (тотем базы) открыты сразу.
    for (const r of reg.recipes.all) if (r.unlock === 'tutorial') this.known.add(r.id);
    if (!save) return null;
    try {
      this.world.importDelta(save.world as unknown as WorldDelta);
    } catch (e) {
      // Сохранение старого (меньшего) мира: начинаем у бункера, прогресс мира не переносится.
      log.error('save: изменения мира не применены', e);
      this.time.delayedCall(500, () => this.game.events.emit(TOAST, t('save.old_world')));
      return null;
    }
    this.dayNight.seconds = save.worldSec;
    this.dayState = this.dayNight.state;
    return save.hero as HeroSave;
  }

  private onSaveRequest(): void {
    void this.saveNow();
  }

  /** Снимок текущей игры. */
  private snapshot(base: SaveGame): SaveGame {
    return {
      ...base,
      worldSec: this.dayNight.seconds,
      playTimeSec: this.playTimeSec,
      hero: this.hero.toSave() as unknown as SaveGame['hero'],
      ...this.progress.toSave(),
      world: this.world.exportDelta(),
      vehicles: this.vehicles.toSave() as unknown as SaveGame['vehicles'],
      craft: {
        known: [...this.known],
        seen: [...this.seenStations],
        stations: { ...this.stations.toJSON() },
      },
    };
  }

  /** Сохранить текущую игру (автосохранение, пауза, сворачивание, выход в меню). Записи идут по очереди. */
  saveNow(): Promise<void> {
    const c = ctx();
    const base = c.currentSave;
    if (!base || !c.saves) return this.saving;
    const snap = this.snapshot(base);
    c.currentSave = snap;
    const saves = c.saves;
    this.saving = this.saving
      .then(() => saves.write(snap, Date.now()))
      .then(() => {
        this.game.events.emit(GAME_SAVED);
      })
      .catch((e: unknown) => log.error('save: не удалось сохранить', e));
    return this.saving;
  }
  private worldUpdateAcc = 0;
  private nextAtlasCheck = 0;

  /** Время мира (игровые секунды): дропы исчезают по сроку, ящики обновляются после респауна. */
  private applyWorldChanges(): void {
    const ch = this.world.update(this.dayNight.seconds);
    for (const e of ch.expired) this.views.get(e.key)?.removeObject(e.uid);
    for (const r of ch.respawned) {
      const v = this.views.get(r.key);
      const o = v?.chunk.objects.find((x) => x.uid === r.uid);
      if (v && o) v.refreshObject(o);
    }
  }

  /** Выбросить предмет у героя (отладка F6; настоящий инвентарь — шаг 5). */
  dropAtHero(itemId: string, count = 1): void {
    const o = this.world.dropItem(
      { id: itemId, count },
      this.hero.pos.x + 0.4 + Math.random() * 0.8,
      this.hero.pos.y - 0.2 + Math.random() * 0.6,
      this.dayNight.seconds,
    );
    const v = this.views.get(
      World.key(Math.floor(o.x / this.world.chunkTiles), Math.floor(o.y / this.world.chunkTiles)),
    );
    const view = v?.ready ? v.addObject(o) : null;
    if (view) {
      popIn(this, view.img);
    }
  }

  /**
   * Атласы биомов: заранее догружаем те, что ближе preloadRadiusTiles к камере (загрузка в GPU
   * происходит до того, как биом попадёт в кадр); выгружаем ленивые атласы дальше unloadRadiusTiles,
   * если их не использует ни один построенный чанк. Состояние мира (дроп, ящики) живёт в дельте и не теряется.
   */
  private manageAtlases(time: number): void {
    const cfg = registry().worldgen.atlasStreaming;
    if (time < this.nextAtlasCheck) return;
    this.nextAtlasCheck = time + cfg.checkEveryMs;
    const cam = this.cameras.main;
    const cx = cam.midPoint.x / TILE;
    const cy = cam.midPoint.y / TILE;
    const near = new Set<number>();
    const far = new Set<number>();
    const R = cfg.unloadRadiusTiles;
    const step = cfg.sampleStepTiles;
    for (let dy = -R; dy <= R; dy += step) {
      for (let dx = -R; dx <= R; dx += step) {
        const d = Math.hypot(dx, dy);
        if (d > R) continue;
        const b = this.world.layout.biomeAt(cx + dx, cy + dy);
        if (b === 0) continue;
        far.add(b);
        if (d <= cfg.preloadRadiusTiles) near.add(b);
      }
    }
    const groups = atlasGroups().groups;
    for (const b of near)
      if (groups[`biome${b}`] && !AssetLoader.isLoaded(this, `biome${b}`))
        void AssetLoader.ensureGroup(this, `biome${b}`);
    // Какие атласы ещё нужны построенным чанкам.
    const used = new Set<string>();
    for (const v of this.views.values())
      for (const o of v.chunk.objects) {
        const g = getAssetInfo(o.sprite)?.group;
        if (g) used.add(g);
      }
    for (const [name, info] of Object.entries(groups)) {
      const m = /^biome(\d)$/.exec(name);
      if (!m || info.load !== 'lazy' || far.has(Number(m[1])) || used.has(name)) continue;
      if (AssetLoader.isLoaded(this, name)) AssetLoader.unloadGroup(this, name);
    }
  }

  /** Редкие блики на видимой воде. */
  private waterRipples(time: number): void {
    if (time < this.nextRipple) return;
    this.nextRipple = time + RIPPLE_EVERY_MS;
    const view = this.cameras.main.worldView;
    const cells: [number, number][] = [];
    for (const v of this.visibleViews()) {
      for (const c of v.waterCells) {
        if (view.contains(c[0] * TILE, c[1] * TILE)) cells.push(c);
      }
    }
    const c = cells[Math.floor(Math.random() * cells.length)];
    if (c) ripple(this, (c[0] + Math.random()) * TILE, (c[1] + Math.random()) * TILE, DEPTH.water);
  }

  private updateCamera(delta: number, hx: number, hy: number): void {
    const cam = this.cameras.main;
    if (this.freeCam) {
      const m = this.controls.move;
      const v = (FREE_CAM_TILES_PER_SEC * TILE * delta) / 1000 / cam.zoom;
      cam.scrollX += m.x * v;
      cam.scrollY += m.y * v;
      return;
    }
    // Плавное следование (lerp из worldgen.json → camera) с поправкой на частоту кадров.
    const lerp = registry().worldgen.camera.lerp;
    const k = 1 - Math.pow(1 - lerp, delta / (1000 / 60));
    const tx = hx - cam.width / 2;
    const ty = hy - 32 - cam.height / 2;
    cam.scrollX += (tx - cam.scrollX) * k;
    cam.scrollY += (ty - cam.scrollY) * k;
  }

  /**
   * Потоковая подгрузка. Данные чанков генерируются на шаг дальше видов (края и стены смотрят в соседей),
   * виды строятся только при готовых соседях; работа за кадр ограничена бюджетом времени.
   * Вне кадра виды скрыты, дальше запаса выгрузки — уничтожаются; кэш данных — по LRU.
   */
  private streamChunks(budgetMs: number): void {
    const reg = registry();
    const s = reg.worldgen.streaming;
    const cam = this.cameras.main;
    const view = cam.worldView;
    const span = this.world.chunkTiles * TILE;
    const cx0 = Math.floor(view.x / span) - s.marginChunks;
    const cy0 = Math.floor(view.y / span) - s.marginChunks;
    const cx1 = Math.floor((view.x + view.width) / span) + s.marginChunks;
    const cy1 = Math.floor((view.y + view.height) / span) + s.marginChunks;
    const ccx = (view.x + view.width / 2) / span;
    const ccy = (view.y + view.height / 2) / span;
    const dist = (cx: number, cy: number) => Math.hypot(cx + 0.5 - ccx, cy + 0.5 - ccy);

    const t0 = performance.now();
    let ops = 0;
    const canWork = () =>
      budgetMs === Infinity ||
      (ops < s.maxChunkBuildsPerFrame * 4 && (ops === 0 || performance.now() - t0 < budgetMs));

    // 1. Данные: вид + 1 чанк вокруг.
    const gen: [number, number, number][] = [];
    for (let cy = cy0 - 1; cy <= cy1 + 1; cy++)
      for (let cx = cx0 - 1; cx <= cx1 + 1; cx++)
        if (this.world.inChunkRange(cx, cy) && !this.world.isLoaded(cx, cy)) gen.push([cx, cy, dist(cx, cy)]);
    gen.sort((p, q) => p[2] - q[2]);
    for (const [cx, cy] of gen) {
      if (!canWork()) break;
      this.world.getChunk(cx, cy);
      ops++;
    }

    // 2а. Достраиваем начатые виды.
    const deadline = budgetMs === Infinity ? Infinity : t0 + budgetMs;
    for (const v of this.views.values()) {
      if (v.ready) continue;
      const tb = performance.now();
      v.buildStep(deadline === Infinity ? Infinity : Math.max(deadline, tb + 1));
      this.maxChunkBuildMs = Math.max(this.maxChunkBuildMs, performance.now() - tb);
      ops++;
      if (!canWork()) break;
    }

    // 2б. Новые виды: только когда все соседи уже сгенерированы.
    const want: [number, number, number][] = [];
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        if (!this.world.inChunkRange(cx, cy) || this.views.has(World.key(cx, cy))) continue;
        let ready = true;
        for (let dy = -1; dy <= 1 && ready; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (this.world.inChunkRange(cx + dx, cy + dy) && !this.world.isLoaded(cx + dx, cy + dy))
              ready = false;
        if (ready) want.push([cx, cy, dist(cx, cy)]);
      }
    want.sort((p, q) => p[2] - q[2]);
    for (const [cx, cy] of want) {
      if (!canWork()) break;
      const tb = performance.now();
      const chunk = this.world.getChunk(cx, cy);
      const v = new ChunkView(this, this.world, reg, chunk, this.ts);
      this.views.set(chunk.key, v);
      v.buildStep(deadline === Infinity ? Infinity : Math.max(deadline, tb + 1));
      const ms = performance.now() - tb;
      this.maxChunkBuildMs = Math.max(this.maxChunkBuildMs, ms);
      if (ms > 30) log.debug(`chunk ${cx},${cy} step ${ms.toFixed(1)} ms`);
      ops++;
    }

    // 3. Видимость и выгрузка.
    const um = s.unloadMarginChunks;
    const m = s.cullMarginPx;
    const keep = new Set<string>();
    for (const [key, v] of this.views) {
      const { cx, cy } = v.chunk;
      if (cx < cx0 - um || cx > cx1 + um || cy < cy0 - um || cy > cy1 + um) {
        v.destroy();
        this.views.delete(key);
        continue;
      }
      keep.add(key);
      const x = cx * span;
      const y = cy * span;
      // Запас сверху и по бокам — высокие спрайты (деревья, здания) выходят за чанк.
      v.setVisible(
        x < view.right + m && x + span > view.x - m && y < view.bottom + m && y + span > view.y - m * 0.25,
      );
    }
    for (let cy = cy0 - 1; cy <= cy1 + 1; cy++)
      for (let cx = cx0 - 1; cx <= cx1 + 1; cx++) keep.add(World.key(cx, cy));
    this.world.trimCache(s.cacheChunks, keep);
  }

  /** Виды чанков в кадре. */
  private *visibleViews(): Generator<ChunkView> {
    for (const v of this.views.values()) if (v.visible) yield v;
  }

  /** Объект перед героем плавно становится полупрозрачным; южная стена комнаты — когда герой внутри. */
  private updateOcclusion(delta: number, hx: number, hy: number): void {
    const hb = this.hero.view.bounds();
    const step = Math.min(1, delta / OCCLUDE_MS);
    const near = 4 * TILE;
    for (const v of this.visibleViews()) {
      for (const o of v.objects) {
        let target = 1;
        if (
          o.img.depth > hy &&
          Math.abs(o.img.x - hx) < near + o.img.displayWidth / 2 &&
          o.img.y - hy < near * 2
        ) {
          const b = o.img.getBounds();
          if (Phaser.Geom.Rectangle.Overlaps(b, hb)) target = OCCLUDE_ALPHA;
        }
        if (o.alpha !== target) {
          o.alpha += Math.sign(target - o.alpha) * Math.min(Math.abs(target - o.alpha), step);
          o.img.setAlpha(o.alpha);
          o.glow?.setAlpha(Math.min(o.glow.alpha, o.alpha));
        }
      }
    }
    const room = this.world.roomAt(this.hero.pos.x, this.hero.pos.y);
    this.updatePlayerRoom();
    for (const v of this.visibleViews()) {
      for (const w of v.walls) {
        const a =
          (room && w.south && w.room === room.id) || this.playerSouth.has(`${w.tx},${w.ty}`)
            ? ROOM_SOUTH_ALPHA
            : 1;
        if (w.imgs[0] && w.imgs[0].alpha !== a) for (const i of w.imgs) i.setAlpha(a);
      }
    }
  }

  /** Комната из построек игрока вокруг героя (заливка по клеткам без стен) — пересчёт при смене клетки. */
  private updatePlayerRoom(): void {
    const tx = Math.floor(this.hero.pos.x);
    const ty = Math.floor(this.hero.pos.y);
    const key = `${tx},${ty}`;
    if (key === this.roomKey) return;
    this.roomKey = key;
    const r = enclosure(this.world, tx, ty, registry().build.roomFillLimit);
    this.playerSouth = r?.southWalls ?? new Set();
  }

  /** Двери открываются, когда герой рядом (сжатие к петле за 0.15 с), и закрываются за ним. */
  private updateDoors(hx: number, hy: number): void {
    const R = registry().build.doorOpenRadiusTiles * TILE;
    for (const v of this.visibleViews()) {
      for (const w of v.walls) {
        if (!w.door) continue;
        const dx = (w.tx + 0.5) * TILE - hx;
        const dy = (w.ty + 1) * TILE - hy;
        v.setDoorOpen(w, Math.hypot(dx, dy) <= R);
      }
    }
  }

  private collectLights(hx: number, hy: number): LightSource[] {
    const l = registry().worldgen.lights;
    const lights: LightSource[] = [{ x: hx, y: hy - 40, r: l.heroRadiusTiles * TILE }];
    const flicker = 1 + 0.04 * Math.sin(this.time.now / 90) + 0.03 * Math.sin(this.time.now / 37);
    for (const v of this.visibleViews()) {
      for (const o of v.objects) {
        if (o.obj.light)
          lights.push({ x: o.img.x, y: o.img.y - 24, r: o.obj.light * TILE * (o.flame ? flicker : 1) });
        else if (o.obj.glow)
          lights.push({ x: o.img.x, y: o.img.y - o.img.displayHeight * 0.4, r: l.glowRadiusTiles * TILE });
      }
    }
    return lights;
  }

  // ------------------------------------------------------------------ отладка

  private installDebugKeys(): void {
    const kb = this.input.keyboard!;
    kb.on('keydown-F3', (e: KeyboardEvent) => {
      e.preventDefault();
      this.freeCam = !this.freeCam;
      this.debugOn = this.freeCam;
      if (!this.freeCam) {
        this.debugGfx.clear();
        this.overlay.setDebugText('');
      }
    });
    kb.on('keydown-F4', (e: KeyboardEvent) => {
      e.preventDefault();
      this.dayNight.timeScale = this.dayNight.timeScale === 1 ? FAST_TIME : 1;
    });
    kb.on('keydown-F8', (e: KeyboardEvent) => {
      // Чит до крафта (ТЗ 5, критерии): каменные топор и кирка, ключ, молоток — на пояс.
      e.preventDefault();
      const reg = registry();
      for (const id of ['axe_stone', 'pickaxe_stone', 'wrench', 'hammer_builder']) {
        const st = makeStack(reg, id, 1);
        if (this.hero.inv.hotbar.add(st) > 0) this.hero.inv.main.add(st);
      }
      this.game.events.emit(TOAST, t('hint.cheat_tools'));
    });
    kb.on('keydown-F11', (e: KeyboardEvent) => {
      // Shift+F11 — манекен-мишень; F11 — враг текущего биома по очереди (проверка механик).
      e.preventDefault();
      if (e.shiftKey) {
        this.spawnDummy();
        this.game.events.emit(TOAST, t('hint.dummy'));
        return;
      }
      const biome = this.world.cell(Math.floor(this.hero.pos.x), Math.floor(this.hero.pos.y)).biome;
      const ids = registry().biomes.get(biome)?.enemies ?? ['walker'];
      const id = ids[this.debugEnemy++ % ids.length]!;
      this.enemies.spawnEnemy(id, this.hero.pos.x + 4, this.hero.pos.y);
      this.game.events.emit(TOAST, registry().enemies.get(id)?.name_ru ?? id);
    });
    kb.on('keydown-F12', (e: KeyboardEvent) => {
      // Чит стройки: материалы, тотем, кровать, капкан, турель с патронами.
      e.preventDefault();
      const give: Record<string, number> = {
        planks: 99,
        nails_bolts: 60,
        wood: 60,
        scrap_metal: 40,
        clay: 30,
        stone: 40,
        hammer_builder: 1,
        base_core: 1,
        bed_pallets: 1,
        chest_wood: 1,
        garden: 1,
        rain_barrel: 1,
        bear_trap: 2,
        turret_mg: 1,
        ammo_rifle: 60,
        landmine: 1,
        barrel_explosive: 1,
        stakes: 2,
      };
      for (const [id, n] of Object.entries(give)) this.give(makeStack(registry(), id, n));
      this.game.events.emit(TOAST, t('hint.cheat_build'));
    });
    kb.on('keydown-F9', (e: KeyboardEvent) => {
      // Запасной режим героя целым спрайтом (ТЗ 4.3.8).
      e.preventDefault();
      setFallbackForced(!fallbackForced());
      this.hero.view.setMode(this.hero.view.useFallback());
      this.game.events.emit(
        TOAST,
        this.hero.view.isFallback ? 'Герой: запасной режим (F9)' : 'Герой: риг (F9)',
      );
    });
    kb.on('keydown-F10', (e: KeyboardEvent) => {
      e.preventDefault();
      this.hero.damage(DEBUG_DAMAGE);
    });
    kb.on('keydown-F5', (e: KeyboardEvent) => {
      e.preventDefault();
      if (this.scene.isActive(SceneKeys.WorldMap)) this.scene.stop(SceneKeys.WorldMap);
      else this.scene.launch(SceneKeys.WorldMap);
    });
  }

  // ------------------------------------------------------------------ добыча, подбор, контейнеры

  private viewOf(o: { x: number; y: number }): ChunkView | undefined {
    return this.views.get(
      World.key(Math.floor(o.x / this.world.chunkTiles), Math.floor(o.y / this.world.chunkTiles)),
    );
  }

  /** Удар по объекту: эффекты; добыт — падение дерева / раскол камня / смена спрайта, дроп на землю. */
  private onHarvest(o: WorldObject, hit: HitResult, finished: boolean, drops: WorldObject[]): void {
    const cv = this.viewOf(o);
    const v = cv?.findView(o.uid);
    this.fx.hit(o, v, hit, this.heroDrawX);
    const mat = registry().harvest.particles[o.kind] ?? 'wood';
    this.audio.play(mat === 'stone' ? 'hit_stone' : mat === 'metal' ? 'hit_metal' : 'hit_wood', 'sfx', 0.8);
    if (!finished) return;
    if (v && o.kind === 'tree') this.fx.treeFall(v, this.heroDrawX);
    if (o.kind === 'rock' || o.kind === 'deposit') this.fx.rockCrack(o);
    cv?.refreshObject(o);
    for (const d of drops) {
      const dv = this.viewOf(d);
      const view = dv?.ready ? dv.addObject(d) : null;
      if (view) this.fx.dropAppear(view);
    }
  }

  private onPickup(o: WorldObject, stack: ItemStack): void {
    const v = this.viewOf(o)?.detachObject(o.uid) ?? null;
    this.fx.pickup(v, stack, this.heroDrawX, this.heroDrawY);
    this.progress.track({ type: 'gather', item: stack.id, n: stack.count });
    this.audio.play('pickup', 'ui', 0.6);
  }

  /** «Собрать» без цели: машина рядом — её меню. */
  private freeAction(): boolean {
    const v = this.vehicles.near(this.hero.pos.x, this.hero.pos.y);
    if (v) {
      this.vehicles.openMenu(v);
      return true;
    }
    return false;
  }

  /**
   * Ворота биома (TZ 9.2.6): трофей босса в инвентаре + действие — ворота открываются навсегда
   * (створки удаляются из мира, это в дельте сохранения). Кольца выше mvpBiomeLimit — «Скоро».
   */
  private openGate(o: WorldObject): void {
    const reg = registry();
    if (o.biome > ctx().config.mvpBiomeLimit) {
      this.game.events.emit(TOAST, t('gate.soon'));
      return;
    }
    const need = o.requires;
    if (need && this.hero.inv.count(need) === 0) {
      this.game.events.emit(TOAST, t('gate.need', { item: reg.items.get(need)?.name_ru ?? need }));
      return;
    }
    const prefix = o.uid.replace(/_\d+$/, '_');
    for (const g of this.objectsNear(o.x, o.y, 8)) {
      if (g.kind !== 'gate' || !g.uid.startsWith(prefix)) continue;
      this.world.removeObject(g);
      const cv = this.viewOf(g);
      const v = cv?.findView(g.uid);
      if (v) this.fx.hit(g, v, { progress: 1, wear: 0, stamina: 0, proper: true }, this.heroDrawX);
      cv?.removeObject(g.uid);
    }
    cameraShake(this, 300, 0.01);
    this.progress.notify({
      kind: 'info',
      text: t('gate.opened', { biome: reg.biomes.get(o.biome)?.name_ru ?? '' }),
    });
    void this.saveNow();
  }

  /** Иконка действия над целью и на «умной» кнопке: рука — открыть/подобрать, инструмент — добыть, кулак — ударить. */
  actionIcon(): string | null {
    const tg = this.hero.target;
    if (!tg) return null;
    if (tg.kind === 'container' || tg.def.tool === 'hands') return 'ui.btn_action';
    // Добыча инструментом — иконка инструмента в руке; без подходящего — рука (подсказка «нужен …»).
    const held = this.hero.inv.held;
    const def = held ? registry().items.get(held.id) : undefined;
    return def?.toolType ? def.icon : 'ui.btn_action';
  }

  /** Инвентарь игрока (Tab/I, кнопка рюкзака). */
  openInventory(): void {
    if (this.hero.dead || this.scene.isActive(SceneKeys.Inventory)) return;
    this.scene.launch(SceneKeys.Inventory, { mode: 'player' });
  }

  /** Открыть контейнер: лут по таблице при первом открытии (делает сцена инвентаря), дальше — сохранённое содержимое. */
  openContainer(o: WorldObject): void {
    if (this.hero.dead || this.scene.isActive(SceneKeys.Inventory)) return;
    if (o.kind === 'gate') {
      this.openGate(o);
      return;
    }
    // Записки главной линии — в столах учёных и капсулах (harvest.json → noteObjects).
    if (
      o.ref.type === 'biome' &&
      registry().harvest.noteObjects.includes(o.ref.id) &&
      !this.progress.poiSet.has(`note_${o.uid}`)
    ) {
      this.progress.poi(`note_${o.uid}`, t('poi.note'));
      this.time.delayedCall(400, () => this.showNote());
    }
    if (o.kind === 'container' || containerInfo(registry(), o)) this.audio.play('chest', 'sfx', 0.7);
    if (o.ref.type === 'defense') {
      this.useDefense(o);
      return;
    }
    if (o.ref.type === 'station' && (BASE_STATIONS as readonly string[]).includes(o.ref.id)) {
      this.openBaseMenu(o);
      return;
    }
    if (isCraftStation(registry(), o) && containerInfo(registry(), o)?.type !== 'storage') {
      this.openCraft(o);
      return;
    }
    this.scene.launch(SceneKeys.Inventory, { mode: 'container', obj: o });
  }

  /** Контейнер открыт впервые: смена спрайта с отскоком. */
  containerOpened(o: WorldObject): void {
    const cv = this.viewOf(o);
    cv?.refreshObject(o);
    this.fx.containerOpen(cv?.findView(o.uid));
  }

  /** Контейнер закрыт: если рюкзак погибшего пуст — он исчезает. */
  containerClosed(o: WorldObject): void {
    if (
      o.ref.type === 'container' &&
      o.ref.id === 'dead_backpack' &&
      !this.world.containerContents(o)?.length
    ) {
      this.world.removeObject(o);
      this.viewOf(o)?.removeObject(o.uid);
    }
  }

  /** Выбросить стопку рядом с героем. */
  dropStack(stack: ItemStack): void {
    const o = this.world.dropItem(
      stack,
      this.hero.pos.x + this.hero.move.faceX * 0.8,
      this.hero.pos.y + this.hero.move.faceY * 0.8 + 0.1,
      this.dayNight.seconds,
    );
    this.hero.ignoreForPickup(o.uid);
    const cv = this.viewOf(o);
    const view = cv?.ready ? cv.addObject(o) : null;
    if (view) this.fx.dropAppear(view);
  }

  // ------------------------------------------------------------------ прогресс, звук (шаг 9)

  /** Звук (заглушка, если аудио недоступно). */
  get audio(): Pick<AudioBus, 'play' | 'loop'> {
    return audio() ?? { play: () => {}, loop: () => {} };
  }

  private moveAcc = 0;
  private lastHeroPos = { x: 0, y: 0 };
  private progressAcc = 0;
  private lastDay = 0;
  private stepAcc = 0;

  /** Прогресс по тикам: путь (обучение), посещённые чанки, точки интереса, утро, шаги и петли звука. */
  private tickProgress(dt: number): void {
    const h = this.hero.pos;
    const d = Math.hypot(h.x - this.lastHeroPos.x, h.y - this.lastHeroPos.y);
    this.lastHeroPos = { ...h };
    if (d < 1) {
      this.moveAcc += d;
      this.stepAcc += d;
    }
    if (this.moveAcc >= 1) {
      this.progress.track({ type: 'moved', tiles: Math.floor(this.moveAcc) });
      this.moveAcc -= Math.floor(this.moveAcc);
    }
    // Шаги — звук по пройденному пути.
    if (this.stepAcc >= 0.9 && !this.vehicles?.driving) {
      this.stepAcc = 0;
      this.audio.play('step', 'sfx', 0.35);
    }
    const day = this.dayState.day;
    if (this.lastDay && day > this.lastDay) this.progress.track({ type: 'morning' });
    this.lastDay = day;
    this.progressAcc += dt;
    if (this.progressAcc < 1) return;
    this.progressAcc = 0;
    const n = this.world.chunkTiles;
    // Туман войны: открываются чанки в радиусе fogRevealTiles от героя.
    const fr = registry().prog.map.fogRevealTiles;
    for (let cy = Math.floor((h.y - fr) / n); cy <= Math.floor((h.y + fr) / n); cy++)
      for (let cx = Math.floor((h.x - fr) / n); cx <= Math.floor((h.x + fr) / n); cx++)
        if (this.world.inChunkRange(cx, cy)) this.progress.visit(cx, cy);
    const R = registry().prog.xp.poiRadiusTiles;
    for (const p of this.world.layout.prefabs) {
      if (p.kind !== 'ruin' && p.kind !== 'arena' && p.kind !== 'bunker') continue;
      if (Math.hypot(p.x - h.x, p.y - h.y) > R + (p.radius ?? 0)) continue;
      const id = `${p.kind}_${Math.round(p.x)}_${Math.round(p.y)}`;
      this.progress.poi(id, t(`poi.${p.kind}`));
    }
    // Петли: костёр рядом, ветер на открытом месте ночью сильнее.
    const fire = this.objectsNear(h.x, h.y, 6).filter((o) => o.light && o.ref.type === 'station');
    const fd = fire.length ? Math.min(...fire.map((o) => Math.hypot(o.x - h.x, o.y - h.y))) : 99;
    this.audio.loop('campfire_loop', fd < 6 ? 0.6 * (1 - fd / 6) : 0);
    this.audio.loop('wind_loop', 0.15 + this.dayState.darkness * 0.15);
    audio()?.playMusic(this.dayState.phase === 'NIGHT' ? 'music_night' : null);
  }

  /** Навыки изменились: слоты инвентаря, максимум здоровья. */
  onSkillsChanged(): void {
    this.hero.inv.setBonusSlots(Math.round(this.progress.effect('inventorySlots')));
    this.hero.bonusHp = this.progress.effect('maxHp');
    this.highlight.bonusTiles = this.progress.effect('highlightRadius');
  }

  /** Шаг обучения пройден — HUD перерисует подсказку; на шаге «бой» — бродяга у забора. */
  onTutorialStep(): void {
    this.game.events.emit('tutorial-step');
    const st = this.progress.tutorialStep;
    if (st?.id === 'fight') this.enemies.spawnEnemy('walker', this.hero.pos.x + 7, this.hero.pos.y + 1);
    if (st?.id === 'note') this.time.delayedCall(800, () => this.showNote());
  }

  /** Записка (главная линия): панель с текстом; стартовая — сразу и следующая за ней. */
  showNote(): void {
    const biome = this.world.cell(Math.floor(this.hero.pos.x), Math.floor(this.hero.pos.y)).biome;
    const n = this.progress.readNext(Math.max(1, biome));
    if (!n) return;
    this.scene.launch(SceneKeys.Menu, {
      title: n.title,
      subtitle: n.text,
      items: [
        {
          label: t('ui.close'),
          fn: () => (n.at === 'start' ? this.time.delayedCall(300, () => this.showNote()) : undefined),
        },
      ],
    } satisfies MenuData);
  }

  /** Убит враг: опыт, задания, обучение, статистика. */
  onKill(enemyId: string): void {
    this.progress.track({ type: 'kill', enemy: enemyId, night: this.dayState.phase === 'NIGHT' });
  }

  // ------------------------------------------------------------------ крафт и станки

  get maxBiome(): number {
    return this.progress.maxBiome;
  }

  /** Навыки героя (шаг 9); пока — из прогресса, если есть. */
  get skills(): SkillLevels {
    return this.progress.skills;
  }

  /** Книга крафтов: у станка — его вкладка, иначе ближайший станок в радиусе или «Руки». */
  openCraft(station: WorldObject | null): void {
    if (this.hero.dead || this.scene.isActive(SceneKeys.Craft)) return;
    if (station?.ref.id === 'garden') {
      this.useGarden(station);
      return;
    }
    this.scene.stop(SceneKeys.Inventory);
    if (station) this.stations.of(station, this.dayNight.seconds);
    this.scene.launch(SceneKeys.Craft, { station: station ?? this.nearestStation() });
  }

  /** Грядка: созрело — урожай герою и посадка заново; иначе — сколько ещё расти. */
  private useGarden(o: WorldObject): void {
    const reg = registry();
    const now = this.dayNight.seconds;
    const st = this.stations.of(o, now);
    const got = this.stations.harvestGarden(
      st,
      now,
      (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1)),
    );
    if (got.length === 0) {
      const g = reg.craft.garden;
      const pct = Math.floor(
        ((now - (st.plantedAt ?? now)) / (g.growGameDays * reg.balance.dayNight.fullDaySec)) * 100,
      );
      this.game.events.emit(TOAST, t('craft.garden.growing', { pct: Math.min(99, pct) }));
      return;
    }
    for (const s of got) this.give(s);
    this.stationRefresh(o);
    const v = this.viewOf(o)?.findView(o.uid);
    if (v) popIn(this, v.img);
  }

  /** Ближайший станок с рецептами рядом с героем (вкладка по умолчанию). */
  private nearestStation(): WorldObject | null {
    const reg = registry();
    const R = reg.craft.stationOpenRadiusTiles;
    let best: WorldObject | null = null;
    let bd = Infinity;
    for (const o of this.objectsNear(this.hero.pos.x, this.hero.pos.y, R)) {
      if (o.ref.type !== 'station' || reg.recipes.byStation(o.ref.id).length === 0) continue;
      const d = Math.hypot(o.x - this.hero.pos.x, o.y - this.hero.pos.y);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  /** Объекты загруженных чанков в радиусе (по точке основания). */
  objectsNear(x: number, y: number, r: number): WorldObject[] {
    const out: WorldObject[] = [];
    const n = this.world.chunkTiles;
    for (let cy = Math.floor((y - r) / n); cy <= Math.floor((y + r) / n); cy++) {
      for (let cx = Math.floor((x - r) / n); cx <= Math.floor((x + r) / n); cx++) {
        if (!this.world.inChunkRange(cx, cy) || !this.world.isLoaded(cx, cy)) continue;
        for (const o of this.world.getChunk(cx, cy).objects)
          if (Math.hypot(o.x - x, o.y - y) <= r) out.push(o);
      }
    }
    return out;
  }

  /** Откуда брать ресурсы: инвентарь героя, затем сундуки в радиусе nearbyChestRadiusTiles от станка (или героя). */
  craftSources(at: { x: number; y: number } | null): CraftSource[] {
    const reg = registry();
    const inv = this.hero.inv;
    const out: CraftSource[] = [
      {
        count: (id) => inv.count(id),
        remove: (id, n) => {
          const k = inv.main.remove(id, n);
          return k + inv.hotbar.remove(id, n - k);
        },
      },
    ];
    const p = at ?? this.hero.pos;
    for (const o of this.objectsNear(p.x, p.y, reg.craft.nearbyChestRadiusTiles)) {
      const info = containerInfo(reg, o);
      if (info?.type !== 'storage') continue;
      const items = this.world.containerContents(o) ?? [];
      const box = new Inventory(reg, Math.max(info.slots, items.length), items);
      out.push({
        count: (id) => box.count(id),
        remove: (id, n) => box.remove(id, n),
        commit: () =>
          this.world.setContainerContents(
            o,
            box.slots.filter((s): s is ItemStack => !!s),
          ),
      });
    }
    return out;
  }

  /** Отдать предмет герою; не поместилось — на землю рядом. */
  give(stack: ItemStack): void {
    const left = this.hero.inv.add(stack);
    if (left > 0) this.dropStack({ ...stack, count: left });
  }

  /** Тик крафта: руки, станки (все сразу — работают и вдали от игрока), открытие рецептов по инвентарю. */
  private tickCraft(dt: number): void {
    const reg = registry();
    this.stations.tickHands(dt, (st) => {
      this.give(st);
      this.game.events.emit(TOAST, t('craft.crafted', { name: reg.items.require(st.id).name_ru }));
    });
    this.craftAcc += dt;
    if (this.craftAcc >= 0.25) {
      this.craftAcc = 0;
      this.stations.update(this.dayNight.seconds, this.skills);
    }
    this.scanAcc += dt;
    if (this.scanAcc >= 0.5) {
      this.scanAcc = 0;
      this.scanInventory();
    }
  }

  /**
   * Открытие рецептов по инвентарю (TZ 6.2): первый подбор ресурса тира ≥ noticeTier, чертёж
   * (расходуется — открывает случайный закрытый рецепт), трофей босса (остаётся у игрока).
   */
  private scanInventory(): void {
    const reg = registry();
    for (const o of this.objectsNear(this.hero.pos.x, this.hero.pos.y, 8))
      if (o.ref.type === 'station' && reg.recipes.byStation(o.ref.id).length > 0)
        this.seenStations.add(o.ref.id);
    const inv = this.hero.inv;
    const seen = new Set<string>();
    for (const s of [...inv.main.slots, ...inv.hotbar.slots]) if (s) seen.add(s.id);
    const fresh: string[] = [];
    for (const id of seen) {
      fresh.push(...noticeRecipes(reg, id, this.known));
      for (const r of trophyRecipes(reg, id)) {
        if (this.known.has(r)) continue;
        this.known.add(r);
        fresh.push(r);
      }
    }
    if (seen.has(reg.craft.blueprintItem)) {
      const r = blueprintRecipe(reg, this.known, Math.random());
      if (r) {
        inv.consume({ [reg.craft.blueprintItem]: 1 });
        this.known.add(r);
        const out = reg.recipes.require(r).output;
        this.game.events.emit(
          TOAST,
          t('craft.blueprint_learned', { name: reg.items.get(out)?.name_ru ?? out }),
        );
      }
    }
    if (fresh.length) this.progress.xp(reg.prog.xp.newRecipe * fresh.length);
    for (const r of fresh.slice(0, 3)) {
      const out = reg.recipes.require(r).output;
      this.progress.notify({
        kind: 'recipe',
        text: t('craft.new_recipe', { name: reg.items.get(out)?.name_ru ?? out }),
        icon: reg.items.get(out)?.icon,
      });
    }
  }

  // ------------------------------------------------------------------ строительство (шаг 7)

  /** Режим установки предмета-станка или защиты — режим строительства с выбранным предметом. */
  startPlacing(id: string): void {
    this.scene.stop(SceneKeys.Inventory);
    this.enterBuild({ kind: 'object', id });
  }

  /** Режим строительства: панель BuildScene, призрак в BuildController; HUD-кнопки скрыты. */
  enterBuild(sel?: BuildSel): void {
    if (this.hero.dead) return;
    this.build.enter(sel);
    if (this.scene.isActive(SceneKeys.Build)) this.scene.stop(SceneKeys.Build);
    this.scene.launch(SceneKeys.Build, {});
    this.game.events.emit(BUILD_MODE, true);
  }

  exitBuild(): void {
    this.build.exit();
    this.scene.stop(SceneKeys.Build);
    this.game.events.emit(BUILD_MODE, false);
  }

  /** Перерисовать стены чанков клеток (и чанка севернее — лицо стены над клеткой) и пересчитать комнату. */
  private rebuildCells(cells: readonly [number, number][]): void {
    const keys = new Set<string>();
    const n = this.world.chunkTiles;
    for (const [x, y] of cells)
      for (const yy of [y, y - 1]) keys.add(World.key(Math.floor(x / n), Math.floor(yy / n)));
    for (const k of keys) this.views.get(k)?.rebuildWalls();
    this.roomKey = '';
  }

  /** После постройки, улучшения, починки, разбора: перерисовка и эффекты (ANIMATIONS §7). */
  onBuilt(
    cells: readonly [number, number][],
    kind: 'place' | 'upgrade' | 'repair' | 'disassemble' | 'undo' | 'damage',
  ): void {
    this.rebuildCells(cells);
    for (const [x, y] of cells) {
      const cv = this.viewOf({ x: x + 0.5, y: y + 0.5 });
      const w = cv?.wallAt(x, y);
      const px = (x + 0.5) * TILE;
      const py = (y + 1) * TILE;
      if (kind === 'place') {
        if (w) for (const img of w.imgs) popIn(this, img);
        this.defenseViews.dustAt(px, py + 8, 6);
      } else if (kind === 'upgrade') {
        // Вспышка белым, искры.
        if (w)
          for (const img of w.imgs) {
            img.setTintFill(0xffffff);
            this.time.delayedCall(120, () => img.active && img.clearTint());
          }
        this.fx.hit(
          {
            uid: '',
            ref: { type: 'prefab', id: '' },
            kind: 'scrap',
            sprite: '',
            x: x + 0.5,
            y: y + 1,
            biome: 1,
            collider: null,
            state: 'intact',
          },
          undefined,
          { progress: 0, wear: 0, stamina: 0, proper: true },
          px,
        );
      } else if (kind === 'repair' || kind === 'damage') {
        if (w?.face) shake(this, w.face, 1);
        this.defenseViews.dustAt(px, py + 4, 4);
      } else if (kind === 'disassemble') {
        this.rubble(x, y);
      }
    }
    if (kind !== 'damage') void this.saveNow();
  }

  /** Обломки на rubbleSec + пыль (разрушение, разбор). */
  private rubble(tx: number, ty: number): void {
    const reg = registry();
    const mat = reg.building.materials[0]!;
    const img = spawnSprite(this, tx * TILE, (ty + 0.4) * TILE, mat.sprites.rubble, {
      depth: (ty + 1) * TILE,
    });
    this.defenseViews.dustAt((tx + 0.5) * TILE, (ty + 1) * TILE, 14);
    this.time.delayedCall(reg.build.rubbleSec * 1000, () =>
      this.tweens.add({ targets: img, alpha: 0, duration: 600, onComplete: () => img.destroy() }),
    );
  }

  /** Стена разрушена (взрыв, враги): обломки нужного материала, тряска камеры. */
  private wallDestroyed(tx: number, ty: number, mat: number): void {
    const m = registry().building.materials[mat] ?? registry().building.materials[0]!;
    const img = spawnSprite(this, tx * TILE, (ty + 0.4) * TILE, m.sprites.rubble, { depth: (ty + 1) * TILE });
    this.defenseViews.dustAt((tx + 0.5) * TILE, (ty + 1) * TILE, 18);
    cameraShake(this, 200, 0.006);
    this.time.delayedCall(registry().build.rubbleSec * 1000, () =>
      this.tweens.add({ targets: img, alpha: 0, duration: 600, onComplete: () => img.destroy() }),
    );
  }

  /** Стена игрока разрушена (враги, взрыв): обломки, перерисовка. */
  wallBroken(tx: number, ty: number): void {
    this.wallDestroyed(tx, ty, 0);
    this.rebuildCells([[tx, ty]]);
  }

  /** Дроп врага появился на земле. */
  onDropsAppeared(drops: readonly WorldObject[]): void {
    for (const d of drops) {
      const cv = this.viewOf(d);
      const v = cv?.ready ? cv.addObject(d) : null;
      if (v) this.fx.dropAppear(v);
    }
  }

  /** Опыт за врага (уровни — шаг 9). */
  addXp(n: number): void {
    this.progress.xp(n);
  }

  /** Взрыв (граната, толстяк, молотов): кадры, тряска, пятно. */
  explosionFx(x: number, y: number, radius: number, tint: number): void {
    this.defenseViews.explode(x, y, radius, tint);
  }

  /** Поставлен станок или защита: вид, отскок, пыль. */
  onObjectPlaced(o: WorldObject): void {
    this.progress.track({ type: 'place', item: o.ref.id });
    this.audio.play('build', 'sfx');
    if (o.ref.type === 'station') {
      this.stations.of(o, this.dayNight.seconds);
      this.stationViews.sync(o, this.dayNight.seconds);
    }
    const cv = this.viewOf(o);
    const v = cv?.ready ? cv.addObject(o) : null;
    if (v) popIn(this, v.img);
    this.defenseViews.dustAt(o.x * TILE, o.y * TILE, 8);
    this.defenseCache = null;
    const name = registry().items.get(o.ref.id)?.name_ru ?? o.ref.id;
    this.game.events.emit(TOAST, t('place.done', { name }));
    void this.saveNow();
  }

  /** Убрать поставленный объект (отмена). */
  removePlaced(o: WorldObject): void {
    this.stations.remove(o.uid);
    this.world.removeObject(o);
    this.viewOf(o)?.removeObject(o.uid);
    this.defenseCache = null;
  }

  /** Разобрать станок или защиту молотком (режим строительства, удержание). */
  disassembleObject(o: WorldObject): void {
    const reg = registry();
    if (o.ref.type === 'station') {
      this.disassemble(o, disassembleReturn(reg, o.ref.id));
      return;
    }
    const def = reg.defense.get(o.ref.id);
    if (!def) return;
    for (const [id, n] of Object.entries(def.cost)) {
      const k = Math.floor(n * reg.build.disassembleReturn);
      if (k > 0) this.give({ id, count: k });
    }
    const load = loadItemOf(def);
    const left = load ? Math.floor(((o.data?.['ammo'] ?? o.data?.['fuel']) as number | undefined) ?? 0) : 0;
    if (load && left > 0) this.give({ id: load, count: left });
    this.removePlaced(o);
    this.rubble(Math.floor(o.x), Math.floor(o.y - 0.5));
    void this.saveNow();
  }

  // ------------------------------------------------------------------ база, кровати, сон, телепорт

  /** Тотем базы (один на мир) или null. */
  baseCore(): { x: number; y: number; uid: string } | null {
    return this.stations.all.find((s) => s.id === 'base_core') ?? null;
  }

  /** Радиус базы по уровню тотема (12/16/20). */
  baseRadius(): number {
    const r = registry().stations.get('base_core')?.['radiusTiles'] as number[] | undefined;
    const core = this.baseCore();
    const lvl = core ? ((this.stations.get(core.uid) as { level?: number } | undefined)?.level ?? 1) : 1;
    return r?.[Math.min(r.length, lvl) - 1] ?? 12;
  }

  inBase(x: number, y: number): boolean {
    const c = this.baseCore();
    return !!c && Math.hypot(c.x - x, c.y - y) <= this.baseRadius();
  }

  outposts(): { x: number; y: number; uid: string }[] {
    return this.stations.all.filter((s) => s.id === 'outpost_beacon');
  }

  /** Меню у базовых объектов: кровать/спальник, тотем, аванпост, бочка. */
  private openBaseMenu(o: WorldObject): void {
    const reg = registry();
    const id = o.ref.id;
    const st = this.stations.of(o, this.dayNight.seconds);
    const items: MenuItem[] = [];
    const name = reg.stations.get(id)?.name_ru ?? id;
    let subtitle: string | undefined;
    if (id === 'rain_barrel') {
      const n = this.barrelWater(st);
      subtitle = t('base.barrel', { n, max: reg.build.base.rainBarrel.max });
      items.push({ label: t('base.take_water'), fn: () => this.takeBarrel(st), disabled: n <= 0 });
    }
    if (id === 'bed_pallets' || id === 'sleeping_bag') {
      this.hero.respawn = { x: o.x, y: o.y + 0.6 };
      subtitle = t('base.respawn_set');
      const cfg = { ...reg.balance.dayNight, transitionSec: reg.worldgen.dayNight.transitionSec };
      items.push({
        label: t('base.sleep'),
        fn: () => void this.sleep(),
        disabled: !canSleep(this.dayNight.seconds, cfg),
      });
    }
    if (id === 'base_core') {
      subtitle = t('base.core_info', { r: this.baseRadius() });
      items.push({ label: t('build.repair_base'), fn: () => this.repairBase() });
      // Улучшение тотема (build_rules.json → base.upgrades): уровень II у верстака II, III — у верстака III.
      const lvl = (st as { level?: number }).level ?? 1;
      const up = (
        reg.build.base['upgrades'] as
          { level: number; station: string; cost: Record<string, number> }[] | undefined
      )?.find((u) => u.level === lvl + 1);
      if (up) {
        const near = this.objectsNear(o.x, o.y, reg.build.requiresStationRadiusTiles).some(
          (x) => x.ref.type === 'station' && x.ref.id === up.station,
        );
        const cost = Object.entries(up.cost)
          .map(([i, n]) => `${reg.items.get(i)?.name_ru ?? i} ${n}`)
          .join(', ');
        items.push({
          label: t('base.upgrade', { lvl: up.level === 2 ? 'II' : 'III', cost }),
          disabled: !near || !consumeFromCheck(this.craftSources(o), up.cost),
          fn: () => {
            if (!consumeFrom(this.craftSources(o), up.cost)) return;
            (st as { level?: number }).level = up.level;
            this.progress.notify({ kind: 'info', text: t('base.upgraded', { r: this.baseRadius() }) });
            void this.saveNow();
          },
        });
        if (!near)
          subtitle += ` · ${t('build.need', { what: reg.stations.get(up.station)?.name_ru ?? up.station })}`;
      }
    }
    if (id === 'outpost_beacon')
      items.push({ label: t('base.call_vehicle'), fn: () => this.vehicles.callTo(o.x, o.y) });
    // Телепорт: домой (к тотему) и на аванпосты — точка межстраничной рекламы teleport.
    const core = this.baseCore();
    const here = (p: { x: number; y: number }) => Math.hypot(p.x - o.x, p.y - o.y) < 3;
    if (id !== 'rain_barrel') {
      if (core && !here(core) && !this.inBase(o.x, o.y))
        items.push({ label: t('base.tp_home'), fn: () => void this.teleportTo(core.x, core.y + 1) });
      this.outposts().forEach((p, i) => {
        if (!here(p))
          items.push({
            label: t('base.tp_outpost', { n: i + 1 }),
            fn: () => void this.teleportTo(p.x, p.y + 1),
          });
      });
    }
    items.push({ label: t('ui.back'), fn: () => {} });
    this.scene.launch(SceneKeys.Menu, { title: name, subtitle, items } satisfies MenuData);
  }

  /** Сколько воды накопила бочка (1 ед. в игровой час, до max). */
  private barrelWater(st: StationState): number {
    const rb = registry().build.base.rainBarrel;
    const since = st.plantedAt ?? st.at;
    if (st.plantedAt === undefined) st.plantedAt = since;
    const hours = (this.dayNight.seconds - since) / (registry().balance.dayNight.fullDaySec / 24);
    return Math.min(rb.max, Math.floor(hours * rb.perGameHour));
  }

  private takeBarrel(st: StationState): void {
    const n = this.barrelWater(st);
    if (n <= 0) return;
    this.give({ id: registry().build.base.rainBarrel.item, count: n });
    st.plantedAt = this.dayNight.seconds;
  }

  /** Телепорт к тотему/аванпосту: межстраничная реклама teleport, затемнение. */
  async teleportTo(x: number, y: number): Promise<void> {
    await AdsController.interstitial('teleport');
    this.cameras.main.fadeOut(250, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.teleport(x, y);
      this.cameras.main.fadeIn(300);
    });
  }

  /**
   * Сон (TZ 7.4.3): ночью и без врагов в noEnemiesRadiusTiles — затемнение, реклама sleep, утро.
   * Станки догоняют пропущенное время сами (фоновая работа по игровому времени).
   */
  private async sleep(): Promise<void> {
    const reg = registry();
    const R = reg.build.sleep.noEnemiesRadiusTiles;
    const h = this.hero.pos;
    if (
      [...this.dummies, ...this.enemies.alive.filter((e) => !e.passive)].some(
        (d) => d.hp > 0 && Math.hypot(d.x - h.x, d.y - h.y) <= R,
      )
    ) {
      this.game.events.emit(TOAST, t('base.enemies_near'));
      return;
    }
    const cfg = { ...reg.balance.dayNight, transitionSec: reg.worldgen.dayNight.transitionSec };
    const cam = this.cameras.main;
    cam.fadeOut(reg.build.sleep.fadeMs, 0, 0, 0);
    await new Promise<void>((r) => cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => r()));
    await AdsController.interstitial('sleep');
    this.dayNight.seconds = nextMorning(this.dayNight.seconds, cfg);
    // «Сон»: +20% здоровья за уровень навыка.
    const heal = this.progress.effect('sleepHeal');
    if (heal > 0)
      this.hero.vitals.hp = Math.min(this.hero.maxHp, this.hero.vitals.hp + this.hero.maxHp * heal);
    this.dayState = this.dayNight.state;
    this.stations.update(this.dayNight.seconds, this.skills);
    cam.fadeIn(reg.build.sleep.fadeMs);
    this.game.events.emit(TOAST, t('base.morning', { n: this.dayState.day }));
    void this.saveNow();
  }

  /** Починить всё на базе: стены и защиту в радиусе тотема, ресурсы — из сундуков базы. */
  repairBase(): void {
    const reg = registry();
    const core = this.baseCore();
    if (!core) return;
    const R = this.baseRadius();
    const src = this.craftSources(core).slice(1); // только сундуки базы
    const chests = this.objectsNear(core.x, core.y, R)
      .filter((o) => containerInfo(reg, o)?.type === 'storage')
      .map((o) => {
        const info = containerInfo(reg, o)!;
        const items = this.world.containerContents(o) ?? [];
        const box = new Inventory(reg, Math.max(info.slots, items.length), items);
        return { o, box };
      });
    const all: CraftSource[] = chests.map(({ o, box }) => ({
      count: (id: string) => box.count(id),
      remove: (id: string, n: number) => box.remove(id, n),
      commit: () =>
        this.world.setContainerContents(
          o,
          box.slots.filter((x): x is ItemStack => !!x),
        ),
    }));
    void src;
    let fixed = 0;
    let short = false;
    const cells: [number, number][] = [];
    for (const { tx, ty, cell } of [...this.world.builtCells()]) {
      if (Math.hypot(tx + 0.5 - core.x, ty + 0.5 - core.y) > R || cell.wall === undefined) continue;
      const cost = fullRepairCost(reg, cell);
      if (Object.keys(cost).length === 0) continue;
      if (!consumeFrom(all, cost)) {
        short = true;
        continue;
      }
      this.world.setBuilt(tx, ty, { ...cell, hp: reg.building.materials[cell.wall]!.hp });
      cells.push([tx, ty]);
      fixed++;
    }
    for (const o of this.objectsNear(core.x, core.y, R)) {
      const def = o.ref.type === 'defense' ? reg.defense.get(o.ref.id) : undefined;
      if (!def || o.hp === undefined || o.hp >= def.hp || o.hp <= 0) continue;
      o.hp = def.hp;
      fixed++;
    }
    if (cells.length) this.onBuilt(cells, 'repair');
    this.game.events.emit(
      TOAST,
      short ? t('base.repair_short', { n: fixed }) : t('base.repaired', { n: fixed }),
    );
  }

  /** Автосбор на базе: созревшие грядки и вода из бочек — в ближайший сундук базы. */
  private baseAutoCollect(): void {
    const reg = registry();
    const core = this.baseCore();
    if (!core) return;
    const R = this.baseRadius();
    const near = this.objectsNear(core.x, core.y, R);
    const chests = near.filter((o) => containerInfo(reg, o)?.type === 'storage');
    if (chests.length === 0) return;
    const now = this.dayNight.seconds;
    for (const o of near) {
      if (o.ref.type !== 'station' || (o.ref.id !== 'garden' && o.ref.id !== 'rain_barrel')) continue;
      const st = this.stations.of(o, now);
      let got: ItemStack[] = [];
      if (o.ref.id === 'garden')
        got = this.stations.harvestGarden(
          st,
          now,
          (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1)),
        );
      else {
        const n = this.barrelWater(st);
        if (n > 0) {
          got = [{ id: reg.build.base.rainBarrel.item, count: n }];
          st.plantedAt = now;
        }
      }
      if (got.length === 0) continue;
      const chest = chests.reduce((a, b) =>
        Math.hypot(b.x - o.x, b.y - o.y) < Math.hypot(a.x - o.x, a.y - o.y) ? b : a,
      );
      const info = containerInfo(reg, chest)!;
      const items = this.world.containerContents(chest) ?? [];
      const box = new Inventory(reg, Math.max(info.slots, items.length), items);
      for (const g of got) box.add(g);
      this.world.setContainerContents(
        chest,
        box.slots.filter((x): x is ItemStack => !!x),
      );
      this.stationRefresh(o);
    }
  }

  // ------------------------------------------------------------------ защита и манекены

  /** Защита в загруженных чанках рядом с героем (кэш на 0.5 с). */
  private defenses(): WorldObject[] {
    if (this.defenseCache) return this.defenseCache;
    const h = this.hero.pos;
    this.defenseCache = this.objectsNear(h.x, h.y, 48).filter((o) => o.ref.type === 'defense');
    return this.defenseCache;
  }

  /** Манекен-мишень (отладка F11): ходит туда-обратно справа от героя. */
  spawnDummy(x?: number, y?: number): Dummy {
    const d = new Dummy(
      registry(),
      `dummy${this.dummySeq++}`,
      x ?? this.hero.pos.x + 2,
      y ?? this.hero.pos.y,
    );
    this.dummies.push(d);
    return d;
  }

  /** Тик защиты: цели — манекены (и враги шага 8), герой — только для мин и взрывов. */
  private tickDefense(dt: number): void {
    const reg = registry();
    const now = this.dayNight.seconds;
    for (const d of this.dummies) d.tick(dt, now);
    const h = this.hero;
    const heroT: Target = {
      id: 'hero',
      x: h.pos.x,
      y: h.pos.y,
      r: this.heroR,
      hp: h.vitals.hp,
      maxHp: 100,
      rootedUntil: 0,
      slowUntil: 0,
      slowMul: 1,
      hero: true,
    };
    const targets: Target[] = [heroT, ...this.dummies, ...this.enemies.defenseTargets];
    const events: DefenseEvent[] = [];
    const env: DefenseEnv = {
      now,
      dt,
      powered: (x, y) => this.stations.poweredAt(x, y),
      contactCd: this.contactCd,
    };
    const list = this.defenses();
    for (const o of list) tickDefense(reg, o, targets, env, events);
    for (const ev of events) this.defenseEvent(ev, list, targets);
    this.dummies = this.dummies.filter((d) => d.hp > 0);
    // Разрушенная защита (кроме турелей — остаются обломками) исчезает.
    for (const o of list) {
      if ((o.hp ?? 1) > 0) continue;
      const def = reg.defense.get(o.ref.id);
      if (def?.destroyedSprite) continue;
      if (effectOf(def!).explosionDamage && !o.data?.['exploded']) continue;
      this.removePlaced(o);
    }
  }

  private defenseEvent(ev: DefenseEvent, list: WorldObject[], targets: Target[]): void {
    const views = (o: WorldObject) => this.viewOf(o)?.findView(o.uid);
    this.defenseViews.event(ev, views);
    if (ev.type === 'hit') {
      if (ev.target.hero) this.hero.damage(ev.damage);
      else ev.target.hp -= ev.damage;
    } else if (ev.type === 'alert') {
      this.enemies.noise(ev.o.x, ev.o.y, ev.radius);
    } else if (ev.type === 'trap') {
      this.defenseViews.sync(ev.o);
      this.viewOf(ev.o)?.refreshObject(ev.o);
    } else if (ev.type === 'explode') {
      const r = explosion(this.world, ev.x, ev.y, ev.radius, ev.damage, targets, list);
      for (const { t: tg, damage } of r.targets) {
        if (tg.hero) this.hero.damage(damage);
        else tg.hp -= damage;
      }
      const damaged = r.walls
        .filter((w) => w.result === 'damaged')
        .map((w) => [w.tx, w.ty] as [number, number]);
      for (const w of r.walls.filter((x) => x.result === 'destroyed')) this.wallDestroyed(w.tx, w.ty, 0);
      this.rebuildCells(r.walls.map((w) => [w.tx, w.ty]));
      if (damaged.length) this.onBuilt(damaged, 'damage');
    }
  }

  /** Взаимодействие с защитой: перезарядить ловушку, зарядить патроны/топливо из инвентаря. */
  private useDefense(o: WorldObject): void {
    const reg = registry();
    const def = reg.defense.get(o.ref.id);
    if (!def || !o.data) return;
    if (isOneShot(def)) {
      if (o.data['armed']) {
        this.game.events.emit(TOAST, t('def.armed'));
        return;
      }
      o.data['armed'] = true;
      if (def.id === 'landmine') o.hp = def.hp;
      this.defenseViews.sync(o);
      this.viewOf(o)?.refreshObject(o);
      this.game.events.emit(TOAST, t('def.rearmed', { name: def.name_ru }));
      return;
    }
    const item = loadItemOf(def);
    if (!item) return;
    const key = effectOf(def).ammo ? 'ammo' : 'fuel';
    const have = this.hero.inv.count(item);
    const room = reg.build.defense.ammoSlotMax - Math.floor((o.data[key] as number) ?? 0);
    const n = Math.min(have, room);
    if (n <= 0) {
      this.game.events.emit(
        TOAST,
        have ? t('def.full') : t('def.need', { item: reg.items.get(item)?.name_ru ?? item }),
      );
      return;
    }
    this.hero.inv.consume({ [item]: n });
    o.data[key] = ((o.data[key] as number) ?? 0) + n;
    this.game.events.emit(TOAST, t('def.loaded', { n, total: Math.floor(o.data[key] as number) }));
  }

  /** Разобрать станок молотком: половина ресурсов + всё, что в нём лежало. */
  disassemble(o: WorldObject, returned: ItemStack[]): void {
    for (const st of [...returned, ...this.stations.remove(o.uid)]) this.give(st);
    if (o.ref.type === 'station' && containerInfo(registry(), o)?.type === 'storage')
      for (const st of this.world.containerContents(o) ?? []) this.give(st);
    this.world.removeObject(o);
    const cv = this.viewOf(o);
    const v = cv?.findView(o.uid);
    if (v) this.fx.hit(o, v, { progress: 1, wear: 0, stamina: 0, proper: true }, this.heroDrawX);
    cv?.removeObject(o.uid);
    this.game.events.emit(TOAST, t('craft.disassembled'));
    void this.saveNow();
  }

  /** Вид объекта (для эффектов из окна станка). */
  stationRefresh(o: WorldObject): void {
    this.stationViews.sync(o, this.dayNight.seconds);
    this.viewOf(o)?.refreshObject(o);
  }

  // ------------------------------------------------------------------ смерть

  /**
   * Смерть (ТЗ 4.5): анимация → затемнение → межстраничная реклама «death» → экран «Вы погибли».
   * На время экрана — пауза DIALOG.
   */
  private onHeroDeath(): void {
    this.deathPos = { ...this.hero.pos };
    this.progress.death(this.hero.pos.x, this.hero.pos.y);
    if (this.vehicles.driving) this.vehicles.exit();
    this.controls.clear();
    this.cameras.main.fadeOut(DEATH_FADE_MS, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, async () => {
      await AdsController.interstitial(registry().survival.death.interstitialPlacement);
      this.scene.launch(SceneKeys.Death);
    });
  }

  /** Возрождение: на месте (реклама) или у кровати/бункера; рюкзак погибшего остаётся на месте смерти. */
  respawnHero(inPlace: boolean): void {
    const at = this.deathPos ?? this.hero.pos;
    if (!inPlace) {
      // Всё, кроме экипировки — в рюкзак погибшего на месте смерти (GDD §4).
      const pack = this.world.placeDeathBackpack(
        at.x,
        at.y,
        this.hero.inv.takeAllForDeath(),
        this.dayNight.seconds,
      );
      const v = this.views.get(
        World.key(Math.floor(pack.x / this.world.chunkTiles), Math.floor(pack.y / this.world.chunkTiles)),
      );
      if (v?.ready) v.addObject(pack);
    }
    const spawn = this.hero.respawn ?? this.world.start;
    this.hero.revive(inPlace, spawn);
    this.deathPos = null;
    this.cameras.main.centerOn(this.hero.pos.x * TILE, this.hero.pos.y * TILE - 32);
    this.cameras.main.fadeIn(DEATH_FADE_MS / 2);
    void this.saveNow();
  }

  /** Телепорт (карта F5): в ближайшую проходимую клетку. */
  teleport(x: number, y: number): void {
    for (let r = 0; r < 12; r++) {
      for (let a = 0; a < 16; a++) {
        const px = Math.floor(x + Math.cos((a / 16) * Math.PI * 2) * r) + 0.5;
        const py = Math.floor(y + Math.sin((a / 16) * Math.PI * 2) * r) + 0.5;
        const c = this.world.cell(Math.floor(px), Math.floor(py));
        if (c.passable && c.wall === 0) {
          this.hero.teleport(px, py);
          this.freeCam = false;
          this.cameras.main.centerOn(px * TILE, py * TILE);
          return;
        }
      }
    }
  }

  private drawDebug(): void {
    const g = this.debugGfx;
    g.clear();
    const span = this.world.chunkTiles * TILE;
    g.lineStyle(2, 0xffff00, 0.8);
    for (const v of this.views.values()) g.strokeRect(v.chunk.cx * span, v.chunk.cy * span, span, span);
    g.lineStyle(1, 0x00ffff, 0.9);
    for (const v of this.views.values()) {
      for (const o of v.objects) {
        const c = o.obj.collider;
        if (!c) continue;
        if (c.shape === 'circle') g.strokeCircle(c.x * TILE, c.y * TILE, c.r * TILE);
        else g.strokeRect(c.x0 * TILE, c.y0 * TILE, (c.x1 - c.x0) * TILE, (c.y1 - c.y0) * TILE);
      }
    }
    g.lineStyle(1, 0xff4040, 1).strokeCircle(this.heroDrawX, this.heroDrawY, this.heroR * TILE);
    const p = this.input.activePointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor(p.y / TILE);
    const cell = this.world.cell(tx, ty);
    const s = this.dayState;
    this.overlay.setDebugText(
      [
        'F3 свободная камера · F4 время ×10 · F5 карта · F8 чит-инструменты · F9 запасной режим · F10 урон',
        `курсор ${tx},${ty} · биом ${cell.biome} · тайл ${this.world.tileNames[cell.tile]} · ${cell.passable ? 'проходимо' : 'стена/вода'}`,
        `чанков: отрисовано ${this.views.size}, в памяти ${this.world.loadedChunkCount} · макс. постройка ${this.maxChunkBuildMs.toFixed(1)} мс`,
        `${t('hud.day', { n: s.day })} · ${s.phase} · темнота ${s.darkness.toFixed(2)} · свет ${(this.overlay.lighting?.lastCostMs ?? 0).toFixed(2)} мс`,
      ].join('\n'),
    );
  }
}

function consumeFromCheck(src: CraftSource[], cost: Record<string, number>): boolean {
  return Object.entries(cost).every(([id, n]) => src.reduce((a, x) => a + x.count(id), 0) >= n);
}
