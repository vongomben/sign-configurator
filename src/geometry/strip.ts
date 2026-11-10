// [D]–[G] e BOM: dal grafo agli spezzoni, alla catena e alla distinta.
// L'altezza minima è la più alta fra curve, spezzoni corti e sagome che si fondono.
// Gli spigoli restano, e con CUSP_MODE "split" lo spezzone si taglia lì.

import { rMin, type Params } from '../config';
import { buildBom, bomPiece, type Bom } from '../export/bom';
import { resampleChain, type ChainPath } from './chain';
import type { GraphEdge, GraphNode } from './graph';
import type { Point } from './rasterize';
import { segmentGraph, type SegmentNotice } from './segment';
import { smoothPolyline } from './smooth';
import { centerlineClearance, touchPoints, validateStrip, type ValidationIssue } from './validate';

export interface SegmentSource {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  /** Larghezza del tratto: allarga lo scheletro del puntino fino all'inchiostro. */
  strokeWidthMm?: number;
}

export interface StripChain extends ChainPath {
  id: number;
  /** Linea levigata [E]. Il profilo la segue; `points` sono le corde [F]. */
  smooth: Point[];
  /** Spezzone del puntino: niente asole, due fori sotto le piazzole. */
  dot: boolean;
}

/** Puntino in rilievo, senza canale né striscia (I_DOT_MODE "unlit"). */
export interface UnlitDot {
  x: number;
  y: number;
  radiusMm: number;
  points: Point[];
}

export interface HeightSuggestion {
  /** null se non c'è uno spezzone. Altrimenti l'altezza che azzera le curve. */
  heightMm: number | null;
  limitMm: number;
  /** Ci sono curve troppo strette all'altezza richiesta. */
  hasErrors: boolean;
  empty: boolean;
  /** Curve rimaste all'altezza suggerita. */
  remainingErrors: number;
  /** Curve all'altezza richiesta. Gli spigoli non contano. */
  currentErrors: number;
  /** Spigoli all'altezza richiesta: la scala non li toglie. */
  cuspCount: number;
}

export interface StripPath {
  points: Point[];
  closed: boolean;
  /** false per il trattino sostitutivo: non entra nella lunghezza di riferimento. */
  reference: boolean;
}

export interface StripModel {
  chains: StripChain[];
  issues: ValidationIssue[];
  notices: SegmentNotice[];
  unlit: UnlitDot[];
  bom: Bom;
  suggestion: HeightSuggestion;
  /** Polilinea prima della levigatura, stesso ordine degli spezzoni. */
  paths: StripPath[];
  /** Tratti tolti agli incroci. */
  gaps: { points: Point[]; lengthMm: number }[];
  /** Anelli sotto R_MIN, anche quando diventano un trattino o un rilievo. */
  excluded: { points: Point[] }[];
}

const MIN_HEIGHT_MM = 5;
const MAX_HEIGHT_MM = 2000;

interface Piece {
  points: Point[];
  closed: boolean;
  /** false solo per il pezzo che sostituisce un anello: il riferimento resta l'anello. */
  reference: boolean;
  /** Puntino: spezzone proprio, senza asole. */
  dot: boolean;
}

interface Computed {
  chains: StripChain[];
  issues: ValidationIssue[];
  notices: SegmentNotice[];
  unlit: UnlitDot[];
  bom: Bom;
  paths: StripPath[];
  gaps: { points: Point[]; lengthMm: number }[];
  excluded: { points: Point[] }[];
}

const dist = (a: Point, b: Point): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

function lengthOf(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1]!, points[i]!);
  return total;
}

function pointAt(points: readonly Point[], distance: number): Point {
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
  return points[points.length - 1]!;
}

function project(points: readonly Point[], target: Point): { along: number; gap: number } {
  let bestAlong = 0;
  let bestGap = Infinity;
  let acc = 0;
  if (points.length === 1) return { along: 0, gap: dist(points[0]!, target) };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const len2 = abx * abx + aby * aby;
    const len = Math.sqrt(len2);
    let t = 0;
    if (len2 > 1e-12) {
      t = ((target[0] - a[0]) * abx + (target[1] - a[1]) * aby) / len2;
      t = Math.min(1, Math.max(0, t));
    }
    const gap = Math.hypot(a[0] + t * abx - target[0], a[1] + t * aby - target[1]);
    if (gap < bestGap) {
      bestGap = gap;
      bestAlong = acc + len * t;
    }
    acc += len;
  }
  return { along: bestAlong, gap: bestGap };
}

