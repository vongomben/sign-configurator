import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEFAULT_PARAMS, GENERATOR_VERSION, ORDER_SCHEMA_VERSION, type CuspMode, type IDotMode } from '../config';
import { DEFAULT_CUSTOMER, type OrderSource, type RasterImageSource, type SignOrderV4, type SvgImageSource, type TraceMode } from '../order/schema';
import { layoutRaster } from '../sources/bitmapCodec';
import { importRaster, paintThresholdPreview, rebuildRaster } from '../sources/rasterImport';
import { IMAGE_MAX_BYTES, importSvg } from '../sources/svgImport';
import { layoutSvg } from '../sources/svgPaths';
import type { Bom } from '../export/bom';
import { meshToStl, type StlMesh } from '../export/stl';
import { FONTS } from '../fonts/registry';
import { coverSign, DARK_LABEL, unpairedWalls, type CoverageReport } from '../geometry/coverage';
import type { SkeletonGraph } from '../geometry/graph';
import { cubeCounts } from '../geometry/manifold';
import { mmToPx, rasterize, type Point, type RasterizeInput, type TextRaster } from '../geometry/rasterize';
import type { StripModel } from '../geometry/strip';
import type { TubePairing } from '../geometry/tubePairing';
import type { ValidationIssue } from '../geometry/validate';
import { createGenerator } from '../worker/api';

const generator = createGenerator();

const form = document.querySelector<HTMLFormElement>('#raster-form')!;
const fontSelect = form.querySelector<HTMLSelectElement>('select[name="fontId"]')!;
const measures = document.querySelector<HTMLElement>('#measures')!;
const warningsList = document.querySelector<HTMLUListElement>('#warnings')!;
const issuesList = document.querySelector<HTMLElement>('#issues')!;
const coverageBody = document.querySelector<HTMLTableSectionElement>('#coverage tbody')!;
const rasterWrap = document.querySelector<HTMLElement>('#raster-wrap')!;
const heightHint = document.querySelector<HTMLElement>('#height-hint')!;
const bomSummary = document.querySelector<HTMLElement>('#bom-summary')!;
const bomBody = document.querySelector<HTMLTableSectionElement>('#bom tbody')!;
const bomFoot = document.querySelector<HTMLTableSectionElement>('#bom tfoot')!;
const canvas = document.querySelector<HTMLCanvasElement>('#raster')!;
const legend = document.querySelector<HTMLElement>('#legend')!;
const manifoldOut = document.querySelector<HTMLElement>('#manifold-check')!;
const solidView = document.querySelector<HTMLDivElement>('#solid-view')!;
const solidStatus = document.querySelector<HTMLElement>('#solid-status')!;
const downloadHousing = document.querySelector<HTMLButtonElement>('#download-housing')!;
const downloadDiffuser = document.querySelector<HTMLButtonElement>('#download-diffuser')!;

for (const f of FONTS) fontSelect.add(new Option(f.name, f.id));

const RULER = 28;
const MAX_CANVAS_SIDE = 16_384;
const NICE_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
const niceStep = (screenPxPerMm: number, minPx: number): number =>
  NICE_STEPS.find((s) => s * screenPxPerMm >= minPx) ?? NICE_STEPS[NICE_STEPS.length - 1]!;
const fmt = (mm: number): string => `${mm.toFixed(2)} mm`;

/** Colori dei nodi per grado: estremi, anelli, giunzioni a T/Y, incroci, oltre. */
const DEGREE_COLORS: Record<number, string> = { 1: '#2e7d32', 2: '#757575', 3: '#ef6c00', 4: '#d32f2f' };
const degreeColor = (d: number): string => DEGREE_COLORS[d] ?? '#7b1fa2';
const SEGMENT_COLORS = ['#6a1b9a', '#0277bd', '#2e7d32', '#ef6c00', '#c2185b', '#00838f', '#f9a825', '#455a64'];
const segmentColor = (id: number): string => SEGMENT_COLORS[(id - 1) % SEGMENT_COLORS.length] ?? SEGMENT_COLORS[0]!;

function readModes(data: FormData): { cuspMode: CuspMode; iDotMode: IDotMode } {
  const cusp = String(data.get('cuspMode') ?? 'split');
  const dot = String(data.get('iDotMode') ?? 'dot');
  return {
    cuspMode: cusp === 'warn' ? 'warn' : 'split',
    iDotMode: dot === 'omit' || dot === 'unlit' || dot === 'dash' || dot === 'dot' ? (dot as IDotMode) : 'dot',
  };
}

