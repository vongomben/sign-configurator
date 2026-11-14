import { describe, expect, it } from 'vitest';
import { BED_MARGIN, planSplit, type SplitPoint } from '../src/geometry/split';

function rect(x0: number, y0: number, x1: number, y1: number): SplitPoint[] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

describe('suddivisione per il piatto di stampa', () => {
  it('un\'insegna che sta sul piatto non si taglia', () => {
    const plan = planSplit({ outline: [rect(0, 0, 280, 120)], centerlines: [], keepOut: [], bedW: 300, bedH: 300 });
    expect(plan.cutsX).toEqual([]);
    expect(plan.pieces).toEqual([{ x0: 0, x1: 280 }]);
    expect(plan.warnings).toEqual([]);
  });

  it('se sta girata di 90° non si taglia', () => {
    const plan = planSplit({ outline: [rect(0, 0, 280, 120)], centerlines: [], keepOut: [], bedW: 150, bedH: 300 });
    expect(plan.cutsX).toEqual([]);
  });

  it('il numero di pezzi è il minimo e ogni pezzo sta sul piatto', () => {
    const plan = planSplit({ outline: [rect(10, 0, 710, 120)], centerlines: [], keepOut: [], bedW: 300, bedH: 300 });
    expect(plan.cutsX).toHaveLength(2);
    expect(plan.pieces).toHaveLength(3);
    for (const piece of plan.pieces) expect(piece.x1 - piece.x0).toBeLessThanOrEqual(300 - 2 * BED_MARGIN + 1e-9);
    expect(plan.pieces[0]!.x0).toBe(10);
    expect(plan.pieces[2]!.x1).toBe(710);
    // Senza ostacoli i pezzi escono uguali, entro il passo di ricerca.
    for (const piece of plan.pieces) expect(Math.abs(piece.x1 - piece.x0 - 700 / 3)).toBeLessThan(1);
  });

  it('il taglio evita asole e fori', () => {
    const base = { outline: [rect(0, 0, 400, 120)], centerlines: [], bedW: 300, bedH: 300 };
    const free = planSplit({ ...base, keepOut: [] });
    expect(free.cutsX).toHaveLength(1);
    expect(Math.abs(free.cutsX[0]! - 200)).toBeLessThan(1);
    const blocked = planSplit({ ...base, keepOut: [{ x0: 190, x1: 210 }] });
    expect(blocked.cutsX).toHaveLength(1);
    const x = blocked.cutsX[0]!;
    expect(x < 186 || x > 214).toBe(true);
    expect(blocked.warnings).toEqual([]);
  });

  it('il taglio passa dove attraversa meno canali', () => {
    // Fra x = 150 e 250 ci sono tre canali orizzontali; fuori uno solo.
    const centerlines: SplitPoint[][] = [
      [
        [0, 60],
        [400, 60],
      ],
      [
        [150, 30],
        [250, 30],
      ],
      [
        [150, 90],
        [250, 90],
      ],
    ];
    const plan = planSplit({ outline: [rect(0, 0, 400, 120)], centerlines, keepOut: [], bedW: 300, bedH: 300 });
    expect(plan.cutsX).toHaveLength(1);
    const x = plan.cutsX[0]!;
    expect(x < 150 || x > 250).toBe(true);
  });

  it('un canale quasi parallelo al taglio si evita', () => {
    const centerlines: SplitPoint[][] = [
      [
        [200, 10],
        [201, 110],
      ],
    ];
    const plan = planSplit({ outline: [rect(0, 0, 400, 120)], centerlines, keepOut: [], bedW: 300, bedH: 300 });
    const x = plan.cutsX[0]!;
    expect(x < 200 || x > 201).toBe(true);
  });

  it('un\'insegna più alta del piatto avvisa', () => {
    const plan = planSplit({ outline: [rect(0, 0, 500, 400)], centerlines: [], keepOut: [], bedW: 300, bedH: 300 });
    expect(plan.warnings.join(' ')).toMatch(/oltre il piatto/);
    expect(plan.cutsX.length).toBeGreaterThan(0);
  });

  it('è deterministica', () => {
    const input = { outline: [rect(0, 0, 933.3, 120)], centerlines: [], keepOut: [{ x0: 300, x1: 320 }], bedW: 300, bedH: 300 };
    expect(planSplit(input)).toEqual(planSplit(input));
  });
});
