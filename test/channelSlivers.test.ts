import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { CrossSection, Vec2 } from 'manifold-3d';
import { resolveParams, totalHeight } from '../src/config';
import type { FontBytesReader } from '../src/fonts/loadFont';
import { closeChannel } from '../src/geometry/housing';
import { getManifold } from '../src/geometry/manifold';
import { generateSign } from '../src/worker/generate';

const readPublic: FontBytesReader = async (file) => {
  const b = await readFile(`public/${file}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

function holeAreas(polys: readonly (readonly Vec2[])[]): number[] {
  const out: number[] = [];
  for (const poly of polys) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      a += p[0] * q[1] - q[0] * p[1];
    }
    if (a < 0) out.push(-a / 2);
  }
  return out;
}

const square = (x: number, y: number, s: number, cw = false): Vec2[] => {
  const pts: Vec2[] = [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
  return cw ? pts.reverse() : pts;
};

/** Area che una chiusura di raggio `r` aggiungerebbe ancora: tacche e buchi residui. */
async function leftover(section: CrossSection, r: number): Promise<number> {
  const grown = section.offset(r, 'Round', 2, 32);
  const closed = grown.offset(-r, 'Round', 2, 32);
  const extra = closed.subtract(section);
  let worst = 0;
  for (const part of extra.decompose()) {
    worst = Math.max(worst, part.area());
    part.delete();
  }
  extra.delete();
  closed.delete();
  grown.delete();
  return worst;
}

async function diffuserSlice(text: string, heightMm: number): Promise<CrossSection> {
  const result = await generateSign(
    {
      schemaVersion: 2,
      generatorVersion: '0.2.0',
      source: { kind: 'text', text, fontId: 'sacramento' },
      heightMm,
      color: '#ff2fd6',
      params: {},
      paths: null,
      crossings: [],
    },
    readPublic,
  );
  const { Manifold, Mesh } = await getManifold();
  const p = resolveParams();
  const diffuser = new Manifold(new Mesh(result.diffuserMesh));
  const slice = diffuser.slice(totalHeight(p) - p.DIFFUSER_T / 2);
  diffuser.delete();
  return slice;
}

describe('chiusura del canale: niente buchi né tacche più stretti di 2·WALL_MIN', () => {
  it('riempie una lente e una tacca stretta, tiene un\'isola di parete vera', async () => {
    const wasm = await getManifold();
    // Canale 40×40 con un buco 1×1 (lente), uno 8×8 (isola vera) e una tacca larga 1 mm dal bordo.
    const notch: Vec2[] = [[0, 0], [40, 0], [40, 40], [20.5, 40], [20.5, 30], [19.5, 30], [19.5, 40], [0, 40]];
    const section = new wasm.CrossSection([notch, square(5, 5, 1, true), square(25, 5, 8, true)], 'Positive');
    const outline = wasm.CrossSection.square([40, 40]);
    const closed = closeChannel(wasm, section, outline, 2.4);
    const holes = holeAreas(closed.toPolygons());
    expect(holes).toHaveLength(1);
    expect(holes[0]!).toBeGreaterThan(60);
    // La tacca è sparita: il bordo alto è di nuovo dritto, l'area è quella del quadrato meno l'isola.
    expect(closed.area()).toBeGreaterThan(1600 - 64 - 0.5);
    for (const s of [closed, section, outline]) s.delete();
  });

  it('il canale non esce dalla sagoma esterna', async () => {
    const wasm = await getManifold();
    const section = wasm.CrossSection.square([10, 10]);
    const outline = wasm.CrossSection.square([10, 10]);
    const closed = closeChannel(wasm, section, outline, 2.4);
    const outside = closed.subtract(outline);
    expect(outside.area()).toBeLessThan(1e-6);
    for (const s of [closed, section, outline, outside]) s.delete();
  });

  it('«Ciao» a 12 cm: nel diffusore solo l\'occhiello della «o», niente fessure', async () => {
    const slice = await diffuserSlice('Ciao', 120);
    const holes = holeAreas(slice.toPolygons());
    expect(holes.length).toBeGreaterThan(0);
    expect(Math.min(...holes)).toBeGreaterThan(10);
    expect(await leftover(slice, 1.2)).toBeLessThan(0.05);
    slice.delete();
  });

  it('«Dog» a 12 cm: agli incroci niente tacche scure fra i tratti', async () => {
    const slice = await diffuserSlice('Dog', 120);
    expect(await leftover(slice, 1.2)).toBeLessThan(0.05);
    slice.delete();
  });
});
