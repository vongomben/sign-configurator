import { describe, expect, it } from 'vitest';
import { EDIT_FIT_TOL, resolveParams } from '../src/config';
import { flattenPaths, freezePaths, scalePaths } from '../src/editor/paths';
import { meshToStl } from '../src/export/stl';
import type { Point } from '../src/geometry/rasterize';
import type { OrderPath, SignOrder } from '../src/order/schema';
import { generateSign } from '../src/worker/generate';

const GAP = resolveParams({}).CROSSING_GAP;

const sameBytes = (a: ArrayBuffer, b: ArrayBuffer): boolean => {
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
};

function orderOf(paths: OrderPath[], crossings: SignOrder['crossings'] = []): SignOrder {
  return {
    schemaVersion: 2,
    generatorVersion: '0.2.0',
    source: { kind: 'text', text: 'x', fontId: 'sacramento' },
    heightMm: 120,
    color: '#ff2fd6',
    params: {},
    paths,
    crossings,
  };
}

function quarter(radius: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= 90; i++) {
    const angle = (i / 90) * (Math.PI / 2);
    points.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
  }
  return points;
}

function lengthOf(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
}

function distToPolyline(point: Point, line: readonly Point[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const len2 = abx * abx + aby * aby;
    const t = len2 < 1e-18 ? 0 : Math.min(1, Math.max(0, ((point[0] - a[0]) * abx + (point[1] - a[1]) * aby) / len2));
    best = Math.min(best, Math.hypot(a[0] + t * abx - point[0], a[1] + t * aby - point[1]));
  }
  return best;
}

function hausdorff(left: readonly Point[], right: readonly Point[]): number {
  let max = 0;
  for (const point of left) max = Math.max(max, distToPolyline(point, right));
  for (const point of right) max = Math.max(max, distToPolyline(point, left));
  return max;
}

function cross(): OrderPath[] {
  return freezePaths([
    { points: [[-50, 0], [50, 0]] },
    { points: [[0, -50], [0, 50]] },
  ]);
}

function minOrigin(points: readonly Point[]): number {
  let best = Infinity;
  for (const point of points) best = Math.min(best, Math.hypot(point[0], point[1]));
  return best;
}

function byAxis(curves: { points: Point[] }[], axis: 'h' | 'v'): Point[] {
  const out: Point[] = [];
  for (const curve of curves) {
    const xs = curve.points.map((point) => point[0]);
    const ys = curve.points.map((point) => point[1]);
    const dx = Math.max(...xs) - Math.min(...xs);
    const dy = Math.max(...ys) - Math.min(...ys);
    if (axis === 'h' && dx > 20 && dy < 2) out.push(...curve.points);
    if (axis === 'v' && dy > 20 && dx < 2) out.push(...curve.points);
  }
  return out;
}

describe('tracciati congelati', () => {
  it('il fit resta entro EDIT_FIT_TOL e la rigenerazione segue la curva', async () => {
    const original = quarter(40);
    const paths = freezePaths([{ points: original }]);
    const flat = flattenPaths(paths).curves[0]!;
    expect(hausdorff(flat.points, original)).toBeLessThanOrEqual(EDIT_FIT_TOL);

    const generated = await generateSign(orderOf(paths));
    const samples = generated.centerlines.flatMap((line) => line.points);
    expect(samples.length).toBeGreaterThan(2);
    for (const point of samples) expect(distToPolyline(point, original)).toBeLessThanOrEqual(EDIT_FIT_TOL);
  });

  it('scala ×2 raddoppia le lunghezze', () => {
    const paths = freezePaths([{ points: quarter(40) }, { points: [[1, 2]], dot: true }]);
    const before = flattenPaths(paths).curves[0]!;
    const scaled = scalePaths(paths, 2);
    const after = flattenPaths(scaled).curves[0]!;
    expect(lengthOf(after.points) / lengthOf(before.points)).toBeCloseTo(2, 3);
    const dot = scaled.find((path) => 'type' in path && path.type === 'dot');
    expect(dot).toEqual({ id: 'd1', type: 'dot', center: [2, 4], angle: 0 });
    const curve = paths[0];
    const grown = scaled[0];
    if (!curve || !grown || 'type' in curve || 'type' in grown) throw new Error('curva attesa');
    expect(grown.nodes[0]!.p[0]).toBeCloseTo(curve.nodes[0]!.p[0] * 2, 3);
    expect(grown.nodes[0]!.p[1]).toBeCloseTo(curve.nodes[0]!.p[1] * 2, 3);
  });

  it('scambiare under sposta il gap', async () => {
    const paths = cross();
    expect(paths.map((path) => path.id)).toEqual(['p1', 'p2']);
    const def = await generateSign(orderOf(paths));
    const swapped = await generateSign(orderOf(paths, [{ at: [0, 0], under: 'p1' }]));

    expect(minOrigin(byAxis(def.centerlines, 'v'))).toBeGreaterThan(GAP - 0.2);
    expect(minOrigin(byAxis(def.centerlines, 'h'))).toBeLessThan(0.5);
    expect(minOrigin(byAxis(swapped.centerlines, 'h'))).toBeGreaterThan(GAP - 0.2);
    expect(minOrigin(byAxis(swapped.centerlines, 'v'))).toBeLessThan(0.5);
  });

  it('una scelta senza incrocio produce un avviso', async () => {
    const paths = cross();
    const result = await generateSign(orderOf(paths, [{ at: [100, 100], under: 'p1' }]));
    expect(result.warnings).toContain('Scelta di incrocio senza incrocio corrispondente, in (100.0, 100.0).');
    expect(minOrigin(byAxis(result.centerlines, 'v'))).toBeGreaterThan(GAP - 0.2);
    expect(minOrigin(byAxis(result.centerlines, 'h'))).toBeLessThan(0.5);
  });

  it('lo stesso JSON produce gli stessi file', async () => {
    const frozen = orderOf(cross(), [{ at: [0, 0], under: 'p1' }]);
    const again = JSON.parse(JSON.stringify(frozen)) as SignOrder;
    const first = await generateSign(frozen);
    const second = await generateSign(again);
    expect(sameBytes(meshToStl(first.housingMesh), meshToStl(second.housingMesh))).toBe(true);
    expect(sameBytes(meshToStl(first.diffuserMesh), meshToStl(second.diffuserMesh))).toBe(true);
    expect(second.bom).toEqual(first.bom);
  });
});
