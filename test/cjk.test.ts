import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { getFont, heightGlyphOf } from '../src/fonts/registry';
import { loadFont, type FontBytesReader } from '../src/fonts/loadFont';
import { squaredDistanceTo } from '../src/geometry/distance';
import { buildGraph } from '../src/geometry/graph';
import { rasterizeText } from '../src/geometry/rasterize';
import { skeletonize } from '../src/geometry/skeleton';
import { DEFAULT_CUSTOMER, type SignOrderV4 } from '../src/order/schema';
import { generateSign } from '../src/worker/generate';

const readPublic: FontBytesReader = async (file) => {
  const b = await readFile(`public/${file}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** Larghezza del tratto sui pixel dello scheletro: mediana e scarto fra i decili. */
async function strokeSpread(fontId: string, text: string, heightMm: number) {
  const entry = getFont(fontId)!;
  const font = await loadFont(fontId, readPublic);
  const raster = rasterizeText(font, entry, { text, heightMm });
  const skel = skeletonize(raster.data, raster.width, raster.height);
  const d2 = squaredDistanceTo(raster.data, raster.width, raster.height, 0);
  const widths: number[] = [];
  for (let i = 0; i < skel.length; i++) if (skel[i]) widths.push(2 * Math.sqrt(d2[i]!) - 1);
  widths.sort((a, b) => a - b);
  const at = (p: number) => widths[Math.min(widths.length - 1, Math.floor((widths.length - 1) * p))]!;
  const median = at(0.5);
  const graph = buildGraph(raster);
  const degrees = [...graph.nodes].reduce((acc, node) => acc.set(node.degree, (acc.get(node.degree) ?? 0) + 1), new Map<number, number>());
  return {
    spread: Math.max(at(0.9) / median - 1, 1 - at(0.1) / median),
    topology: `${graph.edges.length}/${[...degrees].sort((a, b) => a[0] - b[0]).join(',')}`,
    warnings: raster.warnings,
  };
}

describe('font cinesi e giapponesi (SPEC §4ter)', () => {
  for (const [fontId, text] of [
    ['noto-sans-sc', '你好'],
    ['mplus-rounded', 'こんにちは'],
  ] as const) {
    it(`${fontId}: misura l'altezza su 永, si scarica a richiesta`, async () => {
      const entry = getFont(fontId)!;
      expect(heightGlyphOf(entry)).toBe('永');
      expect(entry.lazy).toBe(true);
      expect(entry.stripMode).toBe('centerline');
      expect(entry.sample).toBeTruthy();
    });

    it(`${fontId}: tratto costante entro il 25 %, com'è la pipeline a pretendere`, async () => {
      for (const sample of ['永', text]) {
        const { spread } = await strokeSpread(fontId, sample, 200);
        expect(spread, `${fontId} «${sample}»`).toBeLessThan(0.25);
      }
    }, 120_000);

    it(`${fontId}: la topologia non cambia fra 200 e 400 mm`, async () => {
      const small = await strokeSpread(fontId, '永', 200);
      const large = await strokeSpread(fontId, '永', 400);
      expect(small.topology).toBe(large.topology);
    }, 120_000);
  }

  it('un carattere fuori dal sottoinsieme avvisa invece di sparire in silenzio', async () => {
    const entry = getFont('noto-sans-sc')!;
    const font = await loadFont('noto-sans-sc', readPublic);
    // U+9FA5 è l'ultimo CJK del blocco base, fuori dal GB 2312.
    const raster = rasterizeText(font, entry, { text: '龥', heightMm: 200 });
    expect(raster.warnings.join(' ')).toMatch(/U\+9FA5/i);
  }, 60_000);

  it('永 a 300 mm passa tutta la pipeline: un canale per tratto, nessun errore', async () => {
    const order: SignOrderV4 = {
      schemaVersion: 4,
      generatorVersion: 'test',
      pricingVersion: null,
      source: { kind: 'text', text: '永', fontId: 'noto-sans-sc' },
      heightMm: 300,
      sizePreset: null,
      color: '#ff2fd6',
      params: {},
      paths: null,
      crossings: [],
      customer: { ...DEFAULT_CUSTOMER },
      plate: null,
    };
    const result = await generateSign(order, readPublic);
    // 永 ha quattro tratti che si staccano più il corpo centrale: la striscia va in più spezzoni.
    expect(result.bom.segments.length).toBeGreaterThanOrEqual(4);
    expect(result.lightPoints.length).toBeGreaterThan(0);
    expect(result.housingMesh.triVerts.length).toBeGreaterThan(0);
    expect(result.warnings.join(' ')).not.toMatch(/non manifold/);
  }, 180_000);
});