function readInput(): { input: RasterizeInput; zoom: number; showGraph: boolean; cuspMode: CuspMode; iDotMode: IDotMode } {
  const data = new FormData(form);
  const num = (k: string, fallback: number): number => {
    const v = Number(data.get(k));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  const input: RasterizeInput = {
    text: String(data.get('text') ?? ''),
    fontId: String(data.get('fontId') ?? FONTS[0]!.id),
    heightMm: num('heightMm', 100),
    pxPerMm: num('pxPerMm', 10),
  };
  return { input, zoom: num('zoom', 1), showGraph: data.get('showGraph') !== null, ...readModes(data) };
}

const SOLID_LEGEND =
  'Nodi per grado: <span style="--c:#2e7d32">1 estremo</span> <span style="--c:#757575">2 anello chiuso</span> <span style="--c:#ef6c00">3 giunzione</span> <span style="--c:#d32f2f">4 incrocio</span> <span style="--c:#7b1fa2">≥ 5</span> · archi in blu/verde acqua alternati';
const TUBE_LEGEND =
  'Tubi: <span style="--c:#1565c0">pareti accoppiate</span> <span style="--c:#2e7d32">linea mediana</span> <span style="--c:#ef6c00">linea singola</span> <span style="--c:#c62828">coppia dubbia</span>';
const SEGMENT_LEGEND =
  'Spezzoni a colori diversi, cerniere nere, <span style="--c:#c62828">angolo oltre il massimo</span>. La freccia è il verso DIN → DOUT. Cerchio numerato = curva, triangolo = spigolo. Tratteggio grigio = tratto spento, con il motivo.';

function draw(
  r: TextRaster,
  requestedZoom: number,
  graph: SkeletonGraph | null,
  pairing: TubePairing | null,
  strip: StripModel | null,
  coverage: CoverageReport | null,
): void {
  const zoom = Math.min(requestedZoom, (MAX_CANVAS_SIDE - RULER) / Math.max(r.width, r.height));
  const w = Math.round(r.width * zoom);
  const h = Math.round(r.height * zoom);
  // Spazio sopra la bitmap se la linea dell'altezza supera l'inchiostro.
  const top = RULER + Math.max(0, Math.ceil((r.capHeightMm - r.pxToMm.originY) * r.pxPerMm * zoom) + 14);
  canvas.width = w + RULER;
  canvas.height = h + top;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f3f3f3';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const img = new ImageData(r.width, r.height);
  // Con il grafo sopra, la bitmap va schiarita e lo scheletro resta scuro.
  // Per i tubi le pareti si disegnano come polilinee colorate, non come pixel dello scheletro.
  const ink = graph || pairing || strip ? 205 : 0;
  for (let i = 0; i < r.data.length; i++) {
    const v = !pairing && graph?.skeleton[i] ? 0 : r.data[i] ? ink : 255;
    img.data[4 * i] = v;
    img.data[4 * i + 1] = v;
    img.data[4 * i + 2] = v;
    img.data[4 * i + 3] = 255;
  }
  const bitmap = new OffscreenCanvas(r.width, r.height);
  bitmap.getContext('2d')!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, RULER, top, w, h);
  if (r.strokes) {
    const sx0 = (xMm: number): number => RULER + mmToPx(r.pxToMm, xMm, 0)[0] * zoom;
    const sy0 = (yMm: number): number => top + mmToPx(r.pxToMm, 0, yMm)[1] * zoom;
    ctx.strokeStyle = '#263238';
    ctx.lineWidth = Math.max(1.25, 0.6 * zoom);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const line of r.strokes) {
      if (line.length < 2) continue;
      ctx.beginPath();
      line.forEach((p, i) => (i === 0 ? ctx.moveTo(sx0(p[0]), sy0(p[1])) : ctx.lineTo(sx0(p[0]), sy0(p[1]))));
      ctx.stroke();
    }
  }

  // mm → coordinate della canvas
  const sx = (xMm: number): number => RULER + mmToPx(r.pxToMm, xMm, 0)[0] * zoom;
  const sy = (yMm: number): number => top + mmToPx(r.pxToMm, 0, yMm)[1] * zoom;

  const hLine = (yMm: number, color: string, label: string): void => {
    ctx.strokeStyle = color;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(RULER, sy(yMm) + 0.5);
    ctx.lineTo(RULER + w, sy(yMm) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(label, RULER + 4, sy(yMm) - 3);
  };
  hLine(0, '#1565c0', 'linea di base');
  hLine(r.xHeightMm, '#2e7d32', 'x-height');
  hLine(r.capHeightMm, '#c62828', 'altezza (sommità della H)');
  if (r.bbox) {
    ctx.strokeStyle = '#ef6c00';
    ctx.strokeRect(sx(r.bbox.minX), sy(r.bbox.maxY), sx(r.bbox.maxX) - sx(r.bbox.minX), sy(r.bbox.minY) - sy(r.bbox.maxY));
  }
  if (pairing && graph) drawPairing(ctx, graph, pairing, sx, sy);
  else if (graph) drawGraph(ctx, graph, sx, sy);
  if (strip) drawStrip(ctx, strip, sx, sy);
  if (coverage) drawDark(ctx, coverage, sx, sy);
  lastMap = (xMm, yMm) => [sx(xMm), sy(yMm)];
  scrollToPending();
  // Righelli in mm (x lungo il bordo alto, y lungo il bordo sinistro, 0 = origine del testo)
  const screenPxPerMm = r.pxPerMm * zoom;
  const minor = niceStep(screenPxPerMm, 6);
  const major = niceStep(screenPxPerMm, 60);
  ctx.fillStyle = '#e0e0e0';
  ctx.fillRect(0, 0, canvas.width, RULER);
  ctx.fillRect(0, 0, RULER, canvas.height);
  ctx.strokeStyle = '#555';
  ctx.fillStyle = '#222';
  ctx.font = '10px system-ui, sans-serif';
  ctx.beginPath();
  const xMin = r.pxToMm.originX;
  const xMax = xMin + r.width * r.pxToMm.mmPerPx;
  for (let k = Math.ceil(xMin / minor); k * minor <= xMax; k++) {
    const mm = k * minor;
    const isMajor = Math.abs(mm / major - Math.round(mm / major)) < 1e-6;
    const x = Math.round(sx(mm)) + 0.5;
    ctx.moveTo(x, RULER);
    ctx.lineTo(x, RULER - (isMajor ? 12 : 5));
    if (isMajor) ctx.fillText(String(+mm.toFixed(1)), x + 2, 10);
  }
  const yMax = r.pxToMm.originY + (top - RULER) / screenPxPerMm;
  const yMin = yMax - r.height * r.pxToMm.mmPerPx;
  for (let k = Math.ceil(yMin / minor); k * minor <= yMax; k++) {
    const mm = k * minor;
    const isMajor = Math.abs(mm / major - Math.round(mm / major)) < 1e-6;
    const y = Math.round(sy(mm)) + 0.5;
    ctx.moveTo(RULER, y);
    ctx.lineTo(RULER - (isMajor ? 12 : 5), y);
    if (isMajor) ctx.fillText(String(+mm.toFixed(1)), 1, y - 2);
  }
  ctx.stroke();
}

