import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PLATE_MAX_H, PLATE_MAX_W, PLATE_WIRE_HOLES } from '../src/config';
import { meshToStl } from '../src/export/stl';
import type { FontBytesReader } from '../src/fonts/loadFont';
import {
  DEFAULT_CUSTOMER,
  migrateOrder,
  type OrderV1,
  type SignOrder,
  type SignOrderV3,
} from '../src/order/schema';
import { generateSign, type GenerateResult } from '../src/worker/generate';

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

function geometryBom(bom: GenerateResult['bom']): Omit<GenerateResult['bom'], 'plate'> {
  const { plate: _plate, ...rest } = bom;
  return rest;
}

describe('ordine v4', () => {
  it('PLATE_WIRE_HOLES è attivo e il piano laser non blocca finché è null', () => {
    expect(PLATE_WIRE_HOLES).toBe(true);
    expect(PLATE_MAX_W).toBeNull();
    expect(PLATE_MAX_H).toBeNull();
  });

  it('v1, v2 e v3 migrati a v4 danno gli stessi STL e la BOM di prima più plate null', async () => {
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
    const v3: SignOrderV3 = {
      schemaVersion: 3,
      generatorVersion: v1.generatorVersion,
      pricingVersion: '2026-11',
      source: v2.source,
      heightMm: v1.heightMm,
      sizePreset: 'M',
      color: v1.color,
      params: { WALL: 3 },
      paths: null,
      crossings: [],
      customer: { ...DEFAULT_CUSTOMER, diffuser: false, effect: 'arcobaleno' },
    };
    const fromV1 = migrateOrder(v1);
    const fromV2 = migrateOrder(v2);
    const fromV3 = migrateOrder(v3);
    expect(fromV1).toEqual(fromV2);
    expect(fromV1.schemaVersion).toBe(4);
    expect(fromV1.customer).toEqual(DEFAULT_CUSTOMER);
    expect(fromV1.customer.effect).toBe('colore fisso');
    expect(fromV1.sizePreset).toBeNull();
    expect(fromV1.pricingVersion).toBeNull();
    expect(fromV1.plate).toBeNull();
    expect(fromV3.plate).toBeNull();
    expect(fromV3.customer).toEqual(v3.customer);
    expect(fromV3.pricingVersion).toBe('2026-11');
    expect(fromV3.sizePreset).toBe('M');
    expect(migrateOrder(fromV1)).toEqual(fromV1);
    expect(migrateOrder(fromV3)).toEqual(fromV3);

    const rawV1 = await generateSign(v1, readPublic);
    const rawV2 = await generateSign(v2, readPublic);
    const rawV3 = await generateSign(v3, readPublic);
    const migratedV1 = await generateSign(fromV1, readPublic);
    const migratedV2 = await generateSign(fromV2, readPublic);
    const migratedV3 = await generateSign(fromV3, readPublic);
    for (const [raw, migrated] of [
      [rawV1, migratedV1],
      [rawV2, migratedV2],
      [rawV3, migratedV3],
    ] as const) {
      expect(sameBytes(meshToStl(raw.housingMesh), meshToStl(migrated.housingMesh))).toBe(true);
      expect(sameBytes(meshToStl(raw.diffuserMesh), meshToStl(migrated.diffuserMesh))).toBe(true);
      expect(migrated.bom.plate).toBeNull();
      expect(migrated.bom).toEqual({ ...geometryBom(raw.bom), plate: null });
    }
    // Sei generazioni complete: oltre i 5 s di default.
  }, 30_000);
});
