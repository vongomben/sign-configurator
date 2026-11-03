import * as Comlink from 'comlink';
import { DEFAULT_PARAMS, GENERATOR_VERSION, type CuspMode, type IDotMode } from '../config';
import { buildGraph, type SkeletonGraph } from '../geometry/graph';
import { cubeVertexCount } from '../geometry/manifold';
import { rasterize, type RasterizeInput, type TextRaster } from '../geometry/rasterize';
import { layoutStroke } from '../geometry/strokeLayout';
import { getFont } from '../fonts/registry';
import { applyCoverage, coverSign } from '../geometry/coverage';
import { buildStrip, type StripModel } from '../geometry/strip';
import type { TubePairing } from '../geometry/tubePairing';
import type { RasterImageSource, SvgImageSource } from '../order/schema';
import { layoutRaster } from '../sources/bitmapCodec';
import { layoutSvg } from '../sources/svgPaths';
import { generateSign, type GenerateResult, type OrderV1, type SignOrder } from './generate';

export interface StripModes {
  cuspMode: CuspMode;
  iDotMode: IDotMode;
}

export interface SkeletonGraphResult {
  raster: TextRaster;
  graph: SkeletonGraph;
  /** Sempre null: l'accoppiamento dei tubi non è nella pipeline (stripMode "walls"). */
  pairing: TubePairing | null;
  /** Spezzoni, cerniere, validazione e BOM ([D]–[G]). */
  strip: StripModel;
  graphMs: number;
}

// Pipeline [A]–[I] (SPEC §5). generate(order) non blocca l'interfaccia: gira qui.
const generator = {
  version(): string {
    return GENERATOR_VERSION;
  },
  cubeVertexCount(size?: number): Promise<number> {
    return cubeVertexCount(size);
  },
  async rasterize(input: RasterizeInput): Promise<TextRaster> {
    const raster = await rasterize(input);
    return Comlink.transfer(raster, [raster.data.buffer]);
  },
  async skeletonGraph(input: RasterizeInput, modes?: StripModes): Promise<SkeletonGraphResult> {
    const entry = getFont(input.fontId);
    if (!entry) throw new Error(`Font sconosciuto: "${input.fontId}"`);
    const laid = entry.kind === 'stroke' ? await layoutStroke(entry, input) : null;
    const raster = laid ? laid.raster : await rasterize(input);
    const t0 = performance.now();
    const graph = laid ? laid.graph : buildGraph(raster);
    const pairing: TubePairing | null = null;
    const params = {
      ...DEFAULT_PARAMS,
      ...(modes ? { CUSP_MODE: modes.cuspMode, I_DOT_MODE: modes.iDotMode } : {}),
    };
    const strip = buildStrip(
      { nodes: graph.nodes, edges: graph.edges, strokeWidthMm: graph.strokeWidthMm },
      params,
      input.heightMm,
    );
    applyCoverage(
      strip,
      coverSign({
        glyphs: raster.glyphs,
        paths: strip.paths,
        gaps: strip.gaps,
        excluded: strip.excluded,
        walls: [],
        corners: strip.bom.corners,
        params,
        heightMm: input.heightMm,
      }),
    );
    const graphMs = performance.now() - t0;
    return Comlink.transfer({ raster, graph, pairing, strip, graphMs }, [raster.data.buffer, graph.skeleton.buffer]);
  },
  async svgLayout(
    source: SvgImageSource,
    heightMm: number,
    pxPerMm?: number,
    modes?: StripModes,
  ): Promise<SkeletonGraphResult> {
    const t0 = performance.now();
    const laid = layoutSvg(source, heightMm, pxPerMm);
    const params = {
      ...DEFAULT_PARAMS,
      ...(modes ? { CUSP_MODE: modes.cuspMode, I_DOT_MODE: modes.iDotMode } : {}),
    };
    const strip = buildStrip(
      { nodes: laid.graph.nodes, edges: laid.graph.edges, strokeWidthMm: laid.graph.strokeWidthMm },
      params,
      heightMm,
    );
    applyCoverage(
      strip,
      coverSign({
        glyphs: laid.raster.glyphs,
        paths: strip.paths,
        gaps: strip.gaps,
        excluded: strip.excluded,
        walls: [],
        corners: strip.bom.corners,
        params,
        heightMm,
      }),
    );
    const buffers = [laid.raster.data.buffer];
    if (laid.graph.skeleton.buffer !== laid.raster.data.buffer) buffers.push(laid.graph.skeleton.buffer);
    return Comlink.transfer(
      { raster: laid.raster, graph: laid.graph, pairing: null, strip, graphMs: performance.now() - t0 },
      buffers,
    );
  },
  async rasterLayout(source: RasterImageSource, heightMm: number, modes?: StripModes): Promise<SkeletonGraphResult> {
    const t0 = performance.now();
    const laid = layoutRaster(source, heightMm);
    const params = {
      ...DEFAULT_PARAMS,
      ...(modes ? { CUSP_MODE: modes.cuspMode, I_DOT_MODE: modes.iDotMode } : {}),
    };
    const strip = buildStrip(
      { nodes: laid.graph.nodes, edges: laid.graph.edges, strokeWidthMm: laid.graph.strokeWidthMm },
      params,
      heightMm,
    );
    applyCoverage(
      strip,
      coverSign({
        glyphs: laid.raster.glyphs,
        paths: strip.paths,
        gaps: strip.gaps,
        excluded: strip.excluded,
        walls: [],
        corners: strip.bom.corners,
        params,
        heightMm,
      }),
    );
    const buffers = [laid.raster.data.buffer];
    if (laid.graph.skeleton.buffer !== laid.raster.data.buffer) buffers.push(laid.graph.skeleton.buffer);
    return Comlink.transfer(
      { raster: laid.raster, graph: laid.graph, pairing: null, strip, graphMs: performance.now() - t0 },
      buffers,
    );
  },
  async generate(order: SignOrder | OrderV1): Promise<GenerateResult> {
    const result = await generateSign(order);
    return Comlink.transfer(result, [
      result.housingMesh.vertProperties.buffer,
      result.housingMesh.triVerts.buffer,
      result.housingMesh.mergeFromVert.buffer,
      result.housingMesh.mergeToVert.buffer,
      result.diffuserMesh.vertProperties.buffer,
      result.diffuserMesh.triVerts.buffer,
      result.diffuserMesh.mergeFromVert.buffer,
      result.diffuserMesh.mergeToVert.buffer,
    ]);
  },
};

export type GeneratorApi = typeof generator;

Comlink.expose(generator);