function pushPoint(out: Point[], pt: Point): void {
  const last = out[out.length - 1];
  if (!last || dist(last, pt) > 1e-4) out.push(pt);
}

function sliceBetween(points: readonly Point[], from: number, to: number): Point[] {
  const out: Point[] = [];
  pushPoint(out, pointAt(points, from));
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = dist(a, b);
    const next = acc + len;
    if (acc > from + 1e-4 && acc < to - 1e-4) pushPoint(out, [a[0], a[1]]);
    if (next > from + 1e-4 && next < to - 1e-4) pushPoint(out, [b[0], b[1]]);
    acc = next;
  }
  pushPoint(out, pointAt(points, to));
  return out;
}

/** DIN = estremità con x minore, poi y minore. */
function orientOpen(points: readonly Point[]): Point[] {
  if (points.length < 2) return points.map((p) => [p[0], p[1]]);
  const a = points[0]!;
  const b = points[points.length - 1]!;
  const swap = b[0] < a[0] - 1e-9 || (Math.abs(b[0] - a[0]) <= 1e-9 && b[1] < a[1]);
  const seq = swap ? [...points].reverse() : points;
  return seq.map((p) => [p[0], p[1]]);
}

function splitOpen(points: readonly Point[], cuts: readonly Point[], pitch: number): Point[][] {
  const total = lengthOf(points);
  const hits: number[] = [];
  for (const cut of cuts) {
    const hit = project(points, cut);
    if (hit.gap > pitch * 2) continue;
    if (hit.along <= 1 || hit.along >= total - 1) continue;
    hits.push(hit.along);
  }
  hits.sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const along of hits) {
    const last = clusters[clusters.length - 1];
    const tail = last?.[last.length - 1];
    if (!last || tail === undefined || along - tail > pitch * 2) clusters.push([along]);
    else last.push(along);
  }
  const stops = [0];
  for (const cluster of clusters) {
    const mid = cluster.reduce((sum, value) => sum + value, 0) / cluster.length;
    if (mid > 1 && mid < total - 1) stops.push(mid);
  }
  if (stops.length === 1) return [orientOpen(points)];
  stops.push(total);
  const parts: Point[][] = [];
  for (let i = 1; i < stops.length; i++) {
    const part = sliceBetween(points, stops[i - 1]!, stops[i]!);
    if (part.length >= 2 && lengthOf(part) > 1e-3) parts.push(orientOpen(part));
  }
  return parts.length > 0 ? parts : [orientOpen(points)];
}

const JOIN_MM = 1.5;

function endpointJoin(a: readonly Point[], b: readonly Point[]): { aEnd: boolean; bEnd: boolean } | null {
  if (a.length < 2 || b.length < 2) return null;
  const endsA = [a[0]!, a[a.length - 1]!];
  const endsB = [b[0]!, b[b.length - 1]!];
  let best: { aEnd: boolean; bEnd: boolean; d: number } | null = null;
  for (const aEnd of [false, true]) {
    for (const bEnd of [false, true]) {
      const pa = endsA[aEnd ? 1 : 0]!;
      const pb = endsB[bEnd ? 1 : 0]!;
      const d = dist(pa, pb);
      if (d > JOIN_MM) continue;
      if (!best || d < best.d) best = { aEnd, bEnd, d };
    }
  }
  return best ? { aEnd: best.aEnd, bEnd: best.bEnd } : null;
}

function weld(a: readonly Point[], b: readonly Point[], join: { aEnd: boolean; bEnd: boolean }): Point[] {
  const left = join.aEnd ? a.slice() : [...a].reverse();
  const right = join.bEnd ? [...b].reverse() : b.slice();
  return [...left, ...right.slice(1)];
}

/** Uno spezzone sotto la luce minima si attacca al capo vicino, se ce n'è uno. */
function joinShort(pieces: readonly Piece[], minOpen: number): Piece[] {
  let list = pieces.map((piece) => ({
    points: piece.points.slice(),
    closed: piece.closed,
    reference: piece.reference,
    dot: piece.dot,
  }));
  let moved = true;
  while (moved) {
    moved = false;
    for (let i = 0; i < list.length; i++) {
      const piece = list[i]!;
      if (piece.closed || !piece.reference || lengthOf(piece.points) >= minOpen - 1e-6) continue;
      let best = -1;
      let bestJoin: { aEnd: boolean; bEnd: boolean } | null = null;
      for (let j = 0; j < list.length; j++) {
        if (i === j || list[j]!.closed || !list[j]!.reference) continue;
        const join = endpointJoin(piece.points, list[j]!.points);
        if (!join) continue;
        best = j;
        bestJoin = join;
        break;
      }
      if (best < 0 || !bestJoin) continue;
      const merged = weld(piece.points, list[best]!.points, bestJoin);
      const next = list.filter((_, k) => k !== i && k !== best);
      next.push({ points: merged, closed: false, reference: true, dot: false });
      list = next;
      moved = true;
      break;
    }
  }
  return list;
}

