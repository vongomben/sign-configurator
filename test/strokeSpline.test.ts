import { describe, expect, it } from 'vitest';
import type { Point } from '../src/geometry/rasterize';
import { splineThroughPolyline } from '../src/geometry/smooth';

const near = (pts: readonly Point[], p: Point): number => Math.min(...pts.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1])));

function maxTurnDeg(pts: readonly Point[]): number {
  let worst = 0;
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const u = [b[0] - a[0], b[1] - a[1]];
    const v = [c[0] - b[0], c[1] - b[1]];
    const cos = (u[0]! * v[0]! + u[1]! * v[1]!) / (Math.hypot(u[0]!, u[1]!) * Math.hypot(v[0]!, v[1]!));
    worst = Math.max(worst, (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI);
  }
  return worst;
}

describe('spline dei font a tratto singolo', () => {
  it('passa per ogni vertice e toglie i gomiti di una spezzata grossolana', () => {
    // Un arco approssimato con 6 corde, come i glifi Hershey: gomiti da 30°.
    const coarse: Point[] = Array.from({ length: 7 }, (_, i) => {
      const a = (i / 6) * Math.PI;
      return [50 * Math.cos(a), 50 * Math.sin(a)];
    });
    const curve = splineThroughPolyline(coarse, false);
    for (const p of coarse) expect(near(curve, p)).toBeLessThan(1e-6);
    expect(maxTurnDeg(coarse)).toBeGreaterThan(29);
    expect(maxTurnDeg(curve)).toBeLessThan(5);
    // Più vicina all'arco vero della spezzata: la corda si scosta di 50·(1 − cos 15°) ≈ 1,7 mm.
    const chordGap = 50 * (1 - Math.cos(Math.PI / 12));
    const worst = Math.max(...curve.map((p) => Math.abs(Math.hypot(p[0], p[1]) - 50)));
    expect(worst).toBeLessThan(chordGap / 2);
  });

  it('una svolta oltre 75° resta uno spigolo', () => {
    const cusp: Point[] = [
      [0, 0],
      [10, 30],
      [20, 0],
    ];
    const curve = splineThroughPolyline(cusp, false);
    expect(near(curve, [10, 30])).toBeLessThan(1e-6);
    expect(maxTurnDeg(curve)).toBeGreaterThan(75);
  });
});
