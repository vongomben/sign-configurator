// Accoppiamento delle pareti in una linea mediana. Non è nella pipeline dell'insegna:
// gli occhielli piccoli (archi concentrici di lunghezza molto diversa) non si accoppiano
// in modo affidabile. Neonderthaw usa stripMode "walls" e tratta ogni parete come
// una monolinea. Il modulo resta per i test e per un eventuale ritorno. Modulo puro.

import type { SkeletonGraph } from './graph';
import type { Point } from './rasterize';
import { smoothPolyline } from './smooth';

/** La luce reale sta fra questi multipli della luce mediana del registro. */
export const GAP_TOL_MIN = 0.6;
export const GAP_TOL_MAX = 1.8;
/** Fascia in cui una parallela è almeno una coppia candidata, in multipli della distanza nominale. */
const SEARCH_DIST_MIN = 0.3;
const SEARCH_DIST_MAX = 2.5;
/**
 * Angolo massimo fra le tangenti, e fra la congiungente e la normale.
 * 42° e non 28°: in «Ciao» di Neonderthaw le pareti di un tubo piegano fino a circa 40°.
 */
export const PAIR_ANGLE_DEG = 42;
/** Sovrapposizione minima del metodo a normali, in distanze nominali. */
export const PAIR_MIN_LENGTH_W = 2;
/** Sotto questa lunghezza la vicinanza è rumore, senza avviso. */
const DUBIOUS_MIN_LENGTH_W = 1;
/** La mediana prosegue sulle estremità sfalsate finché la tangente non gira di più. */
const STAGGER_TURN_DEG = 40;
/** E non oltre queste distanze nominali: uno svolazzo dritto non è un'estremità sfalsata. */
const STAGGER_MAX_W = 4;
const SAMPLE_STEP_MM = 0.5;

export interface TubePair {
  /** Indici degli archi del grafo. a === b: la polilinea si accoppia con sé stessa (tubo a U). */
  a: number;
  b: number;
  /** Linea mediana in mm, estremità sfalsate comprese. */
  midline: Point[];
  lengthMm: number;
  /** Tratto in cui le due pareti corrono affiancate. */
  overlapMm: number;
  /** Distanza mediana fra gli assi, mm. */
  distanceMm: number;
}

export interface TubeLine {
  edgeId: number;
  points: Point[];
}

export interface DubiousPair {
  a: number;
  b: number;
  reason: 'short' | 'distance' | 'angle';
  /** Angolo fra le tangenti, gradi. */
  angleDeg: number;
  overlapMm: number;
  distanceMm: number;
  /** Centro del tratto parallelo, mm. */
  x: number;
  y: number;
}

export interface TubePairing {
  pairs: TubePair[];
  /** Linee senza compagna (barra della t, puntino della i). */
  singles: TubeLine[];
  dubious: DubiousPair[];
  warnings: string[];
  /** lineWidth + gap, alla scala del testo. */
  nominalMm: number;
  distanceMinMm: number;
  distanceMaxMm: number;
}

interface ChainPoint {
  p: Point;
  s: number;
  tx: number;
  ty: number;
}

interface Hit {
  s: number;
  t: number;
  dist: number;
  angleDeg: number;
  p: Point;
  q: Point;
}

interface Run {
  a: number;
  b: number;
  hits: Hit[];
  overlapMm: number;
  distanceMm: number;
  angleDeg: number;
}

const lengthOf = (pts: readonly Point[]): number => {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return l;
};

