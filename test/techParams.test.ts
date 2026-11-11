import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, GENERATOR_VERSION } from '../src/config';
import { migrateOrder } from '../src/order/schema';
import { decodeShare, encodeShare } from '../src/order/share';
import { DEFAULT_LED_DENSITY, LED_DENSITIES, TECH_FIELDS, ledDensityOptions, techFieldInvalid, techParams } from '../src/ui/techParams';
import { lightPointsFromChains } from '../src/geometry/lights';
import type { Point } from '../src/geometry/rasterize';

describe('parametri tecnici della pagina cliente', () => {
  it('i valori predefiniti non scrivono override', () => {
    const numbers = Object.fromEntries(TECH_FIELDS.map((f) => [f.key, String(DEFAULT_PARAMS[f.key])]));
    expect(techParams({ numbers, edgeProfile: DEFAULT_PARAMS.EDGE_PROFILE })).toEqual({});
  });

  it('scrive solo i valori cambiati e validi', () => {
    const params = techParams({
      numbers: { STRIP_T: '1.6', CHANNEL_DEPTH: '10', CHANNEL_W: 'abc', FLOOR: '999', WIRE_SLOT_L: '' },
      edgeProfile: 'outer',
    });
    expect(params).toEqual({ STRIP_T: 1.6, CHANNEL_DEPTH: 10, EDGE_PROFILE: 'outer' });
  });

  it('un profilo sconosciuto resta al default', () => {
    expect(techParams({ numbers: {}, edgeProfile: 'tondo' })).toEqual({});
  });

  it('segna come non valido solo ciò che è fuori limite o non numerico', () => {
    const field = TECH_FIELDS.find((f) => f.key === 'CHAMFER_ANGLE')!;
    expect(techFieldInvalid(field, '45')).toBe(false);
    expect(techFieldInvalid(field, '')).toBe(false);
    expect(techFieldInvalid(field, '90')).toBe(true);
    expect(techFieldInvalid(field, 'x')).toBe(true);
  });

  it('ogni parametro tecnico sopravvive al link condiviso', () => {
    const numbers = Object.fromEntries(
      // Un passo sopra il default, o sotto se il default è già il massimo.
      TECH_FIELDS.map((f) => [f.key, String(DEFAULT_PARAMS[f.key] + f.step <= f.max ? DEFAULT_PARAMS[f.key] + f.step : DEFAULT_PARAMS[f.key] - f.step)]),
    );
    const params = { WALL: 2.2, ...techParams({ numbers, edgeProfile: 'both' }) };
    expect(Object.keys(params).length).toBe(TECH_FIELDS.length + 2);
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
    expect(read.warnings).toEqual([]);
    expect(read.order?.params).toEqual(params);
  });

  it('densità dei LED: solo la scala 30–144, predefinita 144', () => {
    expect(LED_DENSITIES).toEqual([30, 60, 74, 96, 144]);
    const options = ledDensityOptions();
    expect(options.map((o) => o.value)).toEqual([30, 60, 74, 96, 144]);
    expect(options.filter((o) => o.isDefault).map((o) => o.value)).toEqual([DEFAULT_LED_DENSITY]);
    expect(DEFAULT_LED_DENSITY).toBe(144);
    expect(techParams({ numbers: {}, edgeProfile: 'square', ledPerM: '60' })).toEqual({ LED_PER_M: 60 });
    // 144 è anche la densità del profilo standard: uguale al default, non va nell'ordine.
    expect(techParams({ numbers: {}, edgeProfile: 'square', ledPerM: '144' })).toEqual({});
    // Un valore fuori scala torna a 144.
    expect(techParams({ numbers: {}, edgeProfile: 'square', ledPerM: '160' })).toEqual({});
    expect(techParams({ numbers: {}, edgeProfile: 'square' })).toEqual({});
  });

  it('la densità cambia il numero dei LED sulla stessa linea', () => {
    const line: Point[] = [
      [0, 0],
      [1000 + 2 * DEFAULT_PARAMS.WIRE_SLOT_L, 0],
    ];
    for (const density of LED_DENSITIES) {
      const lights = lightPointsFromChains([{ id: 1, points: line, closed: false }], { ...DEFAULT_PARAMS, LED_PER_M: density });
      expect(lights).toHaveLength(density);
    }
  });
});
