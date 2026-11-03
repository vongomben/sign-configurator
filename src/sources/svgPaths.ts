// Geometria SVG pura (SPEC §4bis): path, trasformazioni, millimetri, raster e grafo.
// Nessun DOM. Lo stesso ordine normalizzato produce gli stessi file in browser, worker e Node.
import type { SvgFillElement, SvgImageSource, SvgStrokeElement } from '../order/schema';
import { buildGraph, strokeWidthCv, type SkeletonGraph } from '../geometry/graph';
import type { GlyphInfo, Point, Raster, TextRaster } from '../geometry/rasterize';
import {
  contoursBBox,
  DEFAULT_PX_PER_MM,
  FLATTEN_TOLERANCE_MM,
  RASTER_MARGIN_PX,
  rasterizeContourGroups,
  type BBoxMm,
  type Contour,
} from '../geometry/rasterize';
import { graphFromStrokes } from '../geometry/strokeGraph';
import { outlinePolylines } from './contours';

/** a b c d e f: x' = a x + c y + e, y' = b x + d y + f. */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export interface RawShape {
  /** Path in spazio utente locale, prima della matrice. */
  d: string;
  transform: Matrix;
  kind: 'stroke' | 'fill';
  fillRule: 'nonzero' | 'evenodd';
}

export interface SvgLayout {
  raster: TextRaster;
  graph: SkeletonGraph;
}

export const UNEVEN_STROKE_WARNING = 'tratto non uniforme: prova Contorno';

const KAPPA = 0.5522847498307936;

type Cmd =
  | { t: 'M'; x: number; y: number }
  | { t: 'L'; x: number; y: number }
  | { t: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { t: 'Q'; x1: number; y1: number; x: number; y: number }
  | { t: 'Z' };

interface Poly {
  points: Point[];
  closed: boolean;
}

const dist = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function apply(m: Matrix, x: number, y: number): Point {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function translate(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y];
}

function scale(x: number, y: number): Matrix {
  return [x, 0, 0, y, 0, 0];
}

function rotate(deg: number): Matrix {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}

/** `null`, stringa vuota o solo spazi → identità. */
export function parseTransform(value: string | null | undefined): Matrix {
  if (!value || !value.trim()) return IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi;
  let acc: Matrix = IDENTITY;
  let matched = 0;
  for (const hit of value.matchAll(re)) {
    matched++;
    const kind = hit[1]!.toLowerCase();
    const nums = scanNumbers(hit[2] ?? '');
    let next: Matrix;
    if (kind === 'matrix' && nums.length >= 6) {
      next = [nums[0]!, nums[1]!, nums[2]!, nums[3]!, nums[4]!, nums[5]!];
    } else if (kind === 'translate' && nums.length >= 1) {
      next = translate(nums[0]!, nums[1] ?? 0);
    } else if (kind === 'scale' && nums.length >= 1) {
      next = scale(nums[0]!, nums[1] ?? nums[0]!);
    } else if (kind === 'rotate' && nums.length >= 1) {
      const spin = rotate(nums[0]!);
      if (nums.length >= 3) {
        next = multiply(multiply(translate(nums[1]!, nums[2]!), spin), translate(-nums[1]!, -nums[2]!));
      } else next = spin;
    } else if (kind === 'skewx' && nums.length >= 1) {
      next = [1, 0, Math.tan((nums[0]! * Math.PI) / 180), 1, 0, 0];
    } else if (kind === 'skewy' && nums.length >= 1) {
      next = [1, Math.tan((nums[0]! * Math.PI) / 180), 0, 1, 0, 0];
    } else {
      throw new Error('Trasformazione SVG non valida.');
    }
    acc = multiply(acc, next);
  }
  if (matched === 0) throw new Error('Trasformazione SVG non valida.');
  return acc;
}

const UNIT: Record<string, number> = {
  px: 1,
  pt: 96 / 72,
  pc: (96 / 72) * 12,
  mm: 96 / 25.4,
  cm: 96 / 2.54,
  in: 96,
  q: 96 / 25.4 / 4,
};

/** Lunghezza SVG → unità utente. Percentuali e valori assenti restituiscono `fallback`. */
export function parseLength(raw: string | null | undefined, fallback = 0): number {
  if (raw == null) return fallback;
  const s = raw.trim();
  if (!s || s.endsWith('%')) return fallback;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px|pt|pc|mm|cm|in|q)?$/i.exec(s);
  if (!m) return fallback;
  const unit = (m[2] ?? '').toLowerCase();
  return Number(m[1]) * (unit ? (UNIT[unit] ?? 1) : 1);
}