function resample(points: readonly Point[], step: number): ChainPoint[] {
  if (points.length === 0) return [];
  const out: ChainPoint[] = [];
  const push = (x: number, y: number, s: number): void => {
    out.push({ p: [x, y], s, tx: 1, ty: 0 });
  };
  push(points[0]![0], points[0]![1], 0);
  let acc = 0;
  let traveled = 0;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    const l = Math.hypot(x1 - x0, y1 - y0);
    if (l === 0) continue;
    let t = 0;
    while (acc + (1 - t) * l >= step) {
      const need = step - acc;
      t += need / l;
      traveled += need;
      push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, traveled);
      acc = 0;
    }
    const rest = (1 - t) * l;
    acc += rest;
    traveled += rest;
  }
  const last = points[points.length - 1]!;
  const prev = out[out.length - 1]!;
  if (Math.hypot(last[0] - prev.p[0], last[1] - prev.p[1]) > 1e-6) push(last[0], last[1], traveled);
  const ahead = Math.max(1, Math.round(1 / step));
  for (let i = 0; i < out.length; i++) {
    const a = out[Math.max(0, i - ahead)]!;
    const b = out[Math.min(out.length - 1, i + ahead)]!;
    const l = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]) || 1;
    out[i]!.tx = (b.p[0] - a.p[0]) / l;
    out[i]!.ty = (b.p[1] - a.p[1]) / l;
  }
  return out;
}

function simplify(pts: readonly Point[], tol: number): Point[] {
  if (pts.length <= 2) return [...pts];
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    const [ax, ay] = pts[i0]!;
    const [bx, by] = pts[i1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let best = -1;
    let bestD = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const [px, py] = pts[i]!;
      const d = len > 0 ? Math.abs(dx * (py - ay) - dy * (px - ax)) / len : Math.hypot(px - ax, py - ay);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) continue;
    keep[best] = 1;
    stack.push([i0, best], [best, i1]);
  }
  return pts.filter((_, i) => keep[i]);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/** Campioni oltre `fromS`, ordinati a partire dal tratto accoppiato verso l'esterno. */
function outward(chain: ChainPoint[], fromS: number, dir: -1 | 1, step: number): ChainPoint[] {
  const got = chain.filter((c) => dir < 0 ? c.s < fromS - step * 0.4 : c.s > fromS + step * 0.4);
  return dir < 0 ? got.reverse() : got;
}

/**
 * Estremità in cui una sola delle due pareti prosegue: la mediana continua a metà distanza,
 * finché la linea non gira.
 */
function staggerExtension(samples: ChainPoint[], toward: Point, half: number, maxLen: number): Point[] {
  const first = samples[0];
  if (!first) return [];
  const cosMax = Math.cos((STAGGER_TURN_DEG * Math.PI) / 180);
  const out: Point[] = [];
  let walked = 0;
  let prev = first.p;
  for (const c of samples) {
    walked += Math.hypot(c.p[0] - prev[0], c.p[1] - prev[1]);
    prev = c.p;
    if (walked > maxLen) break;
    if (c.tx * first.tx + c.ty * first.ty < cosMax) break;
    const nx = -c.ty;
    const ny = c.tx;
    const sign = nx * toward[0] + ny * toward[1] >= 0 ? 1 : -1;
    out.push([c.p[0] + nx * sign * half, c.p[1] + ny * sign * half]);
  }
  return out;
}

function buildMidline(chainA: ChainPoint[], chainB: ChainPoint[], run: Run, step: number, maxStagger: number): Point[] {
  const hits = run.hits;
  const first = hits[0]!;
  const last = hits[hits.length - 1]!;
  const half = run.distanceMm / 2;
  const tIncreases = last.t >= first.t;
  const ends: [Hit, -1 | 1, -1 | 1][] = [
    [first, -1, tIncreases ? -1 : 1],
    [last, 1, tIncreases ? 1 : -1],
  ];
  const extensions: [Point[], Point[]] = [[], []];
  ends.forEach(([hit, dirA, dirB], k) => {
    const sideA = outward(chainA, hit.s, dirA, step);
    const sideB = outward(chainB, hit.t, dirB, step);
    const aGoes = sideA.length * step > step * 2;
    const bGoes = sideB.length * step > step * 2;
    let walked: Point[] = [];
    if (aGoes && !bGoes) walked = staggerExtension(sideA, [hit.q[0] - hit.p[0], hit.q[1] - hit.p[1]], half, maxStagger);
    else if (bGoes && !aGoes) walked = staggerExtension(sideB, [hit.p[0] - hit.q[0], hit.p[1] - hit.q[1]], half, maxStagger);
    extensions[k] = k === 0 ? walked.reverse() : walked;
  });
  const mids = hits.map((h): Point => [(h.p[0] + h.q[0]) / 2, (h.p[1] + h.q[1]) / 2]);
  return simplify([...extensions[0]!, ...mids, ...extensions[1]!], step * 0.7);
}

