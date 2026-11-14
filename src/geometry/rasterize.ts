// [A] Rasterizzazione (SPEC §5): path del testo da opentype.js → poligoni → bitmap binaria.
// Modulo puro, senza DOM né canvas: scanline scritta a mano, regole nonzero ed evenodd, un campione
// al centro di ogni pixel, nessun antialiasing. Stesso input → stessi byte, in browser, worker e Node.
import type { Font, PathCommand } from 'opentype.js';
import { getFont, type FontEntry, type StripMode } from '../fonts/registry';
import { loadFont, type FontBytesReader } from '../fonts/loadFont';
import { layoutStroke } from './strokeLayout';
export const DEFAULT_PX_PER_MM = 10;
export const FLATTEN_TOLERANCE_MM = 0.02;
export const RASTER_MARGIN_PX = 5;
export const MAX_RASTER_PIXELS = 40_000_000;

/** Punto in mm, Y verso l'alto (piano dell'insegna, SPEC §1). */
export type Point = [number, number];
/** Contorno chiuso implicitamente. */
export type Contour = Point[];

export interface BBoxMm {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Trasformazione px → mm. Coordinate pixel continue: la colonna i copre [i, i+1), la riga j copre
 * [j, j+1), con le righe che scendono. xMm = originX + px·mmPerPx, yMm = originY − py·mmPerPx.
 */
export interface PxToMm {
  mmPerPx: number;
  originX: number;
  originY: number;
}

export interface Raster {
  /** 1 = pieno, 0 = vuoto; riga per riga dall'alto, `width` byte per riga. */
  data: Uint8Array;
  width: number;
  height: number;
  /** Risoluzione effettiva (ridotta se si supera MAX_RASTER_PIXELS). */
  pxPerMm: number;
  pxToMm: PxToMm;
  warnings: string[];
}

export interface GlyphInfo {
  glyphIndex: number;
  /** Carattere del glifo, se il font lo dichiara (le legature possono non averlo). */
  char: string | null;
  /** Origine del glifo sulla linea di base, in mm. */
  x: number;
  bbox: BBoxMm | null;
}

/** Misure del tubo (registro) alla scala del testo, per l'accoppiamento delle linee in [B]/[C]. */
export interface TubeMm {
  lineWidthMm: number;
  gapMm: number;
}

export interface TextRaster extends Raster {
  text: string;
  fontSizeMm: number;
  /** = altezza richiesta: sommità misurata del glifo "H" (registro, capHeightMeasured). */
  capHeightMm: number;
  /** Sommità misurata del glifo "x". */
  xHeightMm: number;
  /** Ingombro reale dell'inchiostro (dai contorni), mm, Y in su, linea di base a y = 0. */
  bbox: BBoxMm | null;
  /** Avanzamento totale (con kerning), mm. */
  advanceMm: number;
  glyphs: GlyphInfo[];
  /** Caratteri senza glifo nel font, ignorati. */
  missing: string[];
  /** Font a tubi cavi: la bitmap ha due linee per tubo e la luce non si riempie. */
  hollowTubes: boolean;
  tube: TubeMm | null;
  /** centerline: lo scheletro è la striscia. walls: ogni parete del tubo è una striscia. */
  stripMode: StripMode;
  /** Tratto singolo: le linee del font, al posto della bitmap. `null` per i font a contorno. */
  strokes: Point[][] | null;
}

export interface RasterizeInput {
  text: string;
  fontId: string;
  heightMm: number;
  pxPerMm?: number;
}

export interface RasterOptions {
  pxPerMm?: number;
  marginPx?: number;
  maxPixels?: number;
  /** Default `nonzero`. Le aree SVG possono chiedere `evenodd` (SPEC §4bis). */
  fillRule?: 'nonzero' | 'evenodd';
  /** Allarga la griglia oltre i contorni, per esempio per i tratti accanto alle aree. */
  bounds?: BBoxMm;
}

/** Un gruppo di contorni con la propria regola di riempimento. Più gruppi si uniscono in OR. */
export interface ContourLayer {
  contours: readonly Contour[];
  fillRule?: 'nonzero' | 'evenodd';
}

export function pxToMm(t: PxToMm, px: number, py: number): Point {
  return [t.originX + px * t.mmPerPx, t.originY - py * t.mmPerPx];
}

export function mmToPx(t: PxToMm, x: number, y: number): Point {
  return [(x - t.originX) / t.mmPerPx, (t.originY - y) / t.mmPerPx];
}

// ---------------------------------------------------------------- appiattimento

/**
 * Numero di segmenti per una curva con |B''| ≤ m: l'errore della spezzata uniforme è ≤ m / (8n²).
 */
const segmentsFor = (m: number, tol: number): number => Math.max(1, Math.ceil(Math.sqrt(m / (8 * tol))));

/** Path opentype.js → contorni, con le curve appiattite entro `tol` (nelle unità di `map`). */
export function flattenCommands(
  commands: readonly PathCommand[],
  tol = FLATTEN_TOLERANCE_MM,
  map: (x: number, y: number) => Point = (x, y) => [x, y],
): Contour[] {
  const contours: Contour[] = [];
  let current: Contour = [];
  let start: Point = [0, 0];
  let pen: Point = [0, 0];

  const push = (p: Point): void => {
    const last = current[current.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) current.push(p);
  };
  const close = (): void => {
    const first = current[0];
    const last = current[current.length - 1];
    if (first && last && current.length > 1 && first[0] === last[0] && first[1] === last[1]) current.pop();
    if (current.length >= 3) contours.push(current);
    current = [];
  };

  for (const c of commands) {
    switch (c.type) {
      case 'M':
        close();
        pen = start = map(c.x, c.y);
        push(pen);
        break;
      case 'L':
        pen = map(c.x, c.y);
        push(pen);
        break;
      case 'Q': {
        const p0 = pen;
        const p1 = map(c.x1, c.y1);
        const p2 = map(c.x, c.y);
        const n = segmentsFor(2 * Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]), tol);
        for (let k = 1; k <= n; k++) {
          const t = k / n;
          const u = 1 - t;
          push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
        }
        pen = p2;
        break;
      }
      case 'C': {
        const p0 = pen;
        const p1 = map(c.x1, c.y1);
        const p2 = map(c.x2, c.y2);
        const p3 = map(c.x, c.y);
        const d1 = Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]);
        const d2 = Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1]);
        const n = segmentsFor(6 * Math.max(d1, d2), tol);
        for (let k = 1; k <= n; k++) {
          const t = k / n;
          const u = 1 - t;
          const a = u * u * u;
          const b = 3 * u * u * t;
          const cc = 3 * u * t * t;
          const d = t * t * t;
          push([
            a * p0[0] + b * p1[0] + cc * p2[0] + d * p3[0],
            a * p0[1] + b * p1[1] + cc * p2[1] + d * p3[1],
          ]);
        }
        pen = p3;
        break;
      }
      case 'Z':
        close();
        pen = start;
        break;
    }
  }
  close();
  return contours;
}

