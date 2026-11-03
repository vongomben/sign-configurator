// Spezzoni [D] → curve dell'ordine (SPEC §5bis). Fit di Schneider, scala, appiattimento.
// Niente Paper.js: il worker non lo scarica e il risultato non dipende da un motore grafico.

import { EDIT_FIT_TOL } from '../config';
import type { Point } from '../geometry/rasterize';
import type { CurveNode, CurvePath, DotPath, OrderPath } from '../order/schema';

/** Polilinea dopo [D], prima della levigatura. */
export interface FreezeSegment {
  points: readonly Point[];
  closed?: boolean;
  /** Puntino: diventa un dot, non una curva. */
  dot?: boolean;
}

export interface FlatCurve {
  id: string;
  points: Point[];
  closed: boolean;
}

export interface FlatDot {
  id: string;
  center: Point;
  angle: number;
}

/** Spezzone dopo [D], prima della levigatura. */
export interface EditSegment {
  points: Point[];
  closed: boolean;
  dot: boolean;
}

/** Tolleranza di appiattimento delle Bézier in [E] (SPEC §5). */
const FLATTEN_TOLERANCE_MM = 0.02;

const MAX_FIT_DEPTH = 24;
const MAX_NEWTON = 6;

type Cubic = [Point, Point, Point, Point];

const dist = (a: Point, b: Point): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];

const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];

const mul = (a: Point, k: number): Point => [a[0] * k, a[1] * k];

const dot2 = (a: Point, b: Point): number => a[0] * b[0] + a[1] * b[1];

function roundMm(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundPt(point: Point): Point {
  return [roundMm(point[0]), roundMm(point[1])];
}

function lengthOf(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1]!, points[i]!);
  return total;
}

function pointAlong(points: readonly Point[], distance: number): Point {
  if (points.length === 0) return [0, 0];
  let left = Math.max(0, distance);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = dist(a, b);
    if (left <= len || i === points.length - 1) {
      const t = len > 1e-9 ? Math.min(1, left / len) : 0;
      return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    }
    left -= len;
  }
  const last = points[points.length - 1]!;
  return [last[0], last[1]];
}

function uniquePoints(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (!last || dist(last, point) > 1e-6) out.push([point[0], point[1]]);
  }
  return out;
}

function normalize(vector: Point, fallback: Point): Point {
  const len = Math.hypot(vector[0], vector[1]);
  return len > 1e-9 ? [vector[0] / len, vector[1] / len] : fallback;
}

function forwardTangent(points: readonly Point[], index: number): Point {
  const origin = points[index] ?? [0, 0];
  for (let i = index + 1; i < points.length; i++) {
    const step = sub(points[i]!, origin);
    if (dot2(step, step) > 1e-12) return normalize(step, [1, 0]);
  }
  return [1, 0];
}

function backwardTangent(points: readonly Point[], index: number): Point {
  const origin = points[index] ?? [0, 0];
  for (let i = index - 1; i >= 0; i--) {
    const step = sub(points[i]!, origin);
    if (dot2(step, step) > 1e-12) return normalize(step, [-1, 0]);
  }
  return [-1, 0];
}

function chordParameters(points: readonly Point[]): number[] {
  const u = [0];
  for (let i = 1; i < points.length; i++) u.push(u[i - 1]! + dist(points[i - 1]!, points[i]!));
  const total = u[u.length - 1] ?? 0;
  if (total < 1e-12) return points.map((_, index) => (points.length <= 1 ? 0 : index / (points.length - 1)));
  return u.map((value) => value / total);
}

function bezierAt(controls: readonly Point[], t: number): Point {
  let current = controls.map((point): Point => [point[0], point[1]]);
  while (current.length > 1) {
    const next: Point[] = [];
    for (let i = 0; i < current.length - 1; i++) {
      const a = current[i]!;
      const b = current[i + 1]!;
      next.push([(1 - t) * a[0] + t * b[0], (1 - t) * a[1] + t * b[1]]);
    }
    current = next;
  }
  return current[0] ?? [0, 0];
}