function warningOf(d: DubiousPair, nominal: number, dMin: number, dMax: number): string {
  const where = `(${d.x.toFixed(1)}, ${d.y.toFixed(1)}) mm`;
  if (d.reason === 'angle') {
    return `Coppie dubbie: tangenti a ${d.angleDeg.toFixed(0)}°, oltre i ${PAIR_ANGLE_DEG.toFixed(0)}° ammessi, in ${where}.`;
  }
  if (d.reason === 'short') {
    if (d.overlapMm >= PAIR_MIN_LENGTH_W * nominal - 0.05) {
      return `Coppie dubbie: la compagna è già accoppiata, tratto di ${d.overlapMm.toFixed(1)} mm, in ${where}.`;
    }
    return `Coppie dubbie: parallele solo per ${d.overlapMm.toFixed(1)} mm, meno dei ${(PAIR_MIN_LENGTH_W * nominal).toFixed(1)} mm richiesti, in ${where}.`;
  }
  return `Coppie dubbie: distanza ${d.distanceMm.toFixed(1)} mm fuori tolleranza ${dMin.toFixed(1)}–${dMax.toFixed(1)} mm, in ${where}.`;
}

interface WallSeg {
  edge: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  s0: number;
  s1: number;
  tx: number;
  ty: number;
}

interface CastHit {
  seg: WallSeg;
  /** Distanza lungo la normale, mm. */
  t: number;
  /** Ascissa d'arco del punto colpito. */
  s: number;
  x: number;
  y: number;
}

interface NormalHit {
  s: number;
  t: number;
  dist: number;
  angleDeg: number;
  p: Point;
  q: Point;
  partner: number;
}

function wallSegments(chains: readonly ChainPoint[][]): WallSeg[] {
  const segs: WallSeg[] = [];
  chains.forEach((chain, edge) => {
    for (let i = 1; i < chain.length; i++) {
      const a = chain[i - 1]!;
      const b = chain[i]!;
      const dx = b.p[0] - a.p[0];
      const dy = b.p[1] - a.p[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-8) continue;
      segs.push({
        edge,
        ax: a.p[0],
        ay: a.p[1],
        bx: b.p[0],
        by: b.p[1],
        s0: a.s,
        s1: b.s,
        tx: dx / len,
        ty: dy / len,
      });
    }
  });
  return segs;
}

function segmentGrid(segs: readonly WallSeg[], cell: number): Map<string, number[]> {
  const grid = new Map<string, number[]>();
  segs.forEach((seg, index) => {
    const x0 = Math.floor(Math.min(seg.ax, seg.bx) / cell);
    const x1 = Math.floor(Math.max(seg.ax, seg.bx) / cell);
    const y0 = Math.floor(Math.min(seg.ay, seg.by) / cell);
    const y1 = Math.floor(Math.max(seg.ay, seg.by) / cell);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const key = `${ix},${iy}`;
        const bin = grid.get(key);
        if (bin) bin.push(index);
        else grid.set(key, [index]);
      }
    }
  });
  return grid;
}

function nearbySegments(
  ox: number,
  oy: number,
  reach: number,
  cell: number,
  grid: Map<string, number[]>,
  segs: readonly WallSeg[],
): WallSeg[] {
  const x0 = Math.floor((ox - reach) / cell);
  const x1 = Math.floor((ox + reach) / cell);
  const y0 = Math.floor((oy - reach) / cell);
  const y1 = Math.floor((oy + reach) / cell);
  const out: WallSeg[] = [];
  const seen = new Set<number>();
  for (let ix = x0; ix <= x1; ix++) {
    for (let iy = y0; iy <= y1; iy++) {
      for (const index of grid.get(`${ix},${iy}`) ?? []) {
        if (seen.has(index)) continue;
        seen.add(index);
        const seg = segs[index];
        if (seg) out.push(seg);
      }
    }
  }
  return out;
}

