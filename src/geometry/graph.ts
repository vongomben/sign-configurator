// [C] Grafo dello scheletro (SPEC §5): nodi = estremi (grado 1) e giunzioni (grado ≥ 3), archi =
// polilinee in mm. Potatura dei rami spuri più corti della larghezza del tratto e fusione delle
// giunzioni vicine (un incrocio esce dal thinning come due giunzioni a Y unite da un arco corto).
// Modulo puro, deterministico. Con stripMode "walls" ogni polilinea e' gia' una striscia.

import { squaredDistanceTo } from './distance';
import { pxToMm, type Point, type PxToMm } from './rasterize';
import { crossings, ring, ringCount, ringOffsets, skeletonize } from './skeleton';

export interface GraphNode {
  id: number;
  /** Posizione in mm (Y in su). */
  x: number;
  y: number;
  degree: number;
}

export interface GraphEdge {
  id: number;
  a: number;
  b: number;
  /** Polilinea in mm da a a b, estremi compresi. a === b: anello chiuso. */
  points: Point[];
  lengthMm: number;
}

export interface SkeletonGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Larghezza del tratto stimata con la distance transform sull'asse (mediana), mm. */
  strokeWidthMm: number;
  /** Scheletro di [B], stessa griglia della bitmap. */
  skeleton: Uint8Array;
  /** Forellini (area < (HOLE_FILL_MAX_W · tratto)²) riempiti prima del thinning. */
  filledHoles: number;
  prunedSpurs: number;
  mergedJunctions: number;
}

export interface GraphInput {
  data: Uint8Array;
  width: number;
  height: number;
  pxPerMm: number;
  pxToMm: PxToMm;
}

/** Tolleranza di Douglas-Peucker sulle polilinee degli archi, in pixel. */
export const POLYLINE_TOLERANCE_PX = 0.75;

/**
 * Buchi con area < (HOLE_FILL_MAX_W · tratto)² vengono riempiti. In Sacramento i forellini da
 * contorni sovrapposti stanno sotto 0,1 mm² a 100 mm; i buchi veri (puntino della i, occhielli)
 * partono da ~2 mm². Con tratto 4,8 mm la soglia è ~0,64 mm².
 */
export const HOLE_FILL_MAX_W = 1 / 6;

const polylineLength = (pts: readonly Point[]): number => {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return l;
};

/** Larghezza del tratto: mediana di 2·d − 1 px sull'asse, con d = distanza dal vuoto. */
export function strokeWidthPx(data: Uint8Array, skeleton: Uint8Array, width: number, height: number): number {
  const widths = strokeWidths(data, skeleton, width, height);
  if (widths.length === 0) return 0;
  widths.sort((p, q) => p - q);
  return widths[Math.floor(widths.length / 2)]!;
}

/**
 * Coefficiente di variazione dello spessore sull'asse. Sopra 0,35 la traccia centrale
 * di un'area non è un tratto uniforme (SPEC §4bis).
 */
export function strokeWidthCv(data: Uint8Array, skeleton: Uint8Array, width: number, height: number): number {
  const widths = strokeWidths(data, skeleton, width, height);
  if (widths.length < 2) return 0;
  let sum = 0;
  let sum2 = 0;
  for (const w of widths) {
    sum += w;
    sum2 += w * w;
  }
  const mean = sum / widths.length;
  if (mean < 1e-6) return 0;
  const variance = Math.max(0, sum2 / widths.length - mean * mean);
  return Math.sqrt(variance) / mean;
}

function strokeWidths(data: Uint8Array, skeleton: Uint8Array, width: number, height: number): number[] {
  const d2 = squaredDistanceTo(data, width, height, 0);
  const widths: number[] = [];
  for (let i = 0; i < skeleton.length; i++) if (skeleton[i]) widths.push(2 * Math.sqrt(d2[i]!) - 1);
  return widths;
}

// ---------------------------------------------------------------- tracciamento

interface RawGraph {
  nodes: Point[];
  edges: { a: number; b: number; points: Point[] }[];
}

