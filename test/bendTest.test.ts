import { describe, expect, it } from 'vitest';
import type { Manifold, Vec2 } from 'manifold-3d';
import { DEFAULT_PARAMS, totalHeight } from '../src/config';
import { toDxf } from '../src/export/dxf';
import { manifoldToStl } from '../src/export/stl';
import { wireSlotSection } from '../src/geometry/holes';
import { getManifold } from '../src/geometry/manifold';
import {
  bendTestPath,
  bankedChannelHalf,
  buildBendTest,
  channelSection,
  cornerOuterRadius,
  markHoleCenters,
  resolveBendTestParams,
  sagitta,
  wireSlots,
  type BendTestKind,
} from '../src/tools/bendTestGeometry';

/** Marcature 1+2+3+4+5 più le 2 asole. Lo smusso del labbro non è un foro in più. */
const HOLES = 15 + 2;

const P = resolveBendTestParams();
const outerHalf = P.CHANNEL_W / 2 + P.WALL;
const KINDS: BendTestKind[] = ['arcs', 'corners'];

const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
const left = (t: Vec2): Vec2 => [-t[1], t[0]];

/** Area della parte di `poly` che resta fuori dal canale. */
async function areaOutside(channel: Awaited<ReturnType<typeof makeChannel>>, poly: Vec2[] | Vec2[][], grow = 0) {
  const { CrossSection } = await getManifold();
  const raw = new CrossSection(poly, 'NonZero');
  const shape = grow > 0 ? raw.offset(grow, 'Round', 2, 64) : raw;
  const out = shape.subtract(channel);
  const area = out.area();
  for (const x of new Set([raw, shape, out])) x.delete();
  return area;
}

async function makeChannel(kind: BendTestKind, channelW = P.CHANNEL_W) {
  const wasm = await getManifold();
  return channelSection(wasm, bendTestPath(kind, P.HINGE_PITCH), { ...P, CHANNEL_W: channelW });
}

function square(c: Vec2, half: number): Vec2[] {
  return [
    [c[0] - half, c[1] - half],
    [c[0] + half, c[1] - half],
    [c[0] + half, c[1] + half],
    [c[0] - half, c[1] + half],
  ];
}

function dxfVertices(dxf: string, layer: string): [number, number][] {
  const lines = dxf.split('\n');
  const found: [number, number][] = [];
  let entity = '';
  let current = '';
  let x: number | undefined;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i]!;
    const value = lines[i + 1]!;
    if (code === '0') {
      entity = value;
      current = '';
      x = undefined;
    } else if (code === '8') current = value;
    else if (entity === 'LWPOLYLINE' && current === layer && code === '10') x = Number(value);
    else if (entity === 'LWPOLYLINE' && current === layer && code === '20' && x !== undefined) {
      found.push([x, Number(value)]);
      x = undefined;
    }
  }
  return found;
}

/** Area di materiale nel quadratino, sulla fetta a quota z. */
async function sliceArea(solid: Manifold, z: number, poly: Vec2[]): Promise<number> {
  const { CrossSection } = await getManifold();
  const slice = solid.slice(z);
  const box = new CrossSection([poly], 'NonZero');
  const hit = slice.intersect(box);
  const area = hit.area();
  hit.delete();
  box.delete();
  slice.delete();
  return area;
}

describe('bend test: percorsi', () => {
  it('A: archi R40…R7, 15 fori di marcatura', () => {
    const path = bendTestPath('arcs');
    expect(path.bends.map((b) => b.label)).toEqual([40, 25, 15, 10, 7]);
    expect(markHoleCenters(path)).toHaveLength(15);
    expect(path.length).toBeCloseTo(6 * 30 + Math.PI * (40 + 25 + 15 + 10 + 7), 6);
  });

  it('B: dritti lunghi esattamente 3·HINGE_PITCH, spigoli 30…90°', () => {
    const path = bendTestPath('corners', P.HINGE_PITCH);
    expect(path.bends.map((b) => b.label)).toEqual([30, 45, 60, 75, 90]);
    for (let i = 1; i < path.points.length; i++) {
      const [a, b] = [path.points[i - 1]!, path.points[i]!];
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(3 * P.HINGE_PITCH, 9);
    }
    for (const bend of path.bends) {
      const deg = (Math.acos(bend.heading[0] * bend.headingOut[0] + bend.heading[1] * bend.headingOut[1]) * 180) / Math.PI;
      expect(deg).toBeCloseTo(bend.label, 9);
    }
    expect(markHoleCenters(path)).toHaveLength(15);
  });
});

