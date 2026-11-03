import { describe, expect, it } from 'vitest';
import { resolveParams } from '../src/config';
import { liveCheck } from '../src/editor/liveCheck';
import type { Point } from '../src/geometry/rasterize';

const params = resolveParams({ WALL: 2.2 });

function arc(radius: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= 48; i++) {
    const angle = (i / 48) * Math.PI;
    points.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
  }
  return points;
}

describe('validazione dal vivo', () => {
  it('una retta non blocca l\'invio', () => {
    const report = liveCheck([{ id: 'p1', points: [[0, 0], [80, 0]], closed: false }], [], params);
    expect(report.blocked).toBe(false);
    expect(report.markers).toEqual([]);
  });

  it('un arco sotto R_MIN è una curva e blocca', () => {
    const report = liveCheck([{ id: 'p1', points: arc(8), closed: false }], ['p1'], params);
    expect(report.markers.some((marker) => marker.kind === 'curva')).toBe(true);
    expect(report.blocked).toBe(true);
  });

  it('due tratti paralleli troppo vicini sono una fusione', () => {
    const report = liveCheck(
      [
        { id: 'p1', points: [[0, 0], [80, 0]], closed: false },
        { id: 'p2', points: [[10, 4], [70, 4]], closed: false },
      ],
      ['p2'],
      params,
    );
    expect(report.markers.some((marker) => marker.kind === 'fusione' && marker.pathId === 'p2')).toBe(true);
    expect(report.blocked).toBe(true);
  });

  it('lo stesso ingresso dà gli stessi marcatori', () => {
    const segments = [{ id: 'p1', points: arc(8), closed: false }];
    expect(liveCheck(segments, [], params)).toEqual(liveCheck(segments, [], params));
  });
});
