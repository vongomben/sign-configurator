// Link e file dell'ordine (SPEC §12.6). Mai un'eccezione: un hash rotto diventa un avviso.

import { BOX_AUTO, BOX_NONE, BOXES } from '../parts/boxes';
import {
  GENERATOR_VERSION,
  STRIP_VOLTAGES,
  CONTROLLERS,
  PLATE_CORNER_R,
  PLATE_CORNER_R_MAX,
  PLATE_CORNER_R_MIN,
  PLATE_MARGIN,
  PLATE_MARGIN_MAX,
  PLATE_MARGIN_MIN,
  type CuspMode,
  type EdgeProfile,
  type IDotMode,
  type Params,
} from '../config';
import {
  DEFAULT_CUSTOMER,
  migrateOrder,
  type CurveNode,
  type CustomerChoices,
  type LightEffect,
  type OrderCrossing,
  type OrderPath,
  type OrderSource,
  type OrderV1,
  type PlateChoice,
  type PlugType,
  type PlateMaterial,
  type PlateShape,
  type SignOrder,
  type SignOrderV3,
  type SignOrderV4,
  type SizePreset,
  type SvgFillElement,
  type SvgStrokeElement,
  type TraceMode,
} from './schema';

/** Lunghezza massima del frammento `#o=…`, in byte UTF-8. */
export const SHARE_LINK_MAX_BYTES = 8192;
export const SHARE_HEIGHT_MIN_MM = 40;
export const SHARE_HEIGHT_MAX_MM = 800;
export const SHARE_WALL_MIN_MM = 1.6;
export const SHARE_WALL_MAX_MM = 5;
const DEFAULT_COLOR = '#ff2fd6';

export interface ShareLink {
  /** `#o=…`, oppure null se il frammento supera 8 kB. */
  hash: string | null;
  bytes: number;
  /** JSON dell'ordine normalizzato, anche quando il link non c'è. */
  json: string;
}

export interface ShareRead {
  order: SignOrderV4 | null;
  warnings: string[];
}

const NUMERIC_PARAMS = [
  'STRIP_W',
  'STRIP_T',
  'BANK_TRANSITION_L',
  'HINGE_PITCH',
  'HINGE_MAX_DEG',
  'CUT_PITCH',
  'LED_PER_M',
  'LED_MAX_MA',
  'STRIP_V',
  'CHANNEL_W',
  'CHANNEL_DEPTH',
  'WALL',
  'WALL_MIN',
  'MIN_GAP',
  'FLOOR',
  'ANCHOR_HOLE_D',
  'ANCHOR_HOLE_DEPTH',
  'ANCHOR_SPACING',
  'ANCHOR_MIN_PER_SEGMENT',
  'ANCHOR_BOSS_D',
  'ANCHOR_BOSS_H',
  'WIRE_SLOT_W',
  'WIRE_SLOT_L',
  'SLOT_LIP_CHAMFER',
  'CABLE_HOLE_D',
  'CROSSING_GAP',
  'DIFFUSER_T',
  'DIFFUSER_CLEARANCE',
  'CHAMFER_SIZE',
  'CHAMFER_ANGLE',
  'LAYER_STEP',
  'CORNER_MERGE_DIST',
  'DOT_WIRE_HOLE_D',
  'DOT_OVERHANG_MM',
  'COVERAGE_MIN',
] as const satisfies readonly (keyof Params)[];

