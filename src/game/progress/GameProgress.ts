import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import type { Registry } from '../../core/data/Registry';
import type { SaveGame } from '../../core/save';
import { addXp, learn, skillEffect, type LevelState } from '../../core/systems/Progress';
import {
  addExtraTask,
  emptyQuests,
  nextNote,
  onQuestEvent,
  refreshDaily,
  type DailyTask,
  type QuestEvent,
  type QuestState,
} from '../../core/systems/Quests';
import {
  currentStep,
  newTutorial,
  skipTutorial,
  tutorialEvent,
  type TutorialEvent,
  type TutorialState,
} from '../../core/systems/Tutorial';
import type { NoteDef } from '../../core/data/schemas';
import { AdsController } from '../AdsController';
import { registry } from '../GameContext';
import { TILE } from '../render/GroundTiles';
import * as Fx from '../render/Fx';
import { DEPTH } from '../render/ChunkView';
import type { WorldScene } from '../scenes/WorldScene';

/** Уведомление HUD (ANIMATIONS §11): плашка сверху с иконкой, 2.5 с. */
export const NOTIFY = 'notify';
export interface Notice {
  text: string;
  icon?: string;
  kind: 'item' | 'recipe' | 'level' | 'quest' | 'note' | 'info';
}

/** Сутки реального времени (для ежедневных заданий) — даёт игра, не core. */
export function realDay(): number {
  return Math.floor(Date.now() / 86_400_000);
}

export interface MapState {
  visited: string[];
  deaths: [number, number][];
  pois: string[];
  /** Метки игрока. */
  pins?: MapPin[];
  /** Отслеживаемая метка (стрелка в HUD): id метки игрока или авто-метки. */
  tracked?: { x: number; y: number; label: string; color: string } | null;
  /** Скрытые на карте группы меток. */
  hidden?: string[];
}

/** Метка игрока на карте. */
export interface MapPin {
  id: string;
  x: number;
  y: number;
  /** Тип из progression.json → map.pins.types. */
  type: string;
  label: string;
}

export interface PinType {
  icon: string;
  color: string;
  name_ru: string;
}

/** Событие: метки изменились (карта, мини-карта, HUD). */
export const PINS_CHANGED = 'pins-changed';

/**
 * Прогресс игрока (шаг 9): опыт и уровни, навыки, задания (ежедневные и записки главной линии),
 * обучение, карта (посещённые чанки, места смерти, точки интереса), статистика. Сохраняется в SaveGame.
 */
export class GameProgress {
  lv: LevelState;
  maxBiome = 1;
  quests: QuestState = emptyQuests();
  tutorial: TutorialState = newTutorial();
  bosses = new Set<string>();
  map: MapState = { visited: [], deaths: [], pois: [] };
  stats: Record<string, number> = {};
  private visited = new Set<string>();
  private pois = new Set<string>();

  constructor(
    private readonly scene: WorldScene,
    private readonly reg: Registry,
    save: SaveGame | null,
  ) {
    const p = save?.progress;
    this.lv = { level: p?.level ?? 1, xp: p?.xp ?? 0, skills: { ...(p?.skills ?? {}) } };
    this.maxBiome = p?.maxBiome ?? 1;
    if (save) {
      this.quests = { ...emptyQuests(), ...(save.quests as unknown as QuestState) };
      this.tutorial = { ...newTutorial(), ...(save.tutorial as TutorialState) };
      this.bosses = new Set(save.bosses);
      this.map = { ...this.map, ...(save.map as MapState) };
      this.stats = { ...save.stats };
    }
    this.visited = new Set(this.map.visited);
    this.pois = new Set(this.map.pois);
    refreshDaily(reg, this.quests, reg.balance.world.seed, realDay(), this.maxBiome);
  }

  get skills(): Readonly<Record<string, number>> {
    return this.lv.skills;
  }

  effect(key: string): number {
    return skillEffect(this.reg, this.lv.skills, key);
  }

  toSave(): Pick<SaveGame, 'quests' | 'tutorial' | 'bosses' | 'map' | 'stats'> & {
    progress: SaveGame['progress'];
  } {
    this.map.visited = [...this.visited];
    this.map.pois = [...this.pois];
    return {
      progress: {
        level: this.lv.level,
        xp: this.lv.xp,
        maxBiome: this.maxBiome,
        skills: { ...this.lv.skills },
      },
      quests: JSON.parse(JSON.stringify(this.quests)) as SaveGame['quests'],
      tutorial: { ...this.tutorial },
      bosses: [...this.bosses],
      map: JSON.parse(JSON.stringify(this.map)) as SaveGame['map'],
      stats: { ...this.stats },
    };
  }

  notify(n: Notice): void {
    this.scene.game.events.emit(NOTIFY, n);
  }

  // ------------------------------------------------------------------ опыт и навыки

