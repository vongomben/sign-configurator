import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { FontBytesReader } from '../src/fonts/loadFont';
import { buildGraph } from '../src/geometry/graph';
import { rasterize, rasterizeContours, type Contour, type Point } from '../src/geometry/rasterize';
import { pairTubes, type TubePairing } from '../src/geometry/tubePairing';

const readPublic: FontBytesReader = async (file) => {
  const b = await readFile(`public/${file}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** Tratto 2 mm, luce 4 mm: gli assi distano 6 mm. */
const TUBE = { lineWidthMm: 2, gapMm: 4 };

function bar(cx: number, cy: number, length: number, width: number, deg: number): Contour {
  const a = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return (
    [
      [-length / 2, -width / 2],
      [length / 2, -width / 2],
      [length / 2, width / 2],
      [-length / 2, width / 2],
    ] as Point[]
  ).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c] as Point);
}

function ribbon(center: Point[], width: number): Contour {
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i < center.length; i++) {
    const a = center[Math.max(0, i - 1)]!;
    const b = center[Math.min(center.length - 1, i + 1)]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / l;
    const ny = (b[0] - a[0]) / l;
    left.push([center[i]![0] + (nx * width) / 2, center[i]![1] + (ny * width) / 2]);
    right.push([center[i]![0] - (nx * width) / 2, center[i]![1] - (ny * width) / 2]);
  }
  return [...left, ...right.reverse()];
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number, n: number): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const ang = a0 + ((a1 - a0) * i) / n;
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)] as Point;
  });
}

/** Due pareti unite da un'estremità: gli assi distano `sep`. */
function hairpin(leg: number, sep: number): Point[] {
  const R = sep / 2;
  const pts: Point[] = [];
  for (let i = 0; i <= 12; i++) pts.push([(leg * i) / 12, 0]);
  for (let i = 1; i < 18; i++) {
    const ang = -Math.PI / 2 + (Math.PI * i) / 18;
    pts.push([leg + R * Math.cos(ang), R + R * Math.sin(ang)]);
  }
  for (let i = 12; i >= 0; i--) pts.push([(leg * i) / 12, sep]);
  return pts;
}

const pairOf = (contours: Contour[]): TubePairing => pairTubes(buildGraph(rasterizeContours(contours)), TUBE);
const midY = (pts: Point[]): number => pts.reduce((s, p) => s + p[1], 0) / pts.length;
const span = (pts: Point[]): [number, number] => [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];

describe('pairTubes (tubi sintetici, assi a 6 mm)', () => {
  it('dritto: una coppia, mediana a metà fra le pareti', () => {
    const p = pairOf([bar(25, 0, 50, 2, 0), bar(25, 6, 50, 2, 0)]);
    expect(p.pairs).toHaveLength(1);
    expect(p.singles).toHaveLength(0);
    expect(p.dubious).toHaveLength(0);
    const pair = p.pairs[0]!;
    expect(pair.distanceMm).toBeCloseTo(6, 1);
    expect(pair.lengthMm).toBeGreaterThan(46);
    expect(pair.lengthMm).toBeLessThanOrEqual(50);
    expect(midY(pair.midline)).toBeCloseTo(3, 0);
  });

  it('curvo: la mediana sta sul raggio medio', () => {
    const p = pairOf([ribbon(arc(0, 0, 12, 0, Math.PI, 40), 2), ribbon(arc(0, 0, 18, 0, Math.PI, 48), 2)]);
    expect(p.pairs).toHaveLength(1);
    expect(p.pairs[0]!.distanceMm).toBeCloseTo(6, 1);
    const radii = p.pairs[0]!.midline.filter(([, y]) => y > 4).map(([x, y]) => Math.hypot(x, y));
    const med = [...radii].sort((a, b) => a - b)[Math.floor(radii.length / 2)]!;
    expect(med).toBeCloseTo(15, 0);
    expect(p.pairs[0]!.lengthMm).toBeGreaterThan(40);
    expect(p.pairs[0]!.lengthMm).toBeLessThan(50);
  });

  it('a U: la polilinea si accoppia con sé stessa, mediana fra le due gambe', () => {
    const p = pairOf([ribbon(hairpin(40, 6), 2)]);
    expect(p.pairs).toHaveLength(1);
    expect(p.singles).toHaveLength(0);
    const pair = p.pairs[0]!;
    expect(pair.a).toBe(pair.b);
    expect(pair.distanceMm).toBeCloseTo(6, 1);
    // La mediana è dritta, quindi dopo la semplificazione restano gli estremi.
    const [x0, x1] = span(pair.midline);
    expect(x0).toBeLessThan(5);
    expect(x1).toBeGreaterThan(35);
    for (const [, y] of pair.midline) expect(y).toBeCloseTo(3, 0);
    expect(pair.lengthMm).toBeGreaterThan(36);
    expect(pair.lengthMm).toBeLessThan(46);
  });

  it('estremità sfalsate: la mediana copre l\'unione delle due pareti', () => {
    const p = pairOf([bar(25, 0, 50, 2, 0), bar(40, 6, 50, 2, 0)]);
    expect(p.pairs).toHaveLength(1);
    expect(p.dubious).toHaveLength(0);
    const [x0, x1] = span(p.pairs[0]!.midline);
    expect(x0).toBeLessThan(3);
    expect(x1).toBeGreaterThan(60);
    expect(midY(p.pairs[0]!.midline)).toBeCloseTo(3, 0);
    expect(p.pairs[0]!.lengthMm).toBeGreaterThan(58);
  });

  it('due tubi vicini, paralleli solo per 12 mm: ognuno tiene la propria coppia', () => {
    const p = pairOf([
      bar(35, 0, 70, 2, 0),
      bar(35, 6, 70, 2, 0),
      bar(35, 40, 70, 2, 0),
      bar(35, 46, 70, 2, 0),
      bar(36, 12, 12, 2, 0),
      bar(36, 18, 12, 2, 0),
    ]);
    expect(p.pairs).toHaveLength(2);
    const heights = p.pairs.map((pair) => midY(pair.midline)).sort((a, b) => a - b);
    expect(heights[0]).toBeCloseTo(3, 0);
    expect(heights[1]).toBeCloseTo(43, 0);
    const long = p.pairs.filter((pair) => pair.lengthMm > 60);
    expect(long).toHaveLength(2);
    for (const pair of long) {
      expect(pair.distanceMm).toBeGreaterThan(p.distanceMinMm);
      expect(pair.distanceMm).toBeLessThan(p.distanceMaxMm);
    }
    expect(p.warnings.length).toBe(p.dubious.length);
  });

  it('tratto breve: coppia dubbia, non accettata', () => {
    const p = pairOf([bar(6, 0, 12, 2, 0), bar(6, 6, 12, 2, 0)]);
    expect(p.pairs).toHaveLength(0);
    expect(p.dubious).toHaveLength(1);
    expect(p.dubious[0]!.reason).toBe('short');
    expect(p.warnings[0]).toContain('parallele solo per');
  });

  it('distanza fuori tolleranza: coppia dubbia, con la posizione', () => {
    const p = pairOf([bar(30, 0, 60, 2, 0), bar(30, 11, 60, 2, 0)]);
    expect(p.pairs).toHaveLength(0);
    expect(p.singles).toHaveLength(0);
    expect(p.dubious).toEqual([
      expect.objectContaining({ reason: 'distance', a: 0, b: 1 }),
    ]);
    expect(p.dubious[0]!.distanceMm).toBeCloseTo(11, 0);
    expect(p.warnings[0]).toContain('fuori tolleranza');
  });

  it('linea sola: resta singola, senza avvisi', () => {
    const p = pairOf([bar(20, 0, 40, 2, 0)]);
    expect(p.pairs).toHaveLength(0);
    expect(p.dubious).toHaveLength(0);
    expect(p.singles).toHaveLength(1);
  });

  it('deterministico', () => {
    const shape = [bar(10, 0, 40, 2, 15), bar(12, 6, 36, 2, 15)];
    expect(JSON.stringify(pairOf(shape))).toBe(JSON.stringify(pairOf(shape)));
  });
});

describe('pairTubes su Neonderthaw (100 mm)', () => {
  const neon = (text: string, pxPerMm = 6) =>
    rasterize({ text, fontId: 'neonderthaw', heightMm: 100, pxPerMm }, readPublic);

  it('"C": un solo tubo, la polilinea si accoppia con sé stessa', async () => {
    const r = await neon('C');
    const g = buildGraph(r);
    const p = pairTubes(g, r.tube!);
    expect(g.edges).toHaveLength(1);
    expect(p.pairs).toHaveLength(1);
    const pair = p.pairs[0]!;
    expect(pair.a).toBe(pair.b);
    expect(pair.distanceMm).toBeGreaterThan(p.distanceMinMm);
    expect(pair.distanceMm).toBeLessThan(p.distanceMaxMm);
    // La mediana percorre il tubo una volta: circa metà del giro delle due pareti.
    expect(pair.lengthMm / g.edges[0]!.lengthMm).toBeGreaterThan(0.4);
    expect(pair.lengthMm / g.edges[0]!.lengthMm).toBeLessThan(0.6);
    expect(p.singles).toHaveLength(0);
  });

  it('"i": il puntino (anello chiuso) resta una linea singola, l\'asta è un tubo', async () => {
    const r = await neon('i');
    const g = buildGraph(r);
    const p = pairTubes(g, r.tube!);
    const loop = g.edges.find((e) => e.a === e.b);
    expect(loop).toBeDefined();
    expect(p.singles.map((s) => s.edgeId)).toContain(loop!.id);
    expect(p.pairs).toHaveLength(1);
    expect(p.pairs[0]!.a).not.toBe(p.pairs[0]!.b);
    expect(p.pairs[0]!.distanceMm).toBeGreaterThan(p.distanceMinMm);
    expect(p.pairs[0]!.distanceMm).toBeLessThan(p.distanceMaxMm);
  });

  it('"t": l\'asta si accoppia, la barra corta resta dubbia', async () => {
    const r = await neon('t');
    const g = buildGraph(r);
    const p = pairTubes(g, r.tube!);
    expect(p.pairs.length).toBeGreaterThanOrEqual(1);
    expect(p.pairs.some((pair) => pair.lengthMm > 40)).toBe(true);
    const paired = new Set(p.pairs.flatMap((pair) => [pair.a, pair.b]));
    for (const edge of g.edges) {
      const known =
        paired.has(edge.id) ||
        p.dubious.some((doubt) => doubt.a === edge.id || doubt.b === edge.id) ||
        p.singles.some((single) => single.edgeId === edge.id);
      expect(known).toBe(true);
    }
  });

  it('"Ciao Torino": i puntini restano singoli, la C è un tubo, nessuna distanza fuori fascia', async () => {
    const r = await neon('Ciao Torino');
    const g = buildGraph(r);
    const p = pairTubes(g, r.tube!);
    const loops = g.edges.filter((e) => e.a === e.b);
    expect(loops.length).toBeGreaterThanOrEqual(2);
    const dots = loops.filter((loop) => loop.lengthMm / (2 * Math.PI) < 14.62);
    expect(dots.length).toBeGreaterThanOrEqual(2);
    for (const loop of dots) expect(p.singles.map((s) => s.edgeId)).toContain(loop.id);
    const hairpin = p.pairs.filter((pair) => pair.a === pair.b);
    expect(hairpin.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...hairpin.map((pair) => pair.lengthMm))).toBeGreaterThan(200);
    for (const pair of p.pairs) {
      expect(pair.distanceMm).toBeGreaterThanOrEqual(p.distanceMinMm);
      expect(pair.distanceMm).toBeLessThanOrEqual(p.distanceMaxMm);
    }
    const used = new Set<number>();
    for (const pair of p.pairs) {
      used.add(pair.a);
      used.add(pair.b);
    }
    expect(used.size).toBeGreaterThan(0);
    expect(p.warnings.length).toBe(p.dubious.length);
    expect(JSON.stringify(pairTubes(g, r.tube!))).toBe(JSON.stringify(p));
  }, 60_000);
});