const KNOWN_ROOT = new Set([
  'schemaVersion',
  'generatorVersion',
  'pricingVersion',
  'source',
  'heightMm',
  'sizePreset',
  'color',
  'params',
  'paths',
  'crossings',
  'customer',
  'plate',
  'text',
  'fontId',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array | null {
  if (value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function pointOf(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = finite(value[0]);
  const y = finite(value[1]);
  if (x === null || y === null) return null;
  return [x, y];
}

function nodeOf(value: unknown): CurveNode | null {
  if (!isRecord(value)) return null;
  const p = pointOf(value.p);
  const inn = pointOf(value.in);
  const out = pointOf(value.out);
  if (!p || !inn || !out) return null;
  return { p, in: inn, out };
}

function pathOf(value: unknown, warnings: string[]): OrderPath | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0) {
    warnings.push('Spezzone ignorato: manca l\'id.');
    return null;
  }
  if (value.type === 'dot') {
    const center = pointOf(value.center);
    const angle = finite(value.angle);
    if (!center || angle === null) {
      warnings.push(`Puntino ${value.id} ignorato.`);
      return null;
    }
    return { id: value.id, type: 'dot', center, angle };
  }
  if (!Array.isArray(value.nodes)) {
    warnings.push(`Spezzone ${value.id} ignorato.`);
    return null;
  }
  const nodes: CurveNode[] = [];
  for (const node of value.nodes) {
    const read = nodeOf(node);
    if (read) nodes.push(read);
  }
  if (nodes.length < 2) {
    warnings.push(`Spezzone ${value.id} ignorato.`);
    return null;
  }
  return { id: value.id, closed: value.closed === true, nodes };
}

function pathsOf(value: unknown, warnings: string[]): OrderPath[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) {
    warnings.push('Tracciati ignorati.');
    return null;
  }
  const paths: OrderPath[] = [];
  for (const item of value) {
    const path = pathOf(item, warnings);
    if (path) paths.push(path);
  }
  return paths;
}

function crossingsOf(value: unknown, warnings: string[]): OrderCrossing[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    warnings.push('Incroci ignorati.');
    return [];
  }
  const crossings: OrderCrossing[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.under !== 'string') continue;
    const at = pointOf(item.at);
    if (!at) continue;
    crossings.push({ at, under: item.under });
  }
  return crossings;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function sourceOf(value: unknown, warnings: string[]): OrderSource | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'text') {
    const text = typeof value.text === 'string' ? value.text : '';
    let fontId = typeof value.fontId === 'string' ? value.fontId : '';
    if (!fontId) {
      fontId = 'sacramento';
      warnings.push('Font mancante: usato Sacramento.');
    }
    return { kind: 'text', text, fontId };
  }
  if (value.kind !== 'image') return null;
  const name = typeof value.name === 'string' && value.name ? value.name : 'immagine';
  let trace = oneOf(value.trace, ['centerline', 'outline'] as const satisfies readonly TraceMode[]);
  if (!trace) {
    trace = 'centerline';
    warnings.push('Traccia sconosciuta: usata la linea centrale.');
  }
  if (value.format === 'svg' && isRecord(value.svg) && Array.isArray(value.svg.elements)) {
    const elements: (SvgStrokeElement | SvgFillElement)[] = [];
    for (const element of value.svg.elements) {
      if (!isRecord(element) || typeof element.d !== 'string') continue;
      if (element.kind === 'stroke') elements.push({ d: element.d, kind: 'stroke' });
      else if (element.kind === 'fill') {
        const fillRule = element.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
        elements.push({ d: element.d, kind: 'fill', fillRule });
      }
    }
    return { kind: 'image', format: 'svg', name, trace, svg: { elements } };
  }
  if (value.format === 'raster' && isRecord(value.bitmap)) {
    const width = finite(value.bitmap.width);
    const height = finite(value.bitmap.height);
    const rle = typeof value.bitmap.rle === 'string' ? value.bitmap.rle : null;
    if (width === null || height === null || width <= 0 || height <= 0 || rle === null) return null;
    let threshold = finite(value.threshold);
    if (threshold === null) threshold = 128;
    else if (threshold < 0 || threshold > 255) {
      const next = Math.min(255, Math.max(0, threshold));
      warnings.push(`Soglia ${threshold} fuori limite: riportata a ${next}.`);
      threshold = next;
    }
    return {
      kind: 'image',
      format: 'raster',
      name,
      trace,
      threshold,
      invert: value.invert === true,
      bitmap: { width, height, rle },
    };
  }
  return null;
}

