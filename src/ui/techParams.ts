// Parametri tecnici della pagina cliente (SPEC §12.2, strumento «Tecnica»): gli stessi del bend test,
// senza BANK_TRANSITION_L (non usato da [H]/[I]) e senza WALL, che sta sulla barra dell'anteprima.
// Modulo puro: nessun DOM.

import { BOX_AUTO, BOX_NONE, BOXES } from '../parts/boxes';
import { CONTROLLERS, DEFAULT_PARAMS, STRIP_VOLTAGES, type EdgeProfile, type Params } from '../config';

export type TechNumericKey =
  | 'STRIP_W'
  | 'STRIP_T'
  | 'HINGE_PITCH'
  | 'HINGE_MAX_DEG'
  | 'CHANNEL_W'
  | 'CHANNEL_DEPTH'
  | 'FLOOR'
  | 'WIRE_SLOT_W'
  | 'WIRE_SLOT_L'
  | 'SLOT_LIP_CHAMFER'
  | 'CHAMFER_SIZE'
  | 'CHAMFER_ANGLE'
  | 'LAYER_STEP';

export interface TechField {
  key: TechNumericKey;
  label: string;
  unit: 'mm' | '°';
  min: number;
  max: number;
  step: number;
}

export interface TechGroup {
  id: 'strip' | 'channel' | 'wires' | 'edges';
  title: string;
  fields: readonly TechField[];
}

export const TECH_GROUPS: readonly TechGroup[] = [
  {
    id: 'strip',
    title: 'LED strip',
    fields: [
      { key: 'STRIP_W', label: 'Strip width', unit: 'mm', min: 1, max: 20, step: 0.1 },
      { key: 'STRIP_T', label: 'Strip thickness', unit: 'mm', min: 0.2, max: 6, step: 0.1 },
      { key: 'HINGE_PITCH', label: 'Hinge pitch', unit: 'mm', min: 1, max: 50, step: 0.1 },
      { key: 'HINGE_MAX_DEG', label: 'Max bend per hinge', unit: '°', min: 5, max: 90, step: 1 },
    ],
  },
  {
    id: 'channel',
    title: 'Channel',
    fields: [
      { key: 'CHANNEL_W', label: 'Channel width', unit: 'mm', min: 1, max: 25, step: 0.1 },
      { key: 'CHANNEL_DEPTH', label: 'Channel depth', unit: 'mm', min: 1, max: 40, step: 0.1 },
      { key: 'FLOOR', label: 'Floor thickness', unit: 'mm', min: 1, max: 20, step: 0.1 },
    ],
  },
  {
    id: 'wires',
    title: 'Wires',
    fields: [
      { key: 'WIRE_SLOT_W', label: 'Slot width', unit: 'mm', min: 0.5, max: 25, step: 0.1 },
      { key: 'WIRE_SLOT_L', label: 'Slot length', unit: 'mm', min: 0.5, max: 30, step: 0.1 },
      { key: 'SLOT_LIP_CHAMFER', label: 'Lip chamfer', unit: 'mm', min: 0, max: 10, step: 0.1 },
    ],
  },
  {
    id: 'edges',
    title: 'Edges',
    fields: [
      { key: 'CHAMFER_SIZE', label: 'Chamfer height', unit: 'mm', min: 0, max: 40, step: 0.1 },
      { key: 'CHAMFER_ANGLE', label: 'Chamfer angle', unit: '°', min: 1, max: 89, step: 1 },
      { key: 'LAYER_STEP', label: 'Layer height', unit: 'mm', min: 0.04, max: 1, step: 0.02 },
    ],
  },
];

export const TECH_FIELDS: readonly TechField[] = TECH_GROUPS.flatMap((group) => group.fields);

export const EDGE_PROFILES: readonly { value: EdgeProfile; label: string }[] = [
  { value: 'square', label: 'Square' },
  { value: 'outer', label: 'Outer chamfer' },
  { value: 'inner', label: 'Inner chamfer' },
  { value: 'both', label: 'Both chamfers' },
];

/**
 * Densità dei LED per metro che il cliente può scegliere. Il predefinito è 144: il profilo della
 * striscia in `config.ts` (la COB da 160, usata da admin e debug) non è nella scala, quindi la
 * pagina cliente scrive sempre la densità nell'ordine. Cambia solo il numero e il passo dei LED
 * (anteprima, BOM, alimentatore), non il passo di taglio.
 */
