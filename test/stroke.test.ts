import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/config';
import type { FontBytesReader } from '../src/fonts/loadFont';
import { getFont } from '../src/fonts/registry';
import { parseStrokeFont, svgPath } from '../src/fonts/strokeFont';
import { applyCoverage, coverSign } from '../src/geometry/coverage';
import { buildStrip } from '../src/geometry/strip';
import { loadStrokeFont, measureStrokeMetrics, layoutStroke } from '../src/geometry/strokeLayout';

const readPublic: FontBytesReader = async (file) => {
  const b = await readFile(`public/${file}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

const STROKE_IDS = ['hershey-script-simplex', 'ems-allure'] as const;

describe('parser dei tratti singoli', () => {
  it('legge M/L, una curva e il kerning di un SVG', () => {
    const font = parseStrokeFont(`<svg><font horiz-adv-x="100"><font-face font-family="Prova" units-per-em="1000"/>
      <glyph unicode="A" horiz-adv-x="200" d="M 0 0 L 10 80 L 20 0"/>
      <glyph unicode="V" horiz-adv-x="200" d="M 0 80 L 10 0 L 20 80"/>
      <glyph unicode="Q" horiz-adv-x="100" d="M 0 0 Q 0 100 100 100"/>
      <hkern u1="A" u2="V" k="15"/>
      </font></svg>`);
    expect(font.name).toBe('Prova');
    expect(font.glyphs.get('A')!.strokes).toHaveLength(1);
    expect(font.glyphs.get('A')!.strokes[0]!.points[1]).toEqual([10, 80]);
    expect(font.kerning.get('A\0V')).toBe(15);
    const curve = font.glyphs.get('Q')!.strokes[0]!.points;
    expect(curve.length).toBeGreaterThan(2);
    expect(curve[curve.length - 1]).toEqual([100, 100]);
  });

  it('il JSON Hershey ha Y verso il basso e avanzamento o', () => {
    const font = parseStrokeFont(
      JSON.stringify({
        name: 'mini',
        chars: [
          { d: '', o: 4 },
          { d: 'M 0 10 L 0 0', o: 6 },
        ],
      }),
    );
    const bang = font.glyphs.get('!')!;
    expect(bang.advance).toBe(6);
    expect(bang.strokes[0]!.points).toEqual([
      [0, -10],
      [0, 0],
    ]);
  });

  it('un path con virgole e coppie implicite resta una spezzata', () => {
    const strokes = svgPath('M8,1 L7,2 5,14', 0.5);
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.points).toEqual([
      [8, 1],
      [7, 2],
      [5, 14],
    ]);
  });
});

describe('Ciao nei font a tratto singolo', () => {
  for (const fontId of STROKE_IDS) {
    it(`${fontId}: la sommità di H e di x è quella del registro`, async () => {
      const entry = getFont(fontId)!;
      expect(entry.kind).toBe('stroke');
      const laid = await layoutStroke(entry, { text: 'H', heightMm: entry.capHeightMeasured }, readPublic);
      const metrics = measureStrokeMetrics(await loadStrokeFont(fontId, readPublic));
      expect(entry.capHeightMeasured).toBe(metrics.capHeight);
      expect(entry.xHeightMeasured).toBe(metrics.xHeight);
      expect(laid.raster.strokes!.length).toBeGreaterThan(0);
      expect(laid.raster.data.every((v) => v === 0)).toBe(true);
    });

    it(`${fontId}: Ciao non ha rami spuri, copre e si ripete`, async () => {
      const entry = getFont(fontId)!;
      const once = await layoutStroke(entry, { text: 'Ciao', heightMm: 100 }, readPublic);
      const twice = await layoutStroke(entry, { text: 'Ciao', heightMm: 100 }, readPublic);
      expect(once.graph.prunedSpurs).toBe(0);
      expect(once.graph.edges.length).toBeGreaterThan(0);
      expect(once.graph.edges.every((edge) => edge.lengthMm > 0.05)).toBe(true);
      expect(JSON.stringify(once.graph.nodes)).toBe(JSON.stringify(twice.graph.nodes));
      expect(JSON.stringify(once.graph.edges)).toBe(JSON.stringify(twice.graph.edges));

      let height = 100;
      let laid = once;
      for (let step = 0; step < 4; step++) {
        const strip = buildStrip({ nodes: laid.graph.nodes, edges: laid.graph.edges }, DEFAULT_PARAMS, height);
        const coverage = coverSign({
          glyphs: laid.raster.glyphs,
          paths: strip.paths,
          gaps: strip.gaps,
          excluded: strip.excluded,
          walls: [],
          corners: strip.bom.corners,
          params: DEFAULT_PARAMS,
          heightMm: height,
        });
        applyCoverage(strip, coverage);
        const next = strip.suggestion.heightMm;
        const low = coverage.letters.filter((letter) => letter.ratio < DEFAULT_PARAMS.COVERAGE_MIN);
        if (low.length === 0) {
          expect(coverage.letters.length).toBeGreaterThan(0);
          for (const letter of coverage.letters) {
            expect(letter.ratio, letter.letter).toBeGreaterThanOrEqual(DEFAULT_PARAMS.COVERAGE_MIN);
          }
          return;
        }
        expect(next, `${fontId} ${low.map((letter) => letter.letter).join('')}`).not.toBeNull();
        if (next! <= height + 0.5) {
          expect(low.map((letter) => `${letter.letter} ${(letter.ratio * 100).toFixed(0)}%`)).toEqual([]);
        }
        height = next!;
        laid = await layoutStroke(entry, { text: 'Ciao', heightMm: height }, readPublic);
      }
      throw new Error(`${fontId}: copertura sotto ${DEFAULT_PARAMS.COVERAGE_MIN} anche all'altezza consigliata`);
    }, 30000);
  }
});
