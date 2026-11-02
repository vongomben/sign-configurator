import Module, { type ManifoldToplevel } from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';

let instance: Promise<ManifoldToplevel> | undefined;

const isNode =
  typeof (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node ===
  'string';

/**
 * Istanza condivisa di manifold-3d, usabile nel main thread, nel worker e in vitest.
 * Nel browser l'URL del .wasm arriva da Vite (`?url`), così funziona sia in dev sia nel build;
 * in Node il modulo legge il file da node_modules da solo.
 */
export function getManifold(): Promise<ManifoldToplevel> {
  instance ??= (async () => {
    const wasm = await Module(isNode ? undefined : { locateFile: () => wasmUrl });
    wasm.setup();
    return wasm;
  })();
  return instance;
}

/** Vertici e triangoli di un cubo. Un cubo manifold ne ha 8 e 12. */
export async function cubeCounts(size = 10): Promise<{ vertices: number; triangles: number }> {
  const { Manifold } = await getManifold();
  const cube = Manifold.cube([size, size, size], true);
  try {
    return { vertices: cube.numVert(), triangles: cube.numTri() };
  } finally {
    cube.delete();
  }
}

/** Smoke test: vertici di un cubo (8 attesi). */
export async function cubeVertexCount(size = 10): Promise<number> {
  return (await cubeCounts(size)).vertices;
}