function derivative(controls: readonly Point[]): Point[] {
  const degree = controls.length - 1;
  const out: Point[] = [];
  for (let i = 0; i < degree; i++) out.push(mul(sub(controls[i + 1]!, controls[i]!), degree));
  return out;
}

function newton(curve: Cubic, point: Point, u: number): number {
  const first = derivative(curve);
  const second = derivative(first);
  const at = bezierAt(curve, u);
  const d1 = bezierAt(first, u);
  const d2 = bezierAt(second, u);
  const delta = sub(at, point);
  const denominator = dot2(d1, d1) + dot2(delta, d2);
  if (Math.abs(denominator) < 1e-12) return u;
  return Math.min(1, Math.max(0, u - dot2(delta, d1) / denominator));
}

function heuristic(points: readonly Point[], left: Point, right: Point): Cubic {
  const start = points[0] ?? [0, 0];
  const end = points[points.length - 1] ?? start;
  const third = dist(start, end) / 3;
  return [start, add(start, mul(left, third)), add(end, mul(right, third)), end];
}

function generateBezier(points: readonly Point[], u: readonly number[], left: Point, right: Point): Cubic {
  const start = points[0]!;
  const end = points[points.length - 1]!;
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (let i = 0; i < points.length; i++) {
    const t = u[i] ?? 0;
    const mt = 1 - t;
    const b0 = mt * mt * mt;
    const b1 = 3 * mt * mt * t;
    const b2 = 3 * mt * t * t;
    const b3 = t * t * t;
    const a1 = mul(left, b1);
    const a2 = mul(right, b2);
    const sample = points[i]!;
    const tmp = sub(sample, add(mul(start, b0 + b1), mul(end, b2 + b3)));
    c00 += dot2(a1, a1);
    c01 += dot2(a1, a2);
    c11 += dot2(a2, a2);
    x0 += dot2(a1, tmp);
    x1 += dot2(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  const span = dist(start, end);
  const epsilon = 1e-6 * span;
  let alphaL = 0;
  let alphaR = 0;
  if (Math.abs(det) > 1e-12) {
    alphaL = (x0 * c11 - c01 * x1) / det;
    alphaR = (c00 * x1 - c01 * x0) / det;
  }
  if (alphaL < epsilon || alphaR < epsilon) return heuristic(points, left, right);
  return [start, add(start, mul(left, alphaL)), add(end, mul(right, alphaR)), end];
}

function maxError(points: readonly Point[], curve: Cubic, u: readonly number[]): { error: number; index: number } {
  let error = 0;
  let index = Math.max(1, Math.floor(points.length / 2));
  for (let i = 1; i < points.length - 1; i++) {
    const gap = dist(bezierAt(curve, u[i] ?? 0), points[i]!);
    if (gap >= error) {
      error = gap;
      index = i;
    }
  }
  return { error, index };
}

function reparameterize(points: readonly Point[], curve: Cubic, u: readonly number[]): number[] | null {
  const next = u.map((value, index) => {
    if (index === 0) return 0;
    if (index === u.length - 1) return 1;
    return newton(curve, points[index]!, value);
  });
  for (let i = 1; i < next.length; i++) if (next[i]! <= next[i - 1]! + 1e-8) return null;
  return next;
}

/** Fit cubico ricorsivo (Schneider / Graphics Gems). Gli estremi restano i punti dati. */
function fitCubic(points: readonly Point[], left: Point, right: Point, tolerance: number, depth: number): Cubic[] {
  if (points.length < 2) return [];
  if (points.length === 2 || depth >= MAX_FIT_DEPTH) return [heuristic(points, left, right)];
  let u = chordParameters(points);
  let curve = generateBezier(points, u, left, right);
  let worst = maxError(points, curve, u);
  if (worst.error <= tolerance) return [curve];
  if (worst.error < tolerance * 8) {
    for (let i = 0; i < MAX_NEWTON; i++) {
      const primed = reparameterize(points, curve, u);
      if (!primed) break;
      u = primed;
      curve = generateBezier(points, u, left, right);
      worst = maxError(points, curve, u);
      if (worst.error <= tolerance) return [curve];
    }
  }
  let split = worst.index;
  if (split <= 0 || split >= points.length - 1) split = Math.floor(points.length / 2);
  if (split <= 0 || split >= points.length - 1) return [heuristic(points, left, right)];
  const center = normalize(sub(points[split - 1]!, points[split + 1] ?? points[split]!), backwardTangent(points, split));
  const leftSpan = points.slice(0, split + 1);
  const rightSpan = points.slice(split);
  return [
    ...fitCubic(leftSpan, left, center, tolerance, depth + 1),
    ...fitCubic(rightSpan, mul(center, -1), right, tolerance, depth + 1),
  ];
}

function nodesFrom(curves: readonly Cubic[], closed: boolean): CurveNode[] {
  const nodes: CurveNode[] = [];
  for (const [p0, c1, c2, p3] of curves) {
    if (nodes.length === 0) nodes.push({ p: roundPt(p0), in: [0, 0], out: roundPt(sub(c1, p0)) });
    else nodes[nodes.length - 1]!.out = roundPt(sub(c1, nodes[nodes.length - 1]!.p));
    nodes.push({ p: roundPt(p3), in: roundPt(sub(c2, p3)), out: [0, 0] });
  }
  if (closed && nodes.length >= 2) {
    const last = nodes.pop();
    if (last) nodes[0]!.in = last.in;
  }
  return nodes;
}

function fitSegment(points: readonly Point[], closed: boolean): { nodes: CurveNode[]; closed: boolean } {
  const unique = uniquePoints(points);
  const ring = closed && unique.length >= 2 && dist(unique[0]!, unique[unique.length - 1]!) <= 1e-6 ? unique.slice(0, -1) : unique;
  const ringClosed = closed && ring.length >= 3;
  if (ring.length < 2) return { nodes: [], closed: false };
  const loop = ringClosed ? [...ring, ring[0]!] : ring;
  const curves = fitCubic(loop, forwardTangent(loop, 0), backwardTangent(loop, loop.length - 1), EDIT_FIT_TOL, 0);
  return { nodes: nodesFrom(curves, ringClosed), closed: ringClosed };
}

function boundsOf(points: readonly Point[]): { minX: number; minY: number; length: number } {
  let minX = Infinity;
  let minY = Infinity;
  for (const point of points) {
    if (point[0] < minX) minX = point[0];
    if (point[1] < minY) minY = point[1];
  }
  return { minX, minY, length: lengthOf(points) };
}

function dotFrom(id: string, points: readonly Point[]): DotPath {
  const unique = uniquePoints(points);
  const span = lengthOf(unique);
  const center = pointAlong(unique, span / 2);
  const before = pointAlong(unique, Math.max(0, span / 2 - 0.5));
  const after = pointAlong(unique, Math.min(span, span / 2 + 0.5));
  const step = sub(after, before);
  const angle = dot2(step, step) > 1e-12 ? Math.atan2(step[1], step[0]) : 0;
  return { id, type: 'dot', center: roundPt(center), angle: roundMm(angle) };
}

function isDot(path: OrderPath): path is DotPath {
  return 'type' in path && path.type === 'dot';
}

/**
 * Converte gli spezzoni [D] in path dell'ordine.
 * Gli id `p1`, `p2`… e `d1`, `d2`… seguono l'ordine da sinistra a destra.
 */
export function freezePaths(segments: readonly FreezeSegment[]): OrderPath[] {
  const ranked = segments
    .map((segment, index) => ({ segment, index, points: uniquePoints(segment.points) }))
    .filter((item) => item.points.length >= 1);
  ranked.sort((a, b) => {
    const left = boundsOf(a.points);
    const right = boundsOf(b.points);
    return left.minX - right.minX || left.minY - right.minY || left.length - right.length || a.index - b.index;
  });
  let curves = 0;
  let dots = 0;
  const paths: OrderPath[] = [];
  for (const item of ranked) {
    if (item.segment.dot === true) {
      dots += 1;
      paths.push(dotFrom(`d${dots}`, item.points));
      continue;
    }
    const fitted = fitSegment(item.points, item.segment.closed === true);
    if (fitted.nodes.length < 2) continue;
    curves += 1;
    paths.push({ id: `p${curves}`, closed: fitted.closed, nodes: fitted.nodes });
  }
  return paths;
}

/** Scala uniforme rispetto all'origine. L'angolo di un puntino non cambia. */
export function scalePaths(paths: readonly OrderPath[], factor: number): OrderPath[] {
  return paths.map((path) => {
    if (isDot(path)) {
      return {
        id: path.id,
        type: 'dot' as const,
        center: roundPt(mul(path.center, factor)),
        angle: path.angle,
      };
    }
    return {
      id: path.id,
      closed: path.closed,
      nodes: path.nodes.map((node) => ({
        p: roundPt(mul(node.p, factor)),
        in: roundPt(mul(node.in, factor)),
        out: roundPt(mul(node.out, factor)),
      })),
    };
  });
}

function distToSeg(point: Point, a: Point, b: Point): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-18) return dist(point, a);
  const t = Math.min(1, Math.max(0, ((point[0] - a[0]) * abx + (point[1] - a[1]) * aby) / len2));
  return Math.hypot(a[0] + t * abx - point[0], a[1] + t * aby - point[1]);
}