/** Douglas-Peucker: toglie i gradini della catena di pixel, che allungherebbero gli archi del 5–8%. */
function simplifyPolyline(pts: readonly Point[], tol: number): Point[] {
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

/** Scheletro → nodi e archi, in mm. Nodi: gruppi 8-connessi di pixel che non sono "di passaggio". */
function trace(skel: Uint8Array, width: number, height: number, t: PxToMm): RawGraph {
  const off = ringOffsets(width);
  // Prima i 4 vicini, poi le diagonali: il percorso passa per gli angoli dei gradini.
  const order = [0, 2, 4, 6, 1, 3, 5, 7].map((k) => off[k]!);
  const four = new Set([off[0]!, off[2]!, off[4]!, off[6]!]);
  const n = new Uint8Array(8);
  const isNodePx = new Uint8Array(skel.length);
  for (let i = 0; i < skel.length; i++) {
    if (!skel[i]) continue;
    ring(skel, i, off, n);
    // ≠ 2 vicini: estremo o giunzione. Il solo crossing number non basta: all'incrocio di due
    // diagonali resta un blocco 2×2 i cui pixel hanno crossing number 2.
    if (ringCount(n) !== 2 || crossings(n) !== 2) isNodePx[i] = 1;
  }

  const nodeOf = new Int32Array(skel.length).fill(-1);
  const clusters: number[][] = [];
  for (let s = 0; s < skel.length; s++) {
    if (!isNodePx[s] || nodeOf[s]! >= 0) continue;
    const id = clusters.length;
    const members: number[] = [];
    const stack = [s];
    nodeOf[s] = id;
    while (stack.length) {
      const i = stack.pop()!;
      members.push(i);
      for (const o of off) {
        const j = i + o;
        if (isNodePx[j] && nodeOf[j]! < 0) {
          nodeOf[j] = id;
          stack.push(j);
        }
      }
    }
    clusters.push(members.sort((p, q) => p - q));
  }

  const center = (i: number): Point => {
    const x = i % width;
    return pxToMm(t, x + 0.5, (i - x) / width + 0.5);
  };
  const nodes: Point[] = clusters.map((m) => {
    let sx = 0;
    let sy = 0;
    for (const i of m) {
      const [x, y] = center(i);
      sx += x;
      sy += y;
    }
    return [sx / m.length, sy / m.length];
  });

  const visited = new Uint8Array(skel.length);
  const edges: RawGraph['edges'] = [];

  const follow = (start: number, from: number, first: number): void => {
    const pts: Point[] = [nodes[start]!];
    let prev = from;
    let cur = first;
    let steps = 0;
    for (;;) {
      visited[cur] = 1;
      pts.push(center(cur));
      steps++;
      let nextNode = -1;
      let nextPath = -1;
      for (const o of order) {
        const j = cur + o;
        if (j === prev || !skel[j]) continue;
        if (nodeOf[j]! >= 0) {
          if (nodeOf[j] === start && steps < 3) continue;
          if (nextNode < 0 || (four.has(o) && !four.has(nextNode - cur))) nextNode = j;
        } else if (!visited[j] && nextPath < 0) {
          nextPath = j;
        }
      }
      if (nextNode >= 0) {
        pts.push(nodes[nodeOf[nextNode]!]!);
        edges.push({ a: start, b: nodeOf[nextNode]!, points: pts });
        return;
      }
      if (nextPath < 0) {
        // Vicolo cieco (non dovrebbe capitare dopo la pulizia): l'ultimo pixel diventa un estremo.
        const id = nodes.length;
        nodes.push(center(cur));
        edges.push({ a: start, b: id, points: pts });
        return;
      }
      prev = cur;
      cur = nextPath;
    }
  };

  for (let c = 0; c < clusters.length; c++) {
    for (const p of clusters[c]!) {
      for (const o of order) {
        const q = p + o;
        if (skel[q] && nodeOf[q]! < 0 && !visited[q]) follow(c, p, q);
      }
    }
  }
  // Anelli senza nodi (es. "o"): il primo pixel non visitato diventa un nodo di grado 2.
  for (let s = 0; s < skel.length; s++) {
    if (!skel[s] || nodeOf[s]! >= 0 || visited[s]) continue;
    const id = nodes.length;
    nodes.push(center(s));
    nodeOf[s] = id;
    clusters.push([s]);
    for (const o of order) {
      const q = s + o;
      if (skel[q] && nodeOf[q]! < 0 && !visited[q]) {
        follow(id, s, q);
        break;
      }
    }
  }
  return { nodes, edges };
}

// ---------------------------------------------------------------- semplificazione

interface MNode {
  p: Point;
  alive: boolean;
}
interface MEdge {
  a: number;
  b: number;
  points: Point[];
  alive: boolean;
}

function degreeOf(edges: readonly MEdge[], id: number): number {
  let d = 0;
  for (const e of edges) {
    if (!e.alive) continue;
    if (e.a === id) d++;
    if (e.b === id) d++;
  }
  return d;
}

/** Un incrocio a X stretto esce dal thinning come due Y unite da un arco lungo fino a ~5 tratti. */
export const CROSSING_MAX_LENGTH_W = 5;
/** Ogni ramo esterno deve formare con l'arco centrale almeno 180° − questo angolo. */
const CROSSING_ARM_MAX_DEG = 60;
/** Tolleranza sulla continuità rettilinea fra un ramo di un lato e quello opposto. */
const CROSSING_STRAIGHT_MAX_DEG = 35;
/** Giunzioni più vicine di questi tratti: criterio rilassato (solo continuità, con questa tolleranza). */
const CROSSING_NEAR_W = 2;
const CROSSING_NEAR_STRAIGHT_MAX_DEG = 60;

/** Punto a distanza `s` lungo la polilinea dall'inizio (l'ultimo punto se è più corta). */
function pointAt(pts: readonly Point[], s: number): Point {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!;
    const [x1, y1] = pts[i]!;
    const l = Math.hypot(x1 - x0, y1 - y0);
    if (acc + l >= s && l > 0) {
      const t = (s - acc) / l;
      return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
    }
    acc += l;
  }
  return pts[pts.length - 1]!;
}

