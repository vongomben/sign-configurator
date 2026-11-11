// Scatole per l'elettronica (SPEC §2, Scatola): catalogo e scelta in base agli ingombri di
// alimentatore e controller. Misure interne in mm; prezzi indicativi per un pezzo, IVA esclusa,
// novembre 2026. Modulo puro.

/** Distanza fra un componente e la parete, mm. */
export const BOX_WALL_GAP_MM = 5;
/** Distanza fra due componenti affiancati, mm. */
export const BOX_ITEM_GAP_MM = 10;
/** Aria sopra il componente più alto, per i cavi sui morsetti, mm. */
export const BOX_TOP_GAP_MM = 10;
/** Ingombro indicativo di un controller di cui il costruttore non pubblica le misure. */
export const CONTROLLER_FALLBACK_MM: [number, number, number] = [60, 35, 20];

export interface BoxSpec {
  id: string;
  brand: string;
  model: string;
  /** Interno L × W × H, mm. */
  innerMm: [number, number, number];
  /** Esterno L × W × H, mm; null se non l'abbiamo da una fonte. */
  outerMm: [number, number, number] | null;
  ip: string;
  material: string;
  priceEur: [number, number];
  url: string;
  /** Interno stimato dall'esterno (pareti e coperchio), non dichiarato dal costruttore. */
  innerEstimated?: boolean;
}

/** Hammond dà le misure esterne: interno stimato con pareti da 2,5 mm e 7 mm fra fondo e coperchio. */
function hammond(model: string, outer: [number, number, number], price: [number, number]): BoxSpec {
  return {
    id: model.toLowerCase(),
    brand: 'Hammond',
    model,
    innerMm: [outer[0] - 5, outer[1] - 5, outer[2] - 7],
    outerMm: outer,
    ip: 'IP54',
    material: 'Black ABS',
    priceEur: price,
    url: 'https://www.hammfg.com/electronics/small-case/plastic/1591',
    innerEstimated: true,
  };
}

/** Gewiss serie 44 CE: il codice dice le misure interne. */
function gewiss(model: string, inner: [number, number, number], outer: [number, number, number] | null, price: [number, number], ip = 'IP56'): BoxSpec {
  return {
    id: model.toLowerCase(),
    brand: 'Gewiss',
    model,
    innerMm: inner,
    outerMm: outer,
    ip,
    material: 'Grey thermoplastic',
    priceEur: price,
    url: `https://www.gewiss.com/content/gewiss/ww/en/search.html?q=${model}`,
  };
}

export const BOXES: readonly BoxSpec[] = [
  hammond('1591XXLSBK', [86, 56, 36], [8, 10]),
  hammond('1591XXGSBK', [122, 94, 36], [10, 12]),
  hammond('1591XXTSBK', [123, 83, 60], [5, 10]),
  gewiss('GW44204', [100, 100, 50], null, [6, 8]),
  gewiss('GW44205', [120, 80, 50], null, [6, 8]),
  gewiss('GW44206', [150, 110, 70], null, [9, 12]),
  gewiss('GW44207', [190, 140, 70], null, [15, 20]),
  gewiss('GW44208', [240, 190, 90], [254, 200, 98], [17, 32]),
  gewiss('GW44209', [300, 220, 120], [316, 236, 128], [29, 58], 'IP55'),
];

/** Scelta nel menu: la più piccola che basta, nessuna scatola, o una scatola precisa. */
export const BOX_AUTO = 'auto';
export const BOX_NONE = 'none';

export interface BoxItem {
  /** Nome per gli avvisi. */
  label: string;
  sizeMm: [number, number, number];
}

const volume = (b: BoxSpec): number => b.innerMm[0] * b.innerMm[1] * b.innerMm[2];

/**
 * Le misure interne minime per `items` affiancati: in fila lungo L oppure lungo W, con
 * BOX_WALL_GAP_MM alle pareti, BOX_ITEM_GAP_MM fra un componente e l'altro, BOX_TOP_GAP_MM sopra.
 */
export function boxNeeds(items: readonly BoxItem[]): [number, number, number][] {
  if (items.length === 0) return [];
  const gaps = 2 * BOX_WALL_GAP_MM + (items.length - 1) * BOX_ITEM_GAP_MM;
  const sumL = items.reduce((s, i) => s + i.sizeMm[0], 0);
  const sumW = items.reduce((s, i) => s + i.sizeMm[1], 0);
  const maxL = Math.max(...items.map((i) => i.sizeMm[0]));
  const maxW = Math.max(...items.map((i) => i.sizeMm[1]));
  const h = Math.max(...items.map((i) => i.sizeMm[2])) + BOX_TOP_GAP_MM;
  return [
    [sumL + gaps, maxW + 2 * BOX_WALL_GAP_MM, h],
    [maxL + 2 * BOX_WALL_GAP_MM, sumW + gaps, h],
  ];
}

/** I componenti ci stanno, in una delle due file e con la scatola girata come serve. */
export function boxFits(box: BoxSpec, items: readonly BoxItem[]): boolean {
  if (items.length === 0) return true;
  const [bl, bw, bh] = box.innerMm;
  return boxNeeds(items).some(
    ([l, w, h]) => h <= bh && ((l <= bl && w <= bw) || (l <= bw && w <= bl)),
  );
}

/** Id delle scatole che contengono `items`, dalla più piccola. */
export function boxesThatFit(items: readonly BoxItem[]): string[] {
  return [...BOXES].sort((a, b) => volume(a) - volume(b)).filter((b) => boxFits(b, items)).map((b) => b.id);
}

export interface BoxPick {
  box: BoxSpec | null;
  /** La scatola scelta li contiene tutti; sempre vero senza scatola o senza componenti. */
  fits: boolean;
  /** Scelta automatica: la più piccola che basta. */
  auto: boolean;
}

/**
 * Scatola per `items`. `choice`: BOX_AUTO (la più piccola che basta, per volume interno),
 * BOX_NONE, o l'id di una scatola (anche se troppo piccola: `fits` lo dice).
 */
export function pickBox(items: readonly BoxItem[], choice: string = BOX_AUTO): BoxPick {
  if (choice === BOX_NONE || items.length === 0) return { box: null, fits: true, auto: choice !== BOX_NONE };
  const chosen = BOXES.find((b) => b.id === choice);
  if (chosen) return { box: chosen, fits: boxFits(chosen, items), auto: false };
  const box = [...BOXES].sort((a, b) => volume(a) - volume(b)).find((b) => boxFits(b, items)) ?? null;
  return { box, fits: box !== null, auto: true };
}
