import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { FontBytesReader } from '../src/fonts/loadFont';
import { buildGraph, type SkeletonGraph } from '../src/geometry/graph';
import { rasterize, rasterizeContours, type Contour, type Point } from '../src/geometry/rasterize';

const readPublic: FontBytesReader = async (file) => {
  const b = await readFile(`public/${file}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** Rettangolo (antiorario) lungo `length` e largo `width`, centrato in (cx, cy), ruotato di `deg`. */
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

function circle(r: number, n: number, ccw: boolean): Contour {
  return Array.from({ length: n }, (_, k) => {
    const a = ((ccw ? 1 : -1) * 2 * Math.PI * k) / n;
    return [r * Math.cos(a), r * Math.sin(a)] as Point;
  });
}

const graphOf = (contours: Contour[]): SkeletonGraph => buildGraph(rasterizeContours(contours));
const degrees = (g: SkeletonGraph): number[] => g.nodes.map((n) => n.degree).sort((a, b) => a - b);

describe('buildGraph (forme sintetiche, tratto 2 mm a 10 px/mm)', () => {
  it('linea: due estremi, un arco lungo quanto la linea meno le punte', () => {
    const g = graphOf([bar(25, 0, 50, 2, 0)]);
    expect(degrees(g)).toEqual([1, 1]);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]!.lengthMm).toBeGreaterThan(46);
    expect(g.edges[0]!.lengthMm).toBeLessThanOrEqual(50);
    expect(g.strokeWidthMm).toBeCloseTo(2, 0);
  });

  it('cerchio (anello): un solo anello chiuso, lungo 2π·r medio', () => {
    const g = graphOf([circle(10, 720, true), circle(8, 720, false)]);
    expect(degrees(g)).toEqual([2]);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]!.a).toBe(g.edges[0]!.b);
    expect(Math.abs(g.edges[0]!.lengthMm - 2 * Math.PI * 9) / (2 * Math.PI * 9)).toBeLessThan(0.03);
  });

  it('"X": un nodo di grado 4 al centro, quattro estremi', () => {
    const g = graphOf([bar(0, 0, 40, 2, 45), bar(0, 0, 40, 2, -45)]);
    expect(degrees(g)).toEqual([1, 1, 1, 1, 4]);
    expect(g.edges).toHaveLength(4);
    const center = g.nodes.find((n) => n.degree === 4)!;
    expect(Math.hypot(center.x, center.y)).toBeLessThan(g.strokeWidthMm);
  });

  it.each([20, 30, 40, 60])('"X" a %i°: le due giunzioni a Y si fondono in un nodo di grado 4', (deg) => {
    const g = graphOf([bar(0, 0, 40, 2, deg / 2), bar(0, 0, 40, 2, -deg / 2)]);
    expect(degrees(g)).toEqual([1, 1, 1, 1, 4]);
    expect(g.edges).toHaveLength(4);
    const center = g.nodes.find((n) => n.degree === 4)!;
    expect(Math.hypot(center.x, center.y)).toBeLessThan(g.strokeWidthMm);
  });

  it('"H" stretta: le due giunzioni a T restano distinte anche se vicine (traversa di 3 tratti)', () => {
    const g = graphOf([bar(-4, 0, 30, 2, 90), bar(4, 0, 30, 2, 90), bar(0, 0, 8, 2, 0)]);
    expect(degrees(g)).toEqual([1, 1, 1, 1, 3, 3]);
    expect(g.edges).toHaveLength(5);
    expect(g.mergedJunctions).toBe(0);
  });

  it('"T": un nodo di grado 3, tre estremi, nessun ramo spurio', () => {
    const g = graphOf([bar(0, 0, 40, 2, 0), bar(0, -10, 20, 2, 90)]);
    expect(degrees(g)).toEqual([1, 1, 1, 3]);
    expect(g.edges).toHaveLength(3);
    const j = g.nodes.find((n) => n.degree === 3)!;
    expect(Math.hypot(j.x, j.y)).toBeLessThan(g.strokeWidthMm);
  });

  it('forellino (area < tratto²) riempito: niente anello spurio', () => {
    const g = graphOf([bar(0, 0, 40, 4, 0), bar(0, 0, 0.3, 0.3, 0).reverse()]);
    expect(g.filledHoles).toBe(1);
    expect(degrees(g)).toEqual([1, 1]);
  });

  it('deterministico', () => {
    const shape = [bar(0, 0, 40, 2, 37), bar(3, 1, 30, 2, -61)];
    expect(JSON.stringify(graphOf(shape))).toBe(JSON.stringify(graphOf(shape)));
  });
});

describe('buildGraph su Sacramento (100 mm)', () => {
  const sacramento = (text: string, pxPerMm?: number) =>
    rasterize({ text, fontId: 'sacramento', heightMm: 100, ...(pxPerMm ? { pxPerMm } : {}) }, readPublic);
  const histogram = (g: SkeletonGraph): Record<number, number> => {
    const h: Record<number, number> = {};
    for (const n of g.nodes) h[n.degree] = (h[n.degree] ?? 0) + 1;
    return h;
  };
  /** Lunghezza minima degli archi che finiscono in un estremo, in larghezze del tratto. */
  const shortestEndEdge = (g: SkeletonGraph): number =>
    Math.min(
      ...g.edges
        .filter((e) => g.nodes[e.a]!.degree === 1 || g.nodes[e.b]!.degree === 1)
        .map((e) => e.lengthMm / g.strokeWidthMm),
    );

  it('"alebe": le asole di l, e, b si incrociano in nodi di grado 4, nessun ramo spurio', async () => {
    const r = await sacramento('alebe');
    const g = buildGraph(r);
    // Ogni nodo va all'ultimo glifo con l'origine alla sua sinistra.
    const owner = (x: number): number => r.glyphs.filter((gl) => gl.x <= x).length - 1;
    const crossingsPerGlyph = r.glyphs.map((_, k) => g.nodes.filter((n) => n.degree === 4 && owner(n.x) === k).length);
    expect(r.glyphs.map((gl) => gl.char).join('')).toBe('alebe');
    expect(crossingsPerGlyph).toEqual([0, 1, 1, 1, 1]);
    // Estremi veri: attacco e asta della "a", ricciolo della "b", uscita finale.
    expect(histogram(g)).toEqual({ 1: 4, 3: 2, 4: 4 });
    expect(shortestEndEdge(g)).toBeGreaterThan(1);
  });

  it('"alebe": stessa topologia a 8, 10 e 15 px/mm', async () => {
    const hs = [];
    for (const ppm of [8, 10, 15]) hs.push(histogram(buildGraph(await sacramento('alebe', ppm))));
    expect(hs[1]).toEqual(hs[0]);
    expect(hs[2]).toEqual(hs[0]);
  });

  it.each(['l', 'e', 'b'])(
    '"%s" isolata: il tratto parte dentro l\'asola, quindi grado 3 (non c\'è tratto d\'attacco da incrociare)',
    async (ch) => {
      const g = buildGraph(await sacramento(ch));
      expect(g.edges.some((e) => e.a === e.b)).toBe(true);
      expect(g.nodes.filter((n) => n.degree >= 4)).toHaveLength(0);
      expect(shortestEndEdge(g)).toBeGreaterThan(1);
    },
  );

  it('alfabeto minuscolo: nessun ramo più corto del tratto, topologia stabile fra 8 e 12 px/mm', async () => {
    for (const text of ['abcdefghijklm', 'nopqrstuvwxyz']) {
      const g = buildGraph(await sacramento(text));
      expect(shortestEndEdge(g), text).toBeGreaterThan(1);
      expect(g.nodes.filter((n) => n.degree >= 5), text).toHaveLength(0);
      const h8 = histogram(buildGraph(await sacramento(text, 8)));
      const h12 = histogram(buildGraph(await sacramento(text, 12)));
      expect(h12, text).toEqual(h8);
      expect(histogram(g), text).toEqual(h8);
    }
  }, 60_000);

  it('"Ciao Torino": i puntini delle due i restano anelli chiusi a sé (il buco non viene riempito)', async () => {
    const r = await sacramento('Ciao Torino');
    const g = buildGraph(r);
    const dots = r.glyphs.filter((gl) => gl.char === 'i').map((i) =>
      g.edges.filter((e) => {
        const n = g.nodes[e.a]!;
        return e.a === e.b && n.degree === 2 && n.y > r.xHeightMm && n.x > i.bbox!.minX && n.x < i.bbox!.maxX;
      }),
    );
    expect(dots.map((d) => d.length)).toEqual([1, 1]);
    expect(g.filledHoles).toBeLessThanOrEqual(1);
  });
});