function paramsOf(value: unknown, warnings: string[]): Partial<Params> {
  if (value == null) return {};
  if (!isRecord(value)) {
    warnings.push('Parametri ignorati.');
    return {};
  }
  const params: Partial<Params> = {};
  for (const key of NUMERIC_PARAMS) {
    if (!(key in value)) continue;
    const number = finite(value[key]);
    if (number === null) {
      warnings.push(`Parametro ${key} ignorato.`);
      continue;
    }
    if (key === 'STRIP_V') {
      if (STRIP_VOLTAGES.includes(number)) params.STRIP_V = number;
      else warnings.push(`Tensione ${number} V sconosciuta: usata quella predefinita.`);
      continue;
    }
    if (key === 'WALL') {
      const next = Math.min(SHARE_WALL_MAX_MM, Math.max(SHARE_WALL_MIN_MM, number));
      if (next !== number) warnings.push(`Cornice ${number} mm fuori limite: riportata a ${next} mm.`);
      params.WALL = next;
      continue;
    }
    params[key] = number;
  }
  if ('ANCHOR_BOSS' in value) {
    if (typeof value.ANCHOR_BOSS === 'boolean') params.ANCHOR_BOSS = value.ANCHOR_BOSS;
    else warnings.push('Parametro ANCHOR_BOSS ignorato.');
  }
  if ('MIN_LETTER_H' in value) {
    const letter = value.MIN_LETTER_H === null ? null : finite(value.MIN_LETTER_H);
    if (value.MIN_LETTER_H === null || letter !== null) params.MIN_LETTER_H = letter;
    else warnings.push('Parametro MIN_LETTER_H ignorato.');
  }
  if ('BOX_ID' in value) {
    const box = value.BOX_ID;
    if (typeof box === 'string' && (box === BOX_AUTO || box === BOX_NONE || BOXES.some((b) => b.id === box))) params.BOX_ID = box;
    else warnings.push('Scatola sconosciuta: scelta automatica.');
  }
  if ('CONTROLLER_ID' in value) {
    if (typeof value.CONTROLLER_ID === 'string' && CONTROLLERS.some((c) => c.id === value.CONTROLLER_ID)) {
      params.CONTROLLER_ID = value.CONTROLLER_ID;
    } else warnings.push('Controller sconosciuto: usato quello standard.');
  }
  if ('EDGE_PROFILE' in value) {
    const profile = oneOf(value.EDGE_PROFILE, ['square', 'outer', 'inner', 'both'] as const satisfies readonly EdgeProfile[]);
    if (profile) params.EDGE_PROFILE = profile;
    else {
      params.EDGE_PROFILE = 'square';
      warnings.push('Bordo sconosciuto: usato il bordo dritto.');
    }
  }
  if ('CUSP_MODE' in value) {
    const mode = oneOf(value.CUSP_MODE, ['warn', 'split'] as const satisfies readonly CuspMode[]);
    if (mode) params.CUSP_MODE = mode;
    else warnings.push('Parametro CUSP_MODE ignorato.');
  }
  if ('I_DOT_MODE' in value) {
    const mode = oneOf(value.I_DOT_MODE, ['omit', 'dash', 'dot', 'unlit'] as const satisfies readonly IDotMode[]);
    if (mode) params.I_DOT_MODE = mode;
    else warnings.push('Parametro I_DOT_MODE ignorato.');
  }
  return params;
}

function customerOf(value: unknown, warnings: string[]): CustomerChoices {
  const customer: CustomerChoices = { ...DEFAULT_CUSTOMER };
  if (value == null) return customer;
  if (!isRecord(value)) {
    warnings.push('Scelte del cliente ignorate.');
    return customer;
  }
  const effect = oneOf(value.effect, ['colore fisso', 'arcobaleno'] as const satisfies readonly LightEffect[]);
  if (value.effect !== undefined) {
    if (effect) customer.effect = effect;
    else warnings.push('Effetto sconosciuto: usato il colore fisso.');
  }
  if (value.diffuser !== undefined) {
    if (typeof value.diffuser === 'boolean') customer.diffuser = value.diffuser;
    else warnings.push('Diffusore non valido: lasciato attivo.');
  }
  if (value.mount !== undefined && value.mount !== 'wall') warnings.push('Fissaggio sconosciuto: usato il muro.');
  if (value.plug !== undefined) {
    const plug = oneOf(value.plug, ['EU', 'UK', 'CH', 'US'] as const satisfies readonly PlugType[]);
    if (plug) customer.plug = plug;
    else warnings.push('Spina sconosciuta: usata la EU.');
  }
  if (value.proof !== undefined) {
    if (typeof value.proof === 'boolean') customer.proof = value.proof;
    else warnings.push('Bozza non valida: lasciata attiva.');
  }
  return customer;
}