/** Tagli che lasciano ogni pezzo almeno a `minLen`. Gli altri spigoli restano interi. */
function safeCuts(points: readonly Point[], cuts: readonly Point[], minLen: number, pitch: number): Point[] {
  const total = lengthOf(points);
  const located = cuts
    .map((cut) => project(points, cut))
    .filter((hit) => hit.gap <= pitch * 2 && hit.along > 1 && hit.along < total - 1)
    .sort((a, b) => a.along - b.along);
  const clusters: number[][] = [];
  for (const hit of located) {
    const last = clusters[clusters.length - 1];
    const tail = last?.[last.length - 1];
    if (!last || tail === undefined || hit.along - tail > pitch * 2) clusters.push([hit.along]);
    else last.push(hit.along);
  }
  const chosen: number[] = [];
  for (const cluster of clusters) {
    const along = cluster.reduce((sum, value) => sum + value, 0) / cluster.length;
    const stops = [0, ...chosen, along, total].sort((a, b) => a - b);
    const ok = stops.every((stop, index) => index === 0 || stop - stops[index - 1]! >= minLen - 1e-6);
    if (ok) chosen.push(along);
  }
  return chosen.map((along) => pointAt(points, along));
}

function orderPieces(pieces: readonly Piece[]): Piece[] {
  return pieces.slice().sort((a, b) => {
    const as = a.points[0] ?? [0, 0];
    const bs = b.points[0] ?? [0, 0];
    return as[0] - bs[0] || bs[1] - as[1] || lengthOf(a.points) - lengthOf(b.points);
  });
}

function chainOf(points: readonly Point[], closed: boolean, params: Params, id: number, smooth = true): StripChain {
  // I tracciati congelati sono già la curva del cliente: niente Chaikin.
  const curve = smooth ? smoothPolyline(points, closed) : points.map((point): Point => [point[0], point[1]]);
  const chain = resampleChain(curve, {
    hingePitch: params.HINGE_PITCH,
    hingeMaxDeg: params.HINGE_MAX_DEG,
    channelW: params.CHANNEL_W,
    closed,
  });
  return { ...chain, id, smooth: curve, dot: false };
}

function chainsFrom(pieces: readonly Piece[], params: Params, smooth = true): StripChain[] {
  return pieces.map((piece, index) => ({ ...chainOf(piece.points, piece.closed, params, index + 1, smooth), dot: piece.dot }));
}

/** Catene a scala ×2: posizioni riportate all'originale, raggi nella scala doppia. */
function scaledChains(pieces: readonly Piece[], params: Params, smooth = true): StripChain[] {
  return pieces.map((piece, index) => {
    const grown = piece.points.map(([x, y]): Point => [x * 2, y * 2]);
    const chain = chainOf(grown, piece.closed, params, index + 1, smooth);
    return {
      ...chain,
      points: chain.points.map(([x, y]): Point => [x / 2, y / 2]),
      hinges: chain.hinges.map((hinge) => ({ ...hinge, x: hinge.x / 2, y: hinge.y / 2 })),
      smooth: chain.smooth.map(([x, y]): Point => [x / 2, y / 2]),
    };
  });
}

function tangentNear(origin: Point, pieces: readonly Piece[]): Point {
  let best = Infinity;
  let dir: Point = [0, 1];
  for (const piece of pieces) {
    for (let i = 1; i < piece.points.length; i++) {
      const a = piece.points[i - 1]!;
      const b = piece.points[i]!;
      const abx = b[0] - a[0];
      const aby = b[1] - a[1];
      const len2 = abx * abx + aby * aby;
      if (len2 < 1e-12) continue;
      let t = ((origin[0] - a[0]) * abx + (origin[1] - a[1]) * aby) / len2;
      t = Math.min(1, Math.max(0, t));
      const gap = Math.hypot(a[0] + t * abx - origin[0], a[1] + t * aby - origin[1]);
      if (gap < best) {
        best = gap;
        const len = Math.sqrt(len2);
        dir = [abx / len, aby / len];
      }
    }
  }
  return dir;
}

