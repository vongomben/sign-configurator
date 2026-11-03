// [G] Errori e avvisi con posizione (SPEC §5). Una piega oltre il massimo è una
// "curva" se il raggio cresce con la scala, uno "spigolo" se sta in al più due
// cerniere e il raggio non cresce. Modulo puro.

import type { ChainHinge, ChainPath } from './chain';
import { rMin, type Params } from '../config';
import type { Point } from './rasterize';
import type { SegmentNotice } from './segment';

export type IssueLevel = 'error' | 'warning';

/** curva: si allenta ingrandendo. spigolo: cuspide, la scala non basta. */
export type BendKind = 'curva' | 'spigolo';

export interface ValidationIssue {
  level: IssueLevel;
  bend: BendKind | null;
  segmentId: number | null;
  /** Raggio locale della piega, mm. null se l'avviso non è una piega. */
  radiusMm: number | null;
  message: string;
  x: number;
  y: number;
}

export interface ValidateInput {
  chains: readonly (ChainPath & { id: number; dot?: boolean })[];
  /**
   * Le stesse catene costruite a scala doppia, con le posizioni riportate
   * all'originale e il raggio lasciato in millimetri della scala doppia.
   */
  scaledChains?: readonly (ChainPath & { id: number })[];
  notices: readonly SegmentNotice[];
  params: Params;
}

/** Sotto questa crescita del raggio (scala ×2) la piega non si allenta. */
const RADIUS_GROWTH = 1.5;

const where = (x: number, y: number): string => `(${x.toFixed(1)}, ${y.toFixed(1)}) mm`;

function pointAt(points: readonly Point[], distance: number): Point {
  if (points.length === 0) return [0, 0];
  let left = Math.max(0, distance);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (left <= len || i === points.length - 1) {
      const t = len > 1e-9 ? Math.min(1, left / len) : 0;
      return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    }
    left -= len;
  }
  return points[points.length - 1]!;
}

/**
 * Raggio più stretto vicino al gruppo. null = attorno restano solo tratti dritti.
 * undefined = nessuna cerniera nel raggio di ricerca.
 */
function tightestNear(chain: ChainPath | undefined, hinges: readonly ChainHinge[], reach: number): number | null | undefined {
  if (!chain) return undefined;
  let best: number | null | undefined = undefined;
  for (const origin of hinges) {
    for (const hinge of chain.hinges) {
      if (Math.hypot(hinge.x - origin.x, hinge.y - origin.y) > reach) continue;
      if (hinge.radiusMm === null) {
        if (best === undefined) best = null;
        continue;
      }
      if (best === undefined || best === null || hinge.radiusMm < best) best = hinge.radiusMm;
    }
  }
  return best;
}

/** Un gruppo di cerniere oltre il massimo è uno spigolo solo se è corto e non si allarga. */
function clusterKind(cluster: readonly ChainHinge[], scaled: ChainPath | undefined, pitch: number): BendKind {
  const currentR = cluster.reduce((min, hinge) => {
    const radius = hinge.radiusMm;
    return radius === null ? min : Math.min(min, radius);
  }, Infinity);
  const scaledR = tightestNear(scaled, cluster, pitch * 2);
  const grows = scaledR === undefined || scaledR === null || !(currentR < Infinity) || scaledR >= currentR * RADIUS_GROWTH;
  return !grows && cluster.length <= 2 ? 'spigolo' : 'curva';
}

