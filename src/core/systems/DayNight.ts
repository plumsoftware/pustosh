export type DayPhase = 'DAWN' | 'DAY' | 'DUSK' | 'NIGHT';

export interface DayNightConfig {
  fullDaySec: number;
  daySec: number;
  nightSec: number;
  bloodNightEvery: number;
  transitionSec: number;
}

export interface DayNightState {
  /** Номер дня, с 1. */
  day: number;
  /** Секунды от начала суток, 0…fullDaySec. */
  timeOfDay: number;
  phase: DayPhase;
  /** Доля пройденной фазы 0…1. */
  phaseProgress: number;
  /** Кровавая ночь (каждая N-я). Флаг держится всю ночь этого дня. */
  bloodNight: boolean;
  /** Темнота 0 (день) … 1 (ночь), плавно на рассвете и закате. */
  darkness: number;
  /** Сила тёплого тона заката/рассвета 0…1. */
  warm: number;
  /** Секунды от начала ночи (для пульса кровавой ночи), -1 — не ночь. */
  nightElapsed: number;
}

/**
 * Время суток по игровым секундам. Сутки: рассвет (transitionSec) → день → закат (transitionSec) → ночь.
 * Чистая функция: время приходит из тиков GameClock.
 */
export function dayNightAt(sec: number, cfg: DayNightConfig): DayNightState {
  const t = ((sec % cfg.fullDaySec) + cfg.fullDaySec) % cfg.fullDaySec;
  const day = Math.floor(sec / cfg.fullDaySec) + 1;
  const tr = Math.min(cfg.transitionSec, cfg.daySec / 2);
  const bloodNight = day % cfg.bloodNightEvery === 0;
  let phase: DayPhase;
  let progress: number;
  let darkness: number;
  if (t < tr) {
    phase = 'DAWN';
    progress = t / tr;
    darkness = 1 - smooth(progress);
  } else if (t < cfg.daySec - tr) {
    phase = 'DAY';
    progress = (t - tr) / (cfg.daySec - 2 * tr);
    darkness = 0;
  } else if (t < cfg.daySec) {
    phase = 'DUSK';
    progress = (t - (cfg.daySec - tr)) / tr;
    darkness = smooth(progress);
  } else {
    phase = 'NIGHT';
    progress = (t - cfg.daySec) / cfg.nightSec;
    darkness = 1;
  }
  const warm = phase === 'DAWN' || phase === 'DUSK' ? Math.sin(progress * Math.PI) : 0;
  return {
    day,
    timeOfDay: t,
    phase,
    phaseProgress: progress,
    bloodNight: bloodNight && (phase === 'NIGHT' || phase === 'DUSK'),
    darkness,
    warm,
    nightElapsed: phase === 'NIGHT' ? t - cfg.daySec : -1,
  };
}

function smooth(x: number): number {
  return x * x * (3 - 2 * x);
}

/** Игровое время суток: тикает от GameClock, ускорение для отладки (F4). */
/** Утро после сна (TZ 7.4.3): конец рассвета следующих суток (или текущих, если ещё ночь до полуночи). */
export function nextMorning(sec: number, cfg: DayNightConfig): number {
  const tr = Math.min(cfg.transitionSec, cfg.daySec / 2);
  return Math.floor(sec / cfg.fullDaySec + 1) * cfg.fullDaySec + tr;
}

/** Можно ли лечь спать: закат или ночь. */
export function canSleep(sec: number, cfg: DayNightConfig): boolean {
  const p = dayNightAt(sec, cfg).phase;
  return p === 'NIGHT' || p === 'DUSK';
}

export class DayNightSystem {
  /** Игровые секунды с начала мира. */
  seconds: number;
  timeScale = 1;

  constructor(
    readonly cfg: DayNightConfig,
    startSec = 0,
  ) {
    this.seconds = startSec;
  }

  tick(dtSec: number): void {
    this.seconds += dtSec * this.timeScale;
  }

  get state(): DayNightState {
    return dayNightAt(this.seconds, this.cfg);
  }
}