/**
 * viewBox + viewport, senza la posizione x/y dell'elemento. Senza larghezza e altezza assolute
 * il disegno resta nelle unità del viewBox: l'altezza in mm la decide il riquadro d'ingombro.
 */
export function viewBoxMatrix(
  viewBox: string | null,
  width: string | null,
  height: string | null,
  preserve: string | null,
): Matrix {
  const vb = parseViewBox(viewBox);
  if (!vb) return IDENTITY;
  const w = absoluteLength(width);
  const h = absoluteLength(height);
  if (w == null || h == null) return translate(-vb.minX, -vb.minY);
  const par = parseAspect(preserve);
  let sx = w / vb.w;
  let sy = h / vb.h;
  if (par.fit !== 'none') {
    const s = par.fit === 'slice' ? Math.max(sx, sy) : Math.min(sx, sy);
    sx = sy = s;
  }
  const tx = par.ax * (w - vb.w * sx) - vb.minX * sx;
  const ty = par.ay * (h - vb.h * sy) - vb.minY * sy;
  return [sx, 0, 0, sy, tx, ty];
}

function absoluteLength(raw: string | null): number | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!s || s.endsWith('%')) return null;
  const n = parseLength(s, Number.NaN);
  return n > 0 ? n : null;
}

function parseViewBox(raw: string | null): { minX: number; minY: number; w: number; h: number } | null {
  if (!raw) return null;
  const n = scanNumbers(raw);
  if (n.length < 4 || !(n[2]! > 0) || !(n[3]! > 0)) return null;
  return { minX: n[0]!, minY: n[1]!, w: n[2]!, h: n[3]! };
}

function parseAspect(raw: string | null): { ax: number; ay: number; fit: 'meet' | 'slice' | 'none' } {
  const parts = (raw ?? '')
    .trim()
    .split(/[\s,]+/)
    .filter((part) => part && part !== 'defer');
  if (parts[0] === 'none') return { ax: 0, ay: 0, fit: 'none' };
  const align = parts[0] ?? 'xMidYMid';
  const fit = parts.includes('slice') ? 'slice' : 'meet';
  const ax = align.includes('xMin') ? 0 : align.includes('xMax') ? 1 : 0.5;
  const ay = align.includes('YMin') ? 0 : align.includes('YMax') ? 1 : 0.5;
  return { ax, ay, fit };
}

