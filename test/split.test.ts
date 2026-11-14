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

  it('il taglio schiva i fori', () => {
    const base = { outline: [rect(0, 0, 400, 120)], centerlines: [], bedW: 300, bedH: 300 };
    const free = planSplit({ ...base, keepOut: [] });
    expect(free.cutsX).toHaveLength(1);
    expect(Math.abs(free.cutsX[0]! - 200)).toBeLessThan(1);
    // Un foro si schiva uscendo dal suo ingombro.
    const hole = planSplit({ ...base, keepOut: [{ x0: 190, x1: 210, kind: 'hole' }] });
    expect(hole.cutsX).toHaveLength(1);
    const x = hole.cutsX[0]!;
    expect(x < 189 || x > 211).toBe(true);
    expect(hole.warnings).toEqual([]);
  });

  it('un varco senza canali batte un taglio in mezzo a una lettera, anche con un\'asola dentro', () => {
    // Un canale continuo da 0 a 400, interrotto solo fra 195 e 205: lì c'è l'asola.
    const centerlines: SplitPoint[][] = [
      [
        [0, 60],
        [195, 60],
      ],
      [
        [205, 60],
        [400, 60],
      ],
    ];
    const plan = planSplit({
      outline: [rect(0, 0, 400, 120)],
      centerlines,
      keepOut: [{ x0: 195, x1: 205, kind: 'slot' }],
      bedW: 300,
      bedH: 300,
    });
    expect(plan.cutsX).toHaveLength(1);
    expect(plan.cutsX[0]!).toBeGreaterThan(195);
    expect(plan.cutsX[0]!).toBeLessThan(205);
    expect(plan.warnings).toEqual([]);
  });

  it('un pezzo in più si accetta se evita di tagliare un canale', () => {
    // Varchi senza canali a 200, 400 e 600. Con due soli tagli (il minimo per 800 mm) almeno uno
    // cadrebbe dentro una lettera; con tre cadono tutti nei varchi.
    const centerlines: SplitPoint[][] = [
      [
        [0, 60],
        [198, 60],
      ],
      [
        [202, 60],
        [398, 60],
      ],
      [
        [402, 60],
        [598, 60],
      ],
      [
        [602, 60],
        [800, 60],
      ],
    ];
    const plan = planSplit({ outline: [rect(0, 0, 800, 120)], centerlines, keepOut: [], bedW: 300, bedH: 300 });
    expect(plan.cutsX).toHaveLength(3);
    for (const target of [200, 400, 600]) {
      expect(plan.cutsX.some((x) => Math.abs(x - target) < 2)).toBe(true);
    }
    expect(plan.warnings).toEqual([]);
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