/** Archi come polilinee (colore alternato per distinguerli), nodi come dischi colorati per grado. */
function drawGraph(
  ctx: CanvasRenderingContext2D,
  g: SkeletonGraph,
  sx: (xMm: number) => number,
  sy: (yMm: number) => number,
): void {
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  g.edges.forEach((e, k) => {
    ctx.strokeStyle = k % 2 ? '#1565c0' : '#00838f';
    ctx.beginPath();
    e.points.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
    ctx.stroke();
  });
  ctx.lineWidth = 1;
  for (const n of g.nodes) {
    ctx.fillStyle = degreeColor(n.degree);
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.arc(sx(n.x), sy(n.y), 4.5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }
}

function stroke(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  color: string,
  width: number,
  sx: (xMm: number) => number,
  sy: (yMm: number) => number,
  dash: number[] = [],
): void {
  if (points.length === 0) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.setLineDash(dash);
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
  ctx.stroke();
  ctx.setLineDash([]);
}

function arrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const n = Math.hypot(dx, dy) || 1;
  const ux = dx / n;
  const uy = dy / n;
  const px = -uy;
  const py = ux;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - ux * 9 + px * 4, y1 - uy * 9 + py * 4);
  ctx.lineTo(x1 - ux * 9 - px * 4, y1 - uy * 9 - py * 4);
  ctx.closePath();
  ctx.fill();
}

let pendingFocus: Point | null = null;
let lastMap: ((xMm: number, yMm: number) => [number, number]) | null = null;

function scrollToPending(): void {
  if (!pendingFocus || !lastMap) return;
  const [px, py] = lastMap(pendingFocus[0], pendingFocus[1]);
  rasterWrap.scrollLeft = Math.max(0, px - rasterWrap.clientWidth / 2);
  rasterWrap.scrollTop = Math.max(0, py - rasterWrap.clientHeight / 2);
  rasterWrap.scrollIntoView({ block: 'center', inline: 'nearest' });
  pendingFocus = null;
}

function focusIssue(x: number, y: number): void {
  pendingFocus = [x, y];
  const zoom = form.querySelector<HTMLInputElement>('input[name="zoom"]')!;
  const next = Math.max(Number(zoom.value) || 0, 2);
  if (next - Number(zoom.value) > 1e-6) {
    zoom.value = String(next);
    zoom.dispatchEvent(new Event('change', { bubbles: true }));
  } else scrollToPending();
}

/** Spezzoni colorati, cerniere nere e in rosso quelle oltre HINGE_MAX_DEG. */
function drawStrip(
  ctx: CanvasRenderingContext2D,
  strip: StripModel,
  sx: (xMm: number) => number,
  sy: (yMm: number) => number,
): void {
  for (const dot of strip.unlit) {
    ctx.beginPath();
    ctx.fillStyle = 'rgba(90, 90, 90, 0.55)';
    if (dot.points.length >= 3) {
      dot.points.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
      ctx.closePath();
    } else {
      ctx.arc(sx(dot.x), sy(dot.y), 6, 0, 2 * Math.PI);
    }
    ctx.fill();
  }
  for (const chain of strip.chains) {
    const color = segmentColor(chain.id);
    stroke(ctx, chain.points, color, 2.5, sx, sy);
    if (chain.points.length < 2) continue;
    const a = chain.points[chain.points.length - 2]!;
    const b = chain.points[chain.points.length - 1]!;
    ctx.fillStyle = color;
    arrow(ctx, sx(a[0]), sy(a[1]), sx(b[0]), sy(b[1]));
  }
  for (const chain of strip.chains) {
    for (const hinge of chain.hinges) {
      ctx.beginPath();
      ctx.fillStyle = hinge.over ? '#c62828' : '#222';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.arc(sx(hinge.x), sy(hinge.y), hinge.over ? 4.5 : 2.6, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }
  }
  drawMarkers(ctx, strip, sx, sy);
}

const DUBIOUS_LABEL = { short: 'sovrapposizione corta', distance: 'distanza', angle: 'angolo' } as const;

function drawDark(
  ctx: CanvasRenderingContext2D,
  coverage: CoverageReport,
  sx: (xMm: number) => number,
  sy: (yMm: number) => number,
): void {
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const stretch of coverage.stretches) {
    if (stretch.points.length < 2) continue;
    stroke(ctx, stretch.points, '#757575', 2.2, sx, sy, [5, 4]);
    const mid = stretch.points[Math.floor(stretch.points.length / 2)]!;
    ctx.fillStyle = '#424242';
    ctx.fillText(DARK_LABEL[stretch.reason], sx(mid[0]), sy(mid[1]) - 4);
  }
}

