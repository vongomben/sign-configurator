// Incroci senza grafo (SPEC §5bis): intersezione di polilinee, scelta entro 2 mm, gap sulla striscia sotto.

import type { Point } from '../geometry/rasterize';
import type { OrderCrossing } from '../order/schema';

/** Una scelta si lega all'incrocio più vicino se dista al più così. */
export const CROSSING_MATCH_MM = 2;

export interface CrossingCurve {
  id: string;
  points: readonly Point[];
  closed: boolean;
}

export interface PathIntersection {
  at: Point;
  a: string;
  b: string;
  aArc: number;
  bArc: number;
}

export interface AppliedCrossing {
  at: Point;
  under: string;
  over: string;
  /** Ascissa curvilinea, sul percorso che passa sotto. */
  underArc: number;
}

export interface ResolvedCrossings {
  applied: AppliedCrossing[];
  warnings: string[];
}

export interface CutPiece {
  id: string;
  points: Point[];
  closed: boolean;
}

export interface CutGaps {
  pieces: CutPiece[];
  gaps: { points: Point[]; lengthMm: number }[];
}

interface Seg {
  a: Point;
  b: Point;
  arc: number;
  length: number;
}

const dist = (a: Point, b: Point): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

function pathNumber(id: string): number {
  const match = /(\d+)$/.exec(id);
  const value = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

/** Passa sopra l'id minore (p2 prima di p10). A parità di numero, vince la stringa minore. */
function overId(a: string, b: string): string {
  if (a === b) return a;
  const na = pathNumber(a);
  const nb = pathNumber(b);
  if (na !== nb) return na < nb ? a : b;
  return a < b ? a : b;
}

function defaultUnder(a: string, b: string): string {
  const over = overId(a, b);
  return over === a ? b : a;
}

function segmentsOf(path: CrossingCurve): Seg[] {
  const points = path.points;
  const count = path.closed ? points.length : points.length - 1;
  const out: Seg[] = [];
  let arc = 0;
  for (let i = 0; i < count; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const length = dist(a, b);
    if (length > 1e-8) out.push({ a, b, arc, length });
    arc += length;
  }
  return out;
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/**
 * Incrocio proprio. Un estremo che cade in mezzo all'altro segmento conta;
 * due estremi coincidenti sono una giunzione, non un incrocio.
 */
function segmentHit(left: Seg, right: Seg): { at: Point; t: number; u: number } | null {
  const rx = left.b[0] - left.a[0];
  const ry = left.b[1] - left.a[1];
  const sx = right.b[0] - right.a[0];
  const sy = right.b[1] - right.a[1];
  const den = cross(rx, ry, sx, sy);
  if (Math.abs(den) < 1e-12) return null;
  const qx = right.a[0] - left.a[0];
  const qy = right.a[1] - left.a[1];
  const t = cross(qx, qy, sx, sy) / den;
  const u = cross(qx, qy, rx, ry) / den;
  const eps = 1e-6;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  const tEnd = t <= eps || t >= 1 - eps;
  const uEnd = u <= eps || u >= 1 - eps;
  if (tEnd && uEnd) return null;
  const tc = Math.min(1, Math.max(0, t));
  const uc = Math.min(1, Math.max(0, u));
  return { at: [left.a[0] + tc * rx, left.a[1] + tc * ry], t: tc, u: uc };
}

function samePair(left: PathIntersection, right: PathIntersection): boolean {
  return (left.a === right.a && left.b === right.b) || (left.a === right.b && left.b === right.a);
}

/** Intersezioni fra spezzoni distinti e di uno spezzone con sé stesso. */
export function intersectPaths(paths: readonly CrossingCurve[]): PathIntersection[] {
  const usable = paths.filter((path) => path.points.length >= 2);
  const hits: PathIntersection[] = [];
  for (let i = 0; i < usable.length; i++) {
    for (let j = i; j < usable.length; j++) {
      const leftPath = usable[i]!;
      const rightPath = usable[j]!;
      const leftSegs = segmentsOf(leftPath);
      const rightSegs = i === j ? leftSegs : segmentsOf(rightPath);
      for (let a = 0; a < leftSegs.length; a++) {
        const bStart = i === j ? a + 1 : 0;
        for (let b = bStart; b < rightSegs.length; b++) {
          if (i === j && (b === a + 1 || (leftPath.closed && a === 0 && b === leftSegs.length - 1))) continue;
          const left = leftSegs[a]!;
          const right = rightSegs[b]!;
          const hit = segmentHit(left, right);
          if (!hit) continue;
          hits.push({
            at: hit.at,
            a: leftPath.id,
            b: rightPath.id,
            aArc: left.arc + hit.t * left.length,
            bArc: right.arc + hit.u * right.length,
          });
        }
      }
    }
  }
  const unique: PathIntersection[] = [];
  for (const hit of hits) {
    const twin = unique.find((item) => samePair(item, hit) && dist(item.at, hit.at) < 0.05);
    if (!twin) unique.push(hit);
  }
  unique.sort((left, right) => right.at[1] - left.at[1] || left.at[0] - right.at[0] || left.a.localeCompare(right.a) || left.b.localeCompare(right.b));
  return unique;
}

function underArcOf(hit: PathIntersection, under: string): number {
  if (hit.a === hit.b) return Math.max(hit.aArc, hit.bArc);
  return under === hit.a ? hit.aArc : hit.bArc;
}

function applyHit(hit: PathIntersection, under: string): AppliedCrossing {
  const over = hit.a === hit.b ? hit.a : under === hit.a ? hit.b : hit.a;
  return { at: [hit.at[0], hit.at[1]], under, over, underArc: underArcOf(hit, under) };
}

/**
 * Associa ogni scelta all'incrocio libero più vicino, entro 2 mm.
 * Senza scelta, passa sotto l'id maggiore. Una scelta orfana diventa un avviso.
 */
export function resolveCrossings(hits: readonly PathIntersection[], choices: readonly OrderCrossing[]): ResolvedCrossings {
  const taken = new Set<number>();
  const applied: AppliedCrossing[] = [];
  const warnings: string[] = [];
  for (const choice of choices) {
    let best = -1;
    let bestD = CROSSING_MATCH_MM + 1e-9;
    for (let i = 0; i < hits.length; i++) {
      if (taken.has(i)) continue;
      const d = dist(choice.at, hits[i]!.at);
      if (d <= CROSSING_MATCH_MM + 1e-9 && d < bestD) {
        best = i;
        bestD = d;
      }
    }
    if (best < 0) {
      warnings.push(
        `Scelta di incrocio senza incrocio corrispondente, in (${choice.at[0].toFixed(1)}, ${choice.at[1].toFixed(1)}).`,
      );
      continue;
    }
    taken.add(best);
    const hit = hits[best]!;
    const participants = hit.a === hit.b ? [hit.a] : [hit.a, hit.b];
    const under = participants.includes(choice.under) ? choice.under : defaultUnder(hit.a, hit.b);
    applied.push(applyHit(hit, under));
  }
  for (let i = 0; i < hits.length; i++) {
    if (taken.has(i)) continue;
    const hit = hits[i]!;
    applied.push(applyHit(hit, defaultUnder(hit.a, hit.b)));
  }
  return { applied, warnings };
}

function lengthOf(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1]!, points[i]!);
  return total;
}

