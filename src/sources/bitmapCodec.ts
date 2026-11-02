// Bitmap binaria nell'ordine (SPEC §4bis): RLE, soglia, ritaglio, layout puro.
// Nessun DOM. La decodifica del file sta in rasterImport.ts, una volta sola nel main thread.
import { buildGraph, strokeWidthCv } from '../geometry/graph';
import { RASTER_MARGIN_PX, type Point, type Raster, type TextRaster } from '../geometry/rasterize';
import { graphFromStrokes } from '../geometry/strokeGraph';
import type { RasterImageSource, TraceMode } from '../order/schema';
import { outlinePolylines } from './contours';
import { regionsOf, UNEVEN_STROKE_WARNING, type SvgLayout } from './svgPaths';

/** Sotto questa risoluzione lo scheletro [B] non è affidabile (SPEC §4bis). */
export const MIN_BITMAP_PX_PER_MM = 8;

export interface CroppedBitmap {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface LuminanceOptions {
  name: string;
  threshold: number;
  invert: boolean;
  trace: TraceMode;
}

/** Soglia di Otsu sul campione di luminanza. I pixel scuri sono la classe `≤ soglia`. */
export function otsuThreshold(samples: Uint8Array): number {
  const hist = new Uint32Array(256);
  for (const value of samples) hist[value]!++;
  const total = samples.length;
  if (total === 0) return 0;
  let sum = 0;
  for (let tone = 0; tone < 256; tone++) sum += tone * hist[tone]!;
  let sumBackground = 0;
  let weightBackground = 0;
  let best = -1;
  let plateauStart = 0;
  let plateauEnd = 0;
  for (let tone = 0; tone < 256; tone++) {
    weightBackground += hist[tone]!;
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;
    sumBackground += tone * hist[tone]!;
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const between = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (between > best) {
      best = between;
      plateauStart = tone;
      plateauEnd = tone;
    } else if (between === best) {
      plateauEnd = tone;
    }
  }
  return Math.round((plateauStart + plateauEnd) / 2);
}

/** 1 = inchiostro. Senza `invert` l'inchiostro è la luminanza `≤ threshold`. */
export function applyThreshold(luminance: Uint8Array, threshold: number, invert: boolean): Uint8Array {
  const tone = Math.min(255, Math.max(0, Math.round(threshold)));
  const out = new Uint8Array(luminance.length);
  for (let i = 0; i < luminance.length; i++) {
    const dark = luminance[i]! <= tone;
    out[i] = dark !== invert ? 1 : 0;
  }
  return out;
}

/** Riquadro dei pixel a 1. `null` se non c'è inchiostro. Le righe restano dall'alto. */
export function cropInk(data: Uint8Array, width: number, height: number): CroppedBitmap | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!data[row + x]) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const croppedWidth = maxX - minX + 1;
  const croppedHeight = maxY - minY + 1;
  const out = new Uint8Array(croppedWidth * croppedHeight);
  for (let y = 0; y < croppedHeight; y++) {
    out.set(data.subarray((y + minY) * width + minX, (y + minY) * width + maxX + 1), y * croppedWidth);
  }
  return { data: out, width: croppedWidth, height: croppedHeight };
}

/** Soglia, ritaglio e RLE. `null` se la soglia non lascia inchiostro. */
export function bitmapFromLuminance(
  luminance: Uint8Array,
  width: number,
  height: number,
  options: LuminanceOptions,
): { source: RasterImageSource; binary: CroppedBitmap } | null {
  if (luminance.length < width * height) throw new Error('Luminanza più corta delle dimensioni.');
  const cropped = cropInk(applyThreshold(luminance, options.threshold, options.invert), width, height);
  if (!cropped) return null;
  return {
    binary: cropped,
    source: {
      kind: 'image',
      format: 'raster',
      name: options.name,
      trace: options.trace,
      threshold: Math.min(255, Math.max(0, Math.round(options.threshold))),
      invert: options.invert,
      bitmap: { width: cropped.width, height: cropped.height, rle: encodeRle(cropped.data, cropped.width, cropped.height) },
    },
  };
}

/**
 * Righe dall'alto, sequenze alternate che iniziano da 0 (lo sfondo).
 * Se il primo pixel è inchiostro, la prima lunghezza è 0. Lunghezze in LEB128, poi base64.
 */
export function encodeRle(data: Uint8Array, width: number, height: number): string {
  const count = width * height;
  if (!(width > 0) || !(height > 0) || data.length < count) throw new Error('Bitmap non valida.');
  const bytes: number[] = [];
  let index = 0;
  let value = 0;
  while (index < count) {
    let run = 0;
    while (index < count && (data[index]! ? 1 : 0) === value) {
      run++;
      index++;
    }
    writeVarint(run, bytes);
    value = 1 - value;
  }
  return toBase64(Uint8Array.from(bytes));
}

