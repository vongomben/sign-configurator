import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/config';
import type { Point } from '../src/geometry/rasterize';
import { sourceFromPaths } from '../src/geometry/segment';
import { buildStrip } from '../src/geometry/strip';

function arc(radius: number, sweepDeg: number): Point[] {
  const n = sweepDeg;
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * ((sweepDeg * Math.PI) / 180);
    pts.push([radius * Math.cos(a), radius * Math.sin(a)]);
  }
  return pts;
}

/** V a 90° campionata ogni millimetro: il raccordo di Chaikin resta piccolo rispetto al passo. */
function vee(scale: number): Point[] {
  const arm = 40 * scale;
  const pts: Point[] = [];
  for (let t = arm; t > 0; t -= 1) pts.push([-t, t]);
  pts.push([0, 0]);
  for (let t = 1; t <= arm; t += 1) pts.push([t, t]);
  return pts;
}

function ring(cx: number, cy: number, radius: number): Point[] {
  const n = 32;
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    pts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return pts;
}

describe('classificazione delle pieghe', () => {
  it('un arco di raggio noto, confrontato con la scala ×2, è una curva', () => {
    const pts = arc(10, 180);
    const model = buildStrip(sourceFromPaths([{ points: pts }]), DEFAULT_PARAMS, 100);
    const bends = model.issues.filter((issue) => issue.bend !== null);
    expect(bends.length).toBeGreaterThan(0);
    expect(bends.every((issue) => issue.bend === 'curva')).toBe(true);
  });

  it('uno spigolo a V resta spigolo a qualsiasi scala', () => {
    for (const scale of [1, 2, 4]) {
      const model = buildStrip(sourceFromPaths([{ points: vee(scale) }]), { ...DEFAULT_PARAMS, CUSP_MODE: 'warn' }, 100);
      const bends = model.issues.filter((issue) => issue.bend !== null);
      expect(bends.length, `scala ${scale}`).toBeGreaterThan(0);
      expect(bends.every((issue) => issue.bend === 'spigolo'), `scala ${scale}`).toBe(true);
    }
  });

  it('CUSP_MODE split taglia lo spigolo in due spezzoni coerenti', () => {
    const model = buildStrip(
      sourceFromPaths([{ points: vee(1) }]),
      { ...DEFAULT_PARAMS, CUSP_MODE: 'split' },
      100,
    );
    expect(model.chains).toHaveLength(2);
    expect(model.bom.segments).toHaveLength(2);
    expect(model.bom.wireSlots).toBe(2);
    expect(model.bom.corners).toHaveLength(1);
    expect(model.bom.corners[0]!.wireMm).toBe(0);
    expect(model.bom.corners[0]!.segments).toHaveLength(2);
    expect(model.issues.filter((issue) => issue.bend === 'spigolo')).toHaveLength(0);
    for (const chain of model.chains) {
      const ends = [chain.points[0]!, chain.points[chain.points.length - 1]!];
      expect(ends.some((p) => Math.hypot(p[0], p[1]) < 2)).toBe(true);
    }
    const left = model.bom.segments.find((seg) => seg.din[0] < -10 || seg.dout[0] < -10);
    const right = model.bom.segments.find((seg) => seg.din[0] > 10 || seg.dout[0] > 10);
    expect(left).toBeTruthy();
    expect(right).toBeTruthy();
    expect(left!.dinDir[0]).toBeGreaterThan(0.5);
    expect(left!.dinDir[1]).toBeLessThan(-0.5);
    expect(right!.dinDir[0]).toBeGreaterThan(0.5);
    expect(right!.dinDir[1]).toBeGreaterThan(0.5);
  });

  it('I_DOT_MODE dash produce uno spezzone lungo CUT_PITCH, orientato come l\'asta', () => {
    const stem: Point[] = [
      [0, 0],
      [0, 40],
    ];
    const model = buildStrip(
      sourceFromPaths([{ points: stem }, { points: ring(0, 48, 12) }]),
      { ...DEFAULT_PARAMS, I_DOT_MODE: 'dash' },
      100,
    );
    const dashes = model.chains.filter((chain) => Math.abs(chain.lengthMm - DEFAULT_PARAMS.CUT_PITCH) < 0.05);
    expect(dashes).toHaveLength(1);
    expect(model.chains).toHaveLength(2);
    const dash = dashes[0]!;
    const a = dash.points[0]!;
    const b = dash.points[dash.points.length - 1]!;
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(DEFAULT_PARAMS.CUT_PITCH, 1);
    expect(Math.abs(a[0] - b[0])).toBeLessThan(0.5);
    expect((a[1] + b[1]) / 2).toBeCloseTo(48, 0);
    expect(model.issues.some((issue) => issue.message.startsWith('Anello chiuso escluso'))).toBe(false);
    expect(model.unlit).toHaveLength(0);
  });

  it('un trattino che non sta nel puntino diventa un rilievo senza striscia', () => {
    const stem: Point[] = [
      [0, 0],
      [0, 40],
    ];
    const model = buildStrip(
      sourceFromPaths([{ points: stem }, { points: ring(0, 48, 2) }]),
      { ...DEFAULT_PARAMS, I_DOT_MODE: 'dash' },
      100,
    );
    expect(model.chains).toHaveLength(1);
    expect(model.unlit).toHaveLength(1);
    const fallback = model.issues.find((issue) => issue.message.startsWith('Trattino fuori dal puntino'));
    expect(fallback).toBeTruthy();
    expect(fallback!.x).toBeCloseTo(0, 0);
    expect(fallback!.y).toBeCloseTo(48, 0);
  });

  it('I_DOT_MODE dot è uno spezzone proprio, senza asole, se la pillola ci sta', () => {
    const stem: Point[] = [
      [0, 0],
      [0, 40],
    ];
    const model = buildStrip(
      sourceFromPaths([{ points: stem }, { points: ring(0, 60, 12) }]),
      { ...DEFAULT_PARAMS, I_DOT_MODE: 'dot' },
      100,
    );
    const dots = model.chains.filter((chain) => chain.dot);
    expect(dots).toHaveLength(1);
    expect(model.unlit).toHaveLength(0);
    expect(Math.abs(dots[0]!.lengthMm - DEFAULT_PARAMS.CUT_PITCH)).toBeLessThan(0.2);
    const bomDot = model.bom.segments.find((segment) => segment.id === dots[0]!.id);
    expect(bomDot).toBeTruthy();
    expect(bomDot!.cutLengthMm).toBe(DEFAULT_PARAMS.CUT_PITCH);
    expect(model.bom.wireSlots).toBe(2);
  });

  it('un puntino troppo piccolo resta spento e indica l\'altezza minima', () => {
    const stem: Point[] = [
      [0, 0],
      [0, 40],
    ];
    const model = buildStrip(
      sourceFromPaths([{ points: stem }, { points: ring(0, 48, 2) }]),
      { ...DEFAULT_PARAMS, I_DOT_MODE: 'dot' },
      100,
    );
    expect(model.chains.some((chain) => chain.dot)).toBe(false);
    expect(model.unlit).toHaveLength(1);
    expect(model.bom.segments.every((segment) => segment.ledCount > 0)).toBe(true);
    const fallback = model.issues.find((issue) => issue.message.startsWith('Puntino troppo piccolo'));
    expect(fallback).toBeTruthy();
    expect(fallback!.message).toMatch(/Altezza minima \d+ mm/);
    expect(fallback!.y).toBeCloseTo(48, 0);
  });
});
