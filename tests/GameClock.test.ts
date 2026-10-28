import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/core/util/GameClock';

describe('GameClock', () => {
  it('выполняет тик каждые 50 мс и копит остаток', () => {
    const c = new GameClock();
    expect(c.advance(120)).toBe(2);
    expect(c.ticks).toBe(2);
    expect(c.alpha).toBeCloseTo(0.4);
    expect(c.advance(30)).toBe(1);
    expect(c.gameTimeSec).toBeCloseTo(0.15);
  });

  it('две причины паузы: игра идёт, только когда сняты обе', () => {
    const c = new GameClock();
    c.pause('AD');
    c.pause('TAB_HIDDEN');
    expect(c.isPaused).toBe(true);
    c.resume('AD');
    expect(c.isPaused).toBe(true);
    expect(c.isPausedBy('TAB_HIDDEN')).toBe(true);
    c.resume('TAB_HIDDEN');
    expect(c.isPaused).toBe(false);
  });

  it('на паузе тиков нет и время не копится', () => {
    const c = new GameClock();
    c.advance(40);
    c.pause('MENU');
    expect(c.advance(1000)).toBe(0);
    expect(c.ticks).toBe(0);
    c.resume('MENU');
    // Остаток до паузы сброшен: 40 мс не «доигрываются» после возврата.
    expect(c.advance(40)).toBe(0);
    expect(c.advance(10)).toBe(1);
  });

  it('обрезает длинный кадр, чтобы не догонять сотни тиков', () => {
    const c = new GameClock();
    expect(c.advance(10_000)).toBe(GameClock.MAX_FRAME_MS / GameClock.TICK_MS);
  });

  it('сообщает слушателям о смене паузы, повторная причина не дублирует событие', () => {
    const c = new GameClock();
    const events: boolean[] = [];
    const off = c.onPauseChange((p) => events.push(p));
    c.pause('AD');
    c.pause('AD');
    c.resume('AD');
    c.resume('AD');
    off();
    c.pause('MENU');
    expect(events).toEqual([true, false]);
  });

  it('вызывает onTick с номером тика', () => {
    const c = new GameClock();
    const seen: number[] = [];
    c.advance(150, (t) => seen.push(t));
    expect(seen).toEqual([1, 2, 3]);
  });
});
