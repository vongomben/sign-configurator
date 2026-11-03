import { describe, expect, it } from 'vitest';
import { priceOrder, type PriceMeasure } from '../src/pricing';

const customer = { diffuser: true };

function atHeight(heightMm: number): PriceMeasure {
  const scale = heightMm / 100;
  return {
    outlineMm2: 4000 * scale * scale,
    channelMm2: 900 * scale * scale,
    stripMm: 350 * scale,
    segments: 3,
    solderJoints: 2,
    supplyA: 2,
    floorMm: 4,
    channelDepthMm: 8,
    diffuserThicknessMm: 1.2,
  };
}

describe('prezzo', () => {
  it('è deterministico e cresce con l\'altezza', () => {
    const low = priceOrder(customer, atHeight(100));
    const mid = priceOrder(customer, atHeight(150));
    const high = priceOrder(customer, atHeight(200));
    expect(priceOrder(customer, atHeight(100))).toEqual(low);
    expect(mid.total).toBeGreaterThanOrEqual(low.total);
    expect(high.total).toBeGreaterThan(low.total);
    const sum = high.breakdown.reduce((total, line) => total + line.amount, 0);
    expect(sum).toBeCloseTo(high.total, 2);
  });
});