describe('bend test: canale', () => {
  it('A: sugli archi il bordo interno è allargato di s = P²/(8R), l\'esterno no', async () => {
    const channel = await makeChannel('arcs');
    try {
      for (const bend of bendTestPath('arcs').bends) {
        const { center, radius } = bend.arc!;
        const s = sagitta(P.HINGE_PITCH, radius);
        // Metà di un arco da 180°: direzione radiale = tangente d'ingresso.
        const radial = bend.heading;
        const at = (r: number): Vec2 => add(center, scale(radial, r));
        const inner = radius - P.CHANNEL_W / 2 - s;
        const outer = radius + P.CHANNEL_W / 2;
        expect(await areaOutside(channel, square(at(inner + 0.05), 0.01))).toBeLessThan(1e-9);
        expect(await areaOutside(channel, square(at(inner - 0.05), 0.01))).toBeGreaterThan(0);
        expect(await areaOutside(channel, square(at(outer - 0.05), 0.01))).toBeLessThan(1e-9);
        expect(await areaOutside(channel, square(at(outer + 0.05), 0.01))).toBeGreaterThan(0);
      }
    } finally {
      channel.delete();
    }
  });

  it('B: la striscia piegata in un solo intaglio ci sta, con perno ovunque sulla larghezza', async () => {
    for (const channelW of [5.4, 5.8]) {
      const channel = await makeChannel('corners', channelW);
      const clearance = (channelW - P.STRIP_W) / 2;
      try {
        for (const bend of bendTestPath('corners', P.HINGE_PITCH).bends) {
          const n1 = left(bend.heading);
          const n2 = left(bend.headingOut);
          const cos = n1[0] * n2[0] + n1[1] * n2[1];
          for (const p of [-P.STRIP_W / 2, 0, P.STRIP_W / 2]) {
            // Perno X a distanza laterale p da entrambe le linee centrali.
            const X = add(bend.start, scale(add(n1, n2), p / (1 + cos)));
            const end1 = add(X, scale(n1, -p));
            const start2 = add(X, scale(n2, -p));
            const rect = (a: Vec2, t: Vec2, n: Vec2, len: number): Vec2[] => {
              const h = P.STRIP_W / 2;
              const b = add(a, scale(t, len));
              return [add(a, scale(n, -h)), add(b, scale(n, -h)), add(b, scale(n, h)), add(a, scale(n, h))];
            };
            const strip = [rect(end1, bend.heading, n1, -12), rect(start2, bend.headingOut, n2, 12)];
            expect(await areaOutside(channel, strip)).toBeLessThan(1e-6);
            expect(await areaOutside(channel, strip, clearance * 0.9)).toBeLessThan(1e-6);
          }
        }
      } finally {
        channel.delete();
      }
    }
  });

  for (const kind of KINDS) {
    it(`${kind}: asola larga quanto il canale e a filo della parete di testa`, async () => {
      const path = bendTestPath(kind, P.HINGE_PITCH);
      const slots = wireSlots(path);
      expect(slots.map((s) => s.role)).toEqual(['DIN', 'DOUT']);
      expect(slots[0]!.center).toEqual(path.start);
      expect(slots[1]!.center).toEqual(path.end);
      const last = path.points[path.points.length - 1]!;
      const prev = path.points[path.points.length - 2]!;
      const t = [last[0] - prev[0], last[1] - prev[1]] as Vec2;
      const len = Math.hypot(t[0], t[1]);
      expect(slots[1]!.tangent[0]).toBeCloseTo(t[0] / len, 9);
      expect(slots[1]!.tangent[1]).toBeCloseTo(t[1] / len, 9);
      expect(slots[0]!.outward[0]).toBeCloseTo(-slots[0]!.tangent[0], 9);
      expect(slots[1]!.outward[1]).toBeCloseTo(slots[1]!.tangent[1], 9);

      const channel = await makeChannel(kind);
      const wasm = await getManifold();
      try {
        for (const slot of slots) {
          const section = wireSlotSection(wasm, channel, { at: slot.center, outward: slot.outward }, P);
          try {
            const half = P.CHANNEL_W / 2;
            const along = (d: number): Vec2 => add(slot.center, scale(slot.outward, d));
            const n = left(slot.outward);
            const mid = along(-P.WIRE_SLOT_L / 2);
            expect(await areaOutside(section, square(mid, 0.05))).toBeLessThan(1e-9);
            expect(await areaOutside(section, square(add(mid, scale(n, half - 0.15)), 0.04))).toBeLessThan(1e-9);
            expect(await areaOutside(section, square(add(mid, scale(n, half + 0.2)), 0.04))).toBeGreaterThan(0);
            expect(await areaOutside(section, square(along(-P.WIRE_SLOT_L - 0.3), 0.05))).toBeGreaterThan(0);
            expect(await areaOutside(section, square(along(-P.WIRE_SLOT_L + 0.3), 0.05))).toBeLessThan(1e-9);

            const cap = half;
            expect(await areaOutside(section, square(along(cap - 0.15), 0.04))).toBeLessThan(1e-9);
            expect(await areaOutside(section, square(along(cap + 0.2), 0.04))).toBeGreaterThan(0);
            expect(await areaOutside(channel, section.toPolygons())).toBeLessThan(1e-6);
            expect(await areaOutside(channel, square(along(cap - 0.1), 0.02))).toBeLessThan(1e-9);
            expect(await areaOutside(channel, square(along(cap + 0.15), 0.02))).toBeGreaterThan(0);

            const contours = section.toPolygons();
            const dxf = toDxf({ polylines: contours.map((points) => ({ layer: 'WIRE_SLOTS', points })) });
            const written = dxfVertices(dxf, 'WIRE_SLOTS');
            expect(written.length).toBeGreaterThan(8);
            for (const [x, y] of contours.flat()) {
              const hit = written.some(([mx, my]) => Math.abs(mx + x) < 1e-5 && Math.abs(my - y) < 1e-5);
              expect(hit).toBe(true);
            }
          } finally {
            section.delete();
          }
        }
      } finally {
        channel.delete();
      }
    });
  }

  it('B: raggio esterno dello spigolo cresce con l\'angolo', () => {
    const r = [30, 45, 60, 75, 90].map((a) => cornerOuterRadius(P.STRIP_W, P.CHANNEL_W, a));
    for (let i = 1; i < r.length; i++) expect(r[i]!).toBeGreaterThan(r[i - 1]!);
    expect(r[4]!).toBeCloseTo(2.5 / Math.cos(Math.PI / 4) + 0.2, 9);
  });
});

