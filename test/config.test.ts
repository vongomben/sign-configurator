import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, DEFAULT_STRIP, minLetterH, resolveParams, rMin, totalHeight } from '../src/config';

describe('config', () => {
  it('R_MIN ≈ 14,6 mm con cerniere da 10 mm a 40°', () => {
    expect(DEFAULT_PARAMS.HINGE_MAX_DEG).toBe(40);
    expect(rMin(DEFAULT_PARAMS)).toBeCloseTo(14.62, 2);
  });

  it('altezza totale = FLOOR + CHANNEL_DEPTH', () => {
    expect(totalHeight(DEFAULT_PARAMS)).toBe(DEFAULT_PARAMS.FLOOR + DEFAULT_PARAMS.CHANNEL_DEPTH);
    expect(totalHeight(DEFAULT_PARAMS)).toBe(16);
  });

  it("l'asola è larga quanto il canale e sta negli ultimi millimetri", () => {
    expect(DEFAULT_PARAMS.WIRE_SLOT_W).toBe(DEFAULT_PARAMS.CHANNEL_W);
    expect(DEFAULT_PARAMS.WIRE_SLOT_L).toBe(6);
    expect(DEFAULT_PARAMS.WALL_MIN).toBe(1.2);
    expect(DEFAULT_PARAMS.MIN_GAP).toBe(1);
    expect(DEFAULT_PARAMS.SLOT_LIP_CHAMFER).toBe(1);
  });

  it('la striscia standard è larga 10 e spessa 6, e MIN_LETTER_H è il doppio di R_MIN', () => {
    expect(DEFAULT_STRIP.id).toBe('strip-10mm');
    expect(DEFAULT_PARAMS.STRIP_W).toBe(10);
    expect(DEFAULT_PARAMS.STRIP_T).toBe(6);
    expect(DEFAULT_PARAMS.CHANNEL_W).toBe(10.4);
    // Fra i LED e il diffusore restano 6 mm, come con la COB.
    expect(DEFAULT_PARAMS.CHANNEL_DEPTH - DEFAULT_PARAMS.STRIP_T).toBe(6);
    expect(DEFAULT_PARAMS.STRIP_W).toBe(DEFAULT_STRIP.STRIP_W);
    expect(DEFAULT_PARAMS.STRIP_T).toBe(DEFAULT_STRIP.STRIP_T);
    expect(DEFAULT_PARAMS.CHANNEL_W).toBe(DEFAULT_STRIP.CHANNEL_W);
    expect(DEFAULT_PARAMS.HINGE_PITCH).toBe(DEFAULT_STRIP.HINGE_PITCH);
    expect(DEFAULT_PARAMS.HINGE_MAX_DEG).toBe(DEFAULT_STRIP.HINGE_MAX_DEG);
    expect(DEFAULT_PARAMS.CUT_PITCH).toBe(DEFAULT_STRIP.CUT_PITCH);
    expect(DEFAULT_PARAMS.LED_PER_M).toBe(DEFAULT_STRIP.LED_PER_M);
    expect(DEFAULT_PARAMS.MIN_LETTER_H).toBeCloseTo(minLetterH(DEFAULT_STRIP));
    expect(DEFAULT_PARAMS.MIN_LETTER_H).toBeCloseTo(2 * rMin(DEFAULT_STRIP));
    const wider = resolveParams({ HINGE_PITCH: 20 });
    expect(wider.MIN_LETTER_H).toBeCloseTo(2 * rMin(wider));
    expect(wider.HINGE_PITCH).toBe(20);
    expect(DEFAULT_PARAMS.HINGE_PITCH).toBe(10);
  });

  it('gli override non toccano i default', () => {
    const p = resolveParams({ WALL: 3 });
    expect(p.WALL).toBe(3);
    expect(p.FLOOR).toBe(DEFAULT_PARAMS.FLOOR);
    expect(DEFAULT_PARAMS.WALL).toBe(2.2);
  });
});