/** Prima intersezione della semiretta con una parete, a distanza fra tMin e tMax. */
function castNormal(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  segs: readonly WallSeg[],
  tMin: number,
  tMax: number,
  skip: (seg: WallSeg) => boolean,
): CastHit | null {
  let best: CastHit | null = null;
  for (const seg of segs) {
    if (skip(seg)) continue;
    const vx = seg.bx - seg.ax;
    const vy = seg.by - seg.ay;
    const den = dx * vy - dy * vx;
    if (Math.abs(den) < 1e-12) continue;
    const wx = seg.ax - ox;
    const wy = seg.ay - oy;
    const t = (wx * vy - wy * vx) / den;
    const u = (wx * dy - wy * dx) / den;
    if (t < tMin || t > tMax || u < -1e-5 || u > 1 + 1e-5) continue;
    if (best && t >= best.t) continue;
    const uu = Math.min(1, Math.max(0, u));
    best = {
      seg,
      t,
      s: seg.s0 + (seg.s1 - seg.s0) * uu,
      x: ox + dx * t,
      y: oy + dy * t,
    };
  }
  return best;
}

function nearOwn(seg: WallSeg, edge: number, s: number, minAlong: number, loop: boolean): boolean {
  if (seg.edge !== edge) return false;
  if (loop) return true;
  const mid = (seg.s0 + seg.s1) / 2;
  return Math.abs(mid - s) < minAlong;
}

/**
 * Normale da un campione: la parete opposta è la più vicina, e la sua normale
 * deve ricadere sullo stesso campione. Una terza linea in mezzo rompe la coppia.
 */
function confirmedHit(
  sample: ChainPoint,
  edge: number,
  hit: CastHit,
  near: readonly WallSeg[],
  loops: readonly boolean[],
  tMin: number,
  tMax: number,
  minAlong: number,
): NormalHit | null {
  const backSides: [number, number][] = [
    [-hit.seg.ty, hit.seg.tx],
    [hit.seg.ty, -hit.seg.tx],
  ];
  let back: CastHit | null = null;
  for (const [dx, dy] of backSides) {
    const found = castNormal(hit.x, hit.y, dx, dy, near, tMin, tMax, (seg) =>
      nearOwn(seg, hit.seg.edge, hit.s, minAlong, loops[hit.seg.edge] === true),
    );
    if (found && (!back || found.t < back.t)) back = found;
  }
  if (!back || back.seg.edge !== edge) return null;
  if (Math.hypot(back.x - sample.p[0], back.y - sample.p[1]) > Math.max(4, hit.t * 0.75)) return null;
  const parallel = Math.abs(sample.tx * hit.seg.tx + sample.ty * hit.seg.ty);
  return {
    s: sample.s,
    t: hit.s,
    dist: hit.t,
    angleDeg: (Math.acos(Math.min(1, parallel)) * 180) / Math.PI,
    p: [sample.p[0], sample.p[1]],
    q: [hit.x, hit.y],
    partner: hit.seg.edge,
  };
}

function oppositeWall(
  sample: ChainPoint,
  edge: number,
  segs: readonly WallSeg[],
  grid: Map<string, number[]>,
  cell: number,
  loops: readonly boolean[],
  tMin: number,
  tMax: number,
  minAlong: number,
  prefer: number | null,
): NormalHit | null {
  const sides: [number, number][] = [
    [-sample.ty, sample.tx],
    [sample.ty, -sample.tx],
  ];
  const near = nearbySegments(sample.p[0], sample.p[1], tMax, cell, grid, segs);
  const found: CastHit[] = [];
  for (const [dx, dy] of sides) {
    const hit = castNormal(sample.p[0], sample.p[1], dx, dy, near, tMin, tMax, (seg) =>
      nearOwn(seg, edge, sample.s, minAlong, loops[edge] === true),
    );
    if (hit) found.push(hit);
  }
  const confirmed = found
    .map((hit) => {
      const around = nearbySegments(hit.x, hit.y, tMax, cell, grid, segs);
      return confirmedHit(sample, edge, hit, around, loops, tMin, tMax, minAlong);
    })
    .filter((hit): hit is NormalHit => hit !== null)
    .sort((a, b) => a.dist - b.dist);
  const nearest = confirmed[0];
  if (!nearest) return null;
  // A parità di distanza resta la compagna già seguita, così un tubo corto affiancato non buca quello lungo.
  const kept =
    prefer === null
      ? nearest
      : (confirmed.find((hit) => hit.partner === prefer && hit.dist <= nearest.dist + 0.5) ?? nearest);
  return kept;
}

