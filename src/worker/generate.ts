// [A]–[I] nel worker: dall'ordine alle mesh, ai fori e alla distinta (SPEC §5, §6).
import type { Mesh } from 'manifold-3d';
import { resolveParams } from '../config';
import type { Bom } from '../export/bom';
import type { FontBytesReader } from '../fonts/loadFont';
import { buildGraph, type SkeletonGraph } from '../geometry/graph';
import { buildHousing, type HousingHole, type HousingPocket, type HousingSlot } from '../geometry/housing';
import { getManifold } from '../geometry/manifold';
import { rasterize, type GlyphInfo, type RasterizeInput, type TextRaster } from '../geometry/rasterize';
import { layoutStroke } from '../geometry/strokeLayout';
import { ledToDiffuserMm, lightPointsFromChains, type LightPoint } from '../geometry/lights';
import { getFont } from '../fonts/registry';
import { applyCoverage, coverSign } from '../geometry/coverage';
import { buildStrip, buildStripFromPieces, type StripModel } from '../geometry/strip';
import { dotSegment, flattenPaths, type EditSegment } from '../editor/paths';
import { cutCrossingGaps, intersectPaths, resolveCrossings } from '../editor/crossings';
import { migrateOrder, type AnyOrder, type OrderV1, type SignOrder, type SignOrderV4 } from '../order/schema';
import { layoutRaster } from '../sources/bitmapCodec';
import { layoutSvg } from '../sources/svgPaths';

export type { OrderV1, SignOrder };

export interface MeshData {
  numProp: number;
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  mergeFromVert: Uint32Array;
  mergeToVert: Uint32Array;
}

export interface Centerline {
  id: number;
  points: [number, number][];
}

export interface GenerateResult {
  housingMesh: MeshData;
  diffuserMesh: MeshData;
  holes: { anchors: HousingHole[]; cable: HousingHole | null };
  slots: HousingSlot[];
  pockets: HousingPocket[];
  outline: [number, number][][];
  centerlines: Centerline[];
  /** LED lungo la linea centrale, DIN → DOUT. Il passo è LED_PER_M. */
  lightPoints: LightPoint[];
  /** Distanza faccia LED–diffusore, mm. È la sigma della gaussiana in anteprima. */
  ledGapMm: number;
  /** BOM di geometria più `plate`. Senza fondale è null (niente geometria lastra in questa fase). */
  bom: Bom & { plate: null };
  warnings: string[];
  /** Spezzoni dopo [D], prima di Chaikin. «Modifica tracciati» parte da qui. */
  segments: EditSegment[];
}

function editSegments(strip: StripModel): EditSegment[] {
  const count = Math.max(strip.paths.length, strip.chains.length);
  const segments: EditSegment[] = [];
  for (let i = 0; i < count; i++) {
    const path = strip.paths[i];
    const chain = strip.chains[i];
    const points = path?.points ?? chain?.points;
    if (!points || points.length < 2) continue;
    segments.push({
      points: points.map((point) => [point[0], point[1]]),
      closed: path?.closed ?? chain?.closed ?? false,
      dot: chain?.dot === true,
    });
  }
  return segments;
}

function copyMesh(mesh: Mesh): MeshData {
  return {
    numProp: mesh.numProp,
    vertProperties: new Float32Array(mesh.vertProperties),
    triVerts: new Uint32Array(mesh.triVerts),
    mergeFromVert: new Uint32Array(mesh.mergeFromVert ?? []),
    mergeToVert: new Uint32Array(mesh.mergeToVert ?? []),
  };
}

/** Con `paths` la geometria è già in mm: niente [A]–[D] e niente Chaikin. */
function stripFromPaths(order: SignOrderV4, params: ReturnType<typeof resolveParams>, warnings: string[]): StripModel {
  const flat = flattenPaths(order.paths ?? []);
  const hits = intersectPaths(flat.curves);
  const resolved = resolveCrossings(hits, order.crossings);
  warnings.push(...resolved.warnings);
  const cut = cutCrossingGaps(flat.curves, resolved.applied, params.CROSSING_GAP);
  const pieces = [
    ...cut.pieces.map((piece) => ({ points: piece.points, closed: piece.closed, dot: false })),
    ...flat.dots.map((dot) => ({
      points: dotSegment(dot.center, dot.angle, params.CUT_PITCH),
      closed: false,
      dot: true,
    })),
  ];
  return buildStripFromPieces(pieces, params, order.heightMm, {
    notices: resolved.applied.map((crossing) => ({
      kind: 'crossing' as const,
      x: crossing.at[0],
      y: crossing.at[1],
      radiusMm: null,
      degree: 4,
      points: [],
    })),
    gaps: cut.gaps,
  });
}

