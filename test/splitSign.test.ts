import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { FontBytesReader } from '../src/fonts/loadFont';
import { BED_MARGIN, SPLIT_CLEARANCE } from '../src/geometry/split';
import type { SignOrderV4 } from '../src/order/schema';
import { DEFAULT_CUSTOMER } from '../src/order/schema';
import { generateSign, type MeshData } from '../src/worker/generate';

const readPublic: FontBytesReader = async (file) => {
  const b = await readFile(`public/${file}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

function order(text: string, params: SignOrderV4['params'] = {}): SignOrderV4 {
  return {
    schemaVersion: 4,
    generatorVersion: 'test',
    pricingVersion: null,
    source: { kind: 'text', text, fontId: 'sacramento' },
    heightMm: 120,
    sizePreset: 'M',
    color: '#ff2fd6',
    params,
    paths: null,
    crossings: [],
    customer: { ...DEFAULT_CUSTOMER },
    plate: null,
  };
}

/** Quante linee centrali attraversa la retta verticale x = costante. */
function channelsAt(centerlines: readonly { points: [number, number][] }[], x: number): number {
  let n = 0;
  for (const line of centerlines) {
    for (let i = 0; i < line.points.length - 1; i++) {
      const a = line.points[i]!;
      const b = line.points[i + 1]!;
      if ((a[0] - x) * (b[0] - x) > 0) continue;
      if (a[0] === x && b[0] === x) continue;
      if (b[0] === x && i < line.points.length - 2) continue;
      n++;
    }
  }
  return n;
}

function xExtent(mesh: MeshData): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp) {
    const x = mesh.vertProperties[i]!;
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return { min, max };
}

/** Volume racchiuso dalla mesh, dal teorema della divergenza. */
function volume(mesh: MeshData): number {
  const v = mesh.vertProperties;
  const n = mesh.numProp;
  let total = 0;
  for (let i = 0; i < mesh.triVerts.length; i += 3) {
    const a = mesh.triVerts[i]! * n;
    const b = mesh.triVerts[i + 1]! * n;
    const c = mesh.triVerts[i + 2]! * n;
    total +=
      v[a]! * (v[b + 1]! * v[c + 2]! - v[b + 2]! * v[c + 1]!) -
      v[a + 1]! * (v[b]! * v[c + 2]! - v[b + 2]! * v[c]!) +
      v[a + 2]! * (v[b]! * v[c + 1]! - v[b + 1]! * v[c]!);
  }
  return total / 6;
}

describe('insegna divisa per il piatto di stampa', () => {
  it('«Ciao» a 12 cm sta sul piatto da 300 mm: nessun taglio', async () => {
    const result = await generateSign(order('Ciao'), readPublic);
    expect(result.split).toBeNull();
  }, 120_000);

  it('«Ciao Torino» si divide: ogni pezzo sta sul piatto e insieme rifanno l\'insegna', async () => {
    const result = await generateSign(order('Ciao Torino'), readPublic);
    const split = result.split;
    expect(split).not.toBeNull();
    const pieces = split!.housing;
    expect(pieces.length).toBe(split!.cutsX.length + 1);
    expect(split!.diffuser.length).toBe(pieces.length);
    for (const piece of pieces) {
      expect(piece.triVerts.length).toBeGreaterThan(0);
      const { min, max } = xExtent(piece);
      expect(max - min).toBeLessThanOrEqual(300 - 2 * BED_MARGIN + 1e-3);
    }
    // Il materiale tolto è solo l'aria dei tagli: una fetta larga 2·SPLIT_CLEARANCE per taglio.
    const whole = volume(result.housingMesh);
    const sum = pieces.reduce((total, piece) => total + volume(piece), 0);
    expect(sum).toBeLessThan(whole);
    expect(sum).toBeGreaterThan(whole * 0.995);
    expect(2 * SPLIT_CLEARANCE).toBeLessThan(0.5);
    // Il taglio cade dove la striscia è già interrotta: al massimo un giunto attraversa un canale,
    // e l'avviso lo dice. Prima della taratura dei costi li attraversavano tutti e due.
    const onChannel = split!.cutsX.filter((x) => channelsAt(result.centerlines, x) > 0).length;
    expect(onChannel).toBeLessThanOrEqual(1);
    const notice = result.warnings.filter((w) => w.startsWith('Suddivisione per il piatto:'));
    expect(notice).toHaveLength(onChannel > 0 ? 1 : 0);
    if (onChannel > 0) expect(notice[0]).toMatch(/canale acceso/);
  }, 120_000);

  it('con un piatto più grande torna in un pezzo; il risultato è deterministico', async () => {
    const big = await generateSign(order('Ciao Torino', { BED_W: 1000 }), readPublic);
    expect(big.split).toBeNull();
    const a = await generateSign(order('Ciao Torino'), readPublic);
    const b = await generateSign(order('Ciao Torino'), readPublic);
    expect(a.split!.cutsX).toEqual(b.split!.cutsX);
  }, 240_000);
});
