import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { meshToStl } from '../src/export/stl';
import type { FontBytesReader } from '../src/fonts/loadFont';
import { DEFAULT_CUSTOMER, migrateOrder, type OrderV1, type SignOrder } from '../src/order/schema';
import { generateSign } from '../src/worker/generate';

const readPublic: FontBytesReader = async (file) => {
  const b = await readFile(`public/${file}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

const sameBytes = (a: ArrayBuffer, b: ArrayBuffer): boolean => {
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
};

describe('ordine v3', () => {
  it('un ordine v1 e uno v2 migrati a v3 producono gli stessi STL e la stessa BOM', async () => {
    const v1: OrderV1 = {
      schemaVersion: 1,
      generatorVersion: '0.1.0',
      text: 'Ciao',
      fontId: 'sacramento',
      heightMm: 100,
      color: '#ff2fd6',
      params: { WALL: 3 },
    };
    const v2: SignOrder = {
      schemaVersion: 2,
      generatorVersion: v1.generatorVersion,
      source: { kind: 'text', text: v1.text, fontId: v1.fontId },
      heightMm: v1.heightMm,
      color: v1.color,
      params: { WALL: 3 },
      paths: null,
      crossings: [],
    };
    const fromV1 = migrateOrder(v1);
    const fromV2 = migrateOrder(v2);
    expect(fromV1).toEqual(fromV2);
    expect(fromV1.schemaVersion).toBe(3);
    expect(fromV1.customer).toEqual(DEFAULT_CUSTOMER);
    expect(fromV1.sizePreset).toBeNull();
    expect(fromV1.pricingVersion).toBeNull();
    expect(migrateOrder(fromV1)).toEqual(fromV1);

    const rawV1 = await generateSign(v1, readPublic);
    const rawV2 = await generateSign(v2, readPublic);
    const migratedV1 = await generateSign(fromV1, readPublic);
    const migratedV2 = await generateSign(fromV2, readPublic);
    expect(sameBytes(meshToStl(rawV1.housingMesh), meshToStl(migratedV1.housingMesh))).toBe(true);
    expect(sameBytes(meshToStl(rawV1.diffuserMesh), meshToStl(migratedV1.diffuserMesh))).toBe(true);
    expect(migratedV1.bom).toEqual(rawV1.bom);
    expect(sameBytes(meshToStl(rawV2.housingMesh), meshToStl(migratedV2.housingMesh))).toBe(true);
    expect(sameBytes(meshToStl(rawV2.diffuserMesh), meshToStl(migratedV2.diffuserMesh))).toBe(true);
    expect(migratedV2.bom).toEqual(rawV2.bom);
  });
});
