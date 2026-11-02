// Contorni di una bitmap binaria (SPEC §4bis, trace "outline").
// Marching squares: i pixel diagonali non si uniscono, così un buco resta un buco.
// Modulo puro. Stessa bitmap → stessi percorsi, in browser, worker e Node.
import { POLYLINE_TOLERANCE_PX } from '../geometry/graph';
import { pxToMm, type Point, type PxToMm } from '../geometry/rasterize';

/** Buco più piccolo di così non diventa un percorso di striscia (SPEC §4bis). */
export const MIN_HOLE_AREA_MM2 = 0.05;

export interface TracePath {
  /** Pixel continui, Y verso il basso. Il primo punto non è ripetuto in coda: il percorso è chiuso. */
  points: Point[];
  /** Gira intorno a un buco, non al bordo esterno di una regione. */
  hole: boolean;
}

export interface TraceOptions {
  /** Douglas-Peucker, in pixel. Default 0,75, come le polilinee di [C]. */
  tolerancePx?: number;
  /** I buchi con area minore si scartano. 0 li tiene tutti. */
  minHoleAreaPx?: number;
}

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

const keyOf = (x: number, y: number): string => `${Math.round(x * 2)},${Math.round(y * 2)}`;

/**
 * Bordi delle regioni piene. Ogni percorso è chiuso; l'inchiostro resta a destra
 * (Y verso il basso), quindi i buchi hanno area con segno negativo.
 */
export function traceContours(data: Uint8Array, width: number, height: number, options: TraceOptions = {}): TracePath[] {
  const tolerance = options.tolerancePx ?? POLYLINE_TOLERANCE_PX;
  const minHole = options.minHoleAreaPx ?? 0;
  const segs = segments(data, width, height);
  const starts = new Map<string, number[]>();
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    const key = keyOf(seg.ax, seg.ay);
    const list = starts.get(key);
    if (list) list.push(i);
    else starts.set(key, [i]);
  }
  const used = new Uint8Array(segs.length);
  const out: TracePath[] = [];
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;
    const loop = walk(segs, starts, used, s);
    if (!loop) continue;
    const area = signedArea(loop);
    const hole = area < 0;
    if (hole && Math.abs(area) < minHole) continue;
    const points = simplifyClosed(loop, tolerance);
    if (points.length >= 3) out.push({ points, hole });
  }
  return out;
}

/** Polilinee in mm, Y verso l'alto, già semplificate. I buchi sotto `minHoleAreaMm2` non ci sono. */
export function outlinePolylines(
  raster: { data: Uint8Array; width: number; height: number; pxPerMm: number; pxToMm: PxToMm },
  minHoleAreaMm2 = MIN_HOLE_AREA_MM2,
): Point[][] {
  const paths = traceContours(raster.data, raster.width, raster.height, {
    minHoleAreaPx: minHoleAreaMm2 * raster.pxPerMm * raster.pxPerMm,
  });
  return paths.map((path) => path.points.map((point) => pxToMm(raster.pxToMm, point[0], point[1])));
}

function segments(data: Uint8Array, width: number, height: number): Seg[] {
  const at = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    return data[y * width + x] ? 1 : 0;
  };
  const segs: Seg[] = [];
  const add = (a: Point, b: Point): void => {
    segs.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1] });
  };
  for (let j = -1; j < height; j++) {
    for (let i = -1; i < width; i++) {
      const mask = at(i, j) | (at(i + 1, j) << 1) | (at(i + 1, j + 1) << 2) | (at(i, j + 1) << 3);
      if (mask === 0 || mask === 15) continue;
      const top: Point = [i + 1, j + 0.5];
      const right: Point = [i + 1.5, j + 1];
      const bottom: Point = [i + 1, j + 1.5];
      const left: Point = [i + 0.5, j + 1];
      switch (mask) {
        case 1:
          add(top, left);
          break;
        case 2:
          add(right, top);
          break;
        case 3:
          add(right, left);
          break;
        case 4:
          add(bottom, right);
          break;
        case 5:
          add(top, left);
          add(bottom, right);
          break;
        case 6:
          add(bottom, top);
          break;
        case 7:
          add(bottom, left);
          break;
        case 8:
          add(left, bottom);
          break;
        case 9:
          add(top, bottom);
          break;
        case 10:
          add(right, top);
          add(left, bottom);
          break;
        case 11:
          add(right, bottom);
          break;
        case 12:
          add(left, right);
          break;
        case 13:
          add(top, right);
          break;
        case 14:
          add(left, top);
          break;
        default:
          break;
      }
    }
  }
  return segs;
}

