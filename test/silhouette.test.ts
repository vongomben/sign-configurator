import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { CrossSection, Manifold, Vec2 } from 'manifold-3d';
import { DEFAULT_PARAMS, resolveParams } from '../src/config';
import type { FontBytesReader } from '../src/fonts/loadFont';
import { resampleChain } from '../src/geometry/chain';
import { buildGraph } from '../src/geometry/graph';
import { buildHousing, offsetCenterline, type HousingModel } from '../src/geometry/housing';
import { getManifold } from '../src/geometry/manifold';
import { rasterize, type Point } from '../src/geometry/rasterize';
import { sourceFromPaths } from '../src/geometry/segment';
import { smoothPolyline } from '../src/geometry/smooth';
import { buildStrip, type UnlitDot } from '../src/geometry/strip';

const readPublic: FontBytesReader = async (file) => {
  const b = await readFile(`public/${file}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

const P = resolveParams();
const OUTER = P.CHANNEL_W / 2 + P.WALL;

function signedArea(poly: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function pointSegDist(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2));
  return Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby));
}

function hausdorff(a: readonly (readonly Vec2[])[], b: readonly (readonly Vec2[])[]): number {
  const dist = (p: Vec2, polys: readonly (readonly Vec2[])[]): number => {
    let best = Infinity;
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i++) {
        best = Math.min(best, pointSegDist(p, poly[i]!, poly[(i + 1) % poly.length]!));
      }
    }
    return best;
  };
  let h = 0;
  for (const poly of a) for (const p of poly) h = Math.max(h, dist(p, b));
  for (const poly of b) for (const p of poly) h = Math.max(h, dist(p, a));
  return h;
}

/** Contorni esterni: un'asola è un foro, non fa parte della sagoma. */
function outerPolys(section: CrossSection): Vec2[][] {
  const polys = section.toPolygons();
  let peak = 0;
  for (const poly of polys) {
    const area = signedArea(poly);
    if (Math.abs(area) > Math.abs(peak)) peak = area;
  }
  const sign = peak >= 0 ? 1 : -1;
  return polys.filter((poly) => signedArea(poly) * sign > 0.05);
}

async function plugHoles(solid: Manifold, housing: HousingModel): Promise<CrossSection> {
  const { CrossSection } = await getManifold();
  let shape = solid.project();
  const holes = [...housing.holes.wireSlots, ...housing.holes.cornerPockets]
    .map((opening) => opening.points)
    .filter((poly) => poly.length >= 3);
  if (holes.length > 0) {
    const plug = new CrossSection(holes as Vec2[][], 'NonZero');
    const next = CrossSection.union([shape, plug]);
    if (next !== shape) shape.delete();
    plug.delete();
    shape = next;
  }
  const cable = housing.holes.cable;
  if (cable && cable.d > 0) {
    const disk = CrossSection.circle(cable.d / 2 + 0.4, 32).translate([cable.x, cable.y]);
    const next = CrossSection.union([shape, disk]);
    if (next !== shape) shape.delete();
    disk.delete();
    shape = next;
  }
  return shape;
}

async function expectSilhouette(housing: HousingModel, lines: readonly Vec2[][], unlit: readonly UnlitDot[]): Promise<void> {
  const wasm = await getManifold();
  const { CrossSection } = wasm;
  const projected = await plugHoles(housing.solid, housing);
  const parts: CrossSection[] = [];
  try {
    for (const line of lines) {
      if (line.length >= 2) parts.push(offsetCenterline(wasm, line, OUTER));
    }
    for (const dot of unlit) {
      if (dot.points.length >= 3) parts.push(new CrossSection([dot.points as Vec2[]], 'NonZero'));
      else if (dot.radiusMm > 0.2) parts.push(CrossSection.circle(dot.radiusMm, 32).translate([dot.x, dot.y]));
    }
    const expected = parts.length > 0 ? CrossSection.union(parts) : new CrossSection([]);
    const gotPolys = outerPolys(projected);
    const wantPolys = outerPolys(expected);
    const got = gotPolys.length > 0 ? new CrossSection(gotPolys, 'Positive') : new CrossSection([]);
    const want = wantPolys.length > 0 ? new CrossSection(wantPolys, 'Positive') : new CrossSection([]);
    expect(want.area()).toBeGreaterThan(50);
    const diff = got.subtract(want);
    const extra = want.subtract(got);
    const sym = diff.area() + extra.area();
    diff.delete();
    extra.delete();
    got.delete();
    want.delete();
    expected.delete();
    expect(hausdorff(gotPolys, wantPolys)).toBeLessThanOrEqual(0.1);
    expect(sym).toBeLessThanOrEqual(0.1);
  } finally {
    projected.delete();
    for (const part of parts) part.delete();
  }
}

function arc(radius: number, sweepDeg: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= sweepDeg; i++) {
    const a = (i / sweepDeg) * ((sweepDeg * Math.PI) / 180);
    pts.push([radius * Math.cos(a), radius * Math.sin(a)]);
  }
  return pts;
}

describe('sagoma frontale', () => {
  it('un dritto coincide con l\'offset della linea centrale', async () => {
    const line: Vec2[] = [
      [0, 0],
      [80, 0],
    ];
    const wasm = await getManifold();
    const built = buildHousing(wasm, {
      paths: [{ id: 1, points: line, smooth: line, closed: false, lengthMm: 80, hinges: [] }],
      crossings: [],
      unlit: [],
      params: P,
    });
    try {
      expect(built.solid.status()).toBe('NoError');
      await expectSilhouette(built, [line], []);
    } finally {
      built.solid.delete();
      built.diffuser.delete();
    }
  });

  it('un arco resta a larghezza costante anche con la freccia', async () => {
    const pts = arc(40, 180);
    const smooth = smoothPolyline(pts, false);
    const chain = resampleChain(smooth, {
      hingePitch: P.HINGE_PITCH,
      hingeMaxDeg: P.HINGE_MAX_DEG,
      channelW: P.CHANNEL_W,
      closed: false,
    });
    const wasm = await getManifold();
    const built = buildHousing(wasm, {
      paths: [{ id: 1, points: chain.points, smooth, closed: false, lengthMm: chain.lengthMm, hinges: chain.hinges }],
      crossings: [],
      unlit: [],
      params: P,
    });
    try {
      expect(built.solid.status()).toBe('NoError');
      expect(chain.hinges.some((hinge) => hinge.sagittaMm > 0.2)).toBe(true);
      await expectSilhouette(built, [smooth], []);
    } finally {
      built.solid.delete();
      built.diffuser.delete();
    }
  });

  it('uno spigolo con tasca non esce dalla sagoma', async () => {
    const pts: Point[] = [];
    for (let t = 40; t > 0; t -= 1) pts.push([-t, t]);
    pts.push([0, 0]);
    for (let t = 1; t <= 40; t += 1) pts.push([t, t]);
    const model = buildStrip(sourceFromPaths([{ points: pts }]), P, 100);
    expect(model.bom.corners).toHaveLength(1);
    const wasm = await getManifold();
    const built = buildHousing(wasm, { paths: model.chains, crossings: [], unlit: model.unlit, params: P });
    try {
      expect(built.solid.status()).toBe('NoError');
      expect(built.holes.cornerPockets).toHaveLength(1);
      await expectSilhouette(
        built,
        model.chains.map((chain) => chain.smooth),
        model.unlit,
      );
    } finally {
      built.solid.delete();
      built.diffuser.delete();
    }
  });

  it('«Ciao» nei due font resta sull\'offset della linea levigata', async () => {
    for (const fontId of ['sacramento', 'neonderthaw'] as const) {
      const raster = await rasterize({ text: 'Ciao', fontId, heightMm: 100 }, readPublic);
      const graph = buildGraph(raster);
      const model = buildStrip(
        { nodes: graph.nodes, edges: graph.edges, strokeWidthMm: graph.strokeWidthMm },
        P,
        100,
      );
      const wasm = await getManifold();
      const built = buildHousing(wasm, {
        paths: model.chains,
        crossings: model.notices.filter((notice) => notice.kind === 'crossing').map((notice) => [notice.x, notice.y] as Vec2),
        unlit: model.unlit,
        params: P,
      });
      try {
        expect(built.solid.status(), fontId).toBe('NoError');
        expect(model.chains.length, fontId).toBeGreaterThan(0);
        await expectSilhouette(
          built,
          model.chains.map((chain) => chain.smooth),
          model.unlit,
        );
      } finally {
        built.solid.delete();
        built.diffuser.delete();
      }
    }
  }, 30000);
});