/** Direzione (versore) di una polilinea che parte dal nodo, misurata sulla corda lunga `s`. */
function direction(pts: readonly Point[], s: number): Point {
  const [x0, y0] = pts[0]!;
  const [x1, y1] = pointAt(pts, s);
  const l = Math.hypot(x1 - x0, y1 - y0) || 1;
  return [(x1 - x0) / l, (y1 - y0) / l];
}

/** Rami di `id` diversi da `skip`, orientati in uscita dal nodo (un anello conta due volte). */
function armsOf(edges: readonly MEdge[], id: number, skip: MEdge): Point[][] {
  const arms: Point[][] = [];
  for (const f of edges) {
    if (!f.alive || f === skip) continue;
    if (f.a === id) arms.push(f.points);
    if (f.b === id) arms.push([...f.points].reverse());
  }
  return arms;
}

/**
 * L'arco `e` fra due giunzioni di grado 3 è il tratto centrale di un incrocio? Per una X stretta,
 * a entrambi i capi i due rami esterni tornano indietro rispetto all'arco, e ognuno prosegue quasi
 * in linea retta in un ramo dell'altro capo. Due T a più di 2 tratti (come nella "H") non passano:
 * lì i rami esterni sono perpendicolari all'arco.
 */
function isCrossing(edges: readonly MEdge[], e: MEdge, w: number): boolean {
  const len = polylineLength(e.points);
  if (len >= CROSSING_MAX_LENGTH_W * w) return false;
  const armsA = armsOf(edges, e.a, e);
  const armsB = armsOf(edges, e.b, e);
  if (armsA.length !== 2 || armsB.length !== 2) return false;
  const s = Math.max(2 * w, len);
  const [mx, my] = direction(e.points, len);
  const dA = armsA.map((p) => direction(p, s));
  const dB = armsB.map((p) => direction(p, s));
  const paired = (maxDeg: number): boolean => {
    const straight = -Math.cos((maxDeg * Math.PI) / 180);
    const opposite = (u: Point, v: Point): boolean => u[0] * v[0] + u[1] * v[1] < straight;
    return (
      (opposite(dA[0]!, dB[0]!) && opposite(dA[1]!, dB[1]!)) || (opposite(dA[0]!, dB[1]!) && opposite(dA[1]!, dB[0]!))
    );
  };
  // Entro 2 tratti le due giunzioni stanno nella stessa macchia: basta che i quattro rami formino
  // due percorsi passanti plausibili (es. la "e" di Sacramento, dove il tratto d'attacco arriva sul
  // fianco dell'asola e la diagonale riparte poco sotto).
  if (len < CROSSING_NEAR_W * w && paired(CROSSING_NEAR_STRAIGHT_MAX_DEG)) return true;
  // Più lontane: X stretta vera, i rami di A puntano all'indietro (−m), quelli di B in avanti (+m).
  const back = Math.cos(((180 - CROSSING_ARM_MAX_DEG) * Math.PI) / 180);
  if (dA.some(([x, y]) => x * mx + y * my > back) || dB.some(([x, y]) => -(x * mx + y * my) > back)) return false;
  return paired(CROSSING_STRAIGHT_MAX_DEG);
}