/** Il segmento di partenza è il primo non usato, in ordine di scansione: il risultato non dipende dall'ordine di scoperta. */
function walk(segs: Seg[], starts: Map<string, number[]>, used: Uint8Array, start: number): Point[] | null {
  const first = segs[start];
  if (!first) return null;
  used[start] = 1;
  const startKey = keyOf(first.ax, first.ay);
  const points: Point[] = [[first.ax, first.ay]];
  let current = first;
  for (let guard = 0; guard < segs.length; guard++) {
    points.push([current.bx, current.by]);
    if (keyOf(current.bx, current.by) === startKey) return points.slice(0, -1);
    const next = chooseNext(segs, current, starts.get(keyOf(current.bx, current.by)) ?? [], used);
    if (next < 0) return null;
    used[next] = 1;
    const seg = segs[next];
    if (!seg) return null;
    current = seg;
  }
  return null;
}

/**
 * A un incrocio si prende la svolta più a destra: l'inchiostro resta a destra del verso
 * di marcia e due regioni che si toccano solo in diagonale non si fondono.
 */
function chooseNext(segs: Seg[], incoming: Seg, candidates: readonly number[], used: Uint8Array): number {
  let best = -1;
  let bestTurn = Infinity;
  const heading = Math.atan2(incoming.by - incoming.ay, incoming.bx - incoming.ax);
  for (const index of candidates) {
    if (used[index]) continue;
    const seg = segs[index];
    if (!seg) continue;
    const out = Math.atan2(seg.by - seg.ay, seg.bx - seg.ax);
    let turn = heading + Math.PI - out;
    turn %= 2 * Math.PI;
    if (turn < 0) turn += 2 * Math.PI;
    if (turn <= 1e-9) turn = 2 * Math.PI;
    if (turn < bestTurn) {
      bestTurn = turn;
      best = index;
    }
  }
  return best;
}

function signedArea(points: readonly Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    area += p[0] * q[1] - q[0] * p[1];
  }
  return area / 2;
}

function simplifyClosed(points: Point[], tol: number): Point[] {
  if (points.length <= 4) return points.map((point) => [point[0], point[1]]);
  let far = 1;
  let best = -1;
  const origin = points[0]!;
  for (let i = 1; i < points.length; i++) {
    const point = points[i]!;
    const distance = Math.hypot(point[0] - origin[0], point[1] - origin[1]);
    if (distance > best) {
      best = distance;
      far = i;
    }
  }
  const head = simplifyOpen(points.slice(0, far + 1), tol);
  const tail = simplifyOpen([...points.slice(far), [origin[0], origin[1]]], tol);
  return [...head, ...tail.slice(1, -1)];
}

function simplifyOpen(points: readonly Point[], tol: number): Point[] {
  if (points.length <= 2) return points.map((point) => [point[0], point[1]]);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const frame = stack.pop();
    if (!frame) break;
    const [i0, i1] = frame;
    const a = points[i0]!;
    const b = points[i1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    let best = -1;
    let bestD = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const point = points[i]!;
      const distance = len > 0 ? Math.abs(dx * (point[1] - a[1]) - dy * (point[0] - a[0])) / len : Math.hypot(point[0] - a[0], point[1] - a[1]);
      if (distance > bestD) {
        bestD = distance;
        best = i;
      }
    }
    if (best < 0) continue;
    keep[best] = 1;
    stack.push([i0, best], [best, i1]);
  }
  return points.filter((_, index) => keep[index]).map((point) => [point[0], point[1]]);
}