function pointInPoly(p: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const cross = (a[1] > p[1]) !== (b[1] > p[1]);
    if (!cross) continue;
    const x = ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (p[0] < x) inside = !inside;
  }
  return inside;
}

function pointSegDist(p: Point, a: Point, b: Point): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2));
  return Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby));
}

function distToPoly(p: Point, poly: readonly Point[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, pointSegDist(p, poly[i]!, poly[(i + 1) % poly.length]!));
  return best;
}

function circlePoints(cx: number, cy: number, radius: number): Point[] {
  const n = 24;
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return pts;
}

/** Il trattino, con la sua parete, sta nel puntino allargato al massimo di WALL. */
function dashFits(center: Point, dir: Point, params: Params, poly: readonly Point[]): boolean {
  if (poly.length < 3) return false;
  const outer = params.CHANNEL_W / 2 + params.WALL;
  const half = params.CUT_PITCH / 2;
  const inside = (p: Point): boolean => pointInPoly(p, poly) || distToPoly(p, poly) <= params.WALL + 1e-3;
  const leftN = (v: Point): Point => [-v[1], v[0]];
  for (const sign of [-1, 1]) {
    const heading: Point = [dir[0] * sign, dir[1] * sign];
    const end: Point = [center[0] + heading[0] * half, center[1] + heading[1] * half];
    const normal = leftN(heading);
    for (let i = 0; i <= 8; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / 8;
      const p: Point = [
        end[0] + (Math.cos(a) * heading[0] + Math.sin(a) * normal[0]) * outer,
        end[1] + (Math.cos(a) * heading[1] + Math.sin(a) * normal[1]) * outer,
      ];
      if (!inside(p)) return false;
    }
  }
  const side: Point = [-dir[1], dir[0]];
  for (const sign of [-1, 1]) {
    if (!inside([center[0] + side[0] * outer * sign, center[1] + side[1] * outer * sign])) return false;
  }
  return true;
}

/**
 * Scheletro del puntino → contorno dell'inchiostro. Il tratto è circa costante:
 * ogni punto si allontana dal centro di mezzo spessore.
 */
function inkOutline(poly: readonly Point[], center: Point, strokeWidthMm: number): Point[] {
  const extra = Math.max(0, strokeWidthMm) / 2;
  if (extra < 1e-6) return poly.map((p): Point => [p[0], p[1]]);
  return poly.map((p): Point => {
    const dx = p[0] - center[0];
    const dy = p[1] - center[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return [p[0], p[1]];
    return [p[0] + (dx / len) * extra, p[1] + (dy / len) * extra];
  });
}

/**
 * Quanto il rettangolo della striscia (lungo CUT_PITCH, largo canale + pareti)
 * esce dall'ingombro. Le calotte tonde stanno oltre la striscia e non entrano
 * in questo conto: la striscia si taglia a CUT_PITCH, non più corta.
 */
function bodyOverhang(poly: readonly Point[], center: Point, dir: Point, params: Params): number {
  if (poly.length < 3) return Infinity;
  const hx = params.CUT_PITCH / 2;
  const hy = params.CHANNEL_W / 2 + params.WALL;
  const nx = -dir[1];
  const ny = dir[0];
  let max = 0;
  const at = (u: number, v: number): Point => [
    center[0] + dir[0] * hx * u + nx * hy * v,
    center[1] + dir[1] * hx * u + ny * hy * v,
  ];
  const samples: Point[] = [];
  for (let i = 0; i <= 16; i++) {
    const u = -1 + (2 * i) / 16;
    samples.push(at(u, -1), at(u, 1));
  }
  for (let j = 1; j < 8; j++) {
    const v = -1 + (2 * j) / 8;
    samples.push(at(-1, v), at(1, v));
  }
  for (const p of samples) {
    if (pointInPoly(p, poly)) continue;
    max = Math.max(max, distToPoly(p, poly));
  }
  return max;
}

function scaleAround(poly: readonly Point[], center: Point, k: number): Point[] {
  return poly.map((p): Point => [center[0] + (p[0] - center[0]) * k, center[1] + (p[1] - center[1]) * k]);
}

/** Altezza a cui il puntino, scalato, contiene la striscia entro DOT_OVERHANG_MM. */
function dotLitHeight(poly: readonly Point[], center: Point, dir: Point, params: Params, heightMm: number): number {
  const limit = params.DOT_OVERHANG_MM;
  const over = (k: number): number => bodyOverhang(scaleAround(poly, center, k), center, dir, params);
  if (over(1) <= limit) return heightMm;
  let lo = 1;
  let hi = 2;
  while (over(hi) > limit && hi < 64) hi *= 1.6;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (over(mid) <= limit) hi = mid;
    else lo = mid;
  }
  return Math.min(2000, Math.max(heightMm + 1, Math.ceil(heightMm * hi - 1e-9)));
}

