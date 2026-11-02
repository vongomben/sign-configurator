import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { meshToStl } from '../src/export/stl';
import { mmToPx, rasterizeContours, type Contour, type Raster } from '../src/geometry/rasterize';
import type { SignOrder, SvgImageSource } from '../src/order/schema';
import { importSvg } from '../src/sources/svgImport';
import {
  IDENTITY,
  layoutSvg,
  multiply,
  normalizeShapes,
  parseTransform,
  type RawShape,
} from '../src/sources/svgPaths';
import { generateSign } from '../src/worker/generate';

const sameBytes = (a: ArrayBuffer, b: ArrayBuffer): boolean => {
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
};

function stroke(d: string, transform = IDENTITY): RawShape {
  return { d, transform, kind: 'stroke', fillRule: 'nonzero' };
}

function source(elements: SvgImageSource['svg']['elements'], name: string): SvgImageSource {
  return { kind: 'image', format: 'svg', name, trace: 'centerline', svg: { elements } };
}

function orderOf(image: SvgImageSource, heightMm: number): SignOrder {
  return {
    schemaVersion: 2,
    generatorVersion: '0.2.0',
    source: image,
    heightMm,
    color: '#ff2fd6',
    params: {},
    paths: null,
    crossings: [],
  };
}

function pixel(raster: Raster, xMm: number, yMm: number): number {
  const [px, py] = mmToPx(raster.pxToMm, xMm, yMm);
  const col = Math.min(raster.width - 1, Math.max(0, Math.floor(px)));
  const row = Math.min(raster.height - 1, Math.max(0, Math.floor(py)));
  return raster.data[row * raster.width + col] ?? 0;
}

function importInDom(svg: string, heightMm: number, name = 'prova.svg') {
  const window = new Window();
  const previous = { DOMParser: globalThis.DOMParser, document: globalThis.document };
  Object.assign(globalThis, { DOMParser: window.DOMParser, document: window.document });
  try {
    return importSvg(svg, { heightMm, name });
  } finally {
    Object.assign(globalThis, previous);
  }
}

describe('import SVG', () => {
  it('un path retto entra in [C] come tratto, alto heightMm', () => {
    const elements = normalizeShapes([stroke('M0 0 L0 100')], 40);
    expect(elements).toEqual([{ d: 'M0 40 L0 0', kind: 'stroke' }]);
    const laid = layoutSvg(source(elements, 'retta.svg'), 40);
    expect(laid.graph.edges).toHaveLength(1);
    expect(laid.graph.edges[0]!.a).not.toBe(laid.graph.edges[0]!.b);
    expect(laid.graph.edges[0]!.lengthMm).toBeCloseTo(40, 2);
    expect(laid.raster.glyphs.map((glyph) => glyph.char)).toEqual(['regione 1']);
    expect(laid.raster.data.some((value) => value)).toBe(false);
  });

  it('un anello è un tratto chiuso lungo la circonferenza', () => {
    const d = 'M100 50 A50 50 0 1 1 0 50 A50 50 0 1 1 100 50 Z';
    const elements = normalizeShapes([stroke(d)], 100);
    expect(elements[0]?.kind).toBe('stroke');
    const laid = layoutSvg(source(elements, 'anello.svg'), 100);
    expect(laid.graph.edges.some((edge) => edge.a === edge.b)).toBe(true);
    const length = laid.graph.edges.reduce((sum, edge) => sum + edge.lengthMm, 0);
    expect(length).toBeGreaterThan(Math.PI * 100 * 0.97);
    expect(length).toBeLessThan(Math.PI * 100 * 1.03);
  });

  it('compone i transform annidati prima di portare il disegno in mm', () => {
    const nested = multiply(parseTransform('translate(10,20)'), parseTransform('scale(2)'));
    const pure = normalizeShapes([stroke('M0 0 L0 50', nested)], 100);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(10,20)">
        <g transform="scale(2)">
          <path d="M0 0 L0 50" fill="none" stroke="black"/>
        </g>
      </g>
    </svg>`;
    const imported = importInDom(svg, 100, 'gruppi.svg');
    expect(imported.warnings).toEqual([]);
    expect(imported.source.svg.elements).toEqual(pure);
    const laid = layoutSvg(imported.source, 100);
    const points = laid.graph.edges[0]!.points;
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.02);
    expect(Math.min(...ys)).toBeCloseTo(0, 2);
    expect(Math.max(...ys)).toBeCloseTo(100, 2);
  });

  it('evenodd lascia il buco, nonzero lo riempie', () => {
    const outer: Contour = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    const inner: Contour = [
      [25, 25],
      [75, 25],
      [75, 75],
      [25, 75],
    ];
    const holePx = rasterizeContours([outer, inner], { fillRule: 'evenodd', pxPerMm: 4 });
    const solidPx = rasterizeContours([outer, inner], { fillRule: 'nonzero', pxPerMm: 4 });
    expect(pixel(holePx, 10, 50)).toBe(1);
    expect(pixel(holePx, 50, 50)).toBe(0);
    expect(pixel(solidPx, 50, 50)).toBe(1);

    const d = 'M0 0 L100 0 L100 100 L0 100 Z M25 25 L75 25 L75 75 L25 75 Z';
    const hole = layoutSvg(source([{ d, kind: 'fill', fillRule: 'evenodd' }], 'buco.svg'), 100, 4);
    expect(pixel(hole.raster, 10, 50)).toBe(1);
    expect(pixel(hole.raster, 50, 50)).toBe(0);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <path fill="#000" fill-rule="evenodd" d="M0 0 H100 V100 H0 Z M25 25 H75 V75 H25 Z"/>
    </svg>`;
    const imported = importInDom(svg, 100, 'buco.svg');
    expect(imported.source.svg.elements).toEqual([{ d: expect.any(String), kind: 'fill', fillRule: 'evenodd' }]);
    const fromDom = layoutSvg(imported.source, 100, 4);
    expect(pixel(fromDom.raster, 50, 50)).toBe(0);
    expect(pixel(fromDom.raster, 10, 50)).toBe(1);
  });

  it('lo stesso JSON normalizzato produce gli stessi STL e la stessa BOM', async () => {
    const elements = normalizeShapes([stroke('M0 0 L0 80')], 80);
    expect(JSON.stringify(normalizeShapes([stroke('M0 0 L0 80')], 80))).toBe(JSON.stringify(elements));
    const order = orderOf(source(elements, 'retta.svg'), 80);
    const again = JSON.parse(JSON.stringify(order)) as SignOrder;
    const first = await generateSign(order);
    const second = await generateSign(again);
    expect(first.housingMesh.triVerts.length).toBeGreaterThan(0);
    expect(sameBytes(meshToStl(first.housingMesh), meshToStl(second.housingMesh))).toBe(true);
    expect(sameBytes(meshToStl(first.diffuserMesh), meshToStl(second.diffuserMesh))).toBe(true);
    expect(second.bom).toEqual(first.bom);
  });

  it('avvisa sul testo e ignora l\'elemento', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <text x="0" y="10">Ciao</text>
      <path d="M0 0 L0 40" style="fill:none;stroke:#111"/>
    </svg>`;
    const imported = importInDom(svg, 40, 'testo.svg');
    expect(imported.warnings.some((warning) => warning.includes('text'))).toBe(true);
    expect(imported.source.svg.elements).toHaveLength(1);
    expect(imported.source.svg.elements[0]?.kind).toBe('stroke');
  });
});