/** Pipeline completa. `read` serve ai test in Node; nel browser il worker usa fetch. */
export async function generateSign(order: AnyOrder, read?: FontBytesReader): Promise<GenerateResult> {
  const current = migrateOrder(order);
  const params = resolveParams(current.params);
  const warnings: string[] = [];

  let glyphs: GlyphInfo[] = [];
  let strip: StripModel;
  if (current.paths != null) {
    strip = stripFromPaths(current, params, warnings);
  } else {
    let raster: TextRaster;
    let graph: SkeletonGraph;
    if (current.source.kind === 'text') {
      const input: RasterizeInput = {
        text: current.source.text,
        fontId: current.source.fontId,
        heightMm: current.heightMm,
      };
      const entry = getFont(current.source.fontId);
      if (!entry) throw new Error(`Font sconosciuto: "${current.source.fontId}"`);
      const laid = entry.kind === 'stroke' ? await layoutStroke(entry, input, read) : null;
      raster = laid ? laid.raster : await rasterize(input, read);
      graph = laid ? laid.graph : buildGraph(raster);
    } else if (current.source.format === 'svg') {
      const laid = layoutSvg(current.source, current.heightMm);
      raster = laid.raster;
      graph = laid.graph;
    } else {
      const laid = layoutRaster(current.source, current.heightMm);
      raster = laid.raster;
      graph = laid.graph;
    }
    warnings.push(...raster.warnings);
    glyphs = raster.glyphs;
    // stripMode "walls" e "centerline" usano gli archi del grafo: niente mediana.
    strip = buildStrip(
      { nodes: graph.nodes, edges: graph.edges, strokeWidthMm: graph.strokeWidthMm },
      params,
      current.heightMm,
    );
  }
  const coverage = coverSign({
    glyphs,
    paths: strip.paths,
    gaps: strip.gaps,
    excluded: strip.excluded,
    walls: [],
    corners: strip.bom.corners,
    params,
    heightMm: current.heightMm,
  });
  applyCoverage(strip, coverage);
  warnings.push(...strip.issues.map((issue) => issue.message));

  const wasm = await getManifold();
  const housing = buildHousing(wasm, {
    paths: strip.chains,
    crossings: strip.notices.filter((notice) => notice.kind === 'crossing').map((notice) => [notice.x, notice.y]),
    unlit: strip.unlit,
    params,
  });
  warnings.push(...housing.warnings);
  try {
    const housingMesh = copyMesh(housing.solid.getMesh());
    const diffuserMesh = copyMesh(housing.diffuser.getMesh());
    if (housing.solid.status() !== 'NoError') warnings.push(`Housing non manifold (${housing.solid.status()}).`);
    if (housing.diffuser.status() !== 'NoError') warnings.push(`Diffusore non manifold (${housing.diffuser.status()}).`);
    return {
      housingMesh,
      diffuserMesh,
      holes: { anchors: housing.holes.anchors, cable: housing.holes.cable },
      slots: housing.holes.wireSlots,
      pockets: housing.holes.cornerPockets,
      outline: housing.outline,
      centerlines: strip.chains.map((chain) => ({
        id: chain.id,
        points: chain.points.map((point) => [point[0], point[1]] as [number, number]),
      })),
      lightPoints: lightPointsFromChains(
        strip.chains.map((chain) => ({
          id: chain.id,
          points: chain.smooth.length >= 2 ? chain.smooth : chain.points,
          closed: chain.closed,
          dot: chain.dot,
        })),
        params,
      ),
      ledGapMm: ledToDiffuserMm(params),
      bom: { ...strip.bom, plate: null },
      warnings,
      segments: editSegments(strip),
    };
  } finally {
    housing.solid.delete();
    housing.diffuser.delete();
  }
}