function dashPiece(loop: SegmentNotice, pieces: readonly Piece[], pitch: number): Piece {
  const dir = tangentNear([loop.x, loop.y], pieces);
  const half = pitch / 2;
  const a: Point = [loop.x - dir[0] * half, loop.y - dir[1] * half];
  const b: Point = [loop.x + dir[0] * half, loop.y + dir[1] * half];
  return { points: orientOpen([a, b]), closed: false, reference: false, dot: false };
}

function scaleSource(source: SegmentSource, k: number): SegmentSource {
  return {
    nodes: source.nodes.map((n) => ({ ...n, x: n.x * k, y: n.y * k })),
    edges: source.edges.map((e) => ({
      ...e,
      points: e.points.map(([x, y]): Point => [x * k, y * k]),
      lengthMm: e.lengthMm * k,
    })),
  };
}

function dotPoly(loop: SegmentNotice): Point[] {
  if (loop.points.length >= 3) return loop.points;
  const radius = loop.radiusMm ?? 0;
  return radius > 0.2 ? circlePoints(loop.x, loop.y, radius) : [];
}

function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 1e-12 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function distanceToPiece(p: Point, piece: Piece): number {
  let best = Infinity;
  for (let i = 1; i < piece.points.length; i++) best = Math.min(best, pointSegmentDistance(p, piece.points[i - 1]!, piece.points[i]!));
  return best;
}

/**
 * Segni isolati (l'accento di «ì», «è»…): un tratto aperto che non tocca nessun altro e che è troppo
 * corto per avere due asole e la luce minima. Come il puntino (I_DOT_MODE «dot») diventa uno
 * spezzone a sé senza asole, con i fori sotto le piazzole e un LED; sotto il passo di taglio si
 * allunga a CUT_PITCH, centrato e orientato come il tratto.
 */
function markPieces(pieces: readonly Piece[], params: Params, minOpen: number): Piece[] {
  if (params.I_DOT_MODE !== 'dot') return pieces.slice();
  const near = Math.max(params.CORNER_MERGE_DIST, params.CROSSING_GAP * 2 + 1.5);
  return pieces.map((piece, index) => {
    if (piece.closed || piece.dot || piece.points.length < 2) return piece;
    const length = lengthOf(piece.points);
    if (length >= minOpen) return piece;
    const alone = pieces.every(
      (other, j) => j === index || other.points.length < 2 || piece.points.every((p) => distanceToPiece(p, other) > near),
    );
    if (!alone) return piece;
    if (length >= params.CUT_PITCH) return { ...piece, points: piece.points.slice(), dot: true };
    const first = piece.points[0]!;
    const last = piece.points[piece.points.length - 1]!;
    const chord = Math.hypot(last[0] - first[0], last[1] - first[1]);
    const dir: Point = chord > 1e-6 ? [(last[0] - first[0]) / chord, (last[1] - first[1]) / chord] : [1, 0];
    const mid: Point = [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2];
    const half = params.CUT_PITCH / 2;
    return {
      points: orientOpen([
        [mid[0] - dir[0] * half, mid[1] - dir[1] * half],
        [mid[0] + dir[0] * half, mid[1] + dir[1] * half],
      ]),
      closed: false,
      reference: piece.reference,
      dot: true,
    };
  });
}