describe('bend test: pezzi D ed E', () => {
  it('D: fondo inclinato, mesh manifold, 10 marcature + 2 asole', async () => {
    const path = bendTestPath('bank');
    expect(path.bends.map((b) => b.label)).toEqual([0, 20, 35, 50]);
    expect(path.bends.every((b) => b.arc?.radius === 10)).toBe(true);
    expect(markHoleCenters(path)).toHaveLength(10);
    expect(bankedChannelHalf(P.STRIP_W, P.STRIP_T, P.CHANNEL_W, 20)).toBeGreaterThan(P.CHANNEL_W / 2);

    const r = await buildBendTest({ kind: 'bank' });
    try {
      expect(r.status).toBe('NoError');
      expect(r.expectedHoles).toBe(12);
      expect(r.pieces[0]!.genus).toBe(12);
      const bend0 = path.bends[0]!.arc!;
      const bend3 = path.bends[3]!.arc!;
      const at = (arc: { center: Vec2; points: Vec2[] }, towardInner: number): Vec2 => {
        const mid = arc.points[Math.floor(arc.points.length / 2)]!;
        const radial = scale(sub(mid, arc.center), 1 / Math.hypot(mid[0] - arc.center[0], mid[1] - arc.center[1]));
        return add(mid, scale(radial, -towardInner));
      };
      const z = P.FLOOR - 0.6;
      expect(await sliceArea(r.manifold, z, square(at(bend0, 1.8), 0.12))).toBeGreaterThan(0.02);
      expect(await sliceArea(r.manifold, z, square(at(bend3, 1.8), 0.12))).toBeLessThan(1e-6);
      expect(await sliceArea(r.manifold, z, square(at(bend3, -1.8), 0.12))).toBeGreaterThan(0.02);
    } finally {
      r.manifold.delete();
    }
  });

  it('E: due angoli a 90° e uno a 120°, tre tasche, mesh manifold', async () => {
    const path = bendTestPath('joints');
    expect(path.bends.map((b) => b.label)).toEqual([90, 90, 120]);
    expect(markHoleCenters(path)).toHaveLength(6);
    const r = await buildBendTest({ kind: 'joints' });
    try {
      expect(r.status).toBe('NoError');
      expect(r.expectedHoles).toBe(11);
      expect(r.pieces[0]!.genus).toBe(11);
    } finally {
      r.manifold.delete();
    }
  });
});

