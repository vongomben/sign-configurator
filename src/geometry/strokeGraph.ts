// Polilinee di un font a tratto singolo → grafo [C], senza bitmap né scheletro.
// Gli estremi che si toccano (lettere legate) si fondono entro STROKE_JOIN_MM.
// Un incrocio vero spezza i due tratti in un nodo, così la segmentazione lo vede.
import type { GraphEdge, GraphNode, SkeletonGraph } from './graph';
import type { Point } from './rasterize';

/** Distanza sotto la quale due estremi di un tratto singolo sono lo stesso nodo. */
export const STROKE_JOIN_MM = 0.3;

interface Stroke {
  pts: Point[];
  closed: boolean;
}

const dist = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

const lengthOf = (pts: readonly Point[]): number => {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1]!, pts[i]!);
  return total;
};

const keyOf = (p: Point): string => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;

/** Grafo già pronto per [D]. Nessun ramo spurio da potare: le linee sono quelle del font. */
export function graphFromStrokes(paths: readonly { points: readonly Point[]; closed?: boolean }[]): SkeletonGraph {
  const strokes = prepare(paths);
  weldEndpoints(strokes, STROKE_JOIN_MM);
  snapEndpointsToStrokes(strokes, STROKE_JOIN_MM);
  splitCrossings(strokes);
  return toGraph(strokes);
}

function prepare(paths: readonly { points: readonly Point[]; closed?: boolean }[]): Stroke[] {
  const strokes: Stroke[] = [];
  for (const path of paths) {
    const pts: Point[] = [];
    for (const p of path.points) {
      const last = pts[pts.length - 1];
      if (!last || dist(last, p) > 1e-6) pts.push([p[0], p[1]]);
    }
    if (pts.length < 2 || lengthOf(pts) < 1e-4) continue;
    const closed = path.closed === true || dist(pts[0]!, pts[pts.length - 1]!) <= STROKE_JOIN_MM;
    if (closed && dist(pts[0]!, pts[pts.length - 1]!) > 1e-6) pts.push([pts[0]![0], pts[0]![1]]);
    if (closed && dist(pts[0]!, pts[pts.length - 1]!) <= 1e-6) {
      pts[pts.length - 1] = [pts[0]![0], pts[0]![1]];
    }
    strokes.push({ pts, closed });
  }
  return strokes;
}

function weldEndpoints(strokes: Stroke[], tol: number): void {
  const ports: { s: number; at: 0 | 1 }[] = [];
  for (let s = 0; s < strokes.length; s++) {
    const stroke = strokes[s]!;
    if (stroke.closed) continue;
    ports.push({ s, at: 0 }, { s, at: 1 });
  }
  const parent = ports.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const at = (port: { s: number; at: 0 | 1 }): Point => {
    const pts = strokes[port.s]!.pts;
    return port.at === 0 ? pts[0]! : pts[pts.length - 1]!;
  };
  for (let i = 0; i < ports.length; i++) {
    for (let j = i + 1; j < ports.length; j++) {
      if (dist(at(ports[i]!), at(ports[j]!)) <= tol) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < ports.length; i++) {
    const root = find(i);
    const list = groups.get(root);
    if (list) list.push(i);
    else groups.set(root, [i]);
  }
  for (const members of groups.values()) {
    let x = 0;
    let y = 0;
    for (const i of members) {
      const p = at(ports[i]!);
      x += p[0];
      y += p[1];
    }
    const point: Point = [x / members.length, y / members.length];
    for (const i of members) {
      const port = ports[i]!;
      const pts = strokes[port.s]!.pts;
      if (port.at === 0) pts[0] = [point[0], point[1]];
      else pts[pts.length - 1] = [point[0], point[1]];
    }
  }
}

/** Un estremo che cade sul filo di un altro tratto lo spezza e ci si attacca. */
function snapEndpointsToStrokes(strokes: Stroke[], tol: number): void {
  const hits: { s: number; seg: number; t: number; p: Point }[] = [];
  for (let s = 0; s < strokes.length; s++) {
    const stroke = strokes[s]!;
    if (stroke.closed) continue;
    for (const end of [0, stroke.pts.length - 1]) {
      const p = stroke.pts[end]!;
      let best: { s: number; seg: number; t: number; p: Point; d: number } | null = null;
      for (let o = 0; o < strokes.length; o++) {
        if (o === s) continue;
        const other = strokes[o]!.pts;
        const limit = strokes[o]!.closed ? other.length - 1 : other.length - 1;
        for (let seg = 0; seg < limit; seg++) {
          const foot = closestOnSegment(p, other[seg]!, other[seg + 1]!);
          if (foot.d > tol || foot.t <= 1e-4 || foot.t >= 1 - 1e-4) continue;
          if (dist(foot.p, other[seg]!) <= tol || dist(foot.p, other[seg + 1]!) <= tol) continue;
          if (!best || foot.d < best.d) best = { s: o, seg, t: foot.t, p: foot.p, d: foot.d };
        }
      }
      if (!best) continue;
      stroke.pts[end] = [best.p[0], best.p[1]];
      hits.push({ s: best.s, seg: best.seg, t: best.t, p: [best.p[0], best.p[1]] });
    }
  }
  insertPoints(strokes, hits);
}

function splitCrossings(strokes: Stroke[]): void {
  const hits: { s: number; seg: number; t: number; p: Point }[] = [];
  for (let a = 0; a < strokes.length; a++) {
    const pa = strokes[a]!.pts;
    const na = strokes[a]!.closed ? pa.length - 1 : pa.length - 1;
    for (let b = a; b < strokes.length; b++) {
      const pb = strokes[b]!.pts;
      const nb = strokes[b]!.closed ? pb.length - 1 : pb.length - 1;
      for (let i = 0; i < na; i++) {
        const j0 = a === b ? i + 2 : 0;
        for (let j = j0; j < nb; j++) {
          if (a === b && strokes[a]!.closed && i === 0 && j === nb - 1) continue;
          const hit = segmentHit(pa[i]!, pa[i + 1]!, pb[j]!, pb[j + 1]!);
          if (!hit) continue;
          if (dist(hit.p, pa[i]!) <= STROKE_JOIN_MM || dist(hit.p, pa[i + 1]!) <= STROKE_JOIN_MM) continue;
          if (dist(hit.p, pb[j]!) <= STROKE_JOIN_MM || dist(hit.p, pb[j + 1]!) <= STROKE_JOIN_MM) continue;
          hits.push({ s: a, seg: i, t: hit.t, p: hit.p }, { s: b, seg: j, t: hit.u, p: [hit.p[0], hit.p[1]] });
        }
      }
    }
  }
  insertPoints(strokes, hits);
}

function insertPoints(strokes: Stroke[], hits: { s: number; seg: number; t: number; p: Point }[]): void {
  const byStroke = new Map<number, { seg: number; t: number; p: Point }[]>();
  for (const hit of hits) {
    const list = byStroke.get(hit.s);
    if (list) list.push(hit);
    else byStroke.set(hit.s, [hit]);
  }
  for (const [s, list] of byStroke) {
    list.sort((a, b) => b.seg - a.seg || b.t - a.t);
    const pts = strokes[s]!.pts;
    let lastSeg = -1;
    let lastT = -1;
    for (const hit of list) {
      if (hit.seg === lastSeg && Math.abs(hit.t - lastT) < 1e-4) continue;
      lastSeg = hit.seg;
      lastT = hit.t;
      pts.splice(hit.seg + 1, 0, [hit.p[0], hit.p[1]]);
    }
  }
}

function closestOnSegment(p: Point, a: Point, b: Point): { p: Point; t: number; d: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 < 1e-12 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const q: Point = [a[0] + t * dx, a[1] + t * dy];
  return { p: q, t, d: dist(p, q) };
}

function segmentHit(a: Point, b: Point, c: Point, d: Point): { p: Point; t: number; u: number } | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qpx = c[0] - a[0];
  const qpy = c[1] - a[1];
  const t = (qpx * sy - qpy * sx) / den;
  const u = (qpx * ry - qpy * rx) / den;
  if (t <= 1e-5 || t >= 1 - 1e-5 || u <= 1e-5 || u >= 1 - 1e-5) return null;
  return { p: [a[0] + t * rx, a[1] + t * ry], t, u };
}