export function contoursBBox(contours: readonly Contour[]): BBoxMm | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of contours) {
    for (const [x, y] of c) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}

// ---------------------------------------------------------------- riempimento

interface Edge {
  /** Riga del primo e dell'ultimo centro pixel attraversato. */
  rowStart: number;
  rowEnd: number;
  /** x (px) all'altezza del centro della prima riga, e incremento per riga. */
  x: number;
  dxPerRow: number;
  winding: 1 | -1;
}

function unionBox(a: BBoxMm | null, b: BBoxMm | null): BBoxMm | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Contorni in mm → bitmap binaria. `fillRule` di default è nonzero. I pixel si campionano al centro. */
export function rasterizeContours(contours: readonly Contour[], options: RasterOptions = {}): Raster {
  const layer: ContourLayer = { contours };
  if (options.fillRule) layer.fillRule = options.fillRule;
  return rasterizeContourGroups([layer], options);
}

/**
 * Più gruppi di contorni, ognuno con la sua regola, sulla stessa griglia. L'inchiostro si unisce:
 * un gruppo non cancella i pixel già pieni.
 */
export function rasterizeContourGroups(layers: readonly ContourLayer[], options: RasterOptions = {}): Raster {
  const margin = options.marginPx ?? RASTER_MARGIN_PX;
  const maxPixels = options.maxPixels ?? MAX_RASTER_PIXELS;
  const requested = options.pxPerMm ?? DEFAULT_PX_PER_MM;
  const warnings: string[] = [];
  let box: BBoxMm | null = options.bounds ?? null;
  for (const layer of layers) box = unionBox(box, contoursBBox(layer.contours));
  box ??= { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  // Griglia allineata all'origine in mm: la linea di base (y = 0) cade su un bordo di pixel.
  let res = requested;
  let ix0 = 0;
  let iy1 = 0;
  let width = 0;
  let height = 0;
  for (;;) {
    ix0 = Math.floor(box.minX * res);
    iy1 = Math.ceil(box.maxY * res);
    width = Math.ceil(box.maxX * res) - ix0 + 2 * margin;
    height = iy1 - Math.floor(box.minY * res) + 2 * margin;
    if (width * height <= maxPixels) break;
    res *= Math.sqrt(maxPixels / (width * height)) * 0.999;
  }
  if (res !== requested) {
    warnings.push(
      `Bitmap oltre ${(maxPixels / 1e6).toFixed(0)} Mpx: risoluzione ridotta da ${requested} a ` +
        `${res.toFixed(3)} px/mm (${width} × ${height} px).`,
    );
  }

  const offX = ix0 - margin;
  const offY = iy1 + margin;
  const data = new Uint8Array(width * height);
  for (const layer of layers) {
    paintLayer(data, width, height, layer.contours, res, offX, offY, layer.fillRule ?? 'nonzero');
  }

  return {
    data,
    width,
    height,
    pxPerMm: res,
    pxToMm: { mmPerPx: 1 / res, originX: offX / res, originY: offY / res },
    warnings,
  };
}

/** Scrive 1 sui pixel interni. Non azzera il resto: più chiamate sulla stessa bitmap si uniscono. */
function paintLayer(
  data: Uint8Array,
  width: number,
  height: number,
  contours: readonly Contour[],
  res: number,
  offX: number,
  offY: number,
  fillRule: 'nonzero' | 'evenodd',
): void {
  const edges: Edge[] = [];
  for (const contour of contours) {
    const n = contour.length;
    for (let i = 0; i < n; i++) {
      const a = contour[i]!;
      const b = contour[(i + 1) % n]!;
      const ax = a[0] * res - offX;
      const ay = offY - a[1] * res;
      const bx = b[0] * res - offX;
      const by = offY - b[1] * res;
      if (ay === by) continue;
      const [tx, ty, bx2, by2] = ay < by ? [ax, ay, bx, by] : [bx, by, ax, ay];
      // Righe il cui centro cy = j + 0.5 sta in [ty, by2): estremi semiaperti, nessun doppio conteggio.
      const rowStart = Math.max(0, Math.ceil(ty - 0.5));
      const rowEnd = Math.min(height - 1, Math.ceil(by2 - 0.5) - 1);
      if (rowStart > rowEnd) continue;
      const slope = (bx2 - tx) / (by2 - ty);
      edges.push({
        rowStart,
        rowEnd,
        x: tx + (rowStart + 0.5 - ty) * slope,
        dxPerRow: slope,
        winding: by > ay ? 1 : -1,
      });
    }
  }
  edges.sort((e, f) => e.rowStart - f.rowStart);

  const evenodd = fillRule === 'evenodd';
  let active: Edge[] = [];
  let next = 0;
  const xs: number[] = [];
  const ws: number[] = [];
  const order: number[] = [];
  for (let row = 0; row < height; row++) {
    while (next < edges.length && edges[next]!.rowStart === row) active.push(edges[next++]!);
    if (active.length === 0) {
      if (next >= edges.length) break;
      continue;
    }
    xs.length = ws.length = order.length = 0;
    for (const e of active) {
      xs.push(e.x + (row - e.rowStart) * e.dxPerRow);
      ws.push(e.winding);
      order.push(order.length);
    }
    order.sort((i, j) => xs[i]! - xs[j]! || ws[i]! - ws[j]!);

    let winding = 0;
    const base = row * width;
    for (let k = 0; k < order.length - 1; k++) {
      winding += ws[order[k]!]!;
      const inside = evenodd ? (winding & 1) !== 0 : winding !== 0;
      if (!inside) continue;
      // Pixel i pieno se il suo centro i + 0.5 sta in [xa, xb).
      const from = Math.max(0, Math.ceil(xs[order[k]!]! - 0.5));
      const to = Math.min(width, Math.ceil(xs[order[k + 1]!]! - 0.5));
      if (to > from) data.fill(1, base + from, base + to);
    }
    active = active.filter((e) => e.rowEnd > row);
  }
}

// ---------------------------------------------------------------- testo

const describeChar = (ch: string): string =>
  `"${ch}" (U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`;

/** Altezza del glifo di `ch` in unità font, se esiste. */
function glyphTop(font: Font, ch: string): number | null {
  if (!font.hasChar(ch)) return null;
  const bb = font.charToGlyph(ch).getBoundingBox();
  return bb.y2 > 0 ? bb.y2 : null;
}

/**
 * Misure reali dal contorno dei glifi, in unità font: sommità di "H" (ripiego "I") e di "x" sopra la
 * linea di base. Le metriche dichiarate (OS/2) dei font script sono spesso inaffidabili. Servono a
 * compilare il registro, una volta per font.
 */
export function measureFontMetrics(
  font: Font,
  heightGlyph = 'H',
): { capHeight: number | null; xHeight: number | null } {
  return { capHeight: glyphTop(font, heightGlyph) ?? glyphTop(font, 'I'), xHeight: glyphTop(font, 'x') };
}

/**
 * Testo su una riga → bitmap. `heightMm` è la sommità misurata della "H" (registro). La bitmap è
 * fedele al font: con `hollowTubes` contiene due linee per tubo. Con `stripMode` `"walls"`
 * ognuna diventa una striscia, senza accoppiarle in una mediana.
 */
export function rasterizeText(font: Font, entry: FontEntry, input: Omit<RasterizeInput, 'fontId'>): TextRaster {
  const fontName = entry.name;
  const warnings: string[] = [];
  let text = input.text;
  if (/[\r\n]/.test(text)) {
    text = text.replace(/\r\n|[\r\n]/g, ' ');
    warnings.push('Il testo va su una sola riga: gli a capo sono diventati spazi.');
  }

  const missing = [...new Set(Array.from(text).filter((ch) => !/\s/.test(ch) && !font.hasChar(ch)))];
  for (const ch of missing) warnings.push(`Carattere ${describeChar(ch)} non presente in ${fontName}: ignorato.`);

  const mmPerUnit = input.heightMm / entry.capHeightMeasured;
  const fontSizeMm = font.unitsPerEm * mmPerUnit;
  const flip = (x: number, y: number): Point => [x, -y];
  const options = { kerning: true, letterSpacing: 0 };

  const contours: Contour[] = [];
  const glyphs: GlyphInfo[] = [];
  const advanceMm = font.forEachGlyph(text, 0, 0, fontSizeMm, options, (glyph, gx, gy, size) => {
    if (glyph.index === 0) return; // .notdef: il carattere è già segnalato come mancante
    const own = flattenCommands(glyph.getPath(gx, gy, size, options, font).commands, FLATTEN_TOLERANCE_MM, flip);
    if (own.length === 0) return;
    contours.push(...own);
    glyphs.push({
      glyphIndex: glyph.index,
      char: glyph.unicode !== undefined ? String.fromCodePoint(glyph.unicode) : null,
      x: gx,
      bbox: contoursBBox(own),
    });
  });

  const raster = rasterizeContours(contours, input.pxPerMm !== undefined ? { pxPerMm: input.pxPerMm } : {});
  warnings.push(...raster.warnings);
  const tube = entry.tube
    ? { lineWidthMm: entry.tube.lineWidth * mmPerUnit, gapMm: entry.tube.gap * mmPerUnit }
    : null;

  return {
    ...raster,
    warnings,
    text,
    fontSizeMm,
    capHeightMm: input.heightMm,
    xHeightMm: entry.xHeightMeasured * mmPerUnit,
    bbox: contoursBBox(contours),
    advanceMm,
    glyphs,
    missing,
    hollowTubes: entry.hollowTubes,
    tube,
    stripMode: entry.stripMode,
    strokes: null,
  };
}

/** Comodità per main thread e worker: carica il font dal registro e rasterizza. I tratti singoli non hanno bitmap. */
export async function rasterize(input: RasterizeInput, read?: FontBytesReader): Promise<TextRaster> {
  const entry = getFont(input.fontId);
  if (!entry) throw new Error(`Font sconosciuto: "${input.fontId}"`);
  if (entry.kind === 'stroke') return (await layoutStroke(entry, input, read)).raster;
  const font = await loadFont(input.fontId, read);
  return rasterizeText(font, entry, input);
}