function pushPoint(out: Point[], point: Point): void {
  const last = out[out.length - 1];
  if (!last || dist(last, point) > 1e-6) out.push([point[0], point[1]]);
}

function flattenCubic(p0: Point, c1: Point, c2: Point, p3: Point, tolerance: number, out: Point[], depth: number): void {
  if (depth > 16 || (distToSeg(c1, p0, p3) <= tolerance && distToSeg(c2, p0, p3) <= tolerance)) {
    pushPoint(out, p3);
    return;
  }
  const p01 = mul(add(p0, c1), 0.5);
  const p12 = mul(add(c1, c2), 0.5);
  const p23 = mul(add(c2, p3), 0.5);
  const p012 = mul(add(p01, p12), 0.5);
  const p123 = mul(add(p12, p23), 0.5);
  const mid = mul(add(p012, p123), 0.5);
  flattenCubic(p0, p01, p012, mid, tolerance, out, depth + 1);
  flattenCubic(mid, p123, p23, p3, tolerance, out, depth + 1);
}

function flattenCurve(path: CurvePath, tolerance: number): Point[] {
  const nodes = path.nodes;
  if (nodes.length === 0) return [];
  const out: Point[] = [[nodes[0]!.p[0], nodes[0]!.p[1]]];
  const count = path.closed ? nodes.length : nodes.length - 1;
  for (let i = 0; i < count; i++) {
    const from = nodes[i]!;
    const to = nodes[(i + 1) % nodes.length]!;
    const p0 = from.p;
    const p3 = to.p;
    flattenCubic(
      p0,
      [p0[0] + from.out[0], p0[1] + from.out[1]],
      [p3[0] + to.in[0], p3[1] + to.in[1]],
      p3,
      tolerance,
      out,
      0,
    );
  }
  if (path.closed && out.length >= 2 && dist(out[0]!, out[out.length - 1]!) <= 1e-4) out.pop();
  return out;
}

/** Appiattisce le Bézier a 0,02 mm. I puntini restano centri, non polilinee. */
export function flattenPaths(paths: readonly OrderPath[], tolerance = FLATTEN_TOLERANCE_MM): { curves: FlatCurve[]; dots: FlatDot[] } {
  const curves: FlatCurve[] = [];
  const dots: FlatDot[] = [];
  for (const path of paths) {
    if (isDot(path)) {
      dots.push({ id: path.id, center: [path.center[0], path.center[1]], angle: path.angle });
      continue;
    }
    const points = flattenCurve(path, tolerance);
    if (points.length >= 2) curves.push({ id: path.id, points, closed: path.closed });
  }
  return { curves, dots };
}

/** Spezzone del puntino, lungo `lengthMm`, centrato e ruotato di `angle` (radianti). */
export function dotSegment(center: Point, angle: number, lengthMm: number): Point[] {
  const half = lengthMm / 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    [center[0] - c * half, center[1] - s * half],
    [center[0] + c * half, center[1] + s * half],
  ];
}
