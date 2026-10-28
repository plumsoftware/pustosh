/**
 * Причины паузы. Игра идёт, только когда набор причин пуст.
 * ORIENTATION — телефон в портрете (игра только горизонтальная).
 */
export type PauseReason = 'AD' | 'MENU' | 'TAB_HIDDEN' | 'PLATFORM' | 'DIALOG' | 'ORIENTATION';

export type PauseListener = (paused: boolean, reasons: ReadonlySet<PauseReason>) => void;

/**
 * Фиксированный шаг логики: 20 тиков в секунду (50 мс). Внешний цикл (Phaser) передаёт
 * реальную длительность кадра в advance(); GameClock сам системное время не читает.
 */
export class GameClock {
  static readonly TICK_MS = 50;
  static readonly TICKS_PER_SEC = 1000 / GameClock.TICK_MS;
  /** Длинный кадр (вкладка просыпалась, отладчик) обрезается, чтобы не догонять сотни тиков. */
  static readonly MAX_FRAME_MS = 250;

  private readonly reasons = new Set<PauseReason>();
  private readonly listeners = new Set<PauseListener>();
  private accumulatorMs = 0;
  private tickCount = 0;

  get ticks(): number {
    return this.tickCount;
  }

  /** Игровое время в секундах — только по тикам. */
  get gameTimeSec(): number {
    return this.tickCount / GameClock.TICKS_PER_SEC;
  }

  get isPaused(): boolean {
    return this.reasons.size > 0;
  }

  get pauseReasons(): ReadonlySet<PauseReason> {
    return this.reasons;
  }

  /** Доля до следующего тика (0..1) — для интерполяции рендера. */
  get alpha(): number {
    return this.accumulatorMs / GameClock.TICK_MS;
  }

  pause(reason: PauseReason): void {
    if (this.reasons.has(reason)) return;
    const wasPaused = this.isPaused;
    this.reasons.add(reason);
    if (!wasPaused) this.accumulatorMs = 0;
    this.emit();
  }

  resume(reason: PauseReason): void {
    if (!this.reasons.delete(reason)) return;
    this.emit();
  }

  isPausedBy(reason: PauseReason): boolean {
    return this.reasons.has(reason);
  }

  /**
   * Продвигает часы на реальную длительность кадра и вызывает onTick для каждого целого тика.
   * На паузе тики не идут и время не накапливается. Возвращает число выполненных тиков.
   */
  advance(realDeltaMs: number, onTick?: (tick: number) => void): number {
    if (this.isPaused || !(realDeltaMs > 0)) return 0;
    this.accumulatorMs += Math.min(realDeltaMs, GameClock.MAX_FRAME_MS);
    let done = 0;
    while (this.accumulatorMs >= GameClock.TICK_MS) {
      this.accumulatorMs -= GameClock.TICK_MS;
      this.tickCount++;
      done++;
      onTick?.(this.tickCount);
    }
    return done;
  }

  /** Подписка на смену состояния паузы; возвращает функцию отписки. */
  onPauseChange(listener: PauseListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const paused = this.isPaused;
    for (const l of this.listeners) l(paused, this.reasons);
  }
}
