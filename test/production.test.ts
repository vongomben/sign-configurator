import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/config';
import { meshToStl } from '../src/export/stl';
import type { FontBytesReader } from '../src/fonts/loadFont';
import { resampleChain } from '../src/geometry/chain';
import { buildHousing, type HousingPath } from '../src/geometry/housing';
import { getManifold } from '../src/geometry/manifold';
import type { Point } from '../src/geometry/rasterize';
import { sourceFromPaths } from '../src/geometry/segment';
import { buildStrip } from '../src/geometry/strip';
import { generateSign } from '../src/worker/generate';

const readPublic: FontBytesReader = async (file) => {
  const b = await readFile(`public/${file}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

function straight(length: number): HousingPath {
  const chain = resampleChain(
    [
      [0, 0],
      [length, 0],
    ],
    {
      hingePitch: DEFAULT_PARAMS.HINGE_PITCH,
      hingeMaxDeg: DEFAULT_PARAMS.HINGE_MAX_DEG,
      channelW: DEFAULT_PARAMS.CHANNEL_W,
      closed: false,
    },
  );
  return { id: 1, points: chain.points, closed: false, lengthMm: chain.lengthMm, hinges: chain.hinges };
}

function vee(): Point[] {
  const pts: Point[] = [];
  for (let t = 40; t > 0; t -= 1) pts.push([-t, t]);
  pts.push([0, 0]);
  for (let t = 1; t <= 40; t += 1) pts.push([t, t]);
  return pts;
}

async function diskHits(polys: readonly (readonly [number, number][])[], x: number, y: number, r: number): Promise<boolean> {
  const { CrossSection } = await getManifold();
  const shapes = polys.filter((poly) => poly.length >= 3);
  if (shapes.length === 0) return false;
  const opening = new CrossSection(shapes as [number, number][][], 'NonZero');
  const disk = CrossSection.circle(r, 24).translate([x, y]);
  const hit = opening.intersect(disk);
  const area = hit.area();
  hit.delete();
  disk.delete();
  opening.delete();
  return area > 1e-6;
}

describe('geometria di produzione', () => {
  it('dritto da 100 mm: genus 2, volume stabile, STL identico, ancoraggi fuori dalle asole', async () => {
    const wasm = await getManifold();
    const path = straight(100);
    const build = () => buildHousing(wasm, { paths: [path], crossings: [], unlit: [], params: DEFAULT_PARAMS });
    const a = build();
    const b = build();
    try {
      expect(a.solid.status()).toBe('NoError');
      expect(a.solid.genus()).toBe(2);
      expect(b.solid.genus()).toBe(2);
      expect(a.solid.volume()).toBeCloseTo(b.solid.volume(), 6);
      expect(a.solid.volume()).toBeGreaterThan(1000);
      const bytes = (mesh: ReturnType<typeof a.solid.getMesh>) => new Uint8Array(meshToStl(mesh));
      const left = bytes(a.solid.getMesh());
      const right = bytes(b.solid.getMesh());
      expect(left.length).toBe(right.length);
      expect(left.every((value, i) => value === right[i])).toBe(true);
      for (const hole of a.holes.anchors) {
        const slots = a.holes.wireSlots.map((slot) => slot.points);
        expect(await diskHits(slots, hole.x, hole.y, hole.d / 2)).toBe(false);
      }
    } finally {
      a.solid.delete();
      a.diffuser.delete();
      b.solid.delete();
      b.diffuser.delete();
    }
  });

  it('lo spigolo a 90° non mette ancoraggi nella tasca', async () => {
    const model = buildStrip(sourceFromPaths([{ points: vee() }]), DEFAULT_PARAMS, 100);
    const wasm = await getManifold();
    const built = buildHousing(wasm, { paths: model.chains, crossings: [], unlit: [], params: DEFAULT_PARAMS });
    try {
      expect(built.solid.status()).toBe('NoError');
      expect(built.holes.cornerPockets.length).toBeGreaterThan(0);
      const openings = [
        ...built.holes.wireSlots.map((slot) => slot.points),
        ...built.holes.cornerPockets.map((pocket) => pocket.points),
      ];
      for (const hole of built.holes.anchors) {
        expect(await diskHits(openings, hole.x, hole.y, hole.d / 2)).toBe(false);
      }
    } finally {
      built.solid.delete();
      built.diffuser.delete();
    }
  });

  it('Ciao Torino resta nei tempi: Sacramento sotto i 3 s, Neonderthaw sotto gli 8', async () => {
    for (const fontId of ['sacramento', 'neonderthaw']) {
      const t0 = performance.now();
      const result = await generateSign(
        {
          schemaVersion: 2,
          generatorVersion: '0.2.0',
          source: { kind: 'text', text: 'Ciao Torino', fontId },
          heightMm: 100,
          color: '#ff2fd6',
          params: {},
          paths: null,
          crossings: [],
        },
        readPublic,
      );
      // Neonderthaw ha due strisce per tubo: da solo sta intorno ai 3 s.
      // Il tetto è più alto perché la suite gira in parallelo.
      expect(performance.now() - t0).toBeLessThan(fontId === 'neonderthaw' ? 8000 : 3000);
      expect(result.centerlines.length).toBeGreaterThan(0);
      expect(result.housingMesh.triVerts.length).toBeGreaterThan(12);
      expect(result.diffuserMesh.triVerts.length).toBeGreaterThan(0);
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
    }
  }, 20_000);
});