function drawMarkers(
  ctx: CanvasRenderingContext2D,
  strip: StripModel,
  sx: (xMm: number) => number,
  sy: (yMm: number) => number,
): void {
  let n = 0;
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const issue of strip.issues) {
    if (!issue.bend) continue;
    n += 1;
    const x = sx(issue.x);
    const y = sy(issue.y);
    ctx.beginPath();
    if (issue.bend === 'curva') ctx.arc(x, y, 9, 0, 2 * Math.PI);
    else {
      ctx.moveTo(x, y - 11);
      ctx.lineTo(x + 9, y + 8);
      ctx.lineTo(x - 9, y + 8);
      ctx.closePath();
    }
    ctx.fillStyle = issue.bend === 'curva' ? '#1565c0' : '#e65100';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(String(n), x, issue.bend === 'spigolo' ? y + 1 : y);
  }
}

/** Pareti accoppiate in blu, mediana in verde, linee singole in arancio, coppie dubbie in rosso. */
function drawPairing(
  ctx: CanvasRenderingContext2D,
  g: SkeletonGraph,
  p: TubePairing,
  sx: (xMm: number) => number,
  sy: (yMm: number) => number,
): void {
  for (const d of p.dubious) {
    for (const id of [d.a, d.b]) {
      const edge = g.edges[id];
      if (edge) stroke(ctx, edge.points, '#c62828', 1.5, sx, sy, [5, 4]);
    }
  }
  for (const s of p.singles) stroke(ctx, s.points, '#ef6c00', 1.5, sx, sy);
  for (const pair of p.pairs) {
    stroke(ctx, g.edges[pair.a]!.points, '#1565c0', 1.5, sx, sy);
    if (pair.a !== pair.b) stroke(ctx, g.edges[pair.b]!.points, '#1565c0', 1.5, sx, sy);
    stroke(ctx, pair.midline, '#2e7d32', 2.5, sx, sy);
  }
  ctx.fillStyle = '#c62828';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const d of p.dubious) {
    ctx.beginPath();
    ctx.arc(sx(d.x), sy(d.y), 4, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillText(DUBIOUS_LABEL[d.reason], sx(d.x) + 7, sy(d.y));
  }
}

function graphRows(g: SkeletonGraph | null, graphMs: number): [string, string][] {
  if (!g) return [['Scheletro e grafo', '—']];
  const byDegree = new Map<number, number>();
  for (const n of g.nodes) byDegree.set(n.degree, (byDegree.get(n.degree) ?? 0) + 1);
  const degrees = [...byDegree.entries()]
    .sort(([a], [b]) => a - b)
    .map(([d, c]) => `grado ${d}: ${c}`)
    .join(' · ');
  const length = g.edges.reduce((s, e) => s + e.lengthMm, 0);
  return [
    ['Larghezza del tratto (EDT)', fmt(g.strokeWidthMm)],
    ['Nodi', `${g.nodes.length}${degrees ? ` (${degrees})` : ''}`],
    ['Archi', `${g.edges.length}, lunghezza totale ${fmt(length)}`],
    [
      'Semplificazione',
      `${g.prunedSpurs} rami spuri potati, ${g.mergedJunctions} giunzioni fuse, ${g.filledHoles} forellini riempiti`,
    ],
    ['Tempo scheletro + grafo', `${graphMs.toFixed(0)} ms (worker)`],
  ];
}

function pairingRows(p: TubePairing | null): [string, string][] {
  if (!p) return [];
  const length = p.pairs.reduce((s, pair) => s + pair.lengthMm, 0);
  return [
    ['Coppie di tubi', `${p.pairs.length}, linea mediana ${fmt(length)}`],
    ['Linee singole', `${p.singles.length}`],
    ['Coppie dubbie', `${p.dubious.length}`],
    ['Distanza fra gli assi', `${fmt(p.distanceMinMm)} … ${fmt(p.distanceMaxMm)} (nominale ${fmt(p.nominalMm)})`],
  ];
}

function showMeasures(r: TextRaster, mainMatches: boolean | null, extra: [string, string][]): void {
  const caps = r.glyphs
    .filter((g) => g.char && g.bbox && /\p{Lu}/u.test(g.char))
    .map((g) => `${g.char} ${g.bbox!.maxY.toFixed(2)}`);
  const b = r.bbox;
  const t = r.tube;
  const rows: [string, string][] = [
    ['Altezza (sommità della H)', fmt(r.capHeightMm)],
    ['Sommità delle maiuscole nel testo', caps.length ? `${caps.join(' · ')} mm` : '—'],
    ['x-height (sommità della x)', fmt(r.xHeightMm)],
    ['Ingombro totale reale', b ? `${(b.maxX - b.minX).toFixed(2)} × ${(b.maxY - b.minY).toFixed(2)} mm` : '—'],
    ['… in x', b ? `${b.minX.toFixed(2)} … ${b.maxX.toFixed(2)} mm` : '—'],
    ['… in y (base = 0)', b ? `${b.minY.toFixed(2)} … ${b.maxY.toFixed(2)} mm` : '—'],
    ['Avanzamento', fmt(r.advanceMm)],
    [
      'Tubi',
      t
        ? `tubi cavi: linea ${fmt(t.lineWidthMm)}, luce mediana ${fmt(t.gapMm)}`
        : r.strokes && !r.data.some((pixel) => pixel)
          ? 'tratto singolo, senza bitmap'
          : r.strokes
            ? 'tratti e aree'
            : 'tratto pieno, monolinea',
    ],
    ['Corpo font (em)', fmt(r.fontSizeMm)],
    [r.strokes ? 'Linee del font' : 'Bitmap', r.strokes ? `${r.strokes.length} polilinee` : `${r.width} × ${r.height} px a ${+r.pxPerMm.toFixed(4)} px/mm`],
    ['Pixel pieni', `${r.data.reduce((n, v) => n + v, 0).toLocaleString('it-IT')}`],
    ['Main thread = worker', mainMatches === null ? '—' : mainMatches ? 'sì, byte per byte' : 'NO'],
    ...extra,
  ];
  measures.replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }),
  );
}

