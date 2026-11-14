import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadFont, type FontBytesReader } from '../src/fonts/loadFont';
import { FONTS, getFont, heightGlyphOf } from '../src/fonts/registry';
import {
  MAX_RASTER_PIXELS,
  RASTER_MARGIN_PX,
  measureFontMetrics,
  mmToPx,
  pxToMm,
  rasterize,
  rasterizeContours,
  type Contour,
  type Raster,
} from '../src/geometry/rasterize';
import { measureTubes } from '../src/geometry/tubes';

const readPublic: FontBytesReader = async (file) => {
  const b = await readFile(`public/${file}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

const FONT_IDS = FONTS.filter((font) => font.kind === 'outline').map((font) => font.id);
// I font CJK misurano l'altezza su 永 e non hanno maiuscole da controllare: queste prove sono latine.
const LATIN_IDS = FONTS.filter((font) => font.kind === 'outline' && (font.script ?? 'latin') === 'latin').map(
  (font) => font.id,
);
const TEXT = 'Ciao Torino';

const filled = (r: Raster): number => r.data.reduce((n, v) => n + v, 0);

/**
 * Componenti connesse dei pixel con valore `value` (8-connesse per il pieno, 4 per il vuoto),
 * contando solo quelle di almeno `minSize` pixel.
 */
function components(r: Raster, value: 0 | 1, minSize = 1): number {
  const { width: w, height: h, data } = r;
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const nbrs =
    value === 1
      ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
      : [[0, -1], [-1, 0], [1, 0], [0, 1]];
  let count = 0;
  for (let start = 0; start < w * h; start++) {
    if (data[start] !== value || seen[start]) continue;
    let size = 0;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const i = stack[--top]!;
      size++;
      const x = i % w;
      const y = (i - x) / w;
      for (const [dx, dy] of nbrs) {
        const nx = x + dx!;
        const ny = y + dy!;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (data[j] === value && !seen[j]) {
          seen[j] = 1;
          stack[top++] = j;
        }
      }
    }
    if (size >= minSize) count++;
  }
  return count;
}

/**
 * Regioni piene e buchi (il fondo esterno, connesso grazie al margine, non conta).
 * I buchi sotto 0.05 mm² sono fessure tra contorni quasi a contatto, senza rilevanza fisica.
 */
const topology = (r: Raster) => ({
  regions: components(r, 1),
  holes: components(r, 0, Math.ceil(0.05 * r.pxPerMm ** 2)) - 1,
});

/** Lettere disegnate come un unico tratto (più il puntino della i): vale per Sacramento,
 *  non per Neonderthaw, che imita i tubi al neon con interruzioni volute. */
const SINGLE_STROKE: Record<string, boolean> = { sacramento: true, neonderthaw: false };

function circle(cx: number, cy: number, radius: number, n: number, ccw: boolean): Contour {
  return Array.from({ length: n }, (_, k) => {
    const a = ((ccw ? 1 : -1) * 2 * Math.PI * k) / n;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)] as [number, number];
  });
}

describe('rasterizeContours (sintetici)', () => {
  it('rettangolo allineato: area esatta, margine vuoto di 5 px', () => {
    const r = rasterizeContours([[[0, 0], [30, 0], [30, 20], [0, 20]]]);
    expect(filled(r)).toBe(300 * 200);
    expect(r.width).toBe(300 + 2 * RASTER_MARGIN_PX);
    expect(r.height).toBe(200 + 2 * RASTER_MARGIN_PX);
    for (let i = 0; i < r.width; i++) {
      for (const row of [0, RASTER_MARGIN_PX - 1, r.height - RASTER_MARGIN_PX, r.height - 1]) {
        expect(r.data[row * r.width + i]).toBe(0);
      }
    }
  });

  it('rettangolo ruotato: area entro 1%', () => {
    const a = (17 * Math.PI) / 180;
    const rot = ([x, y]: [number, number]): [number, number] => [
      x * Math.cos(a) - y * Math.sin(a),
      x * Math.sin(a) + y * Math.cos(a),
    ];
    const r = rasterizeContours([[rot([0, 0]), rot([30, 0]), rot([30, 20]), rot([0, 20])]]);
    expect(Math.abs(filled(r) / 100 - 600) / 600).toBeLessThan(0.01);
  });

  it('anello (contorno interno opposto): area entro 1% e un buco', () => {
    const r = rasterizeContours([circle(0, 0, 10, 720, true), circle(0, 0, 6, 720, false)]);
    const expected = Math.PI * (10 * 10 - 6 * 6);
    expect(Math.abs(filled(r) / 100 - expected) / expected).toBeLessThan(0.01);
    expect(topology(r)).toEqual({ regions: 1, holes: 1 });
  });

  it('nonzero: contorni sovrapposti con lo stesso verso si uniscono', () => {
    const sq = (x: number, y: number): Contour => [[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10]];
    const r = rasterizeContours([sq(0, 0), sq(5, 5)]);
    expect(filled(r) / 100).toBe(175);
    expect(topology(r)).toEqual({ regions: 1, holes: 0 });
  });

  it('px→mm: il centro di un pixel pieno cade dentro la forma', () => {
    const r = rasterizeContours([[[2, -3], [12, -3], [12, 7], [2, 7]]]);
    const i = r.data.indexOf(1);
    const [x, y] = pxToMm(r.pxToMm, (i % r.width) + 0.5, Math.floor(i / r.width) + 0.5);
    expect(x).toBeCloseTo(2.05, 9);
    expect(y).toBeCloseTo(6.95, 9);
    const [px, py] = mmToPx(r.pxToMm, x, y);
    expect(px).toBeCloseTo((i % r.width) + 0.5, 9);
    expect(py).toBeCloseTo(Math.floor(i / r.width) + 0.5, 9);
  });

  it('oltre 40 Mpx la risoluzione si riduce, con avviso', () => {
    const r = rasterizeContours([[[0, 0], [1000, 0], [1000, 1000], [0, 1000]]]);
    expect(r.width * r.height).toBeLessThanOrEqual(MAX_RASTER_PIXELS);
    expect(r.pxPerMm).toBeLessThan(10);
    expect(r.warnings).toHaveLength(1);
  });
});

describe('registro dei font', () => {
  for (const fontId of FONT_IDS) {
    it(`${fontId}: capHeightMeasured e xHeightMeasured corrispondono ai glifi del TTF`, async () => {
      const entry = getFont(fontId)!;
      const m = measureFontMetrics(await loadFont(fontId, readPublic), heightGlyphOf(entry));
      expect(entry.capHeightMeasured).toBe(m.capHeight);
      expect(entry.xHeightMeasured).toBe(m.xHeight);
      expect(entry.hollowTubes === (entry.tube !== undefined)).toBe(true);
      expect(entry.stripMode).toBe(entry.hollowTubes ? 'walls' : 'centerline');
    });
  }

  it('neonderthaw: hollowTubes con linea e luce del registro coerenti con la misura sul TTF', async () => {
    const entry = getFont('neonderthaw')!;
    expect(entry.hollowTubes).toBe(true);
    const r = await rasterize(
      { text: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', fontId: 'neonderthaw', heightMm: 30, pxPerMm: 20 },
      readPublic,
    );
    expect(r.hollowTubes).toBe(true);
    expect(r.stripMode).toBe('walls');
    const m = measureTubes(r.data, r.width, r.height);
    const unitsPerPx = entry.capHeightMeasured / r.capHeightMm / r.pxPerMm;
    expect(m.lineWidthPx * unitsPerPx).toBeCloseTo(entry.tube!.lineWidth, -0.5);
    expect(Math.abs(m.gapPx * unitsPerPx - entry.tube!.gap) / entry.tube!.gap).toBeLessThan(0.1);
    expect(r.tube!.lineWidthMm).toBeCloseTo((entry.tube!.lineWidth * 30) / entry.capHeightMeasured, 9);
  }, 30_000);

  it('sacramento: tratto pieno, nessuna misura di tubo', async () => {
    expect(getFont('sacramento')!.hollowTubes).toBe(false);
    const r = await rasterize({ text: 'Ciao', fontId: 'sacramento', heightMm: 20 }, readPublic);
    expect(r.hollowTubes).toBe(false);
    expect(r.stripMode).toBe('centerline');
    expect(r.tube).toBeNull();
  });
});

describe('rasterize (testo)', () => {
  for (const fontId of LATIN_IDS) {
    it(`${fontId}: "${TEXT}", maiuscole all'altezza attesa entro ±1 px`, async () => {
      const heightMm = 50;
      const r = await rasterize({ text: TEXT, fontId, heightMm }, readPublic);
      const font = await loadFont(fontId, readPublic);
      const entry = getFont(fontId)!;
      const scale = heightMm / entry.capHeightMeasured;
      expect(r.capHeightMm).toBe(heightMm);
      expect(r.xHeightMm).toBeCloseTo(entry.xHeightMeasured * scale, 9);
      expect(r.warnings).toEqual([]);

      // L'altezza è la sommità reale della "H", e la x-height quella della "x".
      const hx = await rasterize({ text: 'Hx', fontId, heightMm }, readPublic);
      expect(hx.glyphs[0]!.bbox!.maxY).toBeCloseTo(heightMm, 2);
      expect(hx.glyphs[1]!.bbox!.maxY).toBeCloseTo(hx.xHeightMm, 2);
      const inkTop = pxToMm(hx.pxToMm, 0, Math.floor(hx.data.indexOf(1) / hx.width))[1];
      expect(Math.abs(inkTop - heightMm)).toBeLessThanOrEqual(hx.pxToMm.mmPerPx);

      const caps = r.glyphs.filter((g) => g.char === 'C' || g.char === 'T');
      expect(caps.map((g) => g.char)).toEqual(['C', 'T']);
      for (const g of caps) {
        // Il contorno del glifo è scalato in base all'altezza misurata...
        const unitsTop = font.charToGlyph(g.char!).getBoundingBox().y2;
        expect(g.bbox!.maxY).toBeCloseTo(unitsTop * scale, 1);
        // ...e la bitmap lo riproduce: la riga più alta con inchiostro nelle sue colonne.
        const [c0] = mmToPx(r.pxToMm, g.bbox!.minX, 0);
        const [c1] = mmToPx(r.pxToMm, g.bbox!.maxX, 0);
        let topRow = -1;
        for (let row = 0; row < r.height && topRow < 0; row++) {
          for (let col = Math.floor(c0); col < Math.ceil(c1); col++) {
            if (r.data[row * r.width + col]) {
              topRow = row;
              break;
            }
          }
        }
        const topMm = pxToMm(r.pxToMm, 0, topRow)[1];
        expect(Math.abs(topMm - g.bbox!.maxY)).toBeLessThanOrEqual(r.pxToMm.mmPerPx);
      }

      // La linea di base cade su un bordo di pixel; ingombro e larghezza sono esposti in mm.
      const baselineRow = mmToPx(r.pxToMm, 0, 0)[1];
      expect(baselineRow).toBeCloseTo(Math.round(baselineRow), 9);
      expect(r.bbox!.maxX - r.bbox!.minX).toBeGreaterThan(0);
      expect(r.advanceMm).toBeGreaterThan(0);
    });

    it(`${fontId}: due rasterizzazioni identiche byte per byte`, async () => {
      const a = await rasterize({ text: TEXT, fontId, heightMm: 40 }, readPublic);
      const b = await rasterize({ text: TEXT, fontId, heightMm: 40 }, readPublic);
      expect([a.width, a.height]).toEqual([b.width, b.height]);
      expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    });

    it(`${fontId}: nessun tratto spezzato né buco spurio, lettera per lettera`, async () => {
      const heightMm = 40;
      let letterRegions = 0;
      for (const ch of TEXT.replace(/ /g, '')) {
        const lo = await rasterize({ text: ch, fontId, heightMm }, readPublic);
        const hi = await rasterize({ text: ch, fontId, heightMm, pxPerMm: 30 }, readPublic);
        const t = topology(lo);
        expect(t, `${fontId} "${ch}"`).toEqual(topology(hi));
        if (SINGLE_STROKE[fontId]) expect(t.regions, `${fontId} "${ch}"`).toBe(ch === 'i' ? 2 : 1);
        letterRegions += t.regions;
      }
      // Nel testo intero le lettere legate possono unirsi, ma non spezzarsi.
      const all = await rasterize({ text: TEXT, fontId, heightMm }, readPublic);
      expect(topology(all).regions).toBeLessThanOrEqual(letterRegions);
    }, 30_000);

    it(`${fontId}: carattere senza glifo → avviso, nessun riquadro .notdef`, async () => {
      const r = await rasterize({ text: 'Ciao 漢', fontId, heightMm: 30 }, readPublic);
      expect(r.missing).toEqual(['漢']);
      expect(r.warnings.some((w) => w.includes('漢') && w.includes('U+6F22'))).toBe(true);
      expect(r.glyphs.every((g) => g.glyphIndex !== 0)).toBe(true);
      const ok = await rasterize({ text: 'Ciao ', fontId, heightMm: 30 }, readPublic);
      expect(Buffer.from(r.data).equals(Buffer.from(ok.data))).toBe(true);
    });
  }

  it('gli a capo diventano spazi, con avviso', async () => {
    const r = await rasterize({ text: 'Ciao\nTorino', fontId: 'sacramento', heightMm: 20 }, readPublic);
    expect(r.text).toBe('Ciao Torino');
    expect(r.warnings).toHaveLength(1);
  });
});
