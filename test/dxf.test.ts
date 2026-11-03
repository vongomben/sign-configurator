import { describe, expect, it } from 'vitest';
import { toDxf } from '../src/export/dxf';

describe('DXF', () => {
  it('specchia in X e chiude il contorno reale di WIRE_SLOTS', () => {
    const dxf = toDxf({
      polylines: [{ layer: 'WIRE_SLOTS', points: [[1.5, -2], [4, -2], [4, 3]] }],
      circles: [{ layer: 'ANCHOR_HOLES', center: [8, 1], radius: 1.6 }],
    });
    expect(dxf).toContain('AC1015');
    expect(dxf).toContain('8\nWIRE_SLOTS\n90\n3\n70\n1\n10\n-1.5\n20\n-2\n');
    expect(dxf).toContain('10\n-4\n20\n3\n');
    expect(dxf).toContain('8\nANCHOR_HOLES\n10\n-8\n20\n1\n40\n1.6\n');
    const pocket = toDxf({ polylines: [{ layer: 'CORNER_POCKETS', points: [[2, 1], [3, 1], [3, 4]] }] });
    expect(pocket).toContain('8\nCORNER_POCKETS\n90\n3\n70\n1\n10\n-2\n20\n1\n');
    expect(dxf.endsWith('EOF\n')).toBe(true);
  });
});
