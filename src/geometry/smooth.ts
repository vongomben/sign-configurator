// [E] Levigatura Chaikin + ricampionamento (SPEC §5). Modulo puro.
// Due passate al quarto classico: il raccordo cresce con la lettera, così un
// testo più alto allenta le pieghe. Poi si ricampiona a passo costante.

import type { Point } from './rasterize';

export const CHAIKIN_ITERATIONS = 2;
/** Passo del ricampionamento dopo la levigatura, mm. */
export const SMOOTH_STEP_MM = 1;

const dist = (a: Point, b: Point): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

const lerp = (a: Point, b: Point, t: number): Point => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];

function dropClosing(points: readonly Point[]): Point[] {
  if (points.length >= 2 && dist(points[0]!, points[points.length - 1]!) <= 1e-6) return points.slice(0, -1);
  return points.slice();
}

function chaikinOnce(points: readonly Point[], closed: boolean): Point[] {
  const n = points.length;
  if (n < (closed ? 3 : 2)) return points.slice();
  const out: Point[] = [];
  if (!closed) out.push(points[0]!);
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const p = points[i]!;
    const q = points[closed ? (i + 1) % n : i + 1]!;
    const len = dist(p, q);
    if (len < 1e-9) continue;
    const t = 0.25;
    out.push(lerp(p, q, t), lerp(p, q, 1 - t));
  }
  if (!closed) out.push(points[n - 1]!);
  return out.length >= 2 ? out : points.slice();
}

/** Punti a passo d'arco costante, estremi compresi. Chiuso: il primo punto è ripetuto in fondo. */
export function resampleByArcLength(points: readonly Point[], stepMm: number, closed: boolean): Point[] {
  const ring = closed ? dropClosing(points) : points.slice();
  if (ring.length === 0) return [];
  if (ring.length === 1) return closed ? [ring[0]!, ring[0]!] : [ring[0]!];
  const seq = closed ? [...ring, ring[0]!] : ring;
  const step = Math.max(stepMm, 1e-3);
  const out: Point[] = [seq[0]!];
  let carry = 0;
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1]!;
    const b = seq[i]!;
    const len = dist(a, b);
    if (len < 1e-9) continue;
    let done = step - carry;
    while (done <= len + 1e-9) {
      out.push(lerp(a, b, Math.min(1, done / len)));
      done += step;
    }
    carry = len - (done - step);
  }
  const end = seq[seq.length - 1]!;
  if (dist(out[out.length - 1]!, end) > 1e-4) out.push(end);
  else out[out.length - 1] = end;
  return out;
}

/** Chaikin (estremi fissi se aperto) e ricampionamento. */
export function smoothPolyline(
  points: readonly Point[],
  closed: boolean,
  iterations = CHAIKIN_ITERATIONS,
  stepMm = SMOOTH_STEP_MM,
): Point[] {
  if (points.length < 2) return points.slice();
  let cur = closed ? dropClosing(points) : points.slice();
  if (closed && cur.length < 3) return [...cur, cur[0]!];
  for (let k = 0; k < iterations; k++) cur = chaikinOnce(cur, closed);
  return resampleByArcLength(cur, stepMm, closed);
}