function stripRows(strip: StripModel): [string, string][] {
  const hinges = strip.chains.reduce((n, chain) => n + chain.hinges.length, 0);
  const over = strip.chains.reduce((n, chain) => n + chain.hinges.filter((hinge) => hinge.over).length, 0);
  const length = strip.chains.reduce((n, chain) => n + chain.lengthMm, 0);
  const errors = strip.issues.filter((issue) => issue.level === 'error').length;
  const hint = strip.suggestion.empty
    ? '—'
    : strip.suggestion.remainingErrors > 0
      ? `${strip.suggestion.heightMm?.toFixed(0) ?? '—'} mm, ne restano ${strip.suggestion.remainingErrors}`
      : `${strip.suggestion.heightMm?.toFixed(0) ?? '—'} mm`;
  return [
    ['Spezzoni', `${strip.chains.length}, lunghezza catena ${fmt(length)}`],
    ['Cerniere', `${hinges}, oltre il massimo ${over}`],
    ['Errori di validazione', String(errors)],
    ['Altezza minima', hint],
    ['BOM', `${strip.bom.totalLeds} LED, ${strip.bom.anchorHoles} fori, ${strip.bom.wireSlots} asole ${strip.bom.wireSlotW}×${strip.bom.wireSlotL} mm, ${strip.bom.corners.length} giunti d'angolo`],
  ];
}

function summaryText(strip: StripModel): string {
  const curves = strip.issues.filter((issue) => issue.bend === 'curva').length;
  const cusps = strip.issues.filter((issue) => issue.bend === 'spigolo').length;
  const crossings = strip.issues.filter((issue) => issue.message.startsWith('Incrocio')).length;
  if (strip.suggestion.empty) return 'Nessuno spezzone da piegare.';
  const height = strip.suggestion.heightMm === null ? '—' : `${strip.suggestion.heightMm.toFixed(0)} mm`;
  const limit =
    strip.suggestion.hasErrors && strip.suggestion.remainingErrors > 0
      ? ` Entro ${strip.suggestion.limitMm.toFixed(0)} mm le curve non si azzerano.`
      : '';
  const cuspNote = cusps > 0 ? ' Gli spigoli non si risolvono ingrandendo.' : '';
  return `${curves} curve, ${cusps} spigoli, ${crossings} incroci, altezza minima: ${height}.${cuspNote}${limit}`;
}

function showCoverage(report: CoverageReport): void {
  coverageBody.replaceChildren(
    ...report.letters.map((letter) => {
      const row = document.createElement('tr');
      for (const value of [
        letter.letter,
        letter.referenceMm.toFixed(1),
        letter.litMm.toFixed(1),
        `${(letter.ratio * 100).toFixed(0)}%`,
      ]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }),
  );
}

function showIssues(items: readonly ValidationIssue[]): void {
  const groups = new Map<string, ValidationIssue[]>();
  for (const item of items) {
    const key = item.segmentId === null ? 'Altri avvisi' : `Spezzone ${item.segmentId}`;
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  let marker = 0;
  const markerOf = new Map<ValidationIssue, number>();
  for (const item of items) {
    if (item.bend) markerOf.set(item, ++marker);
  }
  const blocks: HTMLElement[] = [];
  for (const [title, group] of groups) {
    const details = document.createElement('details');
    const summaryEl = document.createElement('summary');
    summaryEl.textContent = `${title} · ${group.length} avvisi`;
    const list = document.createElement('div');
    for (const item of group) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.x = String(item.x);
      button.dataset.y = String(item.y);
      if (item.level === 'error') button.className = 'error';
      const n = markerOf.get(item) ?? 0;
      button.textContent = n > 0 ? `${n}. ${item.message}` : item.message;
      list.append(button);
    }
    details.append(summaryEl, list);
    blocks.push(details);
  }
  issuesList.replaceChildren(...blocks);
}

function showHeight(strip: StripModel): void {
  const cusps = strip.issues.filter((issue) => issue.bend === 'spigolo').length;
  heightHint.classList.toggle('error', strip.suggestion.hasErrors || cusps > 0);
  heightHint.textContent = summaryText(strip);
}

function showBom(bom: Bom): void {
  const fit = bom.assembly;
  bomSummary.textContent =
    `${fit.segments} spezzoni · ${fit.solderJoints} saldature (${fit.wires} fili, 3 per collegamento DIN/DOUT) · ` +
    `${fit.corners} giunti d'angolo · filo stimato ${fit.wireM.toFixed(2)} m · ${fit.totalLeds} LED · ` +
    `corrente max ${fit.maxCurrentA.toFixed(2)} A a 5 V · alimentatore da ${fit.supplyA} A`;
  if (bom.segments.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 8;
    td.textContent = 'Nessuno spezzone.';
    tr.append(td);
    bomBody.replaceChildren(tr);
  } else {
    bomBody.replaceChildren(
      ...bom.segments.map((seg) => {
        const tr = document.createElement('tr');
        const cells = [
          String(seg.id),
          seg.lengthMm.toFixed(1),
          seg.cutLengthMm.toFixed(1),
          String(seg.ledCount),
          `(${seg.din[0].toFixed(1)}, ${seg.din[1].toFixed(1)})`,
          `(${seg.dout[0].toFixed(1)}, ${seg.dout[1].toFixed(1)})`,
          `(${seg.dinDir[0].toFixed(2)}, ${seg.dinDir[1].toFixed(2)})`,
          `(${seg.doutDir[0].toFixed(2)}, ${seg.doutDir[1].toFixed(2)})`,
        ];
        for (const [i, text] of cells.entries()) {
          const td = document.createElement('td');
          if (i === 0) td.style.boxShadow = `inset 6px 0 0 ${segmentColor(seg.id)}`;
          td.textContent = text;
          tr.append(td);
        }
        return tr;
      }),
    );
  }
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = 8;
  const cornerText =
    bom.corners.length === 0
      ? ''
      : `, ${bom.corners.length} giunti d'angolo (filo 0 mm: ${bom.corners
          .map((corner) => `(${corner.x.toFixed(1)}, ${corner.y.toFixed(1)}) spezzoni ${corner.segments.join('+')}`)
          .join('; ')})`;
  td.textContent = `Totale: ${bom.totalLeds} LED, ${bom.anchorHoles} fori di ancoraggio, ${bom.wireSlots} asole fili ${bom.wireSlotW}×${bom.wireSlotL} mm${cornerText}`;
  tr.append(td);
  bomFoot.replaceChildren(tr);
}

function clearStrip(): void {
  issuesList.replaceChildren();
  heightHint.textContent = '';
  heightHint.classList.remove('error');
  bomSummary.textContent = '';
  bomBody.replaceChildren();
  bomFoot.replaceChildren();
}

function showWarnings(items: string[], error = false): void {
  warningsList.replaceChildren(
    ...items.map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      if (error) li.className = 'error';
      return li;
    }),
  );
}

