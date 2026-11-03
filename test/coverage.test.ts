import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/config';
import type { FontBytesReader } from '../src/fonts/loadFont';
import { applyCoverage, coverSign, DARK_LABEL } from '../src/geometry/coverage';
import { buildGraph } from '../src/geometry/graph';
import type { Point } from '../src/geometry/rasterize';
import { rasterize } from '../src/geometry/rasterize';
import { sourceFromPaths } from '../src/geometry/segment';
import { buildStrip } from '../src/geometry/strip';
import { pairTubes } from '../src/geometry/tubePairing';

const readPublic: FontBytesReader = async (file) => {
  const b = await readFile(`public/${file}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

const lengthOf = (points: readonly Point[]): number => {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  }
  return total;
};

async function ciao(fontId: 'sacramento' | 'neonderthaw', heightMm = 100) {
  const raster = await rasterize({ text: 'Ciao', fontId, heightMm }, readPublic);
  const graph = buildGraph(raster);
  const strip = buildStrip(
    { nodes: graph.nodes, edges: graph.edges, strokeWidthMm: graph.strokeWidthMm },
    DEFAULT_PARAMS,
    heightMm,
  );
  const coverage = coverSign({
    glyphs: raster.glyphs,
    paths: strip.paths,
    gaps: strip.gaps,
    excluded: strip.excluded,
    walls: [],
    corners: strip.bom.corners,
    params: DEFAULT_PARAMS,
    heightMm,
  });
  applyCoverage(strip, coverage);
  return { raster, graph, strip, coverage };
}

describe('copertura di Ciao', () => {
  it('ogni tratto spento ha un motivo e acceso + spento è il riferimento', async () => {
    for (const fontId of ['sacramento', 'neonderthaw'] as const) {
      const { graph, strip, coverage } = await ciao(fontId);
      for (const stretch of coverage.stretches) {
        expect(DARK_LABEL[stretch.reason].length, fontId).toBeGreaterThan(0);
        expect(stretch.lengthMm, fontId).toBeGreaterThan(0);
      }
      const lit = coverage.letters.reduce((sum, letter) => sum + letter.litMm, 0);
      const dark = coverage.stretches.reduce((sum, stretch) => sum + stretch.lengthMm, 0);
      const reported = coverage.letters.reduce((sum, letter) => sum + letter.referenceMm, 0);
      expect(Math.abs(lit + dark - reported), fontId).toBeLessThanOrEqual(1);

      const dots = strip.excluded.reduce((sum, ring) => sum + lengthOf(ring.points), 0);
      const reference = graph.edges.reduce((sum, edge) => sum + edge.lengthMm, 0) - dots;
      expect(Math.abs(reported - reference), fontId).toBeLessThanOrEqual(1);
      expect(coverage.stretches.some((stretch) => stretch.reason === 'validazione'), fontId).toBe(false);
    }
  }, 30000);

  it('Neonderthaw «Ciao» all\'altezza minima: copertura, canali separati, LED circa doppi', async () => {
    let height = 100;
    let built = await ciao('neonderthaw', height);
    for (let step = 0; step < 4; step++) {
      const next = built.strip.suggestion.heightMm;
      expect(next, `passo ${step}`).not.toBeNull();
      if (next! <= height + 0.5) break;
      height = next!;
      built = await ciao('neonderthaw', height);
    }
    expect(built.raster.stripMode).toBe('walls');
    expect(built.strip.issues.some((issue) => issue.message.startsWith('Sagome che si fondono'))).toBe(false);
    expect(built.coverage.letters.length).toBeGreaterThan(0);
    for (const letter of built.coverage.letters) {
      expect(letter.ratio, letter.letter).toBeGreaterThanOrEqual(DEFAULT_PARAMS.COVERAGE_MIN);
    }
    const pairing = pairTubes(built.graph, built.raster.tube!);
    const median = buildStrip(
      sourceFromPaths([
        ...pairing.pairs.map((pair) => ({ points: pair.midline })),
        ...pairing.singles.map((line) => ({ points: line.points })),
      ]),
      DEFAULT_PARAMS,
      height,
    );
    const ratio = built.strip.bom.totalLeds / median.bom.totalLeds;
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(2.5);
  }, 60000);

  it('un errore di curva non toglie la striscia', async () => {
    const { strip } = await ciao('sacramento');
    const curved = new Set(
      strip.issues.filter((issue) => issue.level === 'error' && issue.bend === 'curva').map((issue) => issue.segmentId),
    );
    expect(curved.size).toBeGreaterThan(0);
    for (const id of curved) {
      expect(strip.chains.some((chain) => chain.id === id)).toBe(true);
      const segment = strip.bom.segments.find((item) => item.id === id);
      expect(segment).toBeTruthy();
      if (segment && segment.lengthMm >= DEFAULT_PARAMS.CUT_PITCH + 2 * DEFAULT_PARAMS.WIRE_SLOT_L) {
        expect(segment.cutLengthMm).toBeGreaterThan(0);
      }
    }
  });

  it('uno spigolo che lascerebbe un pezzo sotto CUT_PITCH non si divide', () => {
    const points: Point[] = [];
    for (let t = 50; t >= 0; t -= 1) points.push([t, 0]);
    for (let t = 1; t <= 15; t += 1) points.push([0, t]);
    const model = buildStrip(sourceFromPaths([{ points }]), DEFAULT_PARAMS, 100);
    expect(model.chains).toHaveLength(1);
    expect(model.issues.some((issue) => issue.bend === 'spigolo')).toBe(true);
    expect(model.bom.segments[0]!.cutLengthMm).toBeGreaterThan(0);
  });
});