/** Forma di base → `d` nello spazio locale dell'elemento. `null` se è degenere. */
export function geometryToD(tag: string, get: (name: string) => string | null): string | null {
  const n = (name: string, fallback = 0): number => parseLength(get(name), fallback);
  if (tag === 'path') {
    const d = get('d');
    return d && d.trim() ? d : null;
  }
  if (tag === 'line') return `M${num(n('x1'))} ${num(n('y1'))} L${num(n('x2'))} ${num(n('y2'))}`;
  if (tag === 'polyline' || tag === 'polygon') {
    const pts = parsePointList(get('points') ?? '');
    if (pts.length < 2) return null;
    const body = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${num(p[0])} ${num(p[1])}`).join(' ');
    return tag === 'polygon' ? `${body} Z` : body;
  }
  if (tag === 'rect') {
    const w = n('width');
    const h = n('height');
    if (!(w > 0) || !(h > 0)) return null;
    const x = n('x');
    const y = n('y');
    let rx = n('rx');
    let ry = n('ry');
    if (rx > 0 && ry <= 0) ry = rx;
    if (ry > 0 && rx <= 0) rx = ry;
    rx = Math.min(rx, w / 2);
    ry = Math.min(ry, h / 2);
    if (rx <= 0 || ry <= 0) return `M${num(x)} ${num(y)} L${num(x + w)} ${num(y)} L${num(x + w)} ${num(y + h)} L${num(x)} ${num(y + h)} Z`;
    return roundedRect(x, y, w, h, rx, ry);
  }
  if (tag === 'circle' || tag === 'ellipse') {
    const rx = tag === 'circle' ? n('r') : n('rx');
    const ry = tag === 'circle' ? n('r') : n('ry');
    if (!(rx > 0) || !(ry > 0)) return null;
    return ellipseToD(n('cx'), n('cy'), rx, ry);
  }
  return null;
}

export function ellipseToD(cx: number, cy: number, rx: number, ry: number): string {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  const p = (x: number, y: number): string => `${num(x)} ${num(y)}`;
  return [
    `M${p(cx + rx, cy)}`,
    `C${p(cx + rx, cy + ky)} ${p(cx + kx, cy + ry)} ${p(cx, cy + ry)}`,
    `C${p(cx - kx, cy + ry)} ${p(cx - rx, cy + ky)} ${p(cx - rx, cy)}`,
    `C${p(cx - rx, cy - ky)} ${p(cx - kx, cy - ry)} ${p(cx, cy - ry)}`,
    `C${p(cx + kx, cy - ry)} ${p(cx + rx, cy - ky)} ${p(cx + rx, cy)}`,
    'Z',
  ].join(' ');
}

function roundedRect(x: number, y: number, w: number, h: number, rx: number, ry: number): string {
  const p = (px: number, py: number): string => `${num(px)} ${num(py)}`;
  return [
    `M${p(x + rx, y)}`,
    `L${p(x + w - rx, y)}`,
    `A${num(rx)} ${num(ry)} 0 0 1 ${p(x + w, y + ry)}`,
    `L${p(x + w, y + h - ry)}`,
    `A${num(rx)} ${num(ry)} 0 0 1 ${p(x + w - rx, y + h)}`,
    `L${p(x + rx, y + h)}`,
    `A${num(rx)} ${num(ry)} 0 0 1 ${p(x, y + h - ry)}`,
    `L${p(x, y + ry)}`,
    `A${num(rx)} ${num(ry)} 0 0 1 ${p(x + rx, y)}`,
    'Z',
  ].join(' ');
}

function parsePointList(raw: string): [number, number][] {
  const nums = scanNumbers(raw);
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i]!, nums[i + 1]!]);
  return pts;
}

/**
 * Forme già trasformate → `d` assoluti in mm, solo `M L C Q Z`, Y verso l'alto,
 * origine nell'angolo in basso a sinistra del riquadro, altezza `heightMm`.
 */
export function normalizeShapes(shapes: readonly RawShape[], heightMm: number): (SvgStrokeElement | SvgFillElement)[] {
  if (!(heightMm > 0)) throw new Error("Altezza dell'immagine non valida.");
  const prepared: { cmds: Cmd[]; kind: RawShape['kind']; fillRule: RawShape['fillRule'] }[] = [];
  for (const shape of shapes) {
    const cmds = transformCmds(absoluteCommands(shape.d), shape.transform);
    if (cmds.some((cmd) => cmd.t === 'L' || cmd.t === 'C' || cmd.t === 'Q')) prepared.push({ cmds, kind: shape.kind, fillRule: shape.fillRule });
  }
  if (prepared.length === 0) throw new Error('Il disegno SVG è vuoto.');
  const box = cmdsBBox(prepared.flatMap((shape) => shape.cmds));
  if (!box) throw new Error('Il disegno SVG è vuoto.');
  const span = box.maxY - box.minY > 1e-9 ? box.maxY - box.minY : box.maxX - box.minX;
  if (!(span > 1e-9)) throw new Error('Il disegno SVG è vuoto.');
  const scale = heightMm / span;
  const out: (SvgStrokeElement | SvgFillElement)[] = [];
  for (const shape of prepared) {
    const d = formatCmds(mapCmds(shape.cmds, box, scale));
    if (!d) continue;
    if (shape.kind === 'stroke') out.push({ d, kind: 'stroke' });
    else out.push({ d, kind: 'fill', fillRule: shape.fillRule });
  }
  if (out.length === 0) throw new Error('Il disegno SVG è vuoto.');
  return out;
}

/** Dall'ordine normalizzato a bitmap [A] e grafo [C]. `outline` segue il bordo delle aree. */
export function layoutSvg(source: SvgImageSource, heightMm: number, pxPerMm?: number): SvgLayout {
  const fills = source.svg.elements.filter((element): element is SvgFillElement => element.kind === 'fill');
  const strokes = source.svg.elements.filter((element) => element.kind === 'stroke');

  const strokeLines: Poly[] = [];
  for (const element of strokes) {
    for (const line of polylinesOf(absoluteCommands(element.d), FLATTEN_TOLERANCE_MM)) {
      if (line.points.length >= 2) strokeLines.push(line);
    }
  }
  const layers: { contours: Contour[]; fillRule: 'nonzero' | 'evenodd' }[] = [];
  for (const element of fills) {
    const contours: Contour[] = [];
    for (const line of polylinesOf(absoluteCommands(element.d), FLATTEN_TOLERANCE_MM)) {
      if (line.points.length < 3) continue;
      contours.push(line.points);
    }
    if (contours.length > 0) layers.push({ contours, fillRule: element.fillRule });
  }
  if (strokeLines.length === 0 && layers.length === 0) throw new Error('Il disegno SVG non produce percorsi.');

  const px = pxPerMm ?? DEFAULT_PX_PER_MM;
  const strokePoints = strokeLines.flatMap((line) => line.points);
  const bounds = unionBounds(layers.flatMap((layer) => layer.contours), strokePoints);
  const outline = source.trace === 'outline' && layers.length > 0;
  let rasterBase: Raster;
  let fillGraph: SkeletonGraph | null = null;
  let outlineLines: Poly[] = [];
  if (layers.length > 0) {
    rasterBase = rasterizeContourGroups(layers, bounds ? { pxPerMm: px, bounds } : { pxPerMm: px });
    if (outline) outlineLines = outlinePolylines(rasterBase).map((points) => ({ points, closed: true }));
    else fillGraph = buildGraph(rasterBase);
  } else {
    rasterBase = emptyRaster(bounds, px);
  }

  let graph: SkeletonGraph;
  if (outline) graph = graphFromStrokes([...outlineLines, ...strokeLines]);
  else if (fillGraph && strokeLines.length === 0) graph = fillGraph;
  else if (!fillGraph) graph = graphFromStrokes(strokeLines);
  else {
    const joined = graphFromStrokes([
      ...fillGraph.edges.map((edge) => ({ points: edge.points, closed: edge.a === edge.b })),
      ...strokeLines,
    ]);
    joined.strokeWidthMm = fillGraph.strokeWidthMm;
    joined.skeleton = fillGraph.skeleton;
    joined.filledHoles = fillGraph.filledHoles;
    joined.prunedSpurs = fillGraph.prunedSpurs;
    joined.mergedJunctions = fillGraph.mergedJunctions;
    graph = joined;
  }
  if (graph.edges.length === 0) {
    throw new Error(
      outline
        ? 'Il disegno non produce percorsi.'
        : 'La linea centrale non resta: il tratto non è uniforme e la traccia Contorno non è ancora disponibile.',
    );
  }

  const glyphs = regionsOf(graph);
  const drawn = outline ? [...outlineLines, ...strokeLines] : strokeLines;
  const raster = asImageRaster(rasterBase, source, heightMm, glyphs, drawn, bounds, outline ? 'walls' : 'centerline');
  if (!outline && fillGraph && strokeWidthCv(rasterBase.data, fillGraph.skeleton, rasterBase.width, rasterBase.height) > 0.35) {
    raster.warnings.push(UNEVEN_STROKE_WARNING);
  }
  return { raster, graph };
}

function asImageRaster(
  base: Raster,
  source: SvgImageSource,
  heightMm: number,
  glyphs: GlyphInfo[],
  strokes: readonly Poly[],
  bbox: BBoxMm | null,
  stripMode: TextRaster['stripMode'] = 'centerline',
): TextRaster {
  return {
    ...base,
    warnings: [...base.warnings],
    text: source.name,
    fontSizeMm: heightMm,
    capHeightMm: heightMm,
    xHeightMm: 0,
    bbox,
    advanceMm: bbox ? bbox.maxX - bbox.minX : 0,
    glyphs,
    missing: [],
    hollowTubes: false,
    tube: null,
    stripMode,
    strokes: strokes.length > 0 ? strokes.map((line) => line.points.map((p): Point => [p[0], p[1]])) : null,
  };
}

function emptyRaster(box: BBoxMm | null, pxPerMm: number): Raster {
  const minX = box?.minX ?? 0;
  const minY = box?.minY ?? 0;
  const maxX = box?.maxX ?? 1;
  const maxY = box?.maxY ?? 1;
  const width = Math.max(1, Math.ceil((maxX - minX) * pxPerMm) + RASTER_MARGIN_PX * 2);
  const height = Math.max(1, Math.ceil((maxY - minY) * pxPerMm) + RASTER_MARGIN_PX * 2);
  return {
    data: new Uint8Array(width * height),
    width,
    height,
    pxPerMm,
    pxToMm: {
      mmPerPx: 1 / pxPerMm,
      originX: minX - RASTER_MARGIN_PX / pxPerMm,
      originY: maxY + RASTER_MARGIN_PX / pxPerMm,
    },
    warnings: [],
  };
}

function unionBounds(contours: readonly Contour[], points: readonly Point[]): BBoxMm | null {
  const all: Contour[] = contours.map((contour) => contour.map((p): Point => [p[0], p[1]]));
  if (points.length > 0) all.push(points.map((p): Point => [p[0], p[1]]));
  return contoursBBox(all);
}

/** Componenti connesse del grafo, da sinistra a destra: «regione 1», «regione 2»… */
export function regionsOf(graph: SkeletonGraph): GlyphInfo[] {
  const parent = graph.nodes.map((_, index) => index);
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index]!)));
  const unite = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (const edge of graph.edges) unite(edge.a, edge.b);
  const groups = new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>();
  const grow = (id: number, x: number, y: number): void => {
    const root = find(id);
    const box = groups.get(root);
    if (!box) groups.set(root, { minX: x, minY: y, maxX: x, maxY: y });
    else {
      box.minX = Math.min(box.minX, x);
      box.minY = Math.min(box.minY, y);
      box.maxX = Math.max(box.maxX, x);
      box.maxY = Math.max(box.maxY, y);
    }
  };
  for (const node of graph.nodes) grow(node.id, node.x, node.y);
  for (const edge of graph.edges) {
    for (const point of edge.points) {
      grow(edge.a, point[0], point[1]);
    }
  }
  return [...groups.values()]
    .sort((a, b) => a.minX - b.minX || a.minY - b.minY)
    .map((box, index) => ({
      glyphIndex: index,
      char: `regione ${index + 1}`,
      x: box.minX,
      bbox: { minX: box.minX, minY: box.minY, maxX: box.maxX, maxY: box.maxY },
    }));
}

// ---------------------------------------------------------------- path

function absoluteCommands(d: string): Cmd[] {
  const s = d.trim();
  if (!s) return [];
  const out: Cmd[] = [];
  let i = 0;
  let cmd = '';
  let pen: Point = [0, 0];
  let start: Point = [0, 0];
  let prevC: Point | null = null;
  let prevQ: Point | null = null;

  const fail = (): never => {
    throw new Error('Path SVG non valido.');
  };
  const skip = (): void => {
    while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n' || s[i] === '\r' || s[i] === ',')) i++;
  };
  const read = (): number => {
    const hit = readNumberAt(s, i);
    if (!hit) return fail();
    i = hit.i;
    return hit.n;
  };
  const flag = (): number => {
    skip();
    const c = s[i];
    if (c !== '0' && c !== '1') fail();
    i++;
    return c === '1' ? 1 : 0;
  };
  const abs = (x: number, y: number, rel: boolean): Point => (rel ? [pen[0] + x, pen[1] + y] : [x, y]);
  const reflect = (point: Point): Point => [2 * pen[0] - point[0], 2 * pen[1] - point[1]];

  while (i < s.length) {
    skip();
    if (i >= s.length) break;
    const c = s[i]!;
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
      cmd = c;
      i++;
    } else if (!cmd || cmd === 'Z' || cmd === 'z') fail();
    const rel = cmd === cmd.toLowerCase();
    const op = cmd.toUpperCase();
    if (op === 'M') {
      const p = abs(read(), read(), rel);
      out.push({ t: 'M', x: p[0], y: p[1] });
      pen = start = p;
      cmd = rel ? 'l' : 'L';
      prevC = prevQ = null;
    } else if (op === 'L') {
      const p = abs(read(), read(), rel);
      out.push({ t: 'L', x: p[0], y: p[1] });
      pen = p;
      prevC = prevQ = null;
    } else if (op === 'H') {
      const x = read();
      const p: Point = [rel ? pen[0] + x : x, pen[1]];
      out.push({ t: 'L', x: p[0], y: p[1] });
      pen = p;
      prevC = prevQ = null;
    } else if (op === 'V') {
      const y = read();
      const p: Point = [pen[0], rel ? pen[1] + y : y];
      out.push({ t: 'L', x: p[0], y: p[1] });
      pen = p;
      prevC = prevQ = null;
    } else if (op === 'C') {
      const c1 = abs(read(), read(), rel);
      const c2 = abs(read(), read(), rel);
      const p = abs(read(), read(), rel);
      out.push({ t: 'C', x1: c1[0], y1: c1[1], x2: c2[0], y2: c2[1], x: p[0], y: p[1] });
      prevC = c2;
      prevQ = null;
      pen = p;
    } else if (op === 'S') {
      const c1 = prevC ? reflect(prevC) : pen;
      const c2 = abs(read(), read(), rel);
      const p = abs(read(), read(), rel);
      out.push({ t: 'C', x1: c1[0], y1: c1[1], x2: c2[0], y2: c2[1], x: p[0], y: p[1] });
      prevC = c2;
      prevQ = null;
      pen = p;
    } else if (op === 'Q') {
      const c1 = abs(read(), read(), rel);
      const p = abs(read(), read(), rel);
      out.push({ t: 'Q', x1: c1[0], y1: c1[1], x: p[0], y: p[1] });
      prevQ = c1;
      prevC = null;
      pen = p;
    } else if (op === 'T') {
      const c1: Point = prevQ ? reflect(prevQ) : pen;
      const p = abs(read(), read(), rel);
      out.push({ t: 'Q', x1: c1[0], y1: c1[1], x: p[0], y: p[1] });
      prevQ = c1;
      prevC = null;
      pen = p;
    } else if (op === 'A') {
      const rx = Math.abs(read());
      const ry = Math.abs(read());
      const angle = read();
      const large = flag();
      const sweep = flag();
      const p = abs(read(), read(), rel);
      out.push(...arcToCubics(pen, rx, ry, angle, large, sweep, p));
      pen = p;
      prevC = prevQ = null;
    } else if (op === 'Z') {
      out.push({ t: 'Z' });
      pen = start;
      prevC = prevQ = null;
    } else fail();
  }
  return out;
}

function arcToCubics(from: Point, rx: number, ry: number, angle: number, large: number, sweep: number, to: Point): Cmd[] {
  if (dist(from, to) < 1e-9) return [];
  if (!(rx > 0) || !(ry > 0)) return [{ t: 'L', x: to[0], y: to[1] }];
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  let rx2 = rx * rx;
  let ry2 = ry * ry;
  const lam = (x1 * x1) / rx2 + (y1 * y1) / ry2;
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rx *= s;
    ry *= s;
    rx2 = rx * rx;
    ry2 = ry * ry;
  }
  const sign = large === sweep ? -1 : 1;
  const sq = Math.max(0, (rx2 * ry2 - rx2 * y1 * y1 - ry2 * x1 * x1) / (rx2 * y1 * y1 + ry2 * x1 * x1));
  const coef = sign * Math.sqrt(sq);
  const cx1 = (coef * (rx * y1)) / ry;
  const cy1 = (coef * -(ry * x1)) / rx;
  const cx = cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2;
  const angleBetween = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let ang = Math.acos(Math.min(1, Math.max(-1, len === 0 ? 1 : dot / len)));
    if (ux * vy - uy * vx < 0) ang = -ang;
    return ang;
  };
  const start = angleBetween(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angleBetween((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;
  const segs = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / segs;
  const map = (ux: number, uy: number): Point => {
    const px = rx * ux;
    const py = ry * uy;
    return [cos * px - sin * py + cx, sin * px + cos * py + cy];
  };
  const cubics: Cmd[] = [];
  for (let k = 0; k < segs; k++) {
    const a0 = start + step * k;
    const a1 = start + step * (k + 1);
    const alpha = (4 / 3) * Math.tan((a1 - a0) / 4);
    const cos0 = Math.cos(a0);
    const sin0 = Math.sin(a0);
    const cos1 = Math.cos(a1);
    const sin1 = Math.sin(a1);
    const c1 = map(cos0 - alpha * sin0, sin0 + alpha * cos0);
    const c2 = map(cos1 + alpha * sin1, sin1 - alpha * cos1);
    const p = map(cos1, sin1);
    cubics.push({ t: 'C', x1: c1[0], y1: c1[1], x2: c2[0], y2: c2[1], x: p[0], y: p[1] });
  }
  const last = cubics[cubics.length - 1];
  if (last && last.t === 'C') {
    last.x = to[0];
    last.y = to[1];
  }
  return cubics;
}

function transformCmds(cmds: readonly Cmd[], m: Matrix): Cmd[] {
  if (m === IDENTITY) return [...cmds];
  const p = (x: number, y: number): Point => apply(m, x, y);
  return cmds.map((cmd): Cmd => {
    if (cmd.t === 'Z') return cmd;
    if (cmd.t === 'M' || cmd.t === 'L') {
      const q = p(cmd.x, cmd.y);
      return { t: cmd.t, x: q[0], y: q[1] };
    }
    if (cmd.t === 'Q') {
      const c1 = p(cmd.x1, cmd.y1);
      const q = p(cmd.x, cmd.y);
      return { t: 'Q', x1: c1[0], y1: c1[1], x: q[0], y: q[1] };
    }
    const c1 = p(cmd.x1, cmd.y1);
    const c2 = p(cmd.x2, cmd.y2);
    const q = p(cmd.x, cmd.y);
    return { t: 'C', x1: c1[0], y1: c1[1], x2: c2[0], y2: c2[1], x: q[0], y: q[1] };
  });
}

function mapCmds(cmds: readonly Cmd[], box: BBoxMm, scaleMm: number): Cmd[] {
  const p = (x: number, y: number): Point => [roundMm((x - box.minX) * scaleMm), roundMm((box.maxY - y) * scaleMm)];
  return cmds.map((cmd): Cmd => {
    if (cmd.t === 'Z') return cmd;
    if (cmd.t === 'M' || cmd.t === 'L') {
      const q = p(cmd.x, cmd.y);
      return { t: cmd.t, x: q[0], y: q[1] };
    }
    if (cmd.t === 'Q') {
      const c1 = p(cmd.x1, cmd.y1);
      const q = p(cmd.x, cmd.y);
      return { t: 'Q', x1: c1[0], y1: c1[1], x: q[0], y: q[1] };
    }
    const c1 = p(cmd.x1, cmd.y1);
    const c2 = p(cmd.x2, cmd.y2);
    const q = p(cmd.x, cmd.y);
    return { t: 'C', x1: c1[0], y1: c1[1], x2: c2[0], y2: c2[1], x: q[0], y: q[1] };
  });
}

function formatCmds(cmds: readonly Cmd[]): string {
  let text = '';
  let pen: Point | null = null;
  const add = (op: string, nums: number[]): void => {
    text += `${text ? ' ' : ''}${op}${nums.map(formatMm).join(' ')}`;
  };
  for (const cmd of cmds) {
    if (cmd.t === 'Z') {
      if (text) text += ' Z';
      continue;
    }
    if (cmd.t === 'M') {
      add('M', [cmd.x, cmd.y]);
      pen = [cmd.x, cmd.y];
    } else if (cmd.t === 'L') {
      if (pen && pen[0] === cmd.x && pen[1] === cmd.y) continue;
      add('L', [cmd.x, cmd.y]);
      pen = [cmd.x, cmd.y];
    } else if (cmd.t === 'Q') {
      add('Q', [cmd.x1, cmd.y1, cmd.x, cmd.y]);
      pen = [cmd.x, cmd.y];
    } else {
      add('C', [cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y]);
      pen = [cmd.x, cmd.y];
    }
  }
  return text;
}

function cmdsBBox(cmds: readonly Cmd[]): BBoxMm | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  const addCubic = (p0: Point, p1: Point, p2: Point, p3: Point): void => {
    add(p0[0], p0[1]);
    add(p3[0], p3[1]);
    for (const t of extrema(p0[0], p1[0], p2[0], p3[0])) add(bezier(p0[0], p1[0], p2[0], p3[0], t), bezier(p0[1], p1[1], p2[1], p3[1], t));
    for (const t of extrema(p0[1], p1[1], p2[1], p3[1])) add(bezier(p0[0], p1[0], p2[0], p3[0], t), bezier(p0[1], p1[1], p2[1], p3[1], t));
  };
  let pen: Point = [0, 0];
  let start: Point = [0, 0];
  for (const cmd of cmds) {
    if (cmd.t === 'M') pen = start = [cmd.x, cmd.y];
    else if (cmd.t === 'L') {
      add(pen[0], pen[1]);
      add(cmd.x, cmd.y);
      pen = [cmd.x, cmd.y];
    } else if (cmd.t === 'Q') {
      const c1: Point = [cmd.x1, cmd.y1];
      const p: Point = [cmd.x, cmd.y];
      addCubic(pen, [pen[0] / 3 + (2 * c1[0]) / 3, pen[1] / 3 + (2 * c1[1]) / 3], [(2 * c1[0]) / 3 + p[0] / 3, (2 * c1[1]) / 3 + p[1] / 3], p);
      pen = p;
    } else if (cmd.t === 'C') {
      addCubic(pen, [cmd.x1, cmd.y1], [cmd.x2, cmd.y2], [cmd.x, cmd.y]);
      pen = [cmd.x, cmd.y];
    } else pen = start;
  }
  return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}

function extrema(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 3 * (p0 - 2 * p1 + p2);
  const c = 3 * (p1 - p0);
  const ts: number[] = [];
  const push = (t: number): void => {
    if (t > 1e-6 && t < 1 - 1e-6) ts.push(t);
  };
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      push((-b + s) / (2 * a));
      push((-b - s) / (2 * a));
    }
  }
  return ts;
}

function bezier(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function polylinesOf(cmds: readonly Cmd[], tol: number): Poly[] {
  const lines: Poly[] = [];
  let current: Point[] = [];
  let start: Point = [0, 0];
  let pen: Point = [0, 0];
  let closed = false;
  const pushPoint = (p: Point): void => {
    const last = current[current.length - 1];
    if (!last || dist(last, p) > 1e-6) current.push(p);
  };
  const finish = (): void => {
    if (closed && current.length >= 2 && dist(current[0]!, current[current.length - 1]!) > 1e-6) {
      current.push([current[0]![0], current[0]![1]]);
    }
    if (current.length >= 2) lines.push({ points: current, closed });
    current = [];
    closed = false;
  };
  for (const cmd of cmds) {
    if (cmd.t === 'M') {
      finish();
      pen = start = [cmd.x, cmd.y];
      pushPoint(pen);
    } else if (cmd.t === 'L') {
      pen = [cmd.x, cmd.y];
      pushPoint(pen);
    } else if (cmd.t === 'Q') {
      const p0 = pen;
      const p1: Point = [cmd.x1, cmd.y1];
      const p2: Point = [cmd.x, cmd.y];
      const n = segmentsFor(2 * Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]), tol);
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const u = 1 - t;
        pushPoint([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
      }
      pen = p2;
    } else if (cmd.t === 'C') {
      const p0 = pen;
      const p1: Point = [cmd.x1, cmd.y1];
      const p2: Point = [cmd.x2, cmd.y2];
      const p3: Point = [cmd.x, cmd.y];
      const d1 = Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]);
      const d2 = Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1]);
      const n = segmentsFor(6 * Math.max(d1, d2), tol);
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const u = 1 - t;
        pushPoint([
          u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
          u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
        ]);
      }
      pen = p3;
    } else {
      closed = true;
      pen = start;
    }
  }
  finish();
  return lines;
}

const segmentsFor = (m: number, tol: number): number => Math.max(1, Math.ceil(Math.sqrt(m / (8 * tol))));

const roundMm = (n: number): number => Math.round(n * 1000) / 1000;

function formatMm(n: number): string {
  const r = Object.is(roundMm(n), -0) ? 0 : roundMm(n);
  return r.toFixed(3).replace(/\.?0+$/, '');
}

function num(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const r = Object.is(Math.round(n * 1e6) / 1e6, -0) ? 0 : Math.round(n * 1e6) / 1e6;
  return String(r);
}

function scanNumbers(raw: string): number[] {
  const nums: number[] = [];
  let i = 0;
  while (i < raw.length) {
    const hit = readNumberAt(raw, i);
    if (!hit) {
      i++;
      continue;
    }
    nums.push(hit.n);
    i = hit.i;
  }
  return nums;
}

function readNumberAt(s: string, index: number): { n: number; i: number } | null {
  let i = index;
  while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n' || s[i] === '\r' || s[i] === ',')) i++;
  const start = i;
  if (s[i] === '+' || s[i] === '-') i++;
  const digits = i;
  while (i < s.length && s[i]! >= '0' && s[i]! <= '9') i++;
  if (s[i] === '.') {
    i++;
    while (i < s.length && s[i]! >= '0' && s[i]! <= '9') i++;
  }
  if (i === digits || (i === digits + 1 && s[digits] === '.')) return null;
  if (s[i] === 'e' || s[i] === 'E') {
    const mark = i;
    i++;
    if (s[i] === '+' || s[i] === '-') i++;
    const exp = i;
    while (i < s.length && s[i]! >= '0' && s[i]! <= '9') i++;
    if (i === exp) i = mark;
  }
  if (i === start) return null;
  const n = Number(s.slice(start, i));
  return Number.isFinite(n) ? { n, i } : null;
}
