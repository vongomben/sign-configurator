import { describe, expect, it } from 'vitest';
import { meshToStl } from '../src/export/stl';
import type { RasterImageSource, SignOrder } from '../src/order/schema';
import { applyThreshold, decodeRle, encodeRle, layoutRaster, otsuThreshold } from '../src/sources/bitmapCodec';
import { traceContours } from '../src/sources/contours';
import { IDENTITY, layoutSvg, normalizeShapes, type RawShape } from '../src/sources/svgPaths';
import { generateSign } from '../src/worker/generate';

const sameBytes = (a: ArrayBuffer, b: ArrayBuffer): boolean => {
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
};

/** Mulberry32, seed fisso: le bitmap di prova non cambiano tra una macchina e l'altra. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paint(data: Uint8Array, width: number, x0: number, y0: number, x1: number, y1: number, value: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) data[y * width + x] = value;
  }
}

describe('bitmap e contorni', () => {
  it('il codec RLE torna alla bitmap di partenza, con seed fisso', () => {
    const rnd = mulberry32(1);
    const sizes: [number, number][] = [
      [1, 1],
      [2, 3],
      [8, 8],
      [17, 5],
      [64, 63],
    ];
    for (const [width, height] of sizes) {
      const data = new Uint8Array(width * height);
      for (let i = 0; i < data.length; i++) data[i] = rnd() < 0.37 ? 1 : 0;
      expect(decodeRle(encodeRle(data, width, height), width, height)).toEqual(data);
      expect(encodeRle(data, width, height)).toBe(encodeRle(data, width, height));
    }
    const leading = new Uint8Array(300);
    leading[0] = 1;
    leading.fill(1, 1);
    expect(decodeRle(encodeRle(leading, 300, 1), 300, 1)).toEqual(leading);
    const board = new Uint8Array(32 * 8);
    for (let i = 0; i < board.length; i++) board[i] = i % 2;
    expect(decodeRle(encodeRle(board, 32, 8), 32, 8)).toEqual(board);
  });

  it('Otsu separa un\'immagine bimodale sintetica', () => {
    const luma = new Uint8Array(4000);
    for (let i = 0; i < 2000; i++) luma[i] = 20 + (i % 15);
    for (let i = 0; i < 2000; i++) luma[2000 + i] = 210 + (i % 20);
    const threshold = otsuThreshold(luma);
    expect(threshold).toBeGreaterThanOrEqual(34);
    expect(threshold).toBeLessThan(210);
    const ink = applyThreshold(luma, threshold, false);
    expect(ink.subarray(0, 2000).every((value) => value === 1)).toBe(true);
    expect(ink.subarray(2000).every((value) => value === 0)).toBe(true);

    const bw = new Uint8Array(100);
    bw.fill(255);
    bw.fill(0, 0, 20);
    const split = otsuThreshold(bw);
    expect(split).toBeGreaterThan(0);
    expect(split).toBeLessThan(255);
    const separated = applyThreshold(bw, split, false);
    expect(separated.subarray(0, 20).every((value) => value === 1)).toBe(true);
    expect(separated.subarray(20).every((value) => value === 0)).toBe(true);
  });

  it('i contorni di un anello sono due percorsi chiusi', () => {
    const width = 24;
    const height = 24;
    const data = new Uint8Array(width * height);
    paint(data, width, 2, 2, 21, 21, 1);
    paint(data, width, 8, 8, 15, 15, 0);
    const paths = traceContours(data, width, height);
    expect(paths).toHaveLength(2);
    expect(paths.filter((path) => path.hole)).toHaveLength(1);
    expect(paths.every((path) => path.points.length >= 4)).toBe(true);

    const source: RasterImageSource = {
      kind: 'image',
      format: 'raster',
      name: 'anello.png',
      trace: 'outline',
      threshold: 128,
      invert: false,
      bitmap: { width, height, rle: encodeRle(data, width, height) },
    };
    const laid = layoutRaster(source, height);
    expect(laid.graph.edges.filter((edge) => edge.a === edge.b)).toHaveLength(2);

    const blob = new Uint8Array(15 * 15);
    paint(blob, 15, 1, 1, 13, 13, 1);
    blob[7 * 15 + 7] = 0;
    expect(traceContours(blob, 15, 15)).toHaveLength(2);
    expect(traceContours(blob, 15, 15, { minHoleAreaPx: 2 })).toHaveLength(1);
  });

  it('il contorno di un anello SVG sono due percorsi chiusi', () => {
    const shape: RawShape = {
      d: 'M0 0 L100 0 L100 100 L0 100 Z M20 20 L80 20 L80 80 L20 80 Z',
      transform: IDENTITY,
      kind: 'fill',
      fillRule: 'evenodd',
    };
    const elements = normalizeShapes([shape], 100);
    const laid = layoutSvg({ kind: 'image', format: 'svg', name: 'anello.svg', trace: 'outline', svg: { elements } }, 100, 4);
    expect(laid.graph.edges.filter((edge) => edge.a === edge.b)).toHaveLength(2);
  });

  it('un cuneo avvisa che il tratto non è uniforme', () => {
    const width = 60;
    const height = 48;
    const data = new Uint8Array(width * height);
    for (let y = 4; y < height - 4; y++) {
      const half = 1 + Math.floor(((y - 4) * 12) / (height - 8));
      for (let x = 30 - half; x <= 30 + half; x++) data[y * width + x] = 1;
    }
    const laid = layoutRaster(
      {
        kind: 'image',
        format: 'raster',
        name: 'cuneo.png',
        trace: 'centerline',
        threshold: 128,
        invert: false,
        bitmap: { width, height, rle: encodeRle(data, width, height) },
      },
      40,
    );
    expect(laid.raster.warnings.some((warning) => warning === 'tratto non uniforme: prova Contorno')).toBe(true);
  });

  it('lo stesso JSON produce gli stessi STL e la stessa BOM', async () => {
    const width = 16;
    const height = 80;
    const data = new Uint8Array(width * height);
    paint(data, width, 6, 0, 9, height - 1, 1);
    const source: RasterImageSource = {
      kind: 'image',
      format: 'raster',
      name: 'barra.png',
      trace: 'centerline',
      threshold: 128,
      invert: false,
      bitmap: { width, height, rle: encodeRle(data, width, height) },
    };
    const order: SignOrder = {
      schemaVersion: 2,
      generatorVersion: '0.2.0',
      source,
      heightMm: 80,
      color: '#ff2fd6',
      params: {},
      paths: null,
      crossings: [],
    };
    const again = JSON.parse(JSON.stringify(order)) as SignOrder;
    const first = await generateSign(order);
    const second = await generateSign(again);
    expect(first.warnings.some((warning) => warning.includes('Immagine a bassa risoluzione per questa altezza'))).toBe(true);
    expect(first.warnings.some((warning) => warning.includes('Altezza massima 10 mm'))).toBe(true);
    expect(first.housingMesh.triVerts.length).toBeGreaterThan(0);
    expect(sameBytes(meshToStl(first.housingMesh), meshToStl(second.housingMesh))).toBe(true);
    expect(sameBytes(meshToStl(first.diffuserMesh), meshToStl(second.diffuserMesh))).toBe(true);
    expect(second.bom).toEqual(first.bom);
    expect(second.warnings).toEqual(first.warnings);
  });
});