/**
 * Potatura dei rami spuri (estremo–giunzione più corti di `minLen`), dei piccoli anelli spuri,
 * scioglimento dei nodi di grado 2, fusione delle giunzioni unite da un arco più corto di `minLen`.
 * Ripete finché il grafo cambia.
 */
function simplify(raw: RawGraph, minLen: number): { nodes: MNode[]; edges: MEdge[]; pruned: number; merged: number } {
  const nodes: MNode[] = raw.nodes.map((p) => ({ p, alive: true }));
  const edges: MEdge[] = raw.edges.map((e) => ({ ...e, alive: true }));
  let pruned = 0;
  let merged = 0;
  const deg = (id: number): number => degreeOf(edges, id);

  for (let changed = true; changed; ) {
    changed = false;

    // Rami spuri: un estremo libero attaccato a una giunzione, più corto della larghezza del tratto.
    for (const e of edges) {
      if (!e.alive || e.a === e.b) continue;
      const da = deg(e.a);
      const db = deg(e.b);
      const spurEnd = da === 1 && db >= 3 ? e.a : db === 1 && da >= 3 ? e.b : -1;
      if (spurEnd < 0 || polylineLength(e.points) >= minLen) continue;
      e.alive = false;
      nodes[spurEnd]!.alive = false;
      pruned++;
      changed = true;
    }
    // Anelli spuri: un piccolo occhiello chiuso su una giunzione.
    for (const e of edges) {
      if (!e.alive || e.a !== e.b || deg(e.a) <= 2) continue;
      if (polylineLength(e.points) >= Math.PI * minLen) continue;
      e.alive = false;
      pruned++;
      changed = true;
    }
    // Bolle spurie: due archi corti fra gli stessi nodi (un forellino nel tratto): resta il più corto.
    for (const e of edges) {
      if (!e.alive || e.a === e.b) continue;
      for (const f of edges) {
        if (f === e || !f.alive || !((f.a === e.a && f.b === e.b) || (f.a === e.b && f.b === e.a))) continue;
        const le = polylineLength(e.points);
        const lf = polylineLength(f.points);
        if (le + lf >= Math.PI * minLen) continue;
        (lf >= le ? f : e).alive = false;
        pruned++;
        changed = true;
        if (!e.alive) break;
      }
    }
    // Giunzioni vicine: contrazione dell'arco corto, il nodo va a metà dell'arco.
    for (const e of edges) {
      if (!e.alive || e.a === e.b || deg(e.a) < 3 || deg(e.b) < 3) continue;
      if (polylineLength(e.points) >= minLen && !isCrossing(edges, e, minLen)) continue;
      const keep = e.a;
      const drop = e.b;
      const mid = pointAtHalf(e.points);
      e.alive = false;
      nodes[keep]!.p = mid;
      nodes[drop]!.alive = false;
      for (const f of edges) {
        if (!f.alive) continue;
        if (f.a === keep || f.a === drop) {
          f.a = keep;
          f.points = [mid, ...f.points.slice(1)];
        }
        if (f.b === keep || f.b === drop) {
          f.b = keep;
          f.points = [...f.points.slice(0, -1), mid];
        }
      }
      merged++;
      changed = true;
    }
    // Nodi di grado 2 fra due archi diversi: si uniscono gli archi.
    for (let id = 0; id < nodes.length; id++) {
      if (!nodes[id]!.alive) continue;
      const inc = edges.filter((e) => e.alive && (e.a === id || e.b === id));
      if (inc.length !== 2 || inc[0]!.a === inc[0]!.b || inc[1]!.a === inc[1]!.b) continue;
      const [e1, e2] = inc as [MEdge, MEdge];
      const p1 = e1.b === id ? e1.points : [...e1.points].reverse();
      const p2 = e2.a === id ? e2.points : [...e2.points].reverse();
      const a = e1.b === id ? e1.a : e1.b;
      const b = e2.a === id ? e2.b : e2.a;
      e1.a = a;
      e1.b = b;
      e1.points = [...p1, ...p2.slice(1)];
      e2.alive = false;
      nodes[id]!.alive = false;
      changed = true;
    }
  }
  return { nodes, edges, pruned, merged };
}

function pointAtHalf(pts: readonly Point[]): Point {
  const half = polylineLength(pts) / 2;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!;
    const [x1, y1] = pts[i]!;
    const l = Math.hypot(x1 - x0, y1 - y0);
    if (acc + l >= half && l > 0) {
      const t = (half - acc) / l;
      return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
    }
    acc += l;
  }
  return pts[pts.length - 1]!;
}