describe('bend test: solidi', () => {
  it('A singolo: manifold, 15 fori + 2 asole passanti, dimensioni attese', async () => {
    const r = await buildBendTest({ kind: 'arcs' });
    try {
      expect(r.status).toBe('NoError');
      expect(r.expectedHoles).toBe(HOLES);
      expect(r.pieces[0]!.genus).toBe(HOLES);
      const { min, max } = r.bounds;
      // X: dritti a x=0 e x=2·(40+25+15+10+7)=194; Y: da −25 (arco R25) a 30+40 (arco R40).
      expect(min[0]).toBeCloseTo(-outerHalf, 2);
      expect(max[0]).toBeCloseTo(194 + outerHalf, 2);
      expect(min[1]).toBeCloseTo(-25 - outerHalf, 2);
      expect(max[1]).toBeCloseTo(70 + outerHalf, 2);
      expect(min[2]).toBeCloseTo(0, 6);
      expect(max[2]).toBeCloseTo(totalHeight(DEFAULT_PARAMS), 6);

      const hole = (z: number, y: number, x = 0) => sliceArea(r.manifold, z, square([x, y], 0.03)).then((a) => a < 1e-8);
      const wall = (z: number, y: number, x = 0) => sliceArea(r.manifold, z, square([x, y], 0.03)).then((a) => a > 0.002);
      const lip = P.WIRE_SLOT_L;
      const cap = -(P.CHANNEL_W / 2);
      expect(await hole(2, -1)).toBe(true);
      expect(await hole(2, lip - 0.4)).toBe(true);
      expect(await wall(2, lip + 0.4)).toBe(true);
      expect(await hole(2, 3, P.CHANNEL_W / 2 - 0.15)).toBe(true);
      expect(await wall(2, 3, P.CHANNEL_W / 2 + 0.25)).toBe(true);
      expect(await hole(2, cap + 0.15)).toBe(true);
      expect(await wall(2, cap - 0.25)).toBe(true);
      // Smusso 45° sul labbro: a z = FLOOR − 0.2 il materiale manca finché non si entra di ~0.8 mm.
      expect(await hole(P.FLOOR - 0.2, lip + 0.05)).toBe(true);
      expect(await wall(P.FLOOR - 0.2, lip + 0.92)).toBe(true);
      expect(await wall(P.FLOOR - P.SLOT_LIP_CHAMFER - 0.5, lip + 0.05)).toBe(true);
    } finally {
      r.manifold.delete();
    }
  });

  it('B singolo: manifold, 15 fori + 2 asole passanti', async () => {
    const r = await buildBendTest({ kind: 'corners' });
    try {
      expect(r.status).toBe('NoError');
      expect(r.expectedHoles).toBe(HOLES);
      expect(r.pieces[0]!.genus).toBe(HOLES);
      expect(r.bounds.max[2] - r.bounds.min[2]).toBeCloseTo(totalHeight(DEFAULT_PARAMS), 6);
    } finally {
      r.manifold.delete();
    }
  });

  for (const kind of KINDS) {
    it(`${kind}: 2 varianti separate (5.4 / 5.8), 1 e 2 tacche, genus = fori`, async () => {
      const r = await buildBendTest({ kind, variants: true });
      try {
        expect(r.status).toBe('NoError');
        expect(r.pieces.map((p) => p.channelW)).toEqual([5.4, 5.8]);
        expect(r.pieces.map((p) => p.notches)).toEqual([1, 2]);
        for (const p of r.pieces) expect(p.genus).toBe(r.expectedHoles);
        const parts = r.manifold.decompose();
        expect(parts).toHaveLength(2);
        for (const m of parts) m.delete();
      } finally {
        r.manifold.delete();
      }
    });

    it(`${kind}: STL riletto come triangoli sciolti torna un solido chiuso con gli stessi fori`, async () => {
      const r = await buildBendTest({ kind, variants: true });
      const { Manifold, Mesh } = await getManifold();
      const stl = manifoldToStl(r.manifold);
      const volume = r.manifold.volume();
      const triExpected = r.manifold.numTri();
      r.manifold.delete();

      const view = new DataView(stl);
      const triCount = view.getUint32(80, true);
      expect(triCount).toBe(triExpected);
      expect(stl.byteLength).toBe(84 + 50 * triCount);
      const vertProperties = new Float32Array(triCount * 9);
      for (let t = 0; t < triCount; t++) {
        for (let k = 0; k < 9; k++) vertProperties[t * 9 + k] = view.getFloat32(84 + t * 50 + 12 + k * 4, true);
      }
      const triVerts = Uint32Array.from({ length: triCount * 3 }, (_, i) => i);
      const mesh = new Mesh({ numProp: 3, vertProperties, triVerts });
      mesh.merge();
      const back = new Manifold(mesh);
      try {
        expect(back.status()).toBe('NoError');
        expect(back.volume()).toBeCloseTo(volume, 0);
        const parts = back.decompose();
        expect(parts.map((m) => m.genus())).toEqual([r.expectedHoles, r.expectedHoles]);
        for (const m of parts) m.delete();
      } finally {
        back.delete();
      }
    });
  }
});