function clampMm(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function plateOf(value: unknown, warnings: string[]): PlateChoice | null {
  if (value == null) return null;
  if (!isRecord(value)) {
    warnings.push('Fondale ignorato.');
    return null;
  }
  const shape = oneOf(value.shape, ['rect', 'pill', 'contour'] as const satisfies readonly PlateShape[]);
  const material = oneOf(value.material, ['clear', 'black', 'wood'] as const satisfies readonly PlateMaterial[]);
  if (!shape || !material) {
    warnings.push('Fondale sconosciuto: nessun fondale.');
    return null;
  }
  let marginMm = finite(value.marginMm);
  if (marginMm === null) {
    marginMm = PLATE_MARGIN;
    warnings.push(`Margine del fondale mancante: usato ${PLATE_MARGIN} mm.`);
  } else {
    const next = clampMm(marginMm, PLATE_MARGIN_MIN, PLATE_MARGIN_MAX);
    if (next !== marginMm) warnings.push(`Margine del fondale ${marginMm} mm fuori limite: riportato a ${next} mm.`);
    marginMm = next;
  }
  let cornerRMm = finite(value.cornerRMm);
  if (cornerRMm === null) {
    cornerRMm = PLATE_CORNER_R;
    warnings.push(`Raggio degli angoli mancante: usato ${PLATE_CORNER_R} mm.`);
  } else {
    const next = clampMm(cornerRMm, PLATE_CORNER_R_MIN, PLATE_CORNER_R_MAX);
    if (next !== cornerRMm) warnings.push(`Raggio degli angoli ${cornerRMm} mm fuori limite: riportato a ${next} mm.`);
    cornerRMm = next;
  }
  return { shape, material, marginMm, cornerRMm };
}

function sizeOf(value: unknown, warnings: string[]): SizePreset | null {
  if (value == null) return null;
  const preset = oneOf(value, ['S', 'M', 'L', 'XL'] as const satisfies readonly SizePreset[]);
  if (preset) return preset;
  warnings.push('Taglia sconosciuta: fa fede l\'altezza.');
  return null;
}

function colorOf(value: unknown, warnings: string[]): string {
  if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) return value;
  warnings.push(`Colore non valido: usato ${DEFAULT_COLOR}.`);
  return DEFAULT_COLOR;
}

function heightOf(value: unknown, warnings: string[]): number | null {
  const height = finite(value);
  if (height === null) {
    warnings.push('Altezza mancante o non valida.');
    return null;
  }
  if (height < SHARE_HEIGHT_MIN_MM) {
    warnings.push(`Altezza ${height} mm fuori limite: riportata a ${SHARE_HEIGHT_MIN_MM} mm.`);
    return SHARE_HEIGHT_MIN_MM;
  }
  if (height > SHARE_HEIGHT_MAX_MM) {
    warnings.push(`Altezza ${height} mm fuori limite: riportata a ${SHARE_HEIGHT_MAX_MM} mm.`);
    return SHARE_HEIGHT_MAX_MM;
  }
  return height;
}