/** Inverso di `encodeRle`: stessi byte, 0 o 1. */
export function decodeRle(rle: string, width: number, height: number): Uint8Array {
  const count = width * height;
  if (!(width > 0) || !(height > 0)) throw new Error('Bitmap non valida.');
  const bytes = fromBase64(rle);
  const out = new Uint8Array(count);
  let offset = 0;
  let cursor = 0;
  let value = 0;
  while (offset < count) {
    if (cursor >= bytes.length) throw new Error('RLE troncato.');
    const read = readVarint(bytes, cursor);
    cursor = read.next;
    const end = offset + read.value;
    if (end > count) throw new Error('RLE più lungo della bitmap.');
    if (value === 1) out.fill(1, offset, end);
    offset = end;
    value = 1 - value;
  }
  return out;
}

/** `null` se l'altezza in pixel basta per almeno 8 px/mm. */
export function lowResolutionWarning(heightPx: number, heightMm: number): string | null {
  if (!(heightMm > 0) || !(heightPx > 0)) return null;
  if (heightPx / heightMm >= MIN_BITMAP_PX_PER_MM - 1e-9) return null;
  const maxMm = heightPx / MIN_BITMAP_PX_PER_MM;
  const rounded = Math.round(maxMm * 10) / 10;
  const text = Math.abs(rounded - Math.round(rounded)) < 1e-9 ? String(Math.round(rounded)) : rounded.toFixed(1);
  return `Immagine a bassa risoluzione per questa altezza. Altezza massima ${text} mm.`;
}

/** Dall'ordine: margine di [A], `pxPerMm` = altezza px / `heightMm`, poi centerline o contorno. */
export function layoutRaster(source: RasterImageSource, heightMm: number): SvgLayout {
  if (!(heightMm > 0)) throw new Error('Altezza non valida.');
  const { width, height, rle } = source.bitmap;
  const ink = decodeRle(rle, width, height);
  let any = false;
  for (let i = 0; i < ink.length; i++) {
    if (ink[i]) {
      any = true;
      break;
    }
  }
  if (!any) throw new Error('La bitmap non ha inchiostro.');

  const margin = RASTER_MARGIN_PX;
  const paddedWidth = width + margin * 2;
  const paddedHeight = height + margin * 2;
  const data = new Uint8Array(paddedWidth * paddedHeight);
  for (let y = 0; y < height; y++) data.set(ink.subarray(y * width, y * width + width), (y + margin) * paddedWidth + margin);
  const pxPerMm = height / heightMm;
  const mmPerPx = heightMm / height;
  const rasterBase: Raster = {
    data,
    width: paddedWidth,
    height: paddedHeight,
    pxPerMm,
    pxToMm: { mmPerPx, originX: -margin * mmPerPx, originY: heightMm + margin * mmPerPx },
    warnings: [],
  };
  const low = lowResolutionWarning(height, heightMm);
  if (low) rasterBase.warnings.push(low);

  const outline = source.trace === 'outline';
  let graph = outline ? null : buildGraph(rasterBase);
  let strokes: Point[][] | null = null;
  if (outline) {
    const lines = outlinePolylines(rasterBase);
    if (lines.length === 0) throw new Error('Il disegno non produce percorsi.');
    graph = graphFromStrokes(lines.map((points) => ({ points, closed: true })));
    strokes = lines;
  }
  if (!graph || graph.edges.length === 0) {
    throw new Error(
      outline
        ? 'Il disegno non produce percorsi.'
        : 'La linea centrale non resta: il tratto non è uniforme e la traccia Contorno non è ancora disponibile.',
    );
  }
  if (!outline && strokeWidthCv(rasterBase.data, graph.skeleton, rasterBase.width, rasterBase.height) > 0.35) {
    rasterBase.warnings.push(UNEVEN_STROKE_WARNING);
  }

  const raster: TextRaster = {
    ...rasterBase,
    warnings: [...rasterBase.warnings],
    text: source.name,
    fontSizeMm: heightMm,
    capHeightMm: heightMm,
    xHeightMm: 0,
    bbox: { minX: 0, minY: 0, maxX: width * mmPerPx, maxY: heightMm },
    advanceMm: width * mmPerPx,
    glyphs: regionsOf(graph),
    missing: [],
    hollowTubes: false,
    tube: null,
    stripMode: outline ? 'walls' : 'centerline',
    strokes,
  };
  return { raster, graph };
}

function writeVarint(value: number, out: number[]): void {
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
}

function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let factor = 1;
  let cursor = offset;
  for (;;) {
    if (cursor >= bytes.length) throw new Error('Varint troncato.');
    const byte = bytes[cursor]!;
    cursor++;
    value += (byte & 0x7f) * factor;
    if ((byte & 0x80) === 0) return { value, next: cursor };
    factor *= 128;
    if (factor > 2 ** 28) throw new Error('Varint troppo lungo.');
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
