import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/config';
import type { FontBytesReader } from '../src/fonts/loadFont';
import { diffuserRgb, gaussianWeight, hueDegrees } from '../src/viewer/neonMaterial';
import { buildGraph } from '../src/geometry/graph';
import { ledToDiffuserMm, lightPointsFromChains } from '../src/geometry/lights';
import { rasterize, type Point } from '../src/geometry/rasterize';
import { buildStrip } from '../src/geometry/strip';

const readPublic: FontBytesReader = async (file) => {
  const b = await readFile(`public/${file}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

const hueGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

describe('colore fisso sul diffusore', () => {
  const sigma = 6;
  const lights = [-2, -1, 0, 1, 2].map((step) => ({ x: step * 6.25, y: 0 }));

  it.each([
    ['rosso', [1, 0, 0] as const, 0],
    ['verde', [0, 1, 0] as const, 120],
    ['blu', [0, 0, 1] as const, 240],
  ])('%s: il centro del tratto ha la tinta e non è bianco', (_name, rgb, hue) => {
    const sample = diffuserRgb(
      0,
      0,
      lights.map((light) => ({ ...light, rgb })),
      sigma,
    );
    expect(hueGap(hueDegrees(...sample), hue)).toBeLessThanOrEqual(15);
    const [r, g, b] = sample;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    expect(max - min).toBeGreaterThan(0.2);
    expect(min).toBeLessThan(0.85);
  });
});

describe('punti luce', () => {
  it('la sigma è CHANNEL_DEPTH meno lo spessore della striscia', () => {
    expect(ledToDiffuserMm(DEFAULT_PARAMS)).toBeCloseTo(DEFAULT_PARAMS.CHANNEL_DEPTH - DEFAULT_PARAMS.STRIP_T);
    const gap = ledToDiffuserMm(DEFAULT_PARAMS);
    expect(gaussianWeight(0, 0, gap)).toBeCloseTo(1);
    expect(gaussianWeight(gap, 0, gap)).toBeCloseTo(Math.exp(-0.5), 5);
  });

  it('su un dritto i LED stanno sulla luce, dal DIN al DOUT, a 160 al metro', () => {
    const points: Point[] = [];
    for (let x = 0; x <= 100; x += 1) points.push([x, 0]);
    const lights = lightPointsFromChains([{ id: 3, points, closed: false }], DEFAULT_PARAMS);
    const lit = 100 - 2 * DEFAULT_PARAMS.WIRE_SLOT_L;
    const count = Math.round((lit * DEFAULT_PARAMS.LED_PER_M) / 1000);
    expect(lights).toHaveLength(count);
    expect(lights[0]!.segment).toBe(3);
    expect(lights[0]!.index).toBe(0);
    expect(lights[1]!.index).toBe(1);
    expect(lights[0]!.pos[2]).toBeCloseTo(DEFAULT_PARAMS.FLOOR + DEFAULT_PARAMS.STRIP_T);
    expect(lights[0]!.dir[0]).toBeCloseTo(1);
    expect(lights[0]!.dir[1]).toBeCloseTo(0);
    expect(lights[0]!.pos[0]).toBeGreaterThan(DEFAULT_PARAMS.WIRE_SLOT_L);
    expect(lights[lights.length - 1]!.pos[0]).toBeLessThan(100 - DEFAULT_PARAMS.WIRE_SLOT_L);
    expect(lights[0]!.pos[0]).toBeLessThan(lights[1]!.pos[0]!);
    expect(JSON.stringify(lightPointsFromChains([{ id: 3, points, closed: false }], DEFAULT_PARAMS))).toBe(
      JSON.stringify(lights),
    );
  });

  it('un anello non piazza due LED sullo stesso punto di chiusura', () => {
    const points: Point[] = [];
    for (let i = 0; i <= 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      points.push([40 + 30 * Math.cos(a), 30 * Math.sin(a)]);
    }
    const lights = lightPointsFromChains([{ id: 1, points, closed: true }], DEFAULT_PARAMS);
    expect(lights.length).toBeGreaterThan(4);
    const first = lights[0]!.pos;
    const last = lights[lights.length - 1]!.pos;
    expect(Math.hypot(first[0] - last[0], first[1] - last[1])).toBeGreaterThan(1);
  });

  it('un puntino ha un solo LED, al centro', () => {
    const points: Point[] = [
      [0, 0],
      [DEFAULT_PARAMS.CUT_PITCH, 0],
    ];
    const lit = lightPointsFromChains([{ id: 1, points, closed: false, dot: true }], DEFAULT_PARAMS);
    const muted = lightPointsFromChains([{ id: 1, points, closed: false }], DEFAULT_PARAMS);
    expect(lit).toHaveLength(1);
    expect(lit[0]!.pos[0]).toBeCloseTo(DEFAULT_PARAMS.CUT_PITCH / 2, 6);
    expect(lit[0]!.pos[1]).toBeCloseTo(0, 6);
    expect(muted).toHaveLength(0);
  });

  it('Ciao a 100 mm con Sacramento ha un LED sul puntino, anche nella BOM', async () => {
    const heightMm = 100;
    const raster = await rasterize({ text: 'Ciao', fontId: 'sacramento', heightMm }, readPublic);
    const graph = buildGraph(raster);
    const strip = buildStrip(
      { nodes: graph.nodes, edges: graph.edges, strokeWidthMm: graph.strokeWidthMm },
      DEFAULT_PARAMS,
      heightMm,
    );
    const dots = strip.chains.filter((chain) => chain.dot);
    expect(dots.length).toBeGreaterThan(0);
    const lights = lightPointsFromChains(
      strip.chains.map((chain) => ({
        id: chain.id,
        points: chain.smooth.length >= 2 ? chain.smooth : chain.points,
        closed: chain.closed,
        dot: chain.dot,
      })),
      DEFAULT_PARAMS,
    );
    const ids = new Set(dots.map((chain) => chain.id));
    expect(lights.filter((light) => ids.has(light.segment)).length).toBe(dots.length);
    for (const dot of dots) {
      const segment = strip.bom.segments.find((item) => item.id === dot.id);
      expect(segment?.ledCount).toBe(1);
      expect(segment?.cutLengthMm).toBe(DEFAULT_PARAMS.CUT_PITCH);
    }
  });
});
