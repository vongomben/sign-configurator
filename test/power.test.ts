import { describe, expect, it } from 'vitest';
import { CONTROLLER, DEFAULT_PARAMS, GENERATOR_VERSION, STRIP_VOLTAGES } from '../src/config';
import { bomAssembly } from '../src/export/bom';
import { decodeShare, encodeShare } from '../src/order/share';
import { DEFAULT_CUSTOMER, migrateOrder } from '../src/order/schema';
import { techParams, voltageOptions } from '../src/ui/techParams';

describe('alimentatore e controller', () => {
  it('a parità di LED la corrente scala con la tensione', () => {
    const at = (v: number) => bomAssembly([], [], 100, DEFAULT_PARAMS.LED_MAX_MA, v);
    expect(at(5).maxCurrentA).toBeCloseTo(6, 6);
    expect(at(12).maxCurrentA).toBeCloseTo(2.5, 6);
    expect(at(24).maxCurrentA).toBeCloseTo(1.25, 6);
    expect(at(5).supplyA).toBe(8);
    expect(at(12).supplyA).toBe(4);
    expect(at(24).supplyA).toBe(2);
    expect(at(12).voltageV).toBe(12);
    // Una tensione sconosciuta vale 5 V.
    expect(at(9).voltageV).toBe(5);
  });

  it('avvisa oltre i 10 A e oltre gli 800 LED del controller', () => {
    const ok = bomAssembly([], [], 100, DEFAULT_PARAMS.LED_MAX_MA, 5);
    expect(ok.controllerWarnings).toEqual([]);
    const amps = bomAssembly([], [], 200, DEFAULT_PARAMS.LED_MAX_MA, 5);
    expect(amps.supplyA).toBeGreaterThan(CONTROLLER.maxA);
    expect(amps.controllerWarnings.join(' ')).toContain(`${CONTROLLER.maxA} A`);
    const leds = bomAssembly([], [], 900, DEFAULT_PARAMS.LED_MAX_MA, 24);
    expect(leds.controllerWarnings.join(' ')).toContain(`${CONTROLLER.maxIcs} IC`);
    // A 24 V gli stessi 200 LED restano sotto il limite di corrente.
    expect(bomAssembly([], [], 200, DEFAULT_PARAMS.LED_MAX_MA, 24).controllerWarnings).toEqual([]);
  });

  it('il menu offre 5, 12 e 24 V e scrive la tensione solo se non è quella predefinita', () => {
    expect(STRIP_VOLTAGES).toEqual([5, 12, 24]);
    expect(voltageOptions().map((o) => o.value)).toEqual([5, 12, 24]);
    expect(techParams({ numbers: {}, edgeProfile: 'square', stripV: '12' })).toEqual({ STRIP_V: 12 });
    expect(techParams({ numbers: {}, edgeProfile: 'square', stripV: '5' })).toEqual({});
    expect(techParams({ numbers: {}, edgeProfile: 'square', stripV: '9' })).toEqual({});
  });

  it('la tensione passa per il link condiviso; una sconosciuta si ignora con un avviso', () => {
    const order = migrateOrder({
      schemaVersion: 4,
      generatorVersion: GENERATOR_VERSION,
      pricingVersion: null,
      source: { kind: 'text', text: 'Ciao', fontId: 'sacramento' },
      heightMm: 120,
      sizePreset: 'M',
      color: '#ff2fd6',
      params: { STRIP_V: 24 },
      paths: null,
      crossings: [],
      customer: { ...DEFAULT_CUSTOMER },
      plate: null,
    });
    expect(decodeShare(encodeShare(order).hash ?? '').order?.params.STRIP_V).toBe(24);
    const bad = decodeShare(encodeShare({ ...order, params: { STRIP_V: 9 } }).hash ?? '');
    expect(bad.order?.params.STRIP_V).toBeUndefined();
    expect(bad.warnings.join(' ')).toContain('9 V');
  });
});
