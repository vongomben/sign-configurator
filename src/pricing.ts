// Prezzo indicativo dal 2D (SPEC §12.5). Le costanti sono segnaposto finché §10 non le fissa.

import type { CustomerChoices } from './order/schema';

export const PRICING_VERSION = '2026-11';

// DA FISSARE (SPEC §10) — g/cm³
export const PLA_DENSITY = 1.24;
// DA FISSARE (SPEC §10) — frazione di riempimento della cornice
export const INFILL_FACTOR = 0.3;
// DA FISSARE (SPEC §10) — €
export const BASE = 35;
// DA FISSARE (SPEC §10) — €/m di striscia tagliata
export const EUR_PER_M_STRIP = 18;
// DA FISSARE (SPEC §10) — €/g di stampa
export const EUR_PER_G_PRINT = 0.05;
// DA FISSARE (SPEC §10) — € per spezzone
export const EUR_PER_SEGMENT = 6;
// DA FISSARE (SPEC §10) — € per saldatura
export const EUR_PER_JOINT = 2;
// DA FISSARE (SPEC §10) — moltiplicatore sul costo
export const MARGIN = 2;
// DA FISSARE (SPEC §10) — €, sotto non si scende
export const PRICE_MIN = 25;
// DA FISSARE (SPEC §10) — €, passo dell'arrotondamento per eccesso
export const PRICE_STEP = 5;

// DA FISSARE (SPEC §10) — alimentatore a scaglioni, €. Il primo con maxA ≥ supplyA.
export const PSU_TIERS: readonly { maxA: number; eur: number }[] = [
  { maxA: 2, eur: 12 },
  { maxA: 5, eur: 18 },
  { maxA: 10, eur: 28 },
  { maxA: Number.POSITIVE_INFINITY, eur: 45 },
];

export interface PriceMeasure {
  outlineMm2: number;
  channelMm2: number;
  /** Somma dei cutLengthMm, mm. */
  stripMm: number;
  segments: number;
  solderJoints: number;
  supplyA: number;
  floorMm: number;
  channelDepthMm: number;
  diffuserThicknessMm: number;
}

export interface PriceLine {
  id: string;
  label: string;
  amount: number;
}

export interface PriceQuote {
  total: number;
  breakdown: PriceLine[];
}

function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundUpStep(value: number, step: number): number {
  if (!(step > 0)) return cents(value);
  const stepCents = Math.round(step * 100);
  const valueCents = Math.round(value * 100);
  return (Math.ceil(valueCents / stepCents) * stepCents) / 100;
}

function supplyEur(supplyA: number): number {
  if (!(supplyA > 0)) return 0;
  for (const tier of PSU_TIERS) {
    if (supplyA <= tier.maxA) return tier.eur;
  }
  return PSU_TIERS[PSU_TIERS.length - 1]?.eur ?? 0;
}

/** Area con segno di un anello, mm². Sommare gli anelli: i buchi, se girano al contrario, si sottraggono. */
export function ringAreaMm2(ring: readonly (readonly [number, number])[]): number {
  let signed = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    signed += a[0] * b[1] - b[0] * a[1];
  }
  return signed / 2;
}

/**
 * Prezzo indicativo. `customer.diffuser` aggiunge il coperchio pieno.
 * Stesso ingresso e stessa PRICING_VERSION → stesso risultato.
 */
export function priceOrder(customer: Pick<CustomerChoices, 'diffuser'>, measure: PriceMeasure): PriceQuote {
  const bodyMm3 = measure.outlineMm2 * (measure.floorMm + measure.channelDepthMm) - measure.channelMm2 * measure.channelDepthMm;
  const bodyG = Math.max(0, bodyMm3) / 1000 * PLA_DENSITY * INFILL_FACTOR;
  const diffuserMm3 = customer.diffuser ? Math.max(0, measure.outlineMm2) * Math.max(0, measure.diffuserThicknessMm) : 0;
  const diffuserG = diffuserMm3 / 1000 * PLA_DENSITY;
  const stripM = Math.max(0, measure.stripMm) / 1000;

  const lines: PriceLine[] = [
    { id: 'base', label: 'Base', amount: cents(BASE) },
    { id: 'strip', label: 'Striscia', amount: cents(stripM * EUR_PER_M_STRIP) },
    { id: 'print', label: 'Stampa', amount: cents(bodyG * EUR_PER_G_PRINT) },
    { id: 'diffuser', label: 'Diffusore', amount: cents(diffuserG * EUR_PER_G_PRINT) },
    { id: 'segments', label: 'Spezzoni', amount: cents(Math.max(0, measure.segments) * EUR_PER_SEGMENT) },
    { id: 'joints', label: 'Saldature', amount: cents(Math.max(0, measure.solderJoints) * EUR_PER_JOINT) },
    { id: 'supply', label: 'Alimentatore', amount: cents(supplyEur(measure.supplyA)) },
    { id: 'options', label: 'Opzioni', amount: 0 },
  ];
  const raw = lines.reduce((sum, line) => sum + line.amount, 0);
  const margined = raw * MARGIN;
  const rounded = roundUpStep(margined, PRICE_STEP);
  const total = Math.max(PRICE_MIN, rounded);
  lines.push(
    { id: 'margin', label: 'Margine', amount: cents(margined - raw) },
    { id: 'rounding', label: 'Arrotondamento', amount: cents(rounded - margined) },
    { id: 'minimum', label: 'Minimo', amount: cents(total - rounded) },
  );
  return { total: cents(total), breakdown: lines };
}
