import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { setStrings, t } from '../src/core/i18n/i18n';

describe('i18n', () => {
  it('подставляет параметры', () => {
    setStrings({ 'hud.day': 'День {n}', 'a.b': 'x {y} {z}' });
    expect(t('hud.day', { n: 3 })).toBe('День 3');
    expect(t('a.b', { y: 1 })).toBe('x 1 {z}');
  });

  it('отсутствующий ключ: в debug подсвечивается [[key]], иначе — сам ключ', () => {
    setStrings({}, { debug: true });
    expect(t('ui.play')).toBe('[[ui.play]]');
    setStrings({}, { debug: false });
    expect(t('ui.play')).toBe('ui.play');
  });

  it('ru.json — плоский словарь строк', () => {
    const ru = JSON.parse(readFileSync(new URL('../public/i18n/ru.json', import.meta.url), 'utf8')) as Record<
      string,
      unknown
    >;
    for (const [k, v] of Object.entries(ru)) expect(typeof v, k).toBe('string');
    expect(ru['ui.play']).toBeTruthy();
  });
});
