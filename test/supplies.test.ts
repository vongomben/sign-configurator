import { describe, expect, it } from 'vitest';
import { bomAssembly } from '../src/export/bom';
import { SUPPLIES, pickSupply } from '../src/parts/supplies';

describe('catalogo degli alimentatori', () => {
  it('dieci famiglie, ognuna con versioni solo a 5, 12 o 24 V', () => {
    expect(SUPPLIES).toHaveLength(10);
    expect(new Set(SUPPLIES.map((f) => f.id)).size).toBe(10);
    for (const family of SUPPLIES) {
      for (const v of family.variants) {
        expect([5, 12, 24]).toContain(v.volts);
        // Corrente nominale coerente con la potenza della famiglia (Mean Well arrotonda i watt).
        expect(v.volts * v.amps).toBeLessThanOrEqual(family.watts * 1.1);
      }
    }
  });

  it("l'adattatore con spina quando basta, poi l'LRS più piccolo", () => {
    expect(pickSupply(12, 4)?.variant.model).toBe('GST60A12-P1J');
    expect(pickSupply(5, 6)?.variant.model).toBe('GST60A05-P1J');
    expect(pickSupply(5, 7)?.variant.model).toBe('LRS-35-5');
    expect(pickSupply(12, 9)?.variant.model).toBe('LRS-150-12');
    expect(pickSupply(24, 9)?.variant.model).toBe('LRS-350-24');
  });

  it('salta le famiglie senza la tensione, mai gli LPV; null se nessuno basta', () => {
    // LRS-150 non ha 5 V: da 18 A si passa all'LRS-200.
    expect(pickSupply(5, 19)?.variant.model).toBe('LRS-200-5');
    expect(SUPPLIES.filter((f) => f.kind === 'waterproof').length).toBe(2);
    for (const a of [1, 3, 8, 14]) expect(pickSupply(24, a)?.family.kind).not.toBe('waterproof');
    expect(pickSupply(5, 61)).toBeNull();
    expect(pickSupply(12, 0)).toBeNull();
  });

  it('la distinta porta il modello consigliato', () => {
    const at12 = bomAssembly([], [], 100, 60, 12);
    expect(at12.supplyA).toBe(4);
    expect(at12.supply).toEqual({ model: 'GST60A12-P1J', family: 'gst60a', watts: 60, amps: 5 });
    expect(bomAssembly([], [], 0, 60, 12).supply).toBeNull();
  });
});

describe('disegni degli alimentatori', () => {
  it('uno per famiglia, alla stessa scala: il fronte è lungo L · ART_SCALE', async () => {
    const { ART_SCALE, supplyArt } = await import('../src/parts/supplyArt');
    for (const family of SUPPLIES) {
      const svg = supplyArt(family);
      expect(svg).toContain('viewBox="0 0 175 72"');
      expect(svg).toContain(`${family.name}, `);
      const front = /<rect x="[\d.]+" y="[\d.]+" width="([\d.]+)"/.exec(svg.slice(svg.indexOf('<rect')));
      expect(Number(front![1])).toBeCloseTo(family.sizeMm[0] * ART_SCALE, 0);
    }
  });
});