/** Avvisi e errori, gli errori prima, poi dall'alto verso il basso. */
export function validateStrip(input: ValidateInput): ValidationIssue[] {
  const { params } = input;
  const minRadius = rMin(params);
  const scaledById = new Map((input.scaledChains ?? []).map((chain) => [chain.id, chain]));
  const issues: ValidationIssue[] = [];

  for (const chain of input.chains) {
    const slot = chain.closed || chain.dot ? 0 : params.WIRE_SLOT_L * 2;
    const useful = Math.max(0, chain.lengthMm - slot);
    if (useful < params.CUT_PITCH - 1e-6) {
      const mid = pointAt(chain.points, chain.lengthMm / 2);
      issues.push({
        level: 'error',
        bend: null,
        segmentId: chain.id,
        radiusMm: null,
        x: mid[0],
        y: mid[1],
        message: `Spezzone ${chain.id}: luce ${useful.toFixed(1)} mm, sotto il passo di taglio ${params.CUT_PITCH.toFixed(1)} mm, in ${where(mid[0], mid[1])}.`,
      });
    }
    const kinds = new Map<ChainHinge, BendKind>();
    let cursor = 0;
    const hinges = chain.hinges;
    while (cursor < hinges.length) {
      if (!hinges[cursor]!.over) {
        cursor += 1;
        continue;
      }
      let end = cursor + 1;
      while (end < hinges.length && hinges[end]!.over) end += 1;
      const cluster = hinges.slice(cursor, end);
      const kind = clusterKind(cluster, scaledById.get(chain.id), params.HINGE_PITCH);
      for (const hinge of cluster) kinds.set(hinge, kind);
      cursor = end;
    }
    for (const hinge of hinges) {
      if (!hinge.over) continue;
      const bend = kinds.get(hinge) ?? 'curva';
      const radius = hinge.radiusMm === null ? '∞' : hinge.radiusMm.toFixed(1);
      const kind = bend === 'curva' ? 'curva troppo stretta' : 'spigolo';
      const remedy = bend === 'curva' ? 'Si allenta ingrandendo il testo.' : 'Non si allenta ingrandendo il testo.';
      issues.push({
        level: 'error',
        bend,
        segmentId: chain.id,
        radiusMm: hinge.radiusMm,
        x: hinge.x,
        y: hinge.y,
        message: `Spezzone ${chain.id}: ${kind}, raggio ${radius} mm (angolo ${hinge.angleDeg.toFixed(1)}°, minimo ${minRadius.toFixed(1)} mm), in ${where(hinge.x, hinge.y)}. ${remedy}`,
      });
    }
  }

  for (const notice of input.notices) {
    if (notice.kind === 'crossing') {
      issues.push({
        level: 'warning',
        bend: null,
        segmentId: null,
        radiusMm: null,
        x: notice.x,
        y: notice.y,
        message: `Incrocio interrotto di ${params.CROSSING_GAP.toFixed(1)} mm per lato, in ${where(notice.x, notice.y)}.`,
      });
    } else if (notice.kind === 'excluded') {
      const radius = notice.radiusMm ?? 0;
      issues.push({
        level: 'warning',
        bend: null,
        segmentId: null,
        radiusMm: notice.radiusMm,
        x: notice.x,
        y: notice.y,
        message: `Anello chiuso escluso: raggio ${radius.toFixed(1)} mm sotto il minimo ${minRadius.toFixed(1)} mm, in ${where(notice.x, notice.y)}.`,
      });
    } else if (notice.kind === 'unlit') {
      const radius = notice.radiusMm ?? 0;
      issues.push({
        level: 'warning',
        bend: null,
        segmentId: null,
        radiusMm: notice.radiusMm,
        x: notice.x,
        y: notice.y,
        message: `Puntino non illuminato, raggio ${radius.toFixed(1)} mm, in ${where(notice.x, notice.y)}.`,
      });
    } else {
      issues.push({
        level: 'warning',
        bend: null,
        segmentId: null,
        radiusMm: null,
        x: notice.x,
        y: notice.y,
        message: `Giunzione di grado ${notice.degree ?? 0}: prosegue solo la coppia più dritta, in ${where(notice.x, notice.y)}.`,
      });
    }
  }

  const rank = (level: IssueLevel): number => (level === 'error' ? 0 : 1);
  issues.sort((a, b) => rank(a.level) - rank(b.level) || b.y - a.y || a.x - b.x || a.message.localeCompare(b.message));
  return issues;
}

export interface ClearanceClash {
  x: number;
  y: number;
  distance: number;
  limit: number;
}

interface ClearanceLine {
  points: readonly Point[];
  closed?: boolean;
}

const CLEARANCE_STEP = 2;
/** Sotto questo angolo fra i due rami il tratto torna indietro: sono le due pareti di un tubo, non un angolo. */
const WALL_FOLD_DEG = 20;

function arcSamples(
  points: readonly Point[],
  step: number,
  closed: boolean,
): { p: Point; s: number; dir: [number, number] }[] {
  if (points.length === 0) return [];
  const out: { p: Point; s: number; dir: [number, number] }[] = [];
  let s = 0;
  let next = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (seg < 1e-9) continue;
    const dir: [number, number] = [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg];
    while (next <= s + seg + 1e-9) {
      const t = (next - s) / seg;
      if (t >= -1e-6 && t <= 1 + 1e-6) {
        const u = Math.min(1, Math.max(0, t));
        out.push({ p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], s: next, dir });
      }
      next += step;
    }
    s += seg;
  }
  if (closed && out.length > 1) {
    const a = out[0]!.p;
    const b = out[out.length - 1]!.p;
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05) out.pop();
  }
  return out;
}

/** I due rami si aprono almeno di `deg`: è un angolo, non due pareti affiancate. */
function legsDiverge(ja: Point, pa: Point, jb: Point, pb: Point, deg: number): boolean {
  const ax = pa[0] - ja[0];
  const ay = pa[1] - ja[1];
  const bx = pb[0] - jb[0];
  const by = pb[1] - jb[1];
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < 1e-6 || lb < 1e-6) return true;
  const cos = (ax * bx + ay * by) / (la * lb);
  const angle = (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
  return angle >= deg;
}