function sequenceOf(path: CrossingCurve): Point[] {
  const points = path.points.map((point): Point => [point[0], point[1]]);
  if (!path.closed) return points;
  if (points.length >= 2 && dist(points[0]!, points[points.length - 1]!) <= 1e-6) return points;
  return [...points, points[0]!];
}

function walk(seq: readonly Point[], distance: number): { point: Point; next: number } {
  let left = Math.max(0, distance);
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1]!;
    const b = seq[i]!;
    const len = dist(a, b);
    if (left <= len + 1e-9 || i === seq.length - 1) {
      const t = len > 1e-9 ? Math.min(1, Math.max(0, left / len)) : 0;
      return { point: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], next: t >= 1 - 1e-8 ? i + 1 : i };
    }
    left -= len;
  }
  const last = seq[seq.length - 1] ?? [0, 0];
  return { point: [last[0], last[1]], next: seq.length };
}

function sliceBetween(seq: readonly Point[], from: number, to: number): Point[] {
  if (to < from - 1e-9) return [];
  const start = walk(seq, from);
  const end = walk(seq, to);
  const out: Point[] = [[start.point[0], start.point[1]]];
  for (let i = start.next; i < end.next && i < seq.length; i++) {
    const point = seq[i]!;
    if (dist(out[out.length - 1]!, point) > 1e-6) out.push([point[0], point[1]]);
  }
  if (dist(out[out.length - 1]!, end.point) > 1e-6) out.push([end.point[0], end.point[1]]);
  return out;
}

