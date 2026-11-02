// [F] Catena di cerniere (SPEC §5). Le corde sono lunghe HINGE_PITCH; l'angolo in una
// cerniera è la deviazione fra due corde. Su un arco di raggio R vale
// R = p / (2·sin(θ/2)), e la freccia è s = p² / (8R). La freccia allarga il canale
// solo verso l'interno. Modulo puro.

import type { Point } from './rasterize';

export interface ChainOptions {
  hingePitch: number;
  hingeMaxDeg: number;
  channelW: number;
  closed: boolean;
}

export interface ChainHinge {
  x: number;
  y: number;
  /** Deviazione in gradi: 0 = dritto. */
  angleDeg: number;
  /** null se il tratto è dritto. */
  radiusMm: number | null;
  sagittaMm: number;
  channelWMm: number;
  /** Angolo maggiore di HINGE_MAX_DEG. */
  over: boolean;
}

export interface ChainPath {
  points: Point[];
  closed: boolean;
  /** Somma delle corde, mm. */
  lengthMm: number;
  hinges: ChainHinge[];
  maxAngleDeg: number;
  minRadiusMm: number | null;
}

interface Cursor {
  /** Indice del vertice ancora davanti. */
  next: number;
  p: Point;
  arc: number;
}

const dist = (a: Point, b: Point): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Primo punto del segmento a–b la cui distanza da origin è pitch. */
function interpolateChord(origin: Point, a: Point, b: Point, pitch: number): Point {
  const ax = a[0] - origin[0];
  const ay = a[1] - origin[1];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const A = dx * dx + dy * dy;
  const B = 2 * (ax * dx + ay * dy);
  const C = ax * ax + ay * ay - pitch * pitch;
  const disc = B * B - 4 * A * C;
  if (A > 1e-12 && disc >= -1e-8) {
    const s = Math.sqrt(Math.max(0, disc));
    const roots = [(-B - s) / (2 * A), (-B + s) / (2 * A)]
      .filter((t) => t >= -1e-6 && t <= 1 + 1e-6)
      .sort((p, q) => p - q);
    const t = roots[0];
    if (t !== undefined) {
      const u = Math.min(1, Math.max(0, t));
      return [a[0] + u * dx, a[1] + u * dy];
    }
  }
  return b;
}

function nextChord(points: readonly Point[], cur: Cursor, pitch: number): Cursor | null {
  const origin = cur.p;
  let arc = cur.arc;
  let prev = cur.p;
  let i = cur.next;
  while (i < points.length) {
    const q = points[i]!;
    const segLen = dist(prev, q);
    const dChord = dist(origin, q);
    if (dChord >= pitch - 1e-7) {
      const onVertex = dChord <= pitch + 1e-6;
      const hit = onVertex ? q : interpolateChord(origin, prev, q, pitch);
      return { p: hit, next: onVertex ? i + 1 : i, arc: arc + dist(prev, hit) };
    }
    arc += segLen;
    prev = q;
    i += 1;
  }
  return null;
}

function sampleChords(points: readonly Point[], pitch: number, closed: boolean): Point[] {
  if (points.length === 0) return [];
  const seq = closed ? [...dropClose(points), points[0]!] : points.slice();
  if (seq.length < 2) return seq.slice();
  const samples: Point[] = [[seq[0]![0], seq[0]![1]]];
  let cur: Cursor = { next: 1, p: seq[0]!, arc: 0 };
  const total = closed ? lengthOf(seq) : Infinity;
  for (let guard = 0; guard < seq.length + 10000; guard++) {
    const n = nextChord(seq, cur, pitch);
    if (!n) break;
    if (closed && n.arc >= total - 1e-4) break;
    if (dist(n.p, samples[samples.length - 1]!) < 1e-4) break;
    samples.push(n.p);
    cur = n;
  }
  const end = seq[seq.length - 1]!;
  if (dist(end, samples[samples.length - 1]!) > 1e-4) samples.push([end[0], end[1]]);
  return samples;
}

function dropClose(points: readonly Point[]): Point[] {
  if (points.length >= 2 && dist(points[0]!, points[points.length - 1]!) <= 1e-6) return points.slice(0, -1);
  return points.slice();
}

function lengthOf(points: readonly Point[]): number {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += dist(points[i - 1]!, points[i]!);
  return l;
}

function hingesOf(points: readonly Point[], options: ChainOptions): ChainHinge[] {
  const n = points.length;
  if (n < 3) return [];
  const out: ChainHinge[] = [];
  for (let i = options.closed ? 0 : 1; i < n - 1; i++) {
    const prev = points[i === 0 ? n - 2 : i - 1]!;
    const cur = points[i]!;
    const next = points[i + 1]!;
    const ix = cur[0] - prev[0];
    const iy = cur[1] - prev[1];
    const ox = next[0] - cur[0];
    const oy = next[1] - cur[1];
    const il = Math.hypot(ix, iy);
    const ol = Math.hypot(ox, oy);
    if (il < 1e-9 || ol < 1e-9) continue;
    const dot = Math.min(1, Math.max(-1, (ix * ox + iy * oy) / (il * ol)));
    const angleDeg = (Math.acos(dot) * 180) / Math.PI;
    const theta = (angleDeg * Math.PI) / 180;
    const radiusMm = theta < 1e-4 ? null : options.hingePitch / (2 * Math.sin(theta / 2));
    const sagittaMm = radiusMm === null ? 0 : (options.hingePitch * options.hingePitch) / (8 * radiusMm);
    out.push({
      x: cur[0],
      y: cur[1],
      angleDeg,
      radiusMm,
      sagittaMm,
      channelWMm: options.channelW + sagittaMm,
      over: angleDeg > options.hingeMaxDeg + 0.05,
    });
  }
  return out;
}

/** Ricampiona la polilinea a corde di `hingePitch` e calcola angolo, raggio, freccia e larghezza. */
export function resampleChain(points: readonly Point[], options: ChainOptions): ChainPath {
  const pitch = options.hingePitch > 0 ? options.hingePitch : 10;
  const sampled = sampleChords(points, pitch, options.closed);
  const hinges = hingesOf(sampled, { ...options, hingePitch: pitch });
  let maxAngleDeg = 0;
  let minRadiusMm: number | null = null;
  for (const h of hinges) {
    if (h.angleDeg > maxAngleDeg) maxAngleDeg = h.angleDeg;
    if (h.radiusMm !== null && (minRadiusMm === null || h.radiusMm < minRadiusMm)) minRadiusMm = h.radiusMm;
  }
  return {
    points: sampled,
    closed: options.closed,
    lengthMm: lengthOf(sampled),
    hinges,
    maxAngleDeg,
    minRadiusMm,
  };
}