function applyDots(segments: Piece[], notices: SegmentNotice[], params: Params, heightMm: number, strokeWidthMm: number): {
  pieces: Piece[];
  notices: SegmentNotice[];
  unlit: UnlitDot[];
  /** Puntini ripiegati su un rilievo, con l'altezza a cui si accenderebbero. */
  fallback: { loop: SegmentNotice; heightMm: number | null }[];
  /** Puntini accesi la cui pillola esce dal disegno più di DOT_OVERHANG_MM. */
  oversize: { loop: SegmentNotice; overhangMm: number }[];
} {
  const loops = notices.filter((notice) => notice.kind === 'excluded');
  const rest = notices.filter((notice) => notice.kind !== 'excluded');
  if (params.I_DOT_MODE === 'dot' || params.I_DOT_MODE === 'dash') {
    const dashes: Piece[] = [];
    const unlit: UnlitDot[] = [];
    const fallback: { loop: SegmentNotice; heightMm: number | null }[] = [];
    const oversize: { loop: SegmentNotice; overhangMm: number }[] = [];
    for (const loop of loops) {
      const dir = tangentNear([loop.x, loop.y], segments);
      const center: Point = [loop.x, loop.y];
      const poly = inkOutline(dotPoly(loop), center, strokeWidthMm);
      const asDot = params.I_DOT_MODE === 'dot';
      // Il puntino è sempre un LED: se la pillola esce dal disegno lo si dice, ma resta acceso.
      // Se tocca l'asta, la fusione (§5 [G]) blocca l'invio e indica l'altezza che li separa.
      if (asDot) {
        const overhangMm = bodyOverhang(poly, center, dir, params);
        if (overhangMm > params.DOT_OVERHANG_MM) oversize.push({ loop, overhangMm });
      }
      const fits = asDot ? true : dashFits(center, dir, params, poly);
      if (fits) {
        const piece = dashPiece(loop, segments, params.CUT_PITCH);
        dashes.push(asDot ? { ...piece, dot: true } : piece);
      } else {
        unlit.push({ x: loop.x, y: loop.y, radiusMm: loop.radiusMm ?? 0, points: poly });
        fallback.push({
          loop,
          heightMm: asDot ? dotLitHeight(poly, center, dir, params, heightMm) : null,
        });
      }
    }
    return { pieces: [...segments, ...dashes], notices: rest, unlit, fallback, oversize };
  }
  if (params.I_DOT_MODE === 'unlit') {
    const unlit = loops.map((loop) => ({
      x: loop.x,
      y: loop.y,
      radiusMm: loop.radiusMm ?? 0,
      points: loop.points,
    }));
    const flagged = loops.map((loop): SegmentNotice => ({ ...loop, kind: 'unlit' }));
    return { pieces: segments, notices: [...rest, ...flagged], unlit, fallback: [], oversize: [] };
  }
  return { pieces: segments, notices, unlit: [], fallback: [], oversize: [] };
}

function classify(pieces: readonly Piece[], notices: readonly SegmentNotice[], params: Params, smooth = true): {
  chains: StripChain[];
  issues: ValidationIssue[];
} {
  const chains = chainsFrom(pieces, params, smooth);
  const issues = validateStrip({ chains, scaledChains: scaledChains(pieces, params, smooth), notices, params });
  return { chains, issues };
}

function compute(source: SegmentSource, params: Params, heightMm: number): Computed {
  const segmented = segmentGraph(source, { crossingGap: params.CROSSING_GAP, rMin: rMin(params) });
  const minOpen = params.CUT_PITCH + 2 * params.WIRE_SLOT_L;
  const base: Piece[] = joinShort(
    segmented.segments.map((seg) => ({
      points: seg.points.map((p): Point => [p[0], p[1]]),
      closed: seg.closed,
      reference: true,
      dot: false,
    })),
    minOpen,
  );
  const dots = applyDots(base, segmented.notices, params, heightMm, source.strokeWidthMm ?? 0);
  let pieces = orderPieces(markPieces(joinShort(dots.pieces, minOpen), params, minOpen));
  let { chains, issues } = classify(pieces, dots.notices, params);

  if (params.CUSP_MODE === 'split' && issues.some((issue) => issue.bend === 'spigolo')) {
    const next: Piece[] = [];
    let changed = false;
    for (const chain of chains) {
      const piece = pieces[chain.id - 1];
      if (!piece) continue;
      const cuts = issues.filter((issue) => issue.bend === 'spigolo' && issue.segmentId === chain.id).map((issue): Point => [issue.x, issue.y]);
      if (cuts.length === 0 || piece.closed) {
        next.push(piece);
        continue;
      }
      const kept = safeCuts(piece.points, cuts, minOpen, params.HINGE_PITCH);
      const parts = kept.length > 0 ? splitOpen(piece.points, kept, params.HINGE_PITCH) : [piece.points];
      if (parts.length > 1) changed = true;
      for (const points of parts) next.push({ points, closed: false, reference: piece.reference, dot: piece.dot });
    }
    if (changed) {
      pieces = orderPieces(markPieces(joinShort(next, minOpen), params, minOpen));
      ({ chains, issues } = classify(pieces, dots.notices, params));
    }
  }

  for (const item of dots.oversize) {
    const loop = item.loop;
    issues.push({
      level: 'warning',
      bend: null,
      segmentId: null,
      radiusMm: loop.radiusMm,
      x: loop.x,
      y: loop.y,
      message: `Puntino più piccolo della pillola del LED: sporge di ${item.overhangMm.toFixed(1)} mm dal disegno, in (${loop.x.toFixed(1)}, ${loop.y.toFixed(1)}).`,
    });
  }
  for (const item of dots.fallback) {
    const loop = item.loop;
    const where = `in (${loop.x.toFixed(1)}, ${loop.y.toFixed(1)})`;
    const height = item.heightMm === null ? '' : ` Altezza minima ${item.heightMm.toFixed(0)} mm.`;
    const message =
      params.I_DOT_MODE === 'dot'
        ? `Puntino troppo piccolo per la striscia, rilievo senza striscia, ${where}.${height}`
        : `Trattino fuori dal puntino, rilievo senza striscia, ${where}.`;
    issues.push({
      level: 'warning',
      bend: null,
      segmentId: null,
      radiusMm: loop.radiusMm,
      x: loop.x,
      y: loop.y,
      message,
    });
  }
  const bom = buildBom(
    chains.map((chain) => bomPiece(chain)),
    params,
    issues.map((issue) => issue.message),
    dots.notices.filter((notice) => notice.kind === 'crossing').map((notice) => [notice.x, notice.y]),
  );
  return {
    chains,
    issues,
    notices: dots.notices,
    unlit: dots.unlit,
    bom,
    paths: pieces.map((piece) => ({
      points: piece.points.map((p): Point => [p[0], p[1]]),
      closed: piece.closed,
      reference: piece.reference,
    })),
    gaps: segmented.gaps.map((gap) => ({ points: gap.points.map((p): Point => [p[0], p[1]]), lengthMm: gap.lengthMm })),
    excluded: segmented.notices
      .filter((notice) => notice.kind === 'excluded')
      .map((notice) => ({ points: notice.points.map((p): Point => [p[0], p[1]]) })),
  };
}

