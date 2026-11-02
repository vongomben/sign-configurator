import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/config';
import { anchorHoleCount, buildBom } from '../src/export/bom';

describe('BOM', () => {
  it('taglia per difetto al passo e conta i LED', () => {
    const bom = buildBom(
      [
        {
          id: 1,
          points: [
            [0, 0],
            [25, 0],
          ],
          lengthMm: 25,
          closed: false,
          dot: false,
        },
      ],
      DEFAULT_PARAMS,
      [],
    );
    expect(bom.segments[0]).toMatchObject({
      id: 1,
      lengthMm: 25,
      ledCount: 2,
      cutLengthMm: 10,
      din: [6, 0],
      dout: [19, 0],
      dinDir: [1, 0],
      doutDir: [1, 0],
    });
    expect(bom.totalLeds).toBe(2);
    expect(bom.wireSlots).toBe(2);
    expect(bom.wireSlotW).toBe(DEFAULT_PARAMS.CHANNEL_W);
    expect(bom.wireSlotL).toBe(DEFAULT_PARAMS.WIRE_SLOT_L);
    expect(bom.anchorHoles).toBe(0);
    expect(bom.assembly).toMatchObject({
      segments: 1,
      solderJoints: 2,
      wires: 6,
      corners: 0,
      totalLeds: 2,
      maxCurrentA: 0.12,
      supplyA: 1,
    });
  });

  it('i fori rispettano il minimo e i 10 mm di margine', () => {
    expect(anchorHoleCount(15, DEFAULT_PARAMS)).toBe(0);
    expect(anchorHoleCount(50, DEFAULT_PARAMS)).toBe(2);
    expect(anchorHoleCount(200, DEFAULT_PARAMS)).toBe(3);
  });
});
