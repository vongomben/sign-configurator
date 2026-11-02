import { describe, expect, it } from 'vitest';
import { squaredDistanceTo } from '../src/geometry/distance';
import { measureTubes } from '../src/geometry/tubes';

/** Generatore pseudo-casuale deterministico (mulberry32). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('squaredDistanceTo', () => {
  it('coincide con la forza bruta su griglie casuali', () => {
    const rand = rng(7);
    for (const [w, h, density] of [[17, 11, 0.05], [30, 23, 0.2], [9, 40, 0.01], [25, 25, 0.5]] as const) {
      const mask = new Uint8Array(w * h).map(() => (rand() < density ? 1 : 0));
      mask[0] = 1;
      const d = squaredDistanceTo(mask, w, h, 1);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let best = Infinity;
          for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) {
              if (mask[j * w + i]) best = Math.min(best, (i - x) ** 2 + (j - y) ** 2);
            }
          }
          expect(d[y * w + x], `${w}×${h} (${x}, ${y})`).toBe(best);
        }
      }
    }
  });

  it('senza siti: distanza "infinita"', () => {
    const d = squaredDistanceTo(new Uint8Array(12), 4, 3, 1);
    expect(Math.min(...d)).toBeGreaterThan(1e19);
  });
});

describe('measureTubes', () => {
  it('tubi sintetici: linee da 5 px, luce da 11 px', () => {
    const w = 240;
    const h = 200;
    const data = new Uint8Array(w * h);
    for (let k = 0; k < 3; k++) {
      const y0 = 10 + k * 60;
      for (const [from, rows] of [[y0, 5], [y0 + 16, 5]] as const) {
        for (let y = from; y < from + rows; y++) data.fill(1, y * w + 20, y * w + 220);
      }
    }
    expect(measureTubes(data, w, h)).toEqual({ lineWidthPx: 5, gapPx: 11 });
  });
});