function hasShort(source: SegmentSource, params: Params, heightMm: number, atHeight: number): boolean {
  const scaled = heightMm === atHeight ? source : scaleSource(source, heightMm / atHeight);
  const segmented = segmentGraph(scaled, { crossingGap: params.CROSSING_GAP, rMin: rMin(params) });
  return segmented.segments.some((seg) => seg.lengthMm < params.CUT_PITCH - 1e-6);
}

function suggest(
  source: SegmentSource,
  params: Params,
  heightMm: number,
  already: Computed,
  clearanceH: number,
): HeightSuggestion {
  const curves = already.issues.filter((issue) => issue.bend === 'curva');
  const cuspCount = already.issues.filter((issue) => issue.bend === 'spigolo').length;
  const currentErrors = curves.length;
  if (already.chains.length === 0 && currentErrors === 0) {
    return { heightMm: null, limitMm: MAX_HEIGHT_MM, hasErrors: false, empty: true, remainingErrors: 0, currentErrors: 0, cuspCount };
  }
  const base = Math.min(MAX_HEIGHT_MM, Math.max(MIN_HEIGHT_MM, Math.round(heightMm)));
  if (currentErrors === 0) {
    let lo = MIN_HEIGHT_MM;
    let hi = base;
    if (!hasShort(source, params, lo, base)) {
      return {
        heightMm: Math.max(lo, clearanceH),
        limitMm: MAX_HEIGHT_MM,
        hasErrors: false,
        empty: false,
        remainingErrors: 0,
        currentErrors: 0,
        cuspCount,
      };
    }
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (!hasShort(source, params, mid, base)) hi = mid;
      else lo = mid;
    }
    return {
      heightMm: Math.max(hi, clearanceH),
      limitMm: MAX_HEIGHT_MM,
      hasErrors: false,
      empty: false,
      remainingErrors: 0,
      currentErrors: 0,
      cuspCount,
    };
  }

  const minR = rMin(params);
  let required = base;
  for (const issue of curves) {
    const radius = issue.radiusMm;
    if (radius === null || radius <= 1e-6) continue;
    required = Math.max(required, base * (minR / radius));
  }
  const capped = Math.min(MAX_HEIGHT_MM, Math.max(clearanceH, Math.ceil(required - 1e-9)));
  return {
    heightMm: capped,
    limitMm: MAX_HEIGHT_MM,
    hasErrors: true,
    empty: false,
    remainingErrors: required <= MAX_HEIGHT_MM + 1e-6 ? 0 : currentErrors,
    currentErrors,
    cuspCount,
  };
}