/**
 * Riempie i buchi (vuoto non collegato al bordo) con area < `maxAreaPx`: forellini dove i contorni
 * del font si sovrappongono, che il thinning trasformerebbe in piccoli anelli.
 */
export function fillSmallHoles(
  data: Uint8Array,
  width: number,
  height: number,
  maxAreaPx: number,
): { data: Uint8Array; filled: number } {
  const seen = new Uint8Array(data.length);
  const stack = new Int32Array(data.length);
  let top = 0;
  const consider = (i: number): void => {
    if (data[i] || seen[i]) return;
    seen[i] = 1;
    stack[top++] = i;
  };
  for (let x = 0; x < width; x++) {
    consider(x);
    consider((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    consider(y * width);
    consider(y * width + width - 1);
  }
  while (top > 0) {
    const i = stack[--top]!;
    const x = i % width;
    const y = (i - x) / width;
    if (x > 0) consider(i - 1);
    if (x + 1 < width) consider(i + 1);
    if (y > 0) consider(i - width);
    if (y + 1 < height) consider(i + width);
  }

  const out = data.slice();
  let filled = 0;
  const members: number[] = [];
  for (let s = 0; s < data.length; s++) {
    if (data[s] || seen[s]) continue;
    top = 0;
    stack[top++] = s;
    seen[s] = 1;
    members.length = 0;
    while (top > 0) {
      const i = stack[--top]!;
      members.push(i);
      const x = i % width;
      const y = (i - x) / width;
      if (x > 0) consider(i - 1);
      if (x + 1 < width) consider(i + 1);
      if (y > 0) consider(i - width);
      if (y + 1 < height) consider(i + width);
    }
    if (members.length < maxAreaPx) {
      for (const i of members) out[i] = 1;
      filled++;
    }
  }
  return { data: out, filled };
}

/** Larghezza del tratto dalla cresta della distance transform, senza scheletro: serve a sapere quali buchi riempire prima dell'unico thinning. */
function medialWidthPx(data: Uint8Array, width: number, height: number): number {
  const d2 = squaredDistanceTo(data, width, height, 0);
  const w: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      if (!data[i]) continue;
      const d = d2[i]!;
      if (d < 0.2) continue;
      if (d + 1e-6 < d2[i - 1]! || d + 1e-6 < d2[i + 1]! || d + 1e-6 < d2[i - width]! || d + 1e-6 < d2[i + width]!) continue;
      w.push(2 * Math.sqrt(d) - 1);
    }
  }
  if (w.length === 0) return 0;
  w.sort((a, b) => a - b);
  return w[w.length >> 1]!;
}

/** [B] + [C]: bitmap di [A] → scheletro → grafo semplificato. */
export function buildGraph(r: GraphInput): SkeletonGraph {
  const widthPx = medialWidthPx(r.data, r.width, r.height);
  const holes = fillSmallHoles(r.data, r.width, r.height, (widthPx * HOLE_FILL_MAX_W) ** 2);
  const skeleton = skeletonize(holes.filled > 0 ? holes.data : r.data, r.width, r.height);
  const w = strokeWidthPx(r.data, skeleton, r.width, r.height);
  const strokeWidthMm = w / r.pxPerMm;
  const raw = trace(skeleton, r.width, r.height, r.pxToMm);
  const s = simplify(raw, strokeWidthMm);

  const ids = new Map<number, number>();
  const nodes: GraphNode[] = [];
  s.nodes.forEach((nd, i) => {
    if (!nd.alive) return;
    ids.set(i, nodes.length);
    nodes.push({ id: nodes.length, x: nd.p[0], y: nd.p[1], degree: 0 });
  });
  const edges: GraphEdge[] = [];
  for (const e of s.edges) {
    if (!e.alive) continue;
    const a = ids.get(e.a)!;
    const b = ids.get(e.b)!;
    nodes[a]!.degree++;
    nodes[b]!.degree++;
    const points = simplifyPolyline(e.points, POLYLINE_TOLERANCE_PX / r.pxPerMm);
    edges.push({ id: edges.length, a, b, points, lengthMm: polylineLength(points) });
  }
  return {
    nodes,
    edges,
    strokeWidthMm,
    skeleton,
    filledHoles: holes.filled,
    prunedSpurs: s.pruned,
    mergedJunctions: s.merged,
  };
}