function toGraph(strokes: Stroke[]): SkeletonGraph {
  const nodes: GraphNode[] = [];
  const byKey = new Map<string, number>();
  const nodeAt = (p: Point): number => {
    const key = keyOf(p);
    const found = byKey.get(key);
    if (found !== undefined) return found;
    const id = nodes.length;
    nodes.push({ id, x: p[0], y: p[1], degree: 0 });
    byKey.set(key, id);
    return id;
  };
  const cuts = new Set<string>();
  const seen = new Map<string, number>();
  for (const stroke of strokes) {
    cuts.add(keyOf(stroke.pts[0]!));
    cuts.add(keyOf(stroke.pts[stroke.pts.length - 1]!));
    for (const p of stroke.pts) {
      const key = keyOf(p);
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of seen) if (count >= 2) cuts.add(key);

  const edges: GraphEdge[] = [];
  for (const stroke of strokes) {
    const pts = stroke.pts;
    let start = 0;
    for (let i = 1; i < pts.length; i++) {
      if (i < pts.length - 1 && !cuts.has(keyOf(pts[i]!))) continue;
      const chunk = pts.slice(start, i + 1).map((q): Point => [q[0], q[1]]);
      if (chunk.length >= 2 && lengthOf(chunk) > 1e-4) {
        edges.push({
          id: edges.length,
          a: nodeAt(chunk[0]!),
          b: nodeAt(chunk[chunk.length - 1]!),
          points: chunk,
          lengthMm: lengthOf(chunk),
        });
      }
      start = i;
    }
  }
  for (const edge of edges) {
    nodes[edge.a]!.degree++;
    nodes[edge.b]!.degree++;
  }
  const used = new Set(edges.flatMap((edge) => [edge.a, edge.b]));
  const kept = nodes.filter((node) => used.has(node.id));
  const remap = new Map(kept.map((node, index) => [node.id, index]));
  const outNodes = kept.map((node, index) => ({ ...node, id: index }));
  const outEdges = edges.map((edge, index) => ({
    ...edge,
    id: index,
    a: remap.get(edge.a)!,
    b: remap.get(edge.b)!,
  }));
  return {
    nodes: outNodes,
    edges: outEdges,
    strokeWidthMm: 0,
    skeleton: new Uint8Array(0),
    filledHoles: 0,
    prunedSpurs: 0,
    mergedJunctions: 0,
  };
}