let housingStl: ArrayBuffer | null = null;
let diffuserStl: ArrayBuffer | null = null;

function saveStl(name: string, buffer: ArrayBuffer | null): void {
  if (!buffer) return;
  const url = URL.createObjectURL(new Blob([buffer], { type: 'model/stl' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

downloadHousing.addEventListener('click', () => saveStl('housing.stl', housingStl));
downloadDiffuser.addEventListener('click', () => saveStl('diffuser.stl', diffuserStl));

const solidPreview = (() => {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  Object.assign(renderer.domElement.style, { position: 'absolute', inset: '0', display: 'block' });
  solidView.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1d1f24);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(-1, -2, 3);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  const content = new THREE.Group();
  scene.add(content);
  const resize = (): void => {
    const { clientWidth: w, clientHeight: h } = solidView;
    renderer.setSize(w, h);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(solidView);
  resize();
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
  const toGeometry = (data: StlMesh): THREE.BufferGeometry => {
    const positions = new Float32Array((data.vertProperties.length / data.numProp) * 3);
    for (let i = 0, j = 0; j < positions.length; i += data.numProp, j += 3) {
      positions[j] = data.vertProperties[i]!;
      positions[j + 1] = data.vertProperties[i + 1]!;
      positions[j + 2] = data.vertProperties[i + 2]!;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.triVerts, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    return geometry;
  };
  return {
    show(housing: StlMesh, diffuser: StlMesh): void {
      for (const child of [...content.children]) {
        content.remove(child);
        (child as THREE.Mesh).geometry.dispose();
      }
      const housingMesh = new THREE.Mesh(
        toGeometry(housing),
        new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.7, metalness: 0 }),
      );
      const diffuserMesh = new THREE.Mesh(
        toGeometry(diffuser),
        new THREE.MeshStandardMaterial({ color: 0xd7dde6, roughness: 0.4, metalness: 0, transparent: true, opacity: 0.45 }),
      );
      content.add(housingMesh, diffuserMesh);
      const box = new THREE.Box3().setFromObject(content);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const span = Math.max(size.x, size.y, 10);
      controls.target.copy(center);
      camera.position.set(center.x, center.y - span, center.z + span * 0.8);
      camera.near = span / 100;
      camera.far = span * 20;
      camera.updateProjectionMatrix();
    },
  };
})();

async function previewSolid(id: number, order: SignOrderV4, label = ''): Promise<void> {
  downloadHousing.disabled = true;
  downloadDiffuser.disabled = true;
  housingStl = null;
  diffuserStl = null;
  solidStatus.textContent = 'Generazione 3D…';
  try {
    const result = await generator.generate(order);
    if (id !== runId) return;
    solidPreview.show(result.housingMesh, result.diffuserMesh);
    housingStl = meshToStl(result.housingMesh, 'housing');
    diffuserStl = meshToStl(result.diffuserMesh, 'diffuser');
    downloadHousing.disabled = false;
    downloadDiffuser.disabled = false;
    const prefix = label ? `${label}: ` : '';
    solidStatus.textContent = `${prefix}${result.centerlines.length} spezzoni · ${result.holes.anchors.length} ancoraggi · ${result.slots.length} asole · ${result.pockets.length} tasche`;
  } catch (err) {
    if (id !== runId) return;
    solidStatus.textContent = `Solido non generato: ${err instanceof Error ? err.message : String(err)}`;
  }
}

interface RasterSession {
  name: string;
  luminance: Uint8Array;
  width: number;
  height: number;
  warnings: string[];
}

type ImageLoad = { kind: 'svg'; markup: string; name: string } | ({ kind: 'raster' } & RasterSession);

let imageLoad: ImageLoad | null = null;
let imageError: string | null = null;

function sourceIsImage(): boolean {
  return form.querySelector<HTMLSelectElement>('select[name="sourceKind"]')!.value === 'image';
}

function traceMode(): TraceMode {
  return form.querySelector<HTMLSelectElement>('select[name="trace"]')!.value === 'outline' ? 'outline' : 'centerline';
}

function syncSourceFields(): void {
  const image = sourceIsImage();
  const raster = image && imageLoad?.kind === 'raster';
  const loaded = image && imageLoad != null;
  for (const el of form.querySelectorAll<HTMLElement>('[data-source]')) {
    const slot = el.dataset.source;
    const show =
      (slot === 'text' && !image) ||
      (slot === 'image' && image) ||
      (slot === 'trace' && loaded) ||
      (slot === 'raster' && raster) ||
      (slot === 'px' && !raster);
    el.hidden = !show;
  }
  const heightLabel = document.querySelector('#height-label');
  if (heightLabel) heightLabel.textContent = image ? 'Altezza (mm)' : 'Altezza maiuscole (mm)';
  const caption = document.querySelector('#coverage caption');
  if (caption) caption.textContent = image ? 'Copertura per regione' : 'Copertura per lettera';
}

function geometryOrder(
  source: OrderSource,
  heightMm: number,
  params: SignOrderV4['params'],
): SignOrderV4 {
  return {
    schemaVersion: ORDER_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    pricingVersion: null,
    source,
    heightMm,
    sizePreset: null,
    color: '#9aa3ad',
    params,
    paths: null,
    crossings: [],
    customer: { ...DEFAULT_CUSTOMER },
    plate: null,
  };
}

function textOrder(input: RasterizeInput, cuspMode: CuspMode, iDotMode: IDotMode): SignOrderV4 {
  return geometryOrder(
    { kind: 'text', text: input.text, fontId: input.fontId },
    input.heightMm,
    { CUSP_MODE: cuspMode, I_DOT_MODE: iDotMode },
  );
}

let runId = 0;
async function run(): Promise<void> {
  const id = ++runId;
  syncSourceFields();
  const { input, zoom, showGraph, cuspMode, iDotMode } = readInput();
  const image = sourceIsImage();
  try {
    let fromWorker: TextRaster;
    let graph: SkeletonGraph;
    let pairing: TubePairing | null;
    let strip: StripModel;
    let graphMs: number;
    let same: boolean;
    let order: SignOrderV4;
    let extraWarnings: string[] = [];
    let solidLabel = '';
    if (image) {
      if (imageError || !imageLoad) {
        downloadHousing.disabled = true;
        downloadDiffuser.disabled = true;
        housingStl = null;
        diffuserStl = null;
        const message = imageError ?? 'Carica un file SVG, PNG o JPG.';
        solidStatus.textContent = message;
        showWarnings([message], Boolean(imageError));
        return;
      }
      let source: SvgImageSource | RasterImageSource;
      if (imageLoad.kind === 'svg') {
        try {
          const imported = importSvg(imageLoad.markup, { heightMm: input.heightMm, name: imageLoad.name, trace: traceMode() });
          source = imported.source;
          extraWarnings = imported.warnings;
        } catch (err) {
          if (id !== runId) return;
          downloadHousing.disabled = true;
          downloadDiffuser.disabled = true;
          const message = err instanceof Error ? err.message : String(err);
          solidStatus.textContent = message;
          showWarnings([message], true);
          canvas.dataset.ok = 'false';
          return;
        }
      } else {
        const built = rebuildRaster(imageLoad.luminance, imageLoad.width, imageLoad.height, {
          name: imageLoad.name,
          threshold: Number(form.querySelector<HTMLInputElement>('input[name="threshold"]')!.value),
          invert: form.querySelector<HTMLInputElement>('input[name="invert"]')!.checked,
          trace: traceMode(),
        });
        if (!built) {
          if (id !== runId) return;
          downloadHousing.disabled = true;
          downloadDiffuser.disabled = true;
          const message = 'Nessun pixel di inchiostro con questa soglia.';
          solidStatus.textContent = message;
          showWarnings([message], true);
          canvas.dataset.ok = 'false';
          return;
        }
        paintThresholdPreview(document.querySelector<HTMLCanvasElement>('#threshold-preview')!, built.binary);
        source = built.source;
        extraWarnings = imageLoad.warnings;
      }
      order = geometryOrder(source, input.heightMm, { CUSP_MODE: cuspMode, I_DOT_MODE: iDotMode });
      solidLabel = imageLoad.name;
      const local = source.format === 'svg' ? layoutSvg(source, input.heightMm, input.pxPerMm) : layoutRaster(source, input.heightMm);
      const remote =
        source.format === 'svg'
          ? await generator.svgLayout(source, input.heightMm, input.pxPerMm, { cuspMode, iDotMode })
          : await generator.rasterLayout(source, input.heightMm, { cuspMode, iDotMode });
      if (id !== runId) return;
      fromWorker = remote.raster;
      graph = remote.graph;
      pairing = remote.pairing;
      strip = remote.strip;
      graphMs = remote.graphMs;
      same =
        remote.raster.width === local.raster.width &&
        remote.raster.height === local.raster.height &&
        remote.raster.data.every((v, i) => v === local.raster.data[i]);
    } else {
      const [remote, fromMain] = await Promise.all([
        generator.skeletonGraph(input, { cuspMode, iDotMode }),
        rasterize(input),
      ]);
      fromWorker = remote.raster;
      graph = remote.graph;
      pairing = remote.pairing;
      strip = remote.strip;
      graphMs = remote.graphMs;
      same =
        fromWorker.width === fromMain.width &&
        fromWorker.height === fromMain.height &&
        fromWorker.data.every((v, i) => v === fromMain.data[i]);
      order = textOrder(input, cuspMode, iDotMode);
    }
    if (id !== runId) return;
    const showPairing = showGraph ? pairing : null;
    const coverage = coverSign({
      glyphs: fromWorker.glyphs,
      paths: strip.paths,
      gaps: strip.gaps,
      excluded: strip.excluded,
      walls: unpairedWalls(graph.edges, pairing),
      corners: strip.bom.corners,
      params: DEFAULT_PARAMS,
      heightMm: input.heightMm,
    });
    draw(fromWorker, zoom, showGraph ? graph : null, showPairing, strip, coverage);
    showCoverage(coverage);
    legend.innerHTML = `${showPairing ? TUBE_LEGEND : SOLID_LEGEND} ${SEGMENT_LEGEND}`;
    showMeasures(fromWorker, same, [...graphRows(graph, graphMs), ...pairingRows(pairing), ...stripRows(strip)]);
    showWarnings([...extraWarnings, ...fromWorker.warnings, ...(pairing?.warnings ?? [])]);
    showHeight(strip);
    showIssues(strip.issues);
    showBom(strip.bom);
    canvas.dataset.nodes = String(graph.nodes.length);
    canvas.dataset.edges = String(graph.edges.length);
    if (pairing) {
      canvas.dataset.pairs = String(pairing.pairs.length);
      canvas.dataset.singles = String(pairing.singles.length);
      canvas.dataset.dubious = String(pairing.dubious.length);
    } else {
      delete canvas.dataset.pairs;
      delete canvas.dataset.singles;
      delete canvas.dataset.dubious;
    }
    canvas.dataset.ok = String(same);
    void previewSolid(id, order, solidLabel);
  } catch (err) {
    if (id !== runId) return;
    showWarnings([`Errore: ${String(err)}`], true);
    clearStrip();
    canvas.dataset.ok = 'false';
    console.error(err);
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  void run();
});
form.addEventListener('change', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && (target.name === 'image' || target.name === 'threshold')) return;
  void run();
});
const thresholdInput = form.querySelector<HTMLInputElement>('input[name="threshold"]')!;
const thresholdValue = document.querySelector<HTMLElement>('#threshold-value')!;
let thresholdTimer = 0;
thresholdInput.addEventListener('input', () => {
  thresholdValue.textContent = thresholdInput.value;
  if (imageLoad?.kind === 'raster') {
    const built = rebuildRaster(imageLoad.luminance, imageLoad.width, imageLoad.height, {
      name: imageLoad.name,
      threshold: Number(thresholdInput.value),
      invert: form.querySelector<HTMLInputElement>('input[name="invert"]')!.checked,
      trace: traceMode(),
    });
    if (built) paintThresholdPreview(document.querySelector<HTMLCanvasElement>('#threshold-preview')!, built.binary);
  }
  window.clearTimeout(thresholdTimer);
  thresholdTimer = window.setTimeout(() => void run(), 300);
});
form.querySelector<HTMLInputElement>('input[name="image"]')!.addEventListener('change', () => {
  const input = form.querySelector<HTMLInputElement>('input[name="image"]')!;
  const file = input.files?.[0];
  if (!file) return;
  void loadDebugImage(file);
});
issuesList.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('button[data-x]');
  if (!(button instanceof HTMLButtonElement)) return;
  const x = Number(button.dataset.x);
  const y = Number(button.dataset.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  focusIssue(x, y);
});

function isSvgFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith('.svg') || file.type === 'image/svg+xml';
}

function isRasterFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith('.png') ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    file.type === 'image/png' ||
    file.type === 'image/jpeg'
  );
}

async function loadDebugImage(file: File): Promise<void> {
  imageLoad = null;
  if (file.size > IMAGE_MAX_BYTES) {
    imageError = 'Il file supera 10 MB.';
    void run();
    return;
  }
  if (isSvgFile(file)) {
    imageLoad = { kind: 'svg', markup: await file.text(), name: file.name || 'immagine.svg' };
    imageError = null;
    void run();
    return;
  }
  if (!isRasterFile(file)) {
    imageError = 'Carica un file SVG, PNG o JPG.';
    void run();
    return;
  }
  try {
    const imported = await importRaster(file, { name: file.name || 'immagine' });
    imageLoad = {
      kind: 'raster',
      name: imported.source.name,
      luminance: imported.luminance,
      width: imported.width,
      height: imported.height,
      warnings: imported.warnings,
    };
    imageError = null;
    const threshold = form.querySelector<HTMLInputElement>('input[name="threshold"]')!;
    threshold.value = String(imported.source.threshold);
    const label = document.querySelector<HTMLElement>('#threshold-value');
    if (label) label.textContent = threshold.value;
    form.querySelector<HTMLInputElement>('input[name="invert"]')!.checked = imported.source.invert;
    void run();
  } catch (err) {
    imageError = err instanceof Error ? err.message : String(err);
    void run();
  }
}

void run();

async function checkManifold(): Promise<void> {
  const [main, worker] = await Promise.all([cubeCounts(), generator.cubeVertexCount()]);
  const ok = main.vertices === 8 && main.triangles === 12 && worker === 8;
  const msg = ok
    ? `vertici: ${main.vertices}, triangoli: ${main.triangles}`
    : `manifold-3d: errore — vertici ${main.vertices}/${worker}, triangoli ${main.triangles}`;
  manifoldOut.textContent = msg;
  manifoldOut.dataset.ok = String(ok);
  console.info(msg);
}

document.querySelector<HTMLButtonElement>('#manifold-test')!.addEventListener('click', () => {
  void checkManifold();
});

checkManifold().catch((err: unknown) => {
  manifoldOut.textContent = `manifold-3d: errore — ${String(err)}`;
  manifoldOut.dataset.ok = 'false';
  console.error(err);
});
