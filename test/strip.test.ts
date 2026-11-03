import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, rMin } from '../src/config';
import type { Point } from '../src/geometry/rasterize';
import { sourceFromPaths } from '../src/geometry/segment';
import { buildStrip } from '../src/geometry/strip';

function arc(radius: number, sweepDeg: number): Point[] {
  const n = sweepDeg;
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * ((sweepDeg * Math.PI) / 180);
    pts.push([radius * Math.cos(a), radius * Math.sin(a)]);
  }
  return pts;
}

describe('altezza minima', () => {
  it('un dritto può scendere fino al passo di taglio', () => {
    const model = buildStrip(
      {
        nodes: [
          { id: 0, x: 0, y: 0, degree: 1 },
          { id: 1, x: 100, y: 0, degree: 1 },
        ],
        edges: [{ id: 0, a: 0, b: 1, points: [[0, 0], [100, 0]], lengthMm: 100 }],
      },
      DEFAULT_PARAMS,
      100,
    );
    expect(model.suggestion.hasErrors).toBe(false);
    expect(model.suggestion.heightMm).toBe(DEFAULT_PARAMS.CUT_PITCH);
    expect(model.bom.segments[0]?.cutLengthMm).toBe(80);
    expect(model.bom.totalLeds).toBe(14);
  });

  it("alza l'altezza finché un arco stretto raggiunge R_MIN", () => {
    const pts = arc(10, 180);
    const end = pts[pts.length - 1]!;
    const model = buildStrip(
      {
        nodes: [
          { id: 0, x: pts[0]![0], y: pts[0]![1], degree: 1 },
          { id: 1, x: end[0], y: end[1], degree: 1 },
        ],
        edges: [{ id: 0, a: 0, b: 1, points: pts, lengthMm: Math.PI * 10 }],
      },
      DEFAULT_PARAMS,
      100,
    );
    expect(model.suggestion.hasErrors).toBe(true);
    const expected = 100 * (rMin(DEFAULT_PARAMS) / 10);
    expect(model.suggestion.heightMm).toBeGreaterThan(expected - 20);
    expect(model.suggestion.heightMm).toBeLessThan(expected + 30);
  });

  it('due tratti non contigui troppo vicini alzano l\'altezza minima', () => {
    const model = buildStrip(
      {
        nodes: [
          { id: 0, x: 0, y: 0, degree: 1 },
          { id: 1, x: 40, y: 0, degree: 1 },
          { id: 2, x: 0, y: 8, degree: 1 },
          { id: 3, x: 40, y: 8, degree: 1 },
        ],
        edges: [
          { id: 0, a: 0, b: 1, points: [[0, 0], [40, 0]], lengthMm: 40 },
          { id: 1, a: 2, b: 3, points: [[0, 8], [40, 8]], lengthMm: 40 },
        ],
      },
      DEFAULT_PARAMS,
      100,
    );
    const limit = DEFAULT_PARAMS.CHANNEL_W + 2 * DEFAULT_PARAMS.WALL + DEFAULT_PARAMS.MIN_GAP;
    const issue = model.issues.find((item) => item.message.startsWith('Sagome che si fondono'));
    expect(issue).toBeTruthy();
    expect(issue!.message).toContain(limit.toFixed(1));
    expect(issue!.y).toBeCloseTo(4, 0);
    const needed = Math.ceil((100 * limit) / 8 - 1e-9);
    expect(model.suggestion.heightMm).toBe(needed);
  });

  it('un angolo retto non è una sagoma fusa, nemmeno spezzato in due', () => {
    const one = buildStrip(sourceFromPaths([{ points: [[0, 0], [40, 0], [40, 40]] }]), DEFAULT_PARAMS, 100);
    expect(one.issues.some((issue) => issue.message.startsWith('Sagome che si fondono'))).toBe(false);
    const two = buildStrip(
      {
        nodes: [
          { id: 0, x: 0, y: 0, degree: 1 },
          { id: 1, x: 40, y: 0, degree: 2 },
          { id: 2, x: 40, y: 40, degree: 1 },
        ],
        edges: [
          { id: 0, a: 0, b: 1, points: [[0, 0], [40, 0]], lengthMm: 40 },
          { id: 1, a: 1, b: 2, points: [[40, 0], [40, 40]], lengthMm: 40 },
        ],
      },
      DEFAULT_PARAMS,
      100,
    );
    expect(two.issues.some((issue) => issue.message.startsWith('Sagome che si fondono'))).toBe(false);
  });

  it('una U sulla stessa linea è due pareti e alza l\'altezza', () => {
    const model = buildStrip(
      sourceFromPaths([{ points: [[0, 0], [40, 0], [40, 8], [0, 8]] }]),
      DEFAULT_PARAMS,
      100,
    );
    expect(model.issues.some((issue) => issue.message.startsWith('Sagome che si fondono'))).toBe(true);
  });
});