function finishModel(model: Computed, source: SegmentSource, params: Params, heightMm: number): StripModel {
  const crossings = model.notices.filter((notice) => notice.kind === 'crossing').map((notice): Point => [notice.x, notice.y]);
  const joints = touchPoints(model.paths, params);
  const clash = centerlineClearance(
    model.chains.map((chain) => ({ points: chain.smooth, closed: chain.closed })),
    params,
    [...crossings, ...joints],
  );
  let clearanceH = MIN_HEIGHT_MM;
  if (clash && clash.distance < clash.limit - 1e-6) {
    const needed = (heightMm * clash.limit) / Math.max(clash.distance, 0.05);
    clearanceH = Math.min(MAX_HEIGHT_MM, Math.max(MIN_HEIGHT_MM, Math.ceil(needed - 1e-9)));
    model.issues.push({
      level: 'warning',
      bend: null,
      segmentId: null,
      radiusMm: null,
      x: clash.x,
      y: clash.y,
      message: `Sagome che si fondono: distanza ${clash.distance.toFixed(1)} mm, minimo ${clash.limit.toFixed(1)} mm, in (${clash.x.toFixed(1)}, ${clash.y.toFixed(1)}). Altezza minima ${clearanceH.toFixed(0)} mm.`,
    });
  }
  return { ...model, suggestion: suggest(source, params, heightMm, model, clearanceH) };
}

/** Segmenta, leviga, simula la catena, valida e compila la BOM. */
export function buildStrip(source: SegmentSource, params: Params, heightMm: number): StripModel {
  return finishModel(compute(source, params, heightMm), source, params, heightMm);
}

/**
 * Catena e BOM da polilinee già pronte (tracciati congelati).
 * `smooth` resta falso: la curva del cliente non passa da Chaikin.
 */
export function buildStripFromPieces(
  input: readonly { points: readonly Point[]; closed: boolean; dot?: boolean }[],
  params: Params,
  heightMm: number,
  extras: {
    notices: readonly SegmentNotice[];
    gaps: readonly { points: Point[]; lengthMm: number }[];
  },
): StripModel {
  const minOpen = params.CUT_PITCH + 2 * params.WIRE_SLOT_L;
  let pieces: Piece[] = input
    .filter((piece) => piece.points.length >= 2)
    .map((piece) => ({
      points: piece.points.map((point): Point => [point[0], point[1]]),
      closed: piece.closed,
      reference: true,
      dot: piece.dot === true,
    }));
  pieces = orderPieces(markPieces(joinShort(pieces, minOpen), params, minOpen));
  const notices = extras.notices.map((notice) => ({
    ...notice,
    points: notice.points.map((point): Point => [point[0], point[1]]),
  }));
  let { chains, issues } = classify(pieces, notices, params, false);

  if (params.CUSP_MODE === 'split' && issues.some((issue) => issue.bend === 'spigolo')) {
    const next: Piece[] = [];
    let changed = false;
    for (const chain of chains) {
      const piece = pieces[chain.id - 1];
      if (!piece) continue;
      const cuts = issues
        .filter((issue) => issue.bend === 'spigolo' && issue.segmentId === chain.id)
        .map((issue): Point => [issue.x, issue.y]);
      if (cuts.length === 0 || piece.closed) {
        next.push(piece);
        continue;
      }
      const kept = safeCuts(piece.points, cuts, minOpen, params.HINGE_PITCH);
      const parts = kept.length > 0 ? splitOpen(piece.points, kept, params.HINGE_PITCH) : [piece.points];
      if (parts.length > 1) changed = true;
      for (const points of parts) next.push({ points, closed: false, reference: piece.reference, dot: piece.dot });
    }
    if (changed) {
      pieces = orderPieces(markPieces(joinShort(next, minOpen), params, minOpen));
      ({ chains, issues } = classify(pieces, notices, params, false));
    }
  }

  const bom = buildBom(
    chains.map((chain) => bomPiece(chain)),
    params,
    issues.map((issue) => issue.message),
    notices.filter((notice) => notice.kind === 'crossing').map((notice): Point => [notice.x, notice.y]),
  );
  const model: Computed = {
    chains,
    issues,
    notices,
    unlit: [],
    bom,
    paths: pieces.map((piece) => ({
      points: piece.points.map((point): Point => [point[0], point[1]]),
      closed: piece.closed,
      reference: piece.reference,
    })),
    gaps: extras.gaps.map((gap) => ({
      points: gap.points.map((point): Point => [point[0], point[1]]),
      lengthMm: gap.lengthMm,
    })),
    excluded: [],
  };
  return finishModel(model, { nodes: [], edges: [] }, params, heightMm);
}
