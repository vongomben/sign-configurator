// Catalogo degli alimentatori (SPEC §2, Alimentatori; pagina parts.html). Dieci famiglie
// Mean Well comuni, ciascuna con le versioni a 5, 12 e 24 V. Correnti e misure dalle schede
// tecniche; prezzi indicativi per un pezzo, IVA esclusa, novembre 2026. Modulo puro.

export type SupplyKind = 'adapter' | 'enclosed' | 'waterproof';

export interface SupplyVariant {
  /** Codice d'ordine del costruttore. */
  model: string;
  volts: number;
  amps: number;
}

export interface SupplyFamily {
  id: string;
  name: string;
  kind: SupplyKind;
  watts: number;
  /** Lunghezza × larghezza × altezza, mm. */
  sizeMm: [number, number, number];
  /** Prezzo medio, € per pezzo, IVA esclusa: minimo e massimo visti. */
  priceEur: [number, number];
  datasheet: string;
  variants: SupplyVariant[];
  /** Nota per la pagina parts (misure da verificare, versioni mancanti). */
  note?: string;
}

const sheet = (family: string): string => `https://www.meanwell.com/Upload/PDF/${family}/${family}-SPEC.PDF`;

function lrs(watts: number, size: [number, number, number], price: [number, number], amps: Record<number, number>): SupplyFamily {
  const name = `LRS-${watts}`;
  return {
    id: name.toLowerCase(),
    name,
    kind: 'enclosed',
    watts,
    sizeMm: size,
    priceEur: price,
    datasheet: sheet(name),
    variants: Object.entries(amps).map(([v, a]) => ({ model: `${name}-${v}`, volts: Number(v), amps: a })),
  };
}

export const SUPPLIES: readonly SupplyFamily[] = [
  {
    id: 'gst60a',
    name: 'GST60A',
    kind: 'adapter',
    watts: 60,
    sizeMm: [125, 50, 31.5],
    priceEur: [16, 22],
    datasheet: sheet('GST60A'),
    variants: [
      { model: 'GST60A05-P1J', volts: 5, amps: 6 },
      { model: 'GST60A12-P1J', volts: 12, amps: 5 },
      { model: 'GST60A24-P1J', volts: 24, amps: 2.5 },
    ],
    note: '30 W at 5 V. IEC C14 inlet: the mains cord carries the plug.',
  },
  lrs(35, [99, 82, 30], [10, 12], { 5: 7, 12: 3, 24: 1.5 }),
  lrs(50, [99, 82, 30], [11, 14], { 5: 10, 12: 4.2, 24: 2.2 }),
  lrs(75, [99, 97, 30], [13, 16], { 5: 14, 12: 6, 24: 3.2 }),
  lrs(100, [129, 97, 30], [14, 22], { 5: 18, 12: 8.5, 24: 4.5 }),
  { ...lrs(150, [159, 97, 30], [17, 24], { 12: 12.5, 24: 6.5 }), note: 'No 5 V version.' },
  lrs(200, [215, 115, 30], [22, 28], { 5: 40, 12: 17, 24: 8.8 }),
  lrs(350, [215, 115, 30], [28, 35], { 5: 60, 12: 29, 24: 14.6 }),
  {
    id: 'lpv-60',
    name: 'LPV-60',
    kind: 'waterproof',
    watts: 60,
    sizeMm: [162.5, 42.5, 32],
    priceEur: [18, 30],
    datasheet: sheet('LPV-60'),
    variants: [
      { model: 'LPV-60-12', volts: 12, amps: 5 },
      { model: 'LPV-60-24', volts: 24, amps: 2.5 },
    ],
    note: 'No 5 V version. Some sellers list 148 × 40 × 30 mm: check the datasheet.',
  },
  {
    id: 'lpv-100',
    name: 'LPV-100',
    kind: 'waterproof',
    watts: 100,
    sizeMm: [190, 52, 37],
    priceEur: [25, 40],
    datasheet: sheet('LPV-100'),
    variants: [
      { model: 'LPV-100-5', volts: 5, amps: 12 },
      { model: 'LPV-100-12', volts: 12, amps: 8.5 },
      { model: 'LPV-100-24', volts: 24, amps: 4.2 },
    ],
    note: '60 W at 5 V.',
  },
];

export interface SupplyPick {
  family: SupplyFamily;
  variant: SupplyVariant;
}

/**
 * Alimentatore consigliato per `amps` (già con il margine) a `volts`, per un'insegna da interno:
 * l'adattatore con spina se basta, altrimenti l'LRS più piccolo che regge la corrente.
 * Gli LPV (esterno) restano nel catalogo ma non vengono scelti. null se nessuno basta.
 */
export function pickSupply(volts: number, amps: number): SupplyPick | null {
  if (!(amps > 0)) return null;
  const order: SupplyKind[] = ['adapter', 'enclosed'];
  for (const kind of order) {
    const fits = SUPPLIES.filter((family) => family.kind === kind)
      .map((family) => ({ family, variant: family.variants.find((v) => v.volts === volts && v.amps >= amps) }))
      .filter((pick): pick is SupplyPick => pick.variant !== undefined)
      .sort((a, b) => a.family.watts - b.family.watts);
    if (fits[0]) return fits[0];
  }
  return null;
}
