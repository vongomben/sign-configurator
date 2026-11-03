import { describe, expect, it } from 'vitest';
import type { CrossSection } from 'manifold-3d';
import { DEFAULT_PARAMS, type EdgeProfile } from '../src/config';
import { MIN_TOP_WALL, planChamfer, type EdgeProfileParams } from '../src/geometry/edgeProfile';
import { getManifold } from '../src/geometry/manifold';
import {
  bendTestPath,
  buildBendTest,
  channelSection,
  resolveBendTestParams,
} from '../src/tools/bendTestGeometry';

const PROFILES: EdgeProfile[] = ['square', 'outer', 'inner', 'both'];
const KINDS = ['arcs', 'corners'] as const;

/** Riferimento del profilo square, asole comprese. Gli altri profili si misurano da qui. */
const SQUARE_BASELINE: Record<'arcs' | 'corners', { volume: number; tris: number }> = {
  arcs: { volume: 36568.133772, tris: 26114 },
  corners: { volume: 13643.147918, tris: 5406 },
};

const base: EdgeProfileParams = DEFAULT_PARAMS;
const plan = (o: Partial<EdgeProfileParams>) => planChamfer({ ...base, ...o });

function perimeter(cs: CrossSection): number {
  let sum = 0;
  for (const poly of cs.toPolygons()) {
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length]!;
      sum += Math.hypot(b[0] - a[0], b[1] - a[1]);
    });
  }
  return sum;
}

describe('planChamfer', () => {
  it('square: nessuno smusso', () => {
    const c = plan({ EDGE_PROFILE: 'square' });
    expect(c.height).toBe(0);
    expect(c.warnings).toEqual([]);
  });

  it('outer: CHAMFER_SIZE invariato, run = size / tan(angolo)', () => {
    const c = plan({ EDGE_PROFILE: 'outer' });
    expect(c.height).toBe(1.5);
    expect(c.run).toBeCloseTo(1.5, 9);
    expect(c.warnings).toEqual([]);
    expect(plan({ EDGE_PROFILE: 'outer', CHAMFER_ANGLE: 60 }).run).toBeCloseTo(1.5 / Math.tan(Math.PI / 3), 9);
  });

  it('inner/both: ridotto perché in cima restino 0.8 mm di parete, con avviso', () => {
    const inner = plan({ EDGE_PROFILE: 'inner' });
    expect(DEFAULT_PARAMS.WALL - inner.run).toBeCloseTo(MIN_TOP_WALL, 9);
    expect(inner.height).toBeLessThan(DEFAULT_PARAMS.CHAMFER_SIZE);
    expect(inner.warnings).toHaveLength(1);

    const both = plan({ EDGE_PROFILE: 'both' });
    expect(DEFAULT_PARAMS.WALL - 2 * both.run).toBeCloseTo(MIN_TOP_WALL, 9);
    expect(both.warnings).toHaveLength(1);

    const ok = plan({ EDGE_PROFILE: 'inner', CHAMFER_SIZE: 1.0 });
    expect(ok.height).toBe(1.0);
    expect(ok.warnings).toEqual([]);
  });

  it('CHAMFER_SIZE limitato a CHANNEL_DEPTH', () => {
    const c = plan({ EDGE_PROFILE: 'outer', CHAMFER_SIZE: 20 });
    expect(c.height).toBe(DEFAULT_PARAMS.CHANNEL_DEPTH);
    expect(c.warnings).toHaveLength(1);
  });

  it('parametri non validi: si torna a square con avviso', () => {
    for (const o of [{ CHAMFER_ANGLE: 90 }, { CHAMFER_ANGLE: 0 }, { LAYER_STEP: 0 }, { WALL: 0.5 }]) {
      const c = plan({ EDGE_PROFILE: 'both', ...o });
      expect(c.profile).toBe('square');
      expect(c.height).toBe(0);
      expect(c.warnings.length).toBeGreaterThan(0);
    }
  });
});

describe('profilo dei bordi sui pezzi di prova', () => {
  for (const kind of KINDS) {
    it(`${kind} square: geometria identica a prima (volume e triangoli)`, async () => {
      const r = await buildBendTest({ kind, params: { EDGE_PROFILE: 'square' } });
      try {
        expect(r.manifold.volume()).toBeCloseTo(SQUARE_BASELINE[kind].volume, 3);
        expect(r.manifold.numTri()).toBe(SQUARE_BASELINE[kind].tris);
      } finally {
        r.manifold.delete();
      }
    });

    it(`${kind}: manifold e genus invariato per tutti i profili, volume tolto come atteso`, async () => {
      const wasm = await getManifold();
      const P = resolveBendTestParams();
      const channel = channelSection(wasm, bendTestPath(kind, P.HINGE_PITCH), P);
      const outline = channel.offset(P.WALL, 'Round', 2, 96);
      const pOuter = perimeter(outline);
      const pInner = perimeter(channel);
      outline.delete();
      channel.delete();

      const square = await buildBendTest({ kind, params: { EDGE_PROFILE: 'square' } });
      const vSquare = square.manifold.volume();
      const genus = square.pieces[0]!.genus;
      square.manifold.delete();

      for (const profile of PROFILES) {
        const r = await buildBendTest({ kind, params: { EDGE_PROFILE: profile } });
        try {
          expect(r.status).toBe('NoError');
          expect(r.pieces[0]!.genus).toBe(genus);
          expect(r.manifold.decompose().map((m) => (m.delete(), 1))).toHaveLength(1);
          if (profile === 'square') continue;

          const { height, run, outer, inner } = r.chamfer;
          expect(height).toBeGreaterThan(0);
          // Sezione triangolare h·run/2 lungo ogni spigolo smussato.
          const expected = ((height * run) / 2) * ((outer ? pOuter : 0) + (inner ? pInner : 0));
          const removed = vSquare - r.manifold.volume();
          expect(removed).toBeGreaterThan(0);
          expect(Math.abs(removed - expected) / expected).toBeLessThan(0.02);
        } finally {
          r.manifold.delete();
        }
      }
    });
  }

  it('2 varianti con smusso "both": entrambe manifold con lo stesso genus', async () => {
    const r = await buildBendTest({ kind: 'corners', variants: true, params: { EDGE_PROFILE: 'both' } });
    try {
      expect(r.status).toBe('NoError');
      for (const p of r.pieces) expect(p.genus).toBe(r.expectedHoles);
      expect(r.chamfer.warnings).toHaveLength(1);
    } finally {
      r.manifold.delete();
    }
  });
});