export const LED_DENSITIES: readonly number[] = [30, 60, 74, 96, 144];
export const DEFAULT_LED_DENSITY = 144;

export function ledDensityOptions(): { value: number; label: string; isDefault: boolean }[] {
  return LED_DENSITIES.map((value) => ({ value, label: `${value} LED/m`, isDefault: value === DEFAULT_LED_DENSITY }));
}

/** Tensioni della striscia nel menu; predefinita quella del profilo (5 V). */
export function voltageOptions(): { value: number; label: string; isDefault: boolean }[] {
  return STRIP_VOLTAGES.map((value) => ({ value, label: `${value} V`, isDefault: value === DEFAULT_PARAMS.STRIP_V }));
}

/** Controller nel menu; predefinito quello standard. */
export function controllerOptions(): { value: string; label: string; isDefault: boolean }[] {
  return CONTROLLERS.map((c) => ({
    value: c.id,
    label: `${c.name} · ${c.maxA} A`,
    isDefault: c.id === DEFAULT_PARAMS.CONTROLLER_ID,
  }));
}

/** Scatole nel menu: automatica, nessuna, poi il catalogo. */
export function boxOptions(): { value: string; label: string; isDefault: boolean }[] {
  return [
    { value: BOX_AUTO, label: 'Auto: smallest that fits', isDefault: true },
    { value: BOX_NONE, label: 'No box', isDefault: false },
    ...BOXES.map((b) => ({
      value: b.id,
      label: `${b.brand} ${b.model} · ${b.innerMm.join(' × ')} mm`,
      isDefault: false,
    })),
  ];
}

export interface TechInput {
  numbers: Partial<Record<TechNumericKey, string>>;
  edgeProfile: string;
  /** Valore del menu della densità. Assente: nessuna densità nell'ordine. Sconosciuto: 144. */
  ledPerM?: string;
  /** Valore del menu della tensione. Assente o sconosciuto: quella del profilo. */
  stripV?: string;
  /** Id del controller. Assente o sconosciuto: quello standard. */
  controller?: string;
  /** Scatola: BOX_AUTO, BOX_NONE o un id di BOXES. Assente o sconosciuta: automatica. */
  box?: string;
}

/**
 * Valori del modulo → override per l'ordine. Un campo vuoto, non numerico o fuori dai limiti
 * resta al default; si scrivono solo i valori diversi dal default.
 */
export function techParams(input: TechInput): Partial<Params> {
  const out: Partial<Params> = {};
  for (const field of TECH_FIELDS) {
    const raw = input.numbers[field.key];
    if (raw === undefined || raw.trim() === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < field.min || value > field.max) continue;
    if (Math.abs(value - DEFAULT_PARAMS[field.key]) < 1e-9) continue;
    out[field.key] = value;
  }
  const profile = EDGE_PROFILES.find((entry) => entry.value === input.edgeProfile)?.value;
  if (profile && profile !== DEFAULT_PARAMS.EDGE_PROFILE) out.EDGE_PROFILE = profile;
  const volts = Number(input.stripV);
  if (STRIP_VOLTAGES.includes(volts) && volts !== DEFAULT_PARAMS.STRIP_V) out.STRIP_V = volts;
  const controller = CONTROLLERS.find((c) => c.id === input.controller);
  if (controller && controller.id !== DEFAULT_PARAMS.CONTROLLER_ID) out.CONTROLLER_ID = controller.id;
  const box = input.box;
  if (box !== undefined && (box === BOX_NONE || BOXES.some((b) => b.id === box))) out.BOX_ID = box;
  if (input.ledPerM !== undefined) {
    const asked = Number(input.ledPerM);
    const density = LED_DENSITIES.includes(asked) ? asked : DEFAULT_LED_DENSITY;
    if (density !== DEFAULT_PARAMS.LED_PER_M) out.LED_PER_M = density;
  }
  return out;
}

/** Il campo è leggibile ma fuori dai limiti, o non è un numero. */
export function techFieldInvalid(field: TechField, raw: string): boolean {
  if (raw.trim() === '') return false;
  const value = Number(raw);
  return !Number.isFinite(value) || value < field.min || value > field.max;
}