  /** Опыт: уровень — плашка и золотая вспышка вокруг героя с блёстками. */
  xp(n: number): void {
    const gained = addXp(this.reg, this.lv, Math.round(n));
    if (!gained) return;
    this.notify({ kind: 'level', text: t('prog.level_up', { n: this.lv.level }) });
    this.scene.audio.play('level_up', 'ui');
    this.levelFx();
    this.tip('skills');
  }

  private levelFx(): void {
    const s = this.scene;
    const x = s.hero.pos.x * TILE;
    const y = s.hero.pos.y * TILE - 40;
    const ring = s.add
      .circle(x, y, 20, 0xffd040, 0.5)
      .setDepth(DEPTH.glow + 2)
      .setBlendMode(Phaser.BlendModes.ADD);
    s.tweens.add({ targets: ring, scale: 4, alpha: 0, duration: 700, onComplete: () => ring.destroy() });
    // Золотые лучи (s32).
    Fx.burst(s, 'effects.levelup_burst', x, y, {
      from: 40,
      to: 150,
      ms: 800,
      depth: DEPTH.glow + 2,
      add: true,
    });
    const sp = Fx.particles(s, ['effects.sparkle_1', 'effects.sparkle_2'], {
      tint: 0xffe070,
      lifespan: 900,
      speed: { min: 40, max: 120 },
      scale: { start: 0.3, end: 0 },
      gravityY: -40,
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(DEPTH.glow + 3);
    sp.explode(24, x, y);
    s.time.delayedCall(1200, () => sp.destroy());
  }

  learn(id: string): boolean {
    const ok = learn(this.reg, this.lv, id);
    if (ok) this.scene.onSkillsChanged();
    return ok;
  }

  // ------------------------------------------------------------------ события игры

  /** Добыча / крафт / убийство → опыт, задания, обучение. */
  track(ev: QuestEvent | TutorialEvent): void {
    const reg = this.reg;
    const X = reg.prog.xp;
    if (ev.type === 'gather') {
      const tier = reg.items.get(ev.item)?.tier ?? 0;
      if (tier >= 1) this.xp(X.perHarvestedResourceTier1 * ev.n);
      this.count('gathered', ev.n);
    } else if (ev.type === 'craft') {
      this.xp(X.craftPerTier * Math.max(1, reg.items.get(ev.item)?.tier ?? 1) * ('n' in ev ? ev.n : 1));
      this.count('crafted', 'n' in ev ? ev.n : 1);
    } else if (ev.type === 'kill') {
      this.count('kills', 1);
      const fam = 'enemy' in ev ? reg.enemies.get(ev.enemy as string)?.family : undefined;
      if (fam) this.count(`kills_${fam}`, 1);
    } else if (ev.type === 'moved') {
      this.count(this.scene.vehicles?.driving ? 'driven' : 'walked', ev.tiles);
    }
    if (ev.type === 'gather' || ev.type === 'craft' || (ev.type === 'kill' && 'enemy' in ev)) {
      const qev =
        ev.type === 'craft'
          ? { type: 'craft' as const, item: ev.item, n: 'n' in ev ? ev.n : 1 }
          : (ev as QuestEvent);
      for (const task of onQuestEvent(this.quests, qev)) this.taskDone(task);
    }
    const tev: TutorialEvent =
      ev.type === 'kill'
        ? { type: 'kill' }
        : ev.type === 'craft'
          ? { type: 'craft', item: ev.item }
          : (ev as TutorialEvent);
    if (tutorialEvent(reg, this.tutorial, tev)) this.scene.onTutorialStep();
  }

  /** Счётчик статистики (stats в сохранении). */
  count(k: string, n = 1): void {
    if (!n) return;
    this.stats[k] = (this.stats[k] ?? 0) + n;
    if (k.startsWith('kills'))
      this.stats['lifeKills'] = (this.stats['lifeKills'] ?? 0) + (k === 'kills' ? n : 0);
  }

  /** Рекорд: stats[k] = max(stats[k], v). */
  record(k: string, v: number): void {
    if (v > (this.stats[k] ?? 0)) this.stats[k] = v;
  }

  // ------------------------------------------------------------------ метки на карте

  get pinTypes(): Record<string, PinType> {
    return ((this.reg.prog.map['pins'] as { types?: Record<string, PinType> } | undefined)?.types ??
      {}) as Record<string, PinType>;
  }

  get pins(): MapPin[] {
    return (this.map.pins ??= []);
  }

  /** Новая метка; null — достигнут лимит. */
  addPin(x: number, y: number, type: string, label: string): MapPin | null {
    const max = (this.reg.prog.map['pins'] as { max?: number } | undefined)?.max ?? 100;
    if (this.pins.length >= max) return null;
    const pin: MapPin = { id: `p${Date.now().toString(36)}${this.pins.length}`, x, y, type, label };
    this.pins.push(pin);
    this.count('pinsPlaced');
    this.scene.game.events.emit(PINS_CHANGED);
    return pin;
  }

  removePin(id: string): void {
    const p = this.pins.find((x) => x.id === id);
    this.map.pins = this.pins.filter((x) => x.id !== id);
    if (p && this.map.tracked && this.map.tracked.x === p.x && this.map.tracked.y === p.y)
      this.map.tracked = null;
    this.scene.game.events.emit(PINS_CHANGED);
  }

  /** Вести к точке (стрелка в HUD) или перестать (null). */
  setTracked(target: MapState['tracked']): void {
    this.map.tracked = target;
    this.scene.game.events.emit(PINS_CHANGED);
  }

  isHidden(group: string): boolean {
    return (this.map.hidden ?? []).includes(group);
  }

  toggleHidden(group: string): void {
    const h = new Set(this.map.hidden ?? []);
    if (h.has(group)) h.delete(group);
    else h.add(group);
    this.map.hidden = [...h];
  }

  private taskDone(task: DailyTask): void {
    this.notify({
      kind: 'quest',
      text: t('quest.done', { name: this.taskName(task) }),
      icon: this.reg.items.get(task.reward.id)?.icon,
    });
  }

  /** Забрать награду выполненного задания. */
  claim(task: DailyTask): void {
    if (task.claimed || task.done < task.n) return;
    task.claimed = true;
    this.scene.give({ id: task.reward.id, count: task.reward.count });
    this.scene.audio.play('ui_confirm', 'ui');
  }

  /** Реклама за награду extra_daily — ещё одно задание сегодня. */
  async extraTask(): Promise<boolean> {
    if (this.quests.extraTaken) return false;
    const r = await AdsController.rewarded('extra_daily');
    if (r !== 'rewarded') return false;
    return !!addExtraTask(this.reg, this.quests, this.reg.balance.world.seed, this.maxBiome);
  }

  taskName(task: DailyTask): string {
    const reg = this.reg;
    const what =
      task.type === 'gather' || task.type === 'craft'
        ? (reg.items.get(task.target)?.name_ru ?? task.target)
        : (reg.enemies.get(task.target)?.name_ru ?? task.target);
    return t(`quest.${task.type}`, { what, n: task.n });
  }

  // ------------------------------------------------------------------ записки

  /** Прочитать следующую записку (из стола учёного, сейфа, стартовую) — опыт, метка босса, обучение. */
  readNext(biome: number): NoteDef | null {
    const n = nextNote(this.reg, this.quests, biome);
    if (!n) return null;
    this.quests.notesRead.push(n.id);
    this.notify({ kind: 'note', text: t('note.found', { title: n.title }) });
    if (tutorialEvent(this.reg, this.tutorial, { type: 'note' })) this.scene.onTutorialStep();
    return n;
  }

  // ------------------------------------------------------------------ карта и места

  /** Посещённый чанк (туман войны) — true, если новый. */
  visit(cx: number, cy: number): boolean {
    const k = `${cx},${cy}`;
    if (this.visited.has(k)) return false;
    this.visited.add(k);
    return true;
  }

  isVisited(cx: number, cy: number): boolean {
    return this.visited.has(`${cx},${cy}`);
  }

  /** Первое посещение точки интереса (руины, посёлок, арена) — опыт и метка. */
  poi(id: string, name: string): void {
    if (this.pois.has(id)) return;
    this.pois.add(id);
    this.xp(this.reg.prog.xp.poiFirstVisit);
    this.notify({ kind: 'info', text: t('prog.poi', { name }) });
  }

  get poiSet(): ReadonlySet<string> {
    return this.pois;
  }

  death(x: number, y: number): void {
    this.map.deaths.push([x, y]);
    const max = (this.reg.prog.map['markers'] as { deathMax?: number } | undefined)?.deathMax ?? 3;
    while (this.map.deaths.length > max) this.map.deaths.shift();
  }

  // ------------------------------------------------------------------ обучение

  /**
   * Подсказка по ходу игры (tip.<id> в ru.json): один раз за игру, после основного обучения,
   * если игрок их не отключил. Показывает WorldScene, когда не открыто другое окно.
   */
  tip(id: string): void {
    const T = this.tutorial;
    if (!T.done || T.tipsOff) return;
    T.tips ??= [];
    if (T.tips.includes(id)) return;
    T.tips.push(id);
    this.scene.queueTip(id);
  }

  get tutorialStep(): { id: string; event: string; n: number; items?: string[] } | null {
    return currentStep(this.reg, this.tutorial);
  }

  skipTutorial(): void {
    skipTutorial(this.tutorial);
    this.scene.onTutorialStep();
  }

  /** Обучение идёт и это первая ночь — спавн вполовину. */
  get spawnMul(): number {
    return !this.tutorial.done && this.scene.dayState.day <= 1
      ? this.reg.prog.tutorial.firstNightSpawnMul
      : 1;
  }
}

export function reg(): Registry {
  return registry();
}
