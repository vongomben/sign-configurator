import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { Manifold, Vec2 } from 'manifold-3d';
import { DEFAULT_PARAMS, resolveParams, totalHeight } from '../src/config';
import { anchorHoleCount } from '../src/export/bom';
import { toDxf } from '../src/export/dxf';
import { resampleChain } from '../src/geometry/chain';
import { anchorHolesAlong, placeAnchorHoles } from '../src/geometry/holes';
import { buildHousing, type HousingPath } from '../src/geometry/housing';
import { getManifold } from '../src/geometry/manifold';
import type { Point } from '../src/geometry/rasterize';
import { sourceFromPaths } from '../src/geometry/segment';
import { buildStrip } from '../src/geometry/strip';
import type { FontBytesReader } from '../src/fonts/loadFont';
import { generateSign } from '../src/worker/generate';

const readPublic: FontBytesReader = async (file) => {
  const b = await readFile(`public/${file}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

const P = resolveParams();

function line(length: number, id: number, origin: Vec2 = [0, 0]): HousingPath {
  return {
    id,
    points: [origin, [origin[0] + length, origin[1]]],
    closed: false,
    lengthMm: length,
    hinges: [],
  };
}

async function sliceArea(solid: Manifold, z: number, c: Vec2, half = 0.08): Promise<number> {
  const { CrossSection } = await getManifold();
  const slice = solid.slice(z);
  const box = new CrossSection([
    [
      [c[0] - half, c[1] - half],
      [c[0] + half, c[1] - half],
      [c[0] + half, c[1] + half],
      [c[0] - half, c[1] + half],
    ],
  ]);
  const hit = slice.intersect(box);
  const area = hit.area();
  hit.delete();
  box.delete();
  slice.delete();
  return area;
}

describe('fori di ancoraggio', () => {
  it('stesse stazioni della BOM, e salta un incrocio a meno di 10 mm', () => {
    expect(anchorHoleCount(15, P)).toBe(0);
    expect(anchorHoleCount(50, P)).toBe(2);
    expect(anchorHoleCount(200, P)).toBe(3);
    const linePts: Vec2[] = Array.from({ length: 21 }, (_, i) => [i * 10, 0]);
    const holes = anchorHolesAlong(linePts, [[80, 0]], P);
    expect(holes.map((h) => h.along)).toEqual([16, 90, 156]);
  });
});

describe('fori spostati', () => {
  it('spezzone corto con asole ai due capi: i fori si spostano, o resta un avviso', () => {
    const moved = placeAnchorHoles(
      [
        [0, 0],
        [70, 0],
      ],
      P,
      { occupies: (x) => x < 20 || x > 50, segmentId: 1 },
    );
    expect(moved.holes.map((hole) => hole.along)).toEqual([20, 50]);
    expect(moved.warnings).toEqual([]);
    expect(moved.holes).toHaveLength(P.ANCHOR_MIN_PER_SEGMENT);

    const short = placeAnchorHoles(
      [
        [0, 0],
        [30, 0],
      ],
      P,
      { occupies: (x) => x < 14 || x > 16, segmentId: 2 },
    );
    expect(short.holes.length).toBeLessThan(P.ANCHOR_MIN_PER_SEGMENT);
    expect(short.warnings).toHaveLength(1);
    expect(short.warnings[0]).toContain('Spezzone 2');
    expect(short.warnings[0]).toContain('(15.0, 0.0)');
    for (const hole of short.holes) expect(hole.along).toBeGreaterThanOrEqual(14);
  });
});

describe('housing', () => {
  it('dritto: manifold, asole passanti, ancoraggio cieco, cavo e diffusore', async () => {
    const wasm = await getManifold();
    const built = buildHousing(wasm, { paths: [line(80, 1)], crossings: [], unlit: [], params: P });
    try {
      expect(built.solid.status()).toBe('NoError');
      expect(built.diffuser.status()).toBe('NoError');
      expect(built.holes.anchors.map((h) => h.x)).toEqual([16, 64]);
      expect(built.holes.cable).toMatchObject({ x: 0, y: 0, d: P.CABLE_HOLE_D });
      expect(built.holes.wireSlots.map((s) => s.role)).toEqual(['DIN', 'DOUT']);
      expect(built.outline.length).toBeGreaterThan(0);

      const floorZ = P.FLOOR / 2;
      const channelZ = P.FLOOR + P.CHANNEL_DEPTH / 2;
      const voidAt = async (z: number, c: Vec2) => (await sliceArea(built.solid, z, c)) < 1e-6;
      const solidAt = async (z: number, c: Vec2) => (await sliceArea(built.solid, z, c)) > 0.01;

      expect(await voidAt(floorZ, [-2, 0])).toBe(true);
      expect(await solidAt(floorZ, [P.WIRE_SLOT_L + 2, 0])).toBe(true);
      expect(await voidAt(floorZ, [0, 2.9])).toBe(true);
      expect(await voidAt(channelZ, [40, 0])).toBe(true);
      expect(await solidAt(channelZ, [40, P.CHANNEL_W / 2 + 1])).toBe(true);
      expect(await voidAt(1, [16, 0])).toBe(true);
      expect(await solidAt(P.ANCHOR_HOLE_DEPTH + 0.5, [16, 0])).toBe(true);

      const cap = -(P.CHANNEL_W / 2);
      expect(await voidAt(floorZ, [cap + 0.2, 0])).toBe(true);
      expect(await solidAt(floorZ, [cap - 0.3, 0])).toBe(true);

      const lidZ = totalHeight(P) - P.DIFFUSER_T / 2;
      expect(built.diffuser.boundingBox().min[2]).toBeCloseTo(totalHeight(P) - P.DIFFUSER_T, 5);
      expect(built.diffuser.boundingBox().max[2]).toBeCloseTo(totalHeight(P), 5);
      expect(await sliceArea(built.diffuser, lidZ, [40, 0])).toBeGreaterThan(0.01);
      expect(await sliceArea(built.diffuser, lidZ, [40, P.CHANNEL_W / 2 - 0.05])).toBeLessThan(1e-6);
    } finally {
      built.solid.delete();
      built.diffuser.delete();
    }
  });

  it("all'incrocio il canale prosegue e il fondo no", async () => {
    const wasm = await getManifold();
    const built = buildHousing(wasm, {
      paths: [line(20, 1), line(24, 2, [26, 0])],
      crossings: [[23, 0]],
      unlit: [],
      params: P,
    });
    try {
      expect(built.solid.status()).toBe('NoError');
      expect(built.holes.wireSlots.map((s) => s.role)).toEqual(['DIN', 'DOUT']);
      const floor = 2;
      const channelZ = P.FLOOR + 2;
      expect(await sliceArea(built.solid, channelZ, [23, 0])).toBeLessThan(1e-6);
      expect(await sliceArea(built.solid, floor, [23, 0])).toBeGreaterThan(0.01);
      expect(await sliceArea(built.solid, floor, [21, 0])).toBeGreaterThan(0.01);
    } finally {
      built.solid.delete();
      built.diffuser.delete();
    }
  });

  it("sull'arco il canale è largo CHANNEL_W più la freccia", async () => {
    const pts: Vec2[] = [];
    for (let i = 0; i <= 180; i++) {
      const a = (i * Math.PI) / 180;
      pts.push([40 * Math.cos(a), 40 * Math.sin(a)]);
    }
    const chain = resampleChain(pts, {
      hingePitch: P.HINGE_PITCH,
      hingeMaxDeg: P.HINGE_MAX_DEG,
      channelW: P.CHANNEL_W,
      closed: false,
    });
    const mid = Math.floor(chain.points.length / 2);
    const at = chain.points[mid]!;
    const wide = chain.hinges[mid - 1]!.channelWMm;
    expect(wide).toBeGreaterThan(P.CHANNEL_W + 0.2);
    const inward: Vec2 = [-at[0] / 40, -at[1] / 40];
    const probe: Vec2 = [at[0] + inward[0] * (P.CHANNEL_W / 2 + 0.05), at[1] + inward[1] * (P.CHANNEL_W / 2 + 0.05)];

    const wasm = await getManifold();
    const built = buildHousing(wasm, {
      paths: [{ id: 1, points: chain.points, closed: false, lengthMm: chain.lengthMm, hinges: chain.hinges }],
      crossings: [],
      unlit: [],
      params: P,
    });
    try {
      expect(built.solid.status()).toBe('NoError');
      const z = P.FLOOR + P.CHANNEL_DEPTH / 2;
      expect(await sliceArea(built.solid, z, probe, 0.04)).toBeLessThan(1e-6);
    } finally {
      built.solid.delete();
      built.diffuser.delete();
    }
  });

  it('i boss sporgono dal retro e il foro ci resta dentro', async () => {
    const wasm = await getManifold();
    const built = buildHousing(wasm, {
      paths: [line(80, 1)],
      crossings: [],
      unlit: [],
      params: resolveParams({ ANCHOR_BOSS: true }),
    });
    try {
      expect(built.solid.status()).toBe('NoError');
      expect(built.solid.boundingBox().min[2]).toBeCloseTo(-P.ANCHOR_BOSS_H, 2);
      expect(await sliceArea(built.solid, -P.ANCHOR_BOSS_H + 1, [16, 0])).toBeLessThan(1e-6);
      expect(await sliceArea(built.solid, -1, [16, 0])).toBeGreaterThan(0.01);
      expect(await sliceArea(built.solid, 1, [16, 0])).toBeGreaterThan(0.01);
    } finally {
      built.solid.delete();
      built.diffuser.delete();
    }
  });
});

describe('tasca d\'angolo', () => {
  it('spigolo a 90°: due spezzoni, una tasca, mesh manifold', async () => {
    const arm = 40;
    const pts: Point[] = [];
    for (let t = arm; t > 0; t -= 1) pts.push([-t, t]);
    pts.push([0, 0]);
    for (let t = 1; t <= arm; t += 1) pts.push([t, t]);
    const model = buildStrip(sourceFromPaths([{ points: pts }]), DEFAULT_PARAMS, 100);
    expect(model.chains).toHaveLength(2);
    expect(model.bom.corners).toHaveLength(1);
    expect(model.bom.corners[0]!.wireMm).toBe(0);
    expect(model.bom.wireSlots).toBe(2);
    const corner = model.bom.corners[0]!;
    for (const chain of model.chains) {
      const holes = anchorHolesAlong(chain.points, [], DEFAULT_PARAMS, [[corner.x, corner.y]]);
      for (const hole of holes) {
        expect(Math.hypot(hole.x - corner.x, hole.y - corner.y)).toBeGreaterThanOrEqual(10 - 1e-6);
      }
    }

    const wasm = await getManifold();
    const built = buildHousing(wasm, { paths: model.chains, crossings: [], unlit: [], params: DEFAULT_PARAMS });
    try {
      expect(built.solid.status()).toBe('NoError');
      expect(built.holes.cornerPockets).toHaveLength(1);
      expect(built.holes.wireSlots).toHaveLength(2);
      expect(built.holes.cornerPockets[0]!.segments).toEqual(corner.segments);
      const dxf = toDxf({
        polylines: built.holes.cornerPockets.map((pocket) => ({ layer: 'CORNER_POCKETS', points: pocket.points })),
      });
      expect(dxf).toContain('CORNER_POCKETS');
      expect(dxf).toContain('LWPOLYLINE');
    } finally {
      built.solid.delete();
      built.diffuser.delete();
    }
  });
});

describe('parete interna', () => {
  it('una freccia oltre WALL − WALL_MIN avvisa con la posizione', async () => {
    const pts: Vec2[] = [];
    for (let i = 0; i <= 180; i++) {
      const a = (i * Math.PI) / 180;
      pts.push([10 * Math.cos(a), 10 * Math.sin(a)]);
    }
    const chain = resampleChain(pts, {
      hingePitch: P.HINGE_PITCH,
      hingeMaxDeg: P.HINGE_MAX_DEG,
      channelW: P.CHANNEL_W,
      closed: false,
    });
    const wasm = await getManifold();
    const built = buildHousing(wasm, {
      paths: [{ id: 1, points: chain.points, smooth: pts, closed: false, lengthMm: chain.lengthMm, hinges: chain.hinges }],
      crossings: [],
      unlit: [],
      params: P,
    });
    try {
      expect(built.solid.status()).toBe('NoError');
      const warning = built.warnings.find((line) => line.startsWith('Parete interna sotto'));
      expect(warning).toBeTruthy();
      expect(warning).toContain(P.WALL_MIN.toFixed(1));
      expect(warning).toMatch(/in \(-?\d+\.\d, -?\d+\.\d\)/);
    } finally {
      built.solid.delete();
      built.diffuser.delete();
    }
  });
});

describe('generate', () => {
  it('una parola di 8 lettere è manifold e resta sotto i 3 secondi', async () => {
    const t0 = performance.now();
    const result = await generateSign(
      {
        schemaVersion: 2,
        generatorVersion: '0.2.0',
        source: { kind: 'text', text: 'Torinese', fontId: 'sacramento' },
        heightMm: 100,
        color: '#ff2fd6',
        params: {},
        paths: null,
        crossings: [],
      },
      readPublic,
    );
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(3000);
    expect(result.housingMesh.triVerts.length).toBeGreaterThan(12);
    expect(result.diffuserMesh.triVerts.length).toBeGreaterThan(0);
    // Ogni spezzone aperto ha due asole, meno quelle fuse nelle tasche. Il puntino "dot" non ne ha.
    const slotEnds = result.bom.wireSlots + result.bom.corners.length * 2;
    expect(slotEnds).toBeLessThanOrEqual(result.bom.segments.length * 2);
    expect((result.bom.segments.length * 2 - slotEnds) % 2).toBe(0);
    expect(result.outline.length).toBeGreaterThan(0);

    const { Manifold, Mesh } = await getManifold();
    const housing = new Manifold(new Mesh(result.housingMesh));
    const diffuser = new Manifold(new Mesh(result.diffuserMesh));
    try {
      expect(housing.status()).toBe('NoError');
      expect(diffuser.status()).toBe('NoError');
    } finally {
      housing.delete();
      diffuser.delete();
    }
  }, 15_000);
});