/**
 * Due tratti non contigui della linea centrale più vicini di
 * CHANNEL_W + 2·WALL + MIN_GAP: le sagome si fondono.
 * Vale anche fra le due pareti dello stesso tubo (stripMode "walls"): l'altezza
 * minima le tiene a distanza di canale, con MIN_GAP fra le sagome.
 * Un angolo, o due spezzoni che si toccano e si aprono, non conta: la corda
 * taglia il vertice. Due rami che tornano indietro, quasi paralleli, sì.
 */
export function centerlineClearance(
  lines: readonly ClearanceLine[],
  params: Pick<Params, 'CHANNEL_W' | 'WALL' | 'MIN_GAP' | 'CORNER_MERGE_DIST' | 'CROSSING_GAP'>,
  crossings: readonly Point[] = [],
): ClearanceClash | null {
  const limit = params.CHANNEL_W + 2 * params.WALL + params.MIN_GAP;
  const joinGap = Math.max(params.CORNER_MERGE_DIST, params.CROSSING_GAP * 2 + 1.5);
  const sampled = lines
    .map((line, index) => {
      const pts = line.points;
      let length = 0;
      for (let i = 1; i < pts.length; i++) {
        length += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
      }
      const closed = line.closed === true;
      return {
        index,
        closed,
        length,
        start: pts[0] ?? ([0, 0] as Point),
        end: pts[pts.length - 1] ?? ([0, 0] as Point),
        samples: arcSamples(pts, CLEARANCE_STEP, closed),
      };
    })
    .filter((line) => line.samples.length > 0);

  const byLine = new Map(sampled.map((line) => [line.index, line]));
  const flat: { p: Point; s: number; dir: [number, number]; line: number }[] = [];
  for (const line of sampled) {
    for (const sample of line.samples) flat.push({ p: sample.p, s: sample.s, dir: sample.dir, line: line.index });
  }
  const foldCos = -Math.cos((WALL_FOLD_DEG * Math.PI) / 180);

  const nearCrossing = (a: Point, b: Point): boolean => {
    for (const c of crossings) {
      if (Math.hypot(a[0] - c[0], a[1] - c[1]) <= limit && Math.hypot(b[0] - c[0], b[1] - c[1]) <= limit) return true;
    }
    return false;
  };

  const buckets = new Map<string, number[]>();
  const cellOf = (p: Point): [number, number] => [Math.floor(p[0] / limit), Math.floor(p[1] / limit)];
  for (let i = 0; i < flat.length; i++) {
    const [cx, cy] = cellOf(flat[i]!.p);
    const key = `${cx},${cy}`;
    const list = buckets.get(key);
    if (list) list.push(i);
    else buckets.set(key, [i]);
  }

  let best: ClearanceClash | null = null;
  for (let i = 0; i < flat.length; i++) {
    const a = flat[i]!;
    const A = byLine.get(a.line)!;
    const [ix, iy] = cellOf(a.p);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = buckets.get(`${ix + dx},${iy + dy}`);
        if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
      const b = flat[j]!;
      const B = byLine.get(b.line)!;
      if (a.line === b.line) {
        let sep = Math.abs(a.s - b.s);
        if (A.closed) sep = Math.min(sep, A.length - sep);
        if (sep <= limit) continue;
        // Un angolo cambia direzione meno di un ritorno: la corda taglia l'angolo, non è un secondo canale.
        if (a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1] > foldCos) continue;
      } else if (!A.closed && !B.closed) {
        let through: number | null = null;
        let jointA: Point | null = null;
        let jointB: Point | null = null;
        const endsA: { p: Point; s: number }[] = [
          { p: A.start, s: 0 },
          { p: A.end, s: A.length },
        ];
        const endsB: { p: Point; s: number }[] = [
          { p: B.start, s: 0 },
          { p: B.end, s: B.length },
        ];
        for (const ea of endsA) {
          for (const eb of endsB) {
            const gap = Math.hypot(ea.p[0] - eb.p[0], ea.p[1] - eb.p[1]);
            if (gap > joinGap) continue;
            const path = Math.abs(a.s - ea.s) + gap + Math.abs(b.s - eb.s);
            if (through === null || path < through) {
              through = path;
              jointA = ea.p;
              jointB = eb.p;
            }
          }
        }
        if (through !== null && through <= limit) continue;
        if (jointA && jointB && legsDiverge(jointA, a.p, jointB, b.p, WALL_FOLD_DEG)) continue;
        if (nearCrossing(a.p, b.p)) continue;
      } else if (nearCrossing(a.p, b.p)) {
        continue;
      }
      const d = Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]);
      if (d >= limit - 1e-6) continue;
      if (best && d >= best.distance) continue;
      best = { x: (a.p[0] + b.p[0]) / 2, y: (a.p[1] + b.p[1]) / 2, distance: d, limit };
        }
      }
    }
  }
  return best;
}
