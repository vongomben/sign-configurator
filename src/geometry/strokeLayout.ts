// Testo in un font a tratto singolo → polilinee in mm e grafo [C]. Niente [A] né [B].
import { getFont, type FontEntry } from '../fonts/registry';
import type { FontBytesReader } from '../fonts/loadFont';
import { fetchFontBytes } from '../fonts/loadFont';
import { kerningOf, parseStrokeFont, strokeTop, type StrokeFont, type StrokePath } from '../fonts/strokeFont';
import { graphFromStrokes } from './strokeGraph';
import type { SkeletonGraph } from './graph';
import type { GlyphInfo, Point, RasterizeInput, TextRaster } from './rasterize';

const PX_PER_MM = 10;
const MARGIN_PX = 5;

const cache = new Map<string, Promise<StrokeFont>>();

export function loadStrokeFont(id: string, read: FontBytesReader = fetchFontBytes): Promise<StrokeFont> {
  let font = cache.get(id);
  if (!font) {
    const entry = getFont(id);
    if (!entry || entry.kind !== 'stroke') return Promise.reject(new Error(`Font a tratto singolo sconosciuto: "${id}"`));
    font = read(entry.file).then((bytes) => parseStrokeFont(new TextDecoder().decode(bytes)));
    font.catch(() => cache.delete(id));
    cache.set(id, font);
  }
  return font;
}

const describeChar = (ch: string): string =>
  `"${ch}" (U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`;

function bboxOf(points: readonly Point[]): GlyphInfo['bbox'] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/** Sommità di H e di x, in unità del font. Per compilare il registro. */
export function measureStrokeMetrics(font: StrokeFont): { capHeight: number | null; xHeight: number | null } {
  return { capHeight: strokeTop(font, 'H') ?? strokeTop(font, 'I'), xHeight: strokeTop(font, 'x') };
}

export interface StrokeLayout {
  raster: TextRaster;
  graph: SkeletonGraph;
}

export async function layoutStroke(
  entry: FontEntry,
  input: Omit<RasterizeInput, 'fontId'>,
  read: FontBytesReader = fetchFontBytes,
): Promise<StrokeLayout> {
  const font = await loadStrokeFont(entry.id, read);
  const warnings: string[] = [];
  let text = input.text;
  if (/[\r\n]/.test(text)) {
    text = text.replace(/\r\n|[\r\n]/g, ' ');
    warnings.push('Il testo va su una sola riga: gli a capo sono diventati spazi.');
  }
  const missing = [...new Set([...text].filter((ch) => !/\s/.test(ch) && !font.glyphs.has(ch)))];
  for (const ch of missing) warnings.push(`Carattere ${describeChar(ch)} non presente in ${entry.name}: ignorato.`);

  const mmPerUnit = input.heightMm / entry.capHeightMeasured;
  const space = font.glyphs.get(' ');
  const spaceAdvance = (space?.advance || font.defaultAdvance) * mmPerUnit;
  const placed: StrokePath[] = [];
  const glyphs: GlyphInfo[] = [];
  let pen = 0;
  let prev = '';
  let glyphIndex = 0;
  for (const ch of text) {
    if (/\s/.test(ch)) {
      pen += spaceAdvance;
      prev = ch;
      continue;
    }
    const glyph = font.glyphs.get(ch);
    if (!glyph) continue;
    pen -= kerningOf(font, prev, ch) * mmPerUnit;
    const own: Point[] = [];
    for (const stroke of glyph.strokes) {
      const points = stroke.points.map((p): Point => [pen + p[0] * mmPerUnit, p[1] * mmPerUnit]);
      if (points.length >= 2) {
        placed.push({ points, closed: stroke.closed });
        own.push(...points);
      }
    }
    glyphs.push({ glyphIndex: glyphIndex++, char: ch, x: pen, bbox: bboxOf(own) });
    pen += glyph.advance * mmPerUnit;
    prev = ch;
  }

  const flat = placed.flatMap((stroke) => stroke.points);
  const box = bboxOf(flat);
  const pxPerMm = input.pxPerMm ?? PX_PER_MM;
  const margin = MARGIN_PX;
  const minX = box?.minX ?? 0;
  const minY = box?.minY ?? 0;
  const maxX = box?.maxX ?? 1;
  const maxY = box?.maxY ?? 1;
  const width = Math.max(1, Math.ceil((maxX - minX) * pxPerMm) + margin * 2);
  const height = Math.max(1, Math.ceil((maxY - minY) * pxPerMm) + margin * 2);
  const graph = graphFromStrokes(placed);
  graph.skeleton = new Uint8Array(width * height);

  return {
    graph,
    raster: {
      data: new Uint8Array(width * height),
      width,
      height,
      pxPerMm,
      pxToMm: { mmPerPx: 1 / pxPerMm, originX: minX - margin / pxPerMm, originY: maxY + margin / pxPerMm },
      warnings,
      text,
      fontSizeMm: font.unitsPerEm * mmPerUnit,
      capHeightMm: input.heightMm,
      xHeightMm: entry.xHeightMeasured * mmPerUnit,
      bbox: box,
      advanceMm: pen,
      glyphs,
      missing,
      hollowTubes: false,
      tube: null,
      stripMode: entry.stripMode,
      strokes: placed.map((stroke) => stroke.points),
    },
  };
}