function orderFromRecord(record: Record<string, unknown>, warnings: string[]): SignOrderV4 | null {
  const extra = Object.keys(record).filter((key) => !KNOWN_ROOT.has(key));
  if (extra.length > 0) warnings.push(`Campi ignorati: ${extra.join(', ')}.`);
  const version = finite(record.schemaVersion);
  const generatorVersion = typeof record.generatorVersion === 'string' ? record.generatorVersion : '';
  const heightMm = heightOf(record.heightMm, warnings);
  if (heightMm === null) return null;
  const color = colorOf(record.color, warnings);
  const params = paramsOf(record.params, warnings);
  if (version === 1) {
    const text = typeof record.text === 'string' ? record.text : '';
    let fontId = typeof record.fontId === 'string' ? record.fontId : '';
    if (!fontId) {
      fontId = 'sacramento';
      warnings.push('Font mancante: usato Sacramento.');
    }
    const v1: OrderV1 = { schemaVersion: 1, generatorVersion, text, fontId, heightMm, color, params };
    return migrateOrder(v1);
  }
  const source = sourceOf(record.source, warnings);
  if (!source) {
    warnings.push('Sorgente mancante o non valida.');
    return null;
  }
  if (version === 2) {
    const v2: SignOrder = {
      schemaVersion: 2,
      generatorVersion,
      source,
      heightMm,
      color,
      params,
      paths: pathsOf(record.paths, warnings),
      crossings: crossingsOf(record.crossings, warnings),
    };
    return migrateOrder(v2);
  }
  const pricingVersion = typeof record.pricingVersion === 'string' ? record.pricingVersion : null;
  const shared = {
    generatorVersion,
    pricingVersion,
    source,
    heightMm,
    sizePreset: sizeOf(record.sizePreset, warnings),
    color,
    params,
    paths: pathsOf(record.paths, warnings),
    crossings: crossingsOf(record.crossings, warnings),
    customer: customerOf(record.customer, warnings),
  };
  if (version === 3) {
    const v3: SignOrderV3 = { schemaVersion: 3, ...shared };
    return migrateOrder(v3);
  }
  if (version === 4) {
    const v4: SignOrderV4 = { schemaVersion: 4, ...shared, plate: plateOf(record.plate, warnings) };
    return migrateOrder(v4);
  }
  warnings.push('Versione dell\'ordine non riconosciuta.');
  return null;
}

function noteGenerator(order: SignOrderV4, warnings: string[]): void {
  if (order.generatorVersion !== GENERATOR_VERSION) {
    warnings.push(`Versione del generatore ${order.generatorVersion || 'mancante'}: il risultato può cambiare.`);
  }
}

/** JSON normalizzato e, se ci sta in 8 kB, il frammento `#o=`. */
export function encodeShare(order: SignOrderV4): ShareLink {
  try {
    const json = JSON.stringify(migrateOrder(order));
    const hash = `#o=${toBase64Url(new TextEncoder().encode(json))}`;
    const bytes = new TextEncoder().encode(hash).length;
    return { hash: bytes > SHARE_LINK_MAX_BYTES ? null : hash, bytes, json };
  } catch {
    return { hash: null, bytes: SHARE_LINK_MAX_BYTES + 1, json: '' };
  }
}

function payloadOf(input: string): string | null {
  const hashAt = input.indexOf('#o=');
  if (hashAt >= 0) return input.slice(hashAt + 3);
  if (input.startsWith('o=')) return input.slice(2);
  return null;
}

/** Hash `#o=`, URL con quell'hash, oppure il JSON del file. Non lancia. */
export function decodeShare(input: string): ShareRead {
  const warnings: string[] = [];
  try {
    const trimmed = input.trim();
    if (trimmed.startsWith('{')) {
      const parsed: unknown = JSON.parse(trimmed);
      if (!isRecord(parsed)) {
        warnings.push('File del design non valido.');
        return { order: null, warnings };
      }
      const order = orderFromRecord(parsed, warnings);
      if (order) noteGenerator(order, warnings);
      return { order, warnings };
    }
    const payload = payloadOf(trimmed);
    if (payload === null) {
      warnings.push('Link non valido.');
      return { order: null, warnings };
    }
    let text = payload;
    if (text.includes('%')) {
      try {
        text = decodeURIComponent(text);
      } catch {
        warnings.push('Link non valido.');
        return { order: null, warnings };
      }
    }
    const bytes = fromBase64Url(text);
    if (!bytes) {
      warnings.push('Link non valido.');
      return { order: null, warnings };
    }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isRecord(parsed)) {
      warnings.push('Link non valido.');
      return { order: null, warnings };
    }
    const order = orderFromRecord(parsed, warnings);
    if (order) noteGenerator(order, warnings);
    return { order, warnings };
  } catch {
    warnings.push('Link non valido.');
    return { order: null, warnings };
  }
}