function addInterval(list: [number, number][], from: number, to: number, length: number, closed: boolean): void {
  if (to - from < 1e-6) return;
  if (!closed) {
    const a = Math.max(0, from);
    const b = Math.min(length, to);
    if (b > a + 1e-6) list.push([a, b]);
    return;
  }
  if (to - from >= length - 1e-6) {
    list.push([0, length]);
    return;
  }
  const span = to - from;
  const start = ((from % length) + length) % length;
  const end = start + span;
  if (end <= length) list.push([start, end]);
  else {
    list.push([start, length]);
    list.push([0, end - length]);
  }
}

function mergeIntervals(intervals: [number, number][]): [number, number][] {
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const [from, to] of sorted) {
    const last = out[out.length - 1];
    if (!last || from > last[1] + 1e-6) out.push([from, to]);
    else last[1] = Math.max(last[1], to);
  }
  return out;
}

interface Span {
  from: number;
  to: number;
  seam: boolean;
}

function keptSpans(length: number, gaps: readonly [number, number][], closed: boolean): Span[] {
  const spans: Span[] = [];
  let cursor = 0;
  for (const [from, to] of gaps) {
    if (from > cursor + 1e-4) spans.push({ from: cursor, to: from, seam: false });
    cursor = Math.max(cursor, to);
  }
  if (length > cursor + 1e-4) spans.push({ from: cursor, to: length, seam: false });
  if (closed && spans.length >= 2) {
    const first = spans[0]!;
    const last = spans[spans.length - 1]!;
    if (first.from <= 1e-4 && last.to >= length - 1e-4) {
      spans[0] = { from: last.from, to: first.to, seam: true };
      spans.pop();
    }
  }
  return spans;
}

function spanPoints(seq: readonly Point[], span: Span, length: number): Point[] {
  if (!span.seam) return sliceBetween(seq, span.from, span.to);
  const tail = sliceBetween(seq, span.from, length);
  const head = sliceBetween(seq, 0, span.to);
  const out = tail.slice();
  for (const point of head) {
    if (out.length === 0 || dist(out[out.length - 1]!, point) > 1e-6) out.push(point);
  }
  return out;
}

/**
 * Interrompe solo il percorso sotto, di `gap` mm per lato lungo la curva.
 * I due capi restano staccati: la distanza è il doppio del gap, più della saldatura degli spezzoni corti.
 */
export function cutCrossingGaps(paths: readonly CrossingCurve[], applied: readonly AppliedCrossing[], gap: number): CutGaps {
  const pieces: CutPiece[] = [];
  const removed: { points: Point[]; lengthMm: number }[] = [];
  for (const path of paths) {
    const seq = sequenceOf(path);
    const length = lengthOf(seq);
    const arcs = applied.filter((item) => item.under === path.id).map((item) => item.underArc);
    if (arcs.length === 0 || length < 1e-6 || gap <= 1e-9) {
      if (seq.length >= 2) pieces.push({ id: path.id, points: seq, closed: path.closed });
      continue;
    }
    const intervals: [number, number][] = [];
    for (const arc of arcs) addInterval(intervals, arc - gap, arc + gap, length, path.closed);
    const merged = mergeIntervals(intervals);
    if (merged.length === 0) {
      pieces.push({ id: path.id, points: seq, closed: path.closed });
      continue;
    }
    for (const [from, to] of merged) {
      const points = sliceBetween(seq, from, to);
      if (points.length >= 2) removed.push({ points, lengthMm: to - from });
    }
    for (const span of keptSpans(length, merged, path.closed)) {
      const points = spanPoints(seq, span, length);
      if (points.length >= 2 && lengthOf(points) > 1e-3) pieces.push({ id: path.id, points, closed: false });
    }
  }
  return { pieces, gaps: removed };
}
