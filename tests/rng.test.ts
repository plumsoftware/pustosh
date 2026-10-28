import { describe, expect, it } from 'vitest';
import { hashSeed, Rng } from '../src/core/util/rng';

describe('Rng', () => {
  it('детерминирован по сиду', () => {
    const a = new Rng(20261027);
    const b = new Rng(20261027);
    const seqA = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seqA);
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('int в границах, hashSeed зависит от координат', () => {
    const r = new Rng(1);
    for (let i = 0; i < 200; i++) {
      const v = r.int(2, 4);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(4);
    }
    expect(hashSeed(1, 0, 1)).not.toBe(hashSeed(1, 1, 0));
  });
});
