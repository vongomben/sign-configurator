import { describe, expect, it } from 'vitest';
import { SHARE_LINK_MAX_BYTES, decodeShare, encodeShare } from '../src/order/share';
import { migrateOrder, type SignOrder } from '../src/order/schema';

function sample(): SignOrder {
  return {
    schemaVersion: 2,
    generatorVersion: '0.2.0',
    source: { kind: 'text', text: 'Città', fontId: 'sacramento' },
    heightMm: 120,
    color: '#ff2fd6',
    params: { WALL: 2.2 },
    paths: null,
    crossings: [],
  };
}

describe('condivisione', () => {
  it('hash e ordine tornano identici', () => {
    const order = migrateOrder(sample());
    const link = encodeShare(order);
    expect(link.hash).toMatch(/^#o=[A-Za-z0-9_-]+$/);
    const read = decodeShare(link.hash ?? '');
    expect(read.warnings).toEqual([]);
    expect(read.order).toEqual(order);
    expect(decodeShare(link.json).order).toEqual(order);
  });

  it('un hash malformato dà un avviso e non lancia', () => {
    for (const input of ['', '#o=', '#o=%%%', '#o=aaaa', 'non-è-un-link']) {
      const read = decodeShare(input);
      expect(read.order).toBeNull();
      expect(read.warnings.length).toBeGreaterThan(0);
    }
  });

  it('oltre 8 kB non c\'è il link, il json sì', () => {
    const order = migrateOrder({
      ...sample(),
      source: { kind: 'text', text: 'x'.repeat(20_000), fontId: 'sacramento' },
    });
    const link = encodeShare(order);
    expect(link.bytes).toBeGreaterThan(SHARE_LINK_MAX_BYTES);
    expect(link.hash).toBeNull();
    expect(decodeShare(link.json).order).toEqual(order);
  });

  it('un valore fuori limite si riporta al limite e un campo sconosciuto si ignora', () => {
    const order = migrateOrder(sample());
    const json = JSON.stringify({ ...order, heightMm: 2000, email: 'a@b.c' });
    const read = decodeShare(json);
    expect(read.order?.heightMm).toBe(800);
    expect(read.warnings.some((warning) => warning.includes('Altezza'))).toBe(true);
    expect(read.warnings.some((warning) => warning.includes('email'))).toBe(true);
    expect(JSON.stringify(read.order)).not.toContain('email');
  });

  it('margine e raggio fuori limite si riportano al limite; forma o materiale sconosciuti tolgono il fondale', () => {
    const order = migrateOrder(sample());
    const wide = decodeShare(JSON.stringify({
      ...order,
      plate: { shape: 'rect', material: 'clear', marginMm: 80, cornerRMm: -2 },
    }));
    expect(wide.order?.plate).toEqual({ shape: 'rect', material: 'clear', marginMm: 60, cornerRMm: 0 });
    expect(wide.warnings.some((warning) => warning.includes('Margine'))).toBe(true);
    expect(wide.warnings.some((warning) => warning.includes('Raggio'))).toBe(true);

    const raw = JSON.parse(JSON.stringify(order)) as { customer: { effect: string }; plate?: unknown };
    raw.customer.effect = 'fisso';
    raw.plate = { shape: 'round', material: 'glass', marginMm: 20, cornerRMm: 8 };
    const unknown = decodeShare(JSON.stringify(raw));
    expect(unknown.order?.plate).toBeNull();
    expect(unknown.order?.customer.effect).toBe('colore fisso');
    expect(unknown.warnings.some((warning) => warning.includes('Fondale'))).toBe(true);
    expect(unknown.warnings.some((warning) => warning.includes('Effetto'))).toBe(true);
  });
});