function groupRuns(hits: readonly NormalHit[], maxGap: number): NormalHit[][] {
  const byPartner = new Map<number, NormalHit[]>();
  for (const hit of hits) {
    const list = byPartner.get(hit.partner);
    if (list) list.push(hit);
    else byPartner.set(hit.partner, [hit]);
  }
  const runs: NormalHit[][] = [];
  for (const list of byPartner.values()) {
    list.sort((a, b) => a.s - b.s);
    let cur: NormalHit[] = [];
    for (const hit of list) {
      const prev = cur[cur.length - 1];
      if (prev && hit.s - prev.s <= maxGap) cur.push(hit);
      else {
        if (cur.length >= 4) runs.push(cur);
        cur = [hit];
      }
    }
    if (cur.length >= 4) runs.push(cur);
  }
  return runs;
}

/** Grafo delle pareti → coppie con linea mediana, linee singole e coppie dubbie. */
export function pairTubes(
  graph: SkeletonGraph,
  tube: { lineWidthMm: number; gapMm: number },
): TubePairing {
  const nominal = tube.lineWidthMm + tube.gapMm;
  const dMin = GAP_TOL_MIN * nominal;
  const dMax = GAP_TOL_MAX * nominal;
  const wideMin = SEARCH_DIST_MIN * nominal;
  const wideMax = SEARCH_DIST_MAX * nominal;
  const empty: TubePairing = {
    pairs: [],
    singles: graph.edges.map((e) => ({ edgeId: e.id, points: e.points })),
    dubious: [],
    warnings: [],
    nominalMm: nominal,
    distanceMinMm: dMin,
    distanceMaxMm: dMax,
  };
  if (!(nominal > 0) || graph.edges.length === 0) return empty;

  const step = SAMPLE_STEP_MM;
  const minAlong = Math.max(nominal * 1.1, dMin);
  const confidentMin = PAIR_MIN_LENGTH_W * nominal;
  const dubiousMin = DUBIOUS_MIN_LENGTH_W * nominal;

  const chains = graph.edges.map((e) => resample(e.points, step));
  const loops = graph.edges.map((e) => e.a === e.b);
  const segs = wallSegments(chains);
  const cell = Math.max(wideMax, 1);
  const grid = segmentGrid(segs, cell);

  const collect = (tMin: number, tMax: number): Map<number, NormalHit[]> => {
    const byEdge = new Map<number, NormalHit[]>();
    chains.forEach((chain, edge) => {
      // Il puntino è un anello solo: non si accoppia con sé stesso. Può però essere
      // la parete interna di un occhiello, di fronte a un altro arco.
      const hits: NormalHit[] = [];
      let prefer: number | null = null;
      for (const sample of chain) {
        const hit = oppositeWall(sample, edge, segs, grid, cell, loops, tMin, tMax, minAlong, prefer);
        if (!hit) continue;
        hits.push(hit);
        prefer = hit.partner;
      }
      if (hits.length > 0) byEdge.set(edge, hits);
    });
    return byEdge;
  };

  const toRun = (edge: number, hits: readonly NormalHit[]): Run | null => {
    let best: NormalHit[] | null = null;
    for (const run of groupRuns(hits, Math.max(step * 2.5, nominal * 0.5))) {
      const overlap = run[run.length - 1]!.s - run[0]!.s;
      const prev = best ? best[best.length - 1]!.s - best[0]!.s : -1;
      if (overlap > prev) best = run;
    }
    if (!best) return null;
    const overlapMm = best[best.length - 1]!.s - best[0]!.s;
    return {
      a: edge,
      b: best[0]!.partner,
      hits: best,
      overlapMm,
      distanceMm: median(best.map((hit) => hit.dist)),
      angleDeg: median(best.map((hit) => hit.angleDeg)),
    };
  };

  const acceptHits = collect(dMin, dMax);
  const runs: Run[] = [];
  for (const [edge, hits] of acceptHits) {
    const run = toRun(edge, hits);
    if (run && run.overlapMm >= confidentMin - 1e-6) runs.push(run);
  }
  runs.sort(
    (p, q) => q.overlapMm - p.overlapMm || Math.abs(p.distanceMm - nominal) - Math.abs(q.distanceMm - nominal) || p.a - q.a || p.b - q.b,
  );

  const claimed: { edge: number; s0: number; s1: number }[] = [];
  const rangeFree = (edge: number, s0: number, s1: number): boolean =>
    !claimed.some((span) => span.edge === edge && span.s1 > s0 + 1 && span.s0 < s1 - 1);
  const pairs: TubePair[] = [];
  for (const run of runs) {
    if (run.a === run.b && loops[run.a]) continue;
    const s0 = run.hits[0]!.s;
    const s1 = run.hits[run.hits.length - 1]!.s;
    const ts = run.hits.map((hit) => hit.t);
    const t0 = Math.min(...ts);
    const t1 = Math.max(...ts);
    if (!rangeFree(run.a, s0, s1)) continue;
    if (!rangeFree(run.b, t0, t1)) continue;
    claimed.push({ edge: run.a, s0, s1 }, { edge: run.b, s0: t0, s1: t1 });
    const raw = buildMidline(chains[run.a]!, chains[run.b]!, run, step, STAGGER_MAX_W * nominal);
    const midline = smoothPolyline(raw, false);
    pairs.push({
      a: run.a,
      b: run.b,
      midline,
      lengthMm: lengthOf(midline),
      overlapMm: run.overlapMm,
      distanceMm: run.distanceMm,
    });
  }
  const pairedEdge = new Set(pairs.flatMap((pair) => [pair.a, pair.b]));

  const noticeHits = collect(wideMin, wideMax);
  const dubious: DubiousPair[] = [];
  for (const [edge, hits] of noticeHits) {
    if (pairedEdge.has(edge)) continue;
    if (loops[edge]) continue;
    const run = toRun(edge, hits);
    if (!run || run.overlapMm < dubiousMin - 1e-6) continue;
    const inRange = run.distanceMm >= dMin && run.distanceMm <= dMax;
    const mid = run.hits[Math.floor(run.hits.length / 2)]!;
    dubious.push({
      a: run.a,
      b: run.b,
      reason: inRange ? 'short' : 'distance',
      angleDeg: run.angleDeg,
      overlapMm: run.overlapMm,
      distanceMm: run.distanceMm,
      x: (mid.p[0] + mid.q[0]) / 2,
      y: (mid.p[1] + mid.q[1]) / 2,
    });
  }
  dubious.sort((p, q) => q.overlapMm - p.overlapMm || p.a - q.a || p.b - q.b);
  const seenPairs = new Set<string>();
  const uniqueDubious: DubiousPair[] = [];
  for (const doubt of dubious) {
    const lo = Math.min(doubt.a, doubt.b);
    const hi = Math.max(doubt.a, doubt.b);
    const key = `${lo}:${hi}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    uniqueDubious.push(doubt);
  }
  dubious.length = 0;
  dubious.push(...uniqueDubious);

  const singles: TubeLine[] = graph.edges
    .filter((e) => !pairedEdge.has(e.id) && !dubious.some((d) => d.a === e.id || d.b === e.id))
    .map((e) => ({ edgeId: e.id, points: e.points }));

  return {
    pairs,
    singles,
    dubious,
    warnings: dubious.map((d) => warningOf(d, nominal, dMin, dMax)),
    nominalMm: nominal,
    distanceMinMm: dMin,
    distanceMaxMm: dMax,
  };
}
