// Ordine v3 (SPEC §6). v1 si legge come v2, poi v2 come v3: stessi STL e stessa BOM.
import type { Params } from '../config';

export interface OrderV1 {
  schemaVersion: 1;
  generatorVersion: string;
  text: string;
  fontId: string;
  heightMm: number;
  color: string;
  params?: Partial<Params>;
}

export type TraceMode = 'centerline' | 'outline';

export interface TextSource {
  kind: 'text';
  text: string;
  fontId: string;
}

export interface SvgStrokeElement {
  d: string;
  kind: 'stroke';
}

export interface SvgFillElement {
  d: string;
  kind: 'fill';
  fillRule: 'nonzero' | 'evenodd';
}

export interface SvgImageSource {
  kind: 'image';
  format: 'svg';
  name: string;
  trace: TraceMode;
  svg: { elements: (SvgStrokeElement | SvgFillElement)[] };
}

export interface RasterImageSource {
  kind: 'image';
  format: 'raster';
  name: string;
  trace: TraceMode;
  threshold: number;
  invert: boolean;
  bitmap: { width: number; height: number; rle: string };
}

export type OrderSource = TextSource | SvgImageSource | RasterImageSource;

/** Nodo di una Bézier cubica, maniglie relative al punto, mm (SPEC §5bis). */
export interface CurveNode {
  p: [number, number];
  in: [number, number];
  out: [number, number];
}

export interface CurvePath {
  id: string;
  closed: boolean;
  nodes: CurveNode[];
}

export interface DotPath {
  id: string;
  type: 'dot';
  center: [number, number];
  angle: number;
}

export type OrderPath = CurvePath | DotPath;

export interface OrderCrossing {
  at: [number, number];
  under: string;
}

/** Ordine v2: geometria, senza le scelte del cliente. */
export interface SignOrder {
  schemaVersion: 2;
  generatorVersion: string;
  source: OrderSource;
  heightMm: number;
  color: string;
  params: Partial<Params>;
  /** null finché il cliente non congela i tracciati. */
  paths: OrderPath[] | null;
  crossings: OrderCrossing[];
}

export type SizePreset = 'S' | 'M' | 'L' | 'XL';

export type LightEffect = 'colore fisso' | 'arcobaleno';

/** Scelte che non cambiano la geometria (SPEC §6). */
export interface CustomerChoices {
  effect: LightEffect;
  diffuser: boolean;
  mount: 'wall';
  plug: 'EU';
  proof: boolean;
}

export const DEFAULT_CUSTOMER: Readonly<CustomerChoices> = Object.freeze({
  effect: 'colore fisso',
  diffuser: true,
  mount: 'wall',
  plug: 'EU',
  proof: true,
});

/** Ordine v3. `sizePreset` è informativo: fa fede `heightMm`. */
export interface SignOrderV3 {
  schemaVersion: 3;
  generatorVersion: string;
  pricingVersion: string | null;
  source: OrderSource;
  heightMm: number;
  sizePreset: SizePreset | null;
  color: string;
  params: Partial<Params>;
  paths: OrderPath[] | null;
  crossings: OrderCrossing[];
  customer: CustomerChoices;
}

function copySource(source: OrderSource): OrderSource {
  if (source.kind === 'text') return { kind: 'text', text: source.text, fontId: source.fontId };
  if (source.format === 'svg') {
    return {
      kind: 'image',
      format: 'svg',
      name: source.name,
      trace: source.trace,
      svg: {
        elements: source.svg.elements.map((element) =>
          element.kind === 'stroke'
            ? { d: element.d, kind: 'stroke' }
            : { d: element.d, kind: 'fill', fillRule: element.fillRule },
        ),
      },
    };
  }
  return {
    kind: 'image',
    format: 'raster',
    name: source.name,
    trace: source.trace,
    threshold: source.threshold,
    invert: source.invert,
    bitmap: { width: source.bitmap.width, height: source.bitmap.height, rle: source.bitmap.rle },
  };
}

function isDotPath(path: OrderPath): path is DotPath {
  return 'type' in path && path.type === 'dot';
}

function copyPath(path: OrderPath): OrderPath {
  if (isDotPath(path)) {
    return { id: path.id, type: 'dot', center: [path.center[0], path.center[1]], angle: path.angle };
  }
  return {
    id: path.id,
    closed: path.closed,
    nodes: path.nodes.map((node) => ({
      p: [node.p[0], node.p[1]],
      in: [node.in[0], node.in[1]],
      out: [node.out[0], node.out[1]],
    })),
  };
}

function copyCrossing(crossing: OrderCrossing): OrderCrossing {
  return { at: [crossing.at[0], crossing.at[1]], under: crossing.under };
}

function asV2(order: OrderV1 | SignOrder | SignOrderV3): SignOrder {
  if (order.schemaVersion === 1) {
    return {
      schemaVersion: 2,
      generatorVersion: order.generatorVersion,
      source: { kind: 'text', text: order.text, fontId: order.fontId },
      heightMm: order.heightMm,
      color: order.color,
      params: { ...(order.params ?? {}) },
      paths: null,
      crossings: [],
    };
  }
  return {
    schemaVersion: 2,
    generatorVersion: order.generatorVersion,
    source: copySource(order.source),
    heightMm: order.heightMm,
    color: order.color,
    params: { ...order.params },
    paths: order.paths ? order.paths.map(copyPath) : null,
    crossings: order.crossings.map(copyCrossing),
  };
}

/** v1 → v2 → v3. I campi del cliente mancanti prendono i default; la geometria non cambia. */
export function migrateOrder(order: OrderV1 | SignOrder | SignOrderV3): SignOrderV3 {
  const geometry = asV2(order);
  const customer = order.schemaVersion === 3 ? { ...order.customer } : { ...DEFAULT_CUSTOMER };
  return {
    schemaVersion: 3,
    generatorVersion: geometry.generatorVersion,
    pricingVersion: order.schemaVersion === 3 ? order.pricingVersion : null,
    source: geometry.source,
    heightMm: geometry.heightMm,
    sizePreset: order.schemaVersion === 3 ? order.sizePreset : null,
    color: geometry.color,
    params: geometry.params,
    paths: geometry.paths,
    crossings: geometry.crossings,
    customer,
  };
}
