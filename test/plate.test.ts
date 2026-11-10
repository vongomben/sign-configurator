import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PLATE_PARAMS } from '../src/config';
import { plateToSvg } from '../src/export/plate';
import type { FontBytesReader } from '../src/fonts/loadFont';
import { buildPlate, plateChoiceOf, PLATE_MATERIALS, type PlateChoice } from '../src/geometry/plate';
import type { HousingModel } from '../src/geometry/housing';
import { getManifold } from '../src/geometry/manifold';
import { decodeShare, encodeShare } from '../src/order/share';
import { migrateOrder, type SignOrder } from '../src/order/schema';
import { generateSign } from '../src/worker/generate';

const readPublic: FontBytesReader = async (file) => {
  const b = await readFile(`public/${file}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** Due rettangoli staccati (come due lettere) e un ancoraggio. */
function twoBlocks(): Pick<HousingModel, 'outline' | 'holes'> {
  return {
    outline: [
      [[0, 0], [40, 0], [40, 20], [0, 20]],
      [[60, 0], [100, 0], [100, 20], [60, 20]],
    ],
    holes: {
      anchors: [{ kind: 'anchor', x: 20, y: 10, d: 3.2 }],
      cable: { kind: 'cable', x: 80, y: 10, d: 6 },
      wireSlots: [{ segmentId: 1, role: 'DIN', points: [[35, 8], [39, 8], [39, 12], [35, 12]] }],
      cornerPockets: [],
      dotWires: [],
    },
  };
}

const order = (plate: PlateChoice | null): SignOrder => ({
  schemaVersion: 2,
  generatorVersion: '0.2.0',
  source: { kind: 'text', text: 'Ciao', fontId: 'sacramento' },
  heightMm: 120,
  color: '#ff2fd6',
  params: {},
  paths: null,
  crossings: [],
  plate,
});

describe('fondale', () => {
  it('rettangolare: ingombro + margine, spessore del materiale, fori e montaggio negli angoli', async () => {
    const wasm = await getManifold();
    const plate = buildPlate(wasm, twoBlocks(), { shape: 'rect', material: 'wood', marginMm: 20 })!;
    try {
      expect(plate.widthMm).toBeCloseTo(140, 3);
      expect(plate.heightMm).toBeCloseTo(60, 3);
      expect(plate.thicknessMm).toBe(PLATE_MATERIALS.wood.thicknessMm);
      const kinds = plate.holes.map((h) => h.kind).sort();
      expect(kinds).toEqual(['cable', 'fix', 'mount', 'mount', 'mount', 'mount', 'wire']);
      const box = plate.solid.boundingBox();
      expect(box.min[2]).toBeCloseTo(-PLATE_MATERIALS.wood.thicknessMm, 6);
      expect(box.max[2]).toBeCloseTo(0, 6);
      // Un buco per foro: il genere della lastra è il numero dei fori.
      expect(plate.solid.genus()).toBe(plate.holes.length);
    } finally {
      plate.solid.delete();
    }
  });

  it('sagomato: un pezzo solo attorno alle due sagome, più piccolo del rettangolo, senza montaggio', async () => {
    const wasm = await getManifold();
    const contour = buildPlate(wasm, twoBlocks(), { shape: 'contour', material: 'smoke', marginMm: 8 })!;
    const rect = buildPlate(wasm, twoBlocks(), { shape: 'rect', material: 'smoke', marginMm: 8 })!;
    try {
      expect(contour.outline.length).toBe(1);
      expect(contour.areaMm2).toBeLessThan(rect.areaMm2);
      expect(contour.holes.some((h) => h.kind === 'mount')).toBe(false);
      expect(contour.thicknessMm).toBe(PLATE_MATERIALS.smoke.thicknessMm);
    } finally {
      contour.solid.delete();
      rect.solid.delete();
    }
  });

  it('un margine stretto toglie i fori di montaggio che cadrebbero sotto l\'insegna', async () => {
    const wasm = await getManifold();
    const plate = buildPlate(wasm, twoBlocks(), { shape: 'rect', material: 'smoke', marginMm: 5 })!;
    try {
      expect(plate.holes.some((h) => h.kind === 'mount')).toBe(false);
      expect(plate.warnings.join(' ')).toContain('montaggio');
    } finally {
      plate.solid.delete();
    }
  });

  it('SVG di taglio in mm, visto dal retro: fori blu, contorno rosso', async () => {
    const wasm = await getManifold();
    const plate = buildPlate(wasm, twoBlocks(), { shape: 'rect', material: 'wood', marginMm: 20 })!;
    plate.solid.delete();
    const svg = plateToSvg(plate);
    expect(svg).toContain('width="150mm"');
    expect(svg).toContain('height="70mm"');
    expect((svg.match(/<circle /g) ?? []).length).toBe(plate.holes.length);
    expect(svg).toContain('stroke="#ff0000"');
    // Vista dal retro: l'ancoraggio frontale a x = 20 sta a destra nel file.
    const fix = /cx="([\d.]+)"[^>]*data-kind="fix"/.exec(svg)!;
    expect(Number(fix[1])).toBeGreaterThan(75);
    expect(PLATE_PARAMS.FIX_HOLE_D).toBeGreaterThan(3.2);
  });

  it('il generatore lo restituisce solo se l\'ordine lo chiede', async () => {
    const none = await generateSign(order(null), readPublic);
    expect(none.plate).toBeNull();
    expect(none.plateMesh).toBeNull();
    const withPlate = await generateSign(order({ shape: 'contour', material: 'wood', marginMm: 15 }), readPublic);
    expect(withPlate.plate?.outline.length).toBe(1);
    expect(withPlate.plateMesh?.triVerts.length).toBeGreaterThan(0);
    // La lastra contiene l'insegna.
    expect(withPlate.plate!.widthMm).toBeGreaterThan(none.outline.flat().reduce((m, p) => Math.max(m, p[0]), 0) - 40);
  });

  it('passa per il link condiviso; un valore sbagliato si ignora con un avviso', () => {
    const link = encodeShare(migrateOrder(order({ shape: 'rect', material: 'smoke', marginMm: 25 })));
    const read = decodeShare(link.hash ?? '');
    expect(read.order?.plate).toEqual({ shape: 'rect', material: 'smoke', marginMm: 25 });
    expect(migrateOrder(order(null)).plate).toBeUndefined();
    const warnings: string[] = [];
    expect(plateChoiceOf({ shape: 'stella', material: 'wood' }, warnings)).toBeNull();
    expect(plateChoiceOf({ shape: 'rect', material: 'wood', marginMm: 500 }, warnings)?.marginMm).toBe(80);
    expect(warnings.length).toBe(2);
  });
});
