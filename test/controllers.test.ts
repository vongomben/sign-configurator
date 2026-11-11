import { describe, expect, it } from 'vitest';
import { CONTROLLER, CONTROLLERS, DEFAULT_PARAMS, GENERATOR_VERSION, controllerOf } from '../src/config';
import { bomAssembly } from '../src/export/bom';
import { migrateOrder } from '../src/order/schema';
import { decodeShare, encodeShare } from '../src/order/share';
import { controllerOptions, techParams } from '../src/ui/techParams';

describe('controller', () => {
  it('il GLEDOPTO Ultra Mini resta lo standard; gli id sono unici e coprono 5–24 V', () => {
    expect(CONTROLLER.model).toBe('GL-C-309WL');
    expect(DEFAULT_PARAMS.CONTROLLER_ID).toBe(CONTROLLER.id);
    expect(new Set(CONTROLLERS.map((c) => c.id)).size).toBe(CONTROLLERS.length);
    for (const c of CONTROLLERS) {
      expect(c.minV).toBeLessThanOrEqual(5);
      expect(c.maxV).toBeGreaterThanOrEqual(24);
    }
    expect(CONTROLLERS.some((c) => c.brand === 'QuinLED')).toBe(true);
    expect(controllerOf('boh')).toBe(CONTROLLER);
  });

  it('i limiti degli avvisi seguono il controller scelto', () => {
    // 200 LED a 60 mA, 5 V: 12 A, 15 A con il margine.
    const small = bomAssembly([], [], 200, 60, 5);
    expect(small.supplyA).toBe(15);
    expect(small.controller).toBe('gl-c-309wl');
    expect(small.controllerWarnings.join(' ')).toContain('10 A');
    const quad = bomAssembly([], [], 200, 60, 5, 'quinled-dig-quad');
    expect(quad.controller).toBe('quinled-dig-quad');
    expect(quad.controllerWarnings).toEqual([]);
    // Troppi LED per l'Ultra Mini, non per il Dig-Quad.
    expect(bomAssembly([], [], 1000, 1, 24).controllerWarnings.join(' ')).toContain('800 IC');
    expect(bomAssembly([], [], 1000, 1, 24, 'quinled-dig-quad').controllerWarnings).toEqual([]);
  });

  it('va nell\'ordine solo se diverso dallo standard, e passa per il link', () => {
    expect(controllerOptions().filter((o) => o.isDefault).map((o) => o.value)).toEqual([CONTROLLER.id]);
    expect(techParams({ numbers: {}, edgeProfile: 'square', controller: CONTROLLER.id })).toEqual({});
    expect(techParams({ numbers: {}, edgeProfile: 'square', controller: 'nope' })).toEqual({});
    const params = techParams({ numbers: {}, edgeProfile: 'square', controller: 'quinled-dig-uno' });
    expect(params).toEqual({ CONTROLLER_ID: 'quinled-dig-uno' });
    const order = migrateOrder({
      schemaVersion: 2,
      generatorVersion: GENERATOR_VERSION,
      source: { kind: 'text', text: 'Ciao', fontId: 'sacramento' },
      heightMm: 120,
      color: '#ff2fd6',
      params,
      paths: null,
      crossings: [],
    });
    const read = decodeShare(encodeShare(order).hash ?? '');
    expect(read.order?.params).toEqual(params);
    const bad = decodeShare(encodeShare({ ...order, params: { CONTROLLER_ID: 'xyz' } }).hash ?? '');
    expect(bad.order?.params.CONTROLLER_ID).toBeUndefined();
    expect(bad.warnings.join(' ')).toContain('Controller');
  });
});

describe('disegni dei controller', () => {
  it('uno per controller; senza misure del costruttore la sagoma è tratteggiata e lo dice', async () => {
    const { controllerArt } = await import('../src/parts/controllerArt');
    for (const c of CONTROLLERS) {
      const svg = controllerArt(c);
      expect(svg).toContain(`${c.name}, `);
      expect(svg.includes('size not published')).toBe(c.sizeMm === null);
      expect(svg.includes('stroke-dasharray')).toBe(c.sizeMm === null);
    }
  });
});
