import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { meshToStl } from '../src/export/stl';
import type { FontBytesReader } from '../src/fonts/loadFont';
import { migrateOrder, type OrderV1, type SignOrder } from '../src/order/schema';
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

describe('ordine v2', () => {
  it('un ordine v1 migrato produce gli stessi STL e la stessa BOM', async () => {
    const v1: OrderV1 = {
      schemaVersion: 1,
      generatorVersion: '0.1.0',
      text: 'Ciao',
      fontId: 'sacramento',
      heightMm: 100,
      color: '#ff2fd6',
      params: { WALL: 3 },
    };
    const original: SignOrder = {
      schemaVersion: 2,
      generatorVersion: v1.generatorVersion,
      source: { kind: 'text', text: v1.text, fontId: v1.fontId },
      heightMm: v1.heightMm,
      color: v1.color,
      params: { WALL: 3 },
      paths: null,
      crossings: [],
    };
    const migrated = migrateOrder(v1);
    expect(migrated).toEqual(original);
    expect(migrateOrder(migrated)).toEqual(migrated);

    const fromV1 = await generateSign(v1, readPublic);
    const fromMigrated = await generateSign(migrated, readPublic);
    expect(sameBytes(meshToStl(fromV1.housingMesh), meshToStl(fromMigrated.housingMesh))).toBe(true);
    expect(sameBytes(meshToStl(fromV1.diffuserMesh), meshToStl(fromMigrated.diffuserMesh))).toBe(true);
    expect(fromMigrated.bom).toEqual(fromV1.bom);
  });
});
