import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { GENERATOR_VERSION, PLATE_FIX_HOLE_D, PLATE_MARGIN_MAX, PLATE_T } from '../src/config';
import { plateToSvg } from '../src/export/plate';
import type { FontBytesReader } from '../src/fonts/loadFont';
import { buildPlate, plateBom, PLATE_MATERIALS, type PlateChoice } from '../src/geometry/plate';
import type { HousingModel } from '../src/geometry/housing';
import { getManifold } from '../src/geometry/manifold';
import { decodeShare, encodeShare } from '../src/order/share';
import { DEFAULT_CUSTOMER, migrateOrder, type SignOrderV4 } from '../src/order/schema';
import { generateSign } from '../src/worker/generate';

const readPublic: FontBytesReader = async (file) => {
  const b = await readFile(`public/${file}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** Due rettangoli staccati (come due lettere), un ancoraggio, il cavo e un'asola. */
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

const choice = (over: Partial<PlateChoice>): PlateChoice => ({
  shape: 'rect',
  material: 'wood',
  marginMm: 20,
  cornerRMm: 8,
  ...over,
});

const order = (plate: PlateChoice | null): SignOrderV4 => ({
  schemaVersion: 4,
  generatorVersion: GENERATOR_VERSION,
  pricingVersion: null,
  source: { kind: 'text', text: 'Ciao', fontId: 'sacramento' },
  heightMm: 120,
  sizePreset: 'M',
  color: '#ff2fd6',
  params: {},
  paths: null,
  crossings: [],
  customer: { ...DEFAULT_CUSTOMER },
  plate,
});

describe('fondale', () => {
  it('rettangolare: ingombro + margine, spessore del materiale, fori e montaggio negli angoli', async () => {
    const wasm = await getManifold();
    const plate = buildPlate(wasm, twoBlocks(), choice({}))!;
    try {
      expect(plate.widthMm).toBeCloseTo(140, 3);
      expect(plate.heightMm).toBeCloseTo(60, 3);
      expect(plate.thicknessMm).toBe(PLATE_T.wood);
      const kinds = plate.holes.map((h) => h.kind).sort();
      expect(kinds).toEqual(['cable', 'fix', 'mount', 'mount', 'mount', 'mount', 'wire']);
      expect(plate.holes.find((h) => h.kind === 'fix')!.d).toBe(PLATE_FIX_HOLE_D);
      const box = plate.solid.boundingBox();
      expect(box.min[2]).toBeCloseTo(-PLATE_T.wood, 6);
      expect(box.max[2]).toBeCloseTo(0, 6);
      // Un buco per foro: il genere della lastra è il numero dei fori.
      expect(plate.solid.genus()).toBe(plate.holes.length);
    } finally {
      plate.solid.delete();
    }
  });

  it('i tre materiali hanno ciascuno il proprio spessore', async () => {
    const wasm = await getManifold();
    for (const material of ['clear', 'black', 'wood'] as const) {
      const plate = buildPlate(wasm, twoBlocks(), choice({ material }))!;
      expect(plate.thicknessMm).toBe(PLATE_T[material]);
      expect(PLATE_MATERIALS[material].thicknessMm).toBe(PLATE_T[material]);
      plate.solid.delete();
    }
    expect(PLATE_MATERIALS.black.label).toBe('Plexi nero trasparente');
  });

  it('pillola: raggio pari a metà del lato corto, area minore del rettangolo, montaggio sulle teste', async () => {
    const wasm = await getManifold();
    const pill = buildPlate(wasm, twoBlocks(), choice({ shape: 'pill' }))!;
    const rect = buildPlate(wasm, twoBlocks(), choice({ shape: 'rect', cornerRMm: 0 }))!;
    try {
      expect(pill.widthMm).toBeCloseTo(140, 1);
      expect(pill.heightMm).toBeCloseTo(60, 1);
      // Rettangolo 140×60 con teste da raggio 30: 140·60 − (4 − π)·30².
      // Archi poligonali a 48 lati: qualche mm² in meno del cerchio vero.
      expect(Math.abs(pill.areaMm2 - (140 * 60 - (4 - Math.PI) * 900))).toBeLessThan(20);
      expect(rect.areaMm2).toBeCloseTo(140 * 60, 0);
      expect(pill.holes.filter((h) => h.kind === 'mount')).toHaveLength(2);
    } finally {
      pill.solid.delete();
      rect.solid.delete();
    }
  });

  it('sagomato: un pezzo solo attorno alle due sagome, più piccolo del rettangolo, senza montaggio', async () => {
    const wasm = await getManifold();
    const contour = buildPlate(wasm, twoBlocks(), choice({ shape: 'contour', material: 'black', marginMm: 10 }))!;
    const rect = buildPlate(wasm, twoBlocks(), choice({ shape: 'rect', material: 'black', marginMm: 10 }))!;
    try {
      expect(contour.outline.length).toBe(1);
      expect(contour.areaMm2).toBeLessThan(rect.areaMm2);
      expect(contour.holes.some((h) => h.kind === 'mount')).toBe(false);
    } finally {
      contour.solid.delete();
      rect.solid.delete();
    }
  });

  it('un margine stretto toglie i fori di montaggio che cadrebbero sotto l\'insegna', async () => {
    const wasm = await getManifold();
    const plate = buildPlate(wasm, twoBlocks(), choice({ marginMm: 10, cornerRMm: 0 }))!;
    try {
      expect(plate.holes.some((h) => h.kind === 'mount')).toBe(false);
      expect(plate.warnings.join(' ')).toContain('montaggio');
    } finally {
      plate.solid.delete();
    }
  });

  it('il margine resta nei limiti di config', async () => {
    const wasm = await getManifold();
    const plate = buildPlate(wasm, twoBlocks(), choice({ marginMm: 500 }))!;
    expect(plate.choice.marginMm).toBe(PLATE_MARGIN_MAX);
    plate.solid.delete();
  });

  it('SVG di taglio in mm, visto dal retro: fori blu, contorno rosso', async () => {
    const wasm = await getManifold();
    const plate = buildPlate(wasm, twoBlocks(), choice({}))!;
    plate.solid.delete();
    const svg = plateToSvg(plate);
    expect(svg).toContain('width="150mm"');
    expect(svg).toContain('height="70mm"');
    expect((svg.match(/<circle /g) ?? []).length).toBe(plate.holes.length);
    expect(svg).toContain('stroke="#ff0000"');
    // Vista dal retro: l'ancoraggio frontale a x = 20 sta a destra nel file.
    const fix = /cx="([\d.]+)"[^>]*data-kind="fix"/.exec(svg)!;
    expect(Number(fix[1])).toBeGreaterThan(75);
  });

  it('BOM del fondale: misure, taglio e fori per tipo', async () => {
    const wasm = await getManifold();
    const plate = buildPlate(wasm, twoBlocks(), choice({ cornerRMm: 0 }))!;
    plate.solid.delete();
    const bom = plateBom(plate);
    expect(bom).toMatchObject({ shape: 'rect', material: 'wood', widthMm: 140, heightMm: 60, thicknessMm: PLATE_T.wood });
    expect(bom.fixHoles).toBe(1);
    expect(bom.mountHoles).toBe(4);
    expect(bom.wireHoles).toBe(2);
    const holes = plate.holes.reduce((sum, h) => sum + Math.PI * h.d, 0);
    expect(bom.cutLengthMm).toBeCloseTo(2 * (140 + 60) + holes, 0);
  });

  it('il generatore lo restituisce solo se l\'ordine v4 lo chiede, anche nella BOM', async () => {
    const none = await generateSign(order(null), readPublic);
    expect(none.plate).toBeNull();
    expect(none.plateMesh).toBeNull();
    expect(none.bom.plate).toBeNull();
    const withPlate = await generateSign(order(choice({ shape: 'contour', marginMm: 15 })), readPublic);
    expect(withPlate.plate?.outline.length).toBe(1);
    expect(withPlate.plateMesh?.triVerts.length).toBeGreaterThan(0);
    expect(withPlate.bom.plate?.shape).toBe('contour');
    // Gli STL dell'insegna non cambiano col fondale.
    expect(withPlate.housingMesh.triVerts.length).toBe(none.housingMesh.triVerts.length);
  });

  it('passa per il link condiviso', () => {
    const plate = choice({ shape: 'pill', material: 'black', marginMm: 25 });
    const link = encodeShare(migrateOrder(order(plate)));
    const read = decodeShare(link.hash ?? '');
    expect(read.order?.plate).toEqual(plate);
  });
});
