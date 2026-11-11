import { describe, expect, it } from 'vitest';
import { GENERATOR_VERSION } from '../src/config';
import { decodeShare, encodeShare } from '../src/order/share';
import { DEFAULT_CUSTOMER, migrateOrder, type PlugType } from '../src/order/schema';
import { PLUGS, plugOf } from '../src/ui/plugs';

const order = (plug: string) =>
  migrateOrder({
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
    customer: { ...DEFAULT_CUSTOMER, plug: plug as PlugType },
    plate: null,
  });

describe('spina dell\'alimentatore', () => {
  it('quattro spine, ciascuna con sigla, paesi e icona; predefinita la europea', () => {
    expect(PLUGS.map((p) => p.value)).toEqual(['EU', 'UK', 'CH', 'US']);
    for (const plug of PLUGS) {
      expect(plug.label.length).toBeGreaterThan(3);
      expect(plug.icon).toContain('<svg');
    }
    expect(DEFAULT_CUSTOMER.plug).toBe('EU');
    expect(plugOf('UK').label).toContain('UK & Ireland');
    expect(plugOf('XX').value).toBe('EU');
  });

  it('la spina passa per il link condiviso; una sconosciuta torna EU con un avviso', () => {
    for (const plug of ['EU', 'UK', 'CH', 'US']) {
      expect(decodeShare(encodeShare(order(plug)).hash ?? '').order?.customer.plug).toBe(plug);
    }
    const read = decodeShare(encodeShare(order('XX')).hash ?? '');
    expect(read.order?.customer.plug).toBe('EU');
    expect(read.warnings.join(' ')).toContain('Spina sconosciuta');
  });
});
