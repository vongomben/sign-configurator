import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, rMin } from '../src/config';
import type { GraphEdge, GraphNode } from '../src/geometry/graph';
import type { Point } from '../src/geometry/rasterize';
import { segmentGraph } from '../src/geometry/segment';

const gap = DEFAULT_PARAMS.CROSSING_GAP;

function edge(id: number, a: number, b: number, points: Point[]): GraphEdge {
  let lengthMm = 0;
  for (let i = 1; i < points.length; i++) {
    lengthMm += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  }
  return { id, a, b, points, lengthMm };
}

function circle(radius: number, n = 32): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    pts.push([radius * Math.cos(a), radius * Math.sin(a)]);
  }
  return pts;
}

function run(nodes: GraphNode[], edges: GraphEdge[]) {
  return segmentGraph({ nodes, edges }, { crossingGap: gap, rMin: rMin(DEFAULT_PARAMS) });
}

describe('segmentazione', () => {
  it('a un incrocio la coppia dritta prosegue e l\'altra si interrompe di CROSSING_GAP', () => {
    const nodes: GraphNode[] = [
      { id: 0, x: 0, y: 0, degree: 4 },
      { id: 1, x: 20, y: 0, degree: 1 },
      { id: 2, x: -20, y: 0, degree: 1 },
      { id: 3, x: 0, y: 20, degree: 1 },
      { id: 4, x: 0, y: -20, degree: 1 },
    ];
    const edges = [
      edge(0, 2, 0, [[-20, 0], [0, 0]]),
      edge(1, 0, 1, [[0, 0], [20, 0]]),
      edge(2, 0, 3, [[0, 0], [0, 20]]),
      edge(3, 0, 4, [[0, 0], [0, -20]]),
    ];
    const { segments, notices } = run(nodes, edges);
    expect(notices.filter((n) => n.kind === 'crossing')).toHaveLength(1);
    expect(segments).toHaveLength(3);

    const through = segments.find((s) => Math.abs(s.lengthMm - 40) < 0.1);
    expect(through).toBeDefined();
    const ends = [through!.points[0]!, through!.points[through!.points.length - 1]!];
    expect(ends.map((p) => p[0]).sort((a, b) => a - b)).toEqual([-20, 20]);
    for (const p of ends) expect(p[1]).toBeCloseTo(0, 4);

    const cut = segments.filter((s) => s !== through);
    expect(cut).toHaveLength(2);
    for (const s of cut) {
      const ys = [s.points[0]![1], s.points[s.points.length - 1]![1]].map(Math.abs).sort((a, b) => a - b);
      expect(ys[0]).toBeCloseTo(gap, 2);
      expect(ys[1]).toBeCloseTo(20, 2);
      for (const p of s.points) expect(Math.abs(p[0])).toBeLessThan(0.05);
    }
  });

  it('a una giunzione di grado 3 il ramo restante arriva fino al nodo', () => {
    const nodes: GraphNode[] = [
      { id: 0, x: 0, y: 0, degree: 3 },
      { id: 1, x: -20, y: 0, degree: 1 },
      { id: 2, x: 20, y: 0, degree: 1 },
      { id: 3, x: 0, y: -20, degree: 1 },
    ];
    const edges = [
      edge(0, 1, 0, [[-20, 0], [0, 0]]),
      edge(1, 0, 2, [[0, 0], [20, 0]]),
      edge(2, 0, 3, [[0, 0], [0, -20]]),
    ];
    const { segments, notices } = run(nodes, edges);
    expect(notices.filter((n) => n.kind === 'crossing')).toHaveLength(0);
    expect(segments).toHaveLength(2);
    const stem = segments.find((s) => Math.abs(s.lengthMm - 20) < 0.1)!;
    const bar = segments.find((s) => Math.abs(s.lengthMm - 40) < 0.1)!;
    const stemEnds = [stem.points[0]!, stem.points[stem.points.length - 1]!];
    expect(stemEnds.some((p) => Math.hypot(p[0], p[1]) < 0.05)).toBe(true);
    expect(stemEnds.some((p) => Math.hypot(p[0], p[1] + 20) < 0.05)).toBe(true);
    expect(bar.lengthMm).toBeCloseTo(40, 4);
  });

  it('i componenti sconnessi sono spezzoni distinti', () => {
    const nodes: GraphNode[] = [
      { id: 0, x: 0, y: 0, degree: 1 },
      { id: 1, x: 30, y: 0, degree: 1 },
      { id: 2, x: 0, y: 15, degree: 1 },
      { id: 3, x: 10, y: 15, degree: 1 },
    ];
    const edges = [
      edge(0, 0, 1, [[0, 0], [30, 0]]),
      edge(1, 2, 3, [[0, 15], [10, 15]]),
    ];
    const { segments } = run(nodes, edges);
    expect(segments.map((s) => s.lengthMm).sort((a, b) => a - b)).toEqual([10, 30]);
    expect(segments.map((s) => s.id)).toEqual([1, 2]);
  });

  it('un anello sotto R_MIN è escluso, uno più grande resta', () => {
    const small = circle(4);
    const large = circle(40);
    const excluded = run([{ id: 0, x: 4, y: 0, degree: 2 }], [edge(0, 0, 0, small)]);
    expect(excluded.segments).toHaveLength(0);
    expect(excluded.notices).toHaveLength(1);
    expect(excluded.notices[0]!.kind).toBe('excluded');
    expect(excluded.notices[0]!.radiusMm).toBeCloseTo(4, 1);

    const kept = run([{ id: 0, x: 40, y: 0, degree: 2 }], [edge(0, 0, 0, large)]);
    expect(kept.notices).toHaveLength(0);
    expect(kept.segments).toHaveLength(1);
    expect(kept.segments[0]!.closed).toBe(true);
    expect(kept.segments[0]!.lengthMm / (2 * Math.PI)).toBeGreaterThan(rMin(DEFAULT_PARAMS));
  });
});
