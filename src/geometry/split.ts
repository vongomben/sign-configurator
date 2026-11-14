// Suddivisione per il piatto di stampa (SPEC §14). Modulo puro: sceglie dove tagliare, non taglia.
// Tagli verticali (x costante), dritti: i pezzi si accostano e li tiene il fondale o la colla.

export type SplitPoint = readonly [number, number];

export interface SplitInput {
  /** Profilo esterno dell'housing, mm. */
  outline: readonly (readonly SplitPoint[])[];
  /** Linee centrali degli spezzoni: un taglio ne attraversa il meno possibile. */
  centerlines: readonly (readonly SplitPoint[])[];
  /**
   * Intervalli in x occupati da una lavorazione. `slot` (asola dei fili, tasca d'angolo) è dove la
   * striscia già finisce: tagliarci dentro costa poco. `hole` (ancoraggio, cavo) si evita di qualche mm.
   */
  keepOut: readonly { x0: number; x1: number; kind?: 'hole' | 'slot' }[];
  bedW: number;
  bedH: number;
}

export interface SplitPiece {
  x0: number;
  x1: number;
}

export interface SplitPlan {
  /** Ascisse dei tagli, crescenti. Vuoto: l'insegna sta sul piatto in un pezzo. */
  cutsX: number[];
  /** Quanti dei tagli scelti attraversano un canale acceso: lì la striscia va interrotta. */
  onChannel: number;
  pieces: SplitPiece[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  warnings: string[];
}

/** Margine dal bordo del piatto, per lato. */
export const BED_MARGIN = 5;
/** Aria per lato su ogni faccia tagliata: i pezzi accostati non forzano. */
export const SPLIT_CLEARANCE = 0.1;
/** Passo di ricerca dei tagli. */
const STEP = 0.5;
/** Un pezzo più stretto di così non si stampa bene. */
const MIN_PIECE = 30;
/**
 * Un taglio che attraversa un canale acceso obbliga a interrompere la striscia e a saldare tre fili
 * sul giunto: è la cosa da evitare per prima, molto più di una lavorazione sfiorata.
 */
const COST_CROSSING = 40;
/** Canale quasi parallelo al taglio: lascia una scheggia lunga. */
const COST_GRAZING = 25;
/** Il profilo esterno lo attraversa qualunque taglio: conta appena, per preferire i tratti stretti. */
const COST_OUTLINE = 0.2;
/** Foro di ancoraggio o del cavo tagliato a metà. Si schiva di qualche millimetro. */
const COST_HOLE = 8;
const HOLE_PAD = 2;
/** Asola o tasca: lì la striscia già finisce, il taglio ci passa quasi senza danno. */
const COST_SLOT = 2;
/** Dentro un varco largo il taglio si mette in mezzo: premio per ogni mm dal canale più vicino. */
const CLEARANCE_BONUS = 0.25;
const CLEARANCE_MAX = 6;
/** Un pezzo in più si accetta solo se evita almeno mezzo attraversamento di canale. */
const COST_EXTRA_PIECE = 20;
/** Quanti pezzi in più del minimo si possono provare. */
const EXTRA_CUTS_MAX = 2;
/** Sotto questo seno dell'angolo fra tratto e taglio, il tratto è «quasi parallelo» (≈ 25°). */
const GRAZING_SIN = 0.42;

function boundsOf(outline: readonly (readonly SplitPoint[])[]): SplitPlan['bounds'] | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of outline) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX > minX && maxY > minY ? { minX, maxX, minY, maxY } : null;
}

/** Costo degli attraversamenti di una polilinea alla retta x = costante. */
function crossingCost(line: readonly SplitPoint[], closed: boolean, x: number, each: number, grazing: number): number {
  let cost = 0;
  const n = line.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = line[i]!;
    const b = line[(i + 1) % n]!;
    if ((a[0] - x) * (b[0] - x) > 0) continue;
    if (a[0] === x && b[0] === x) {
      cost += grazing;
      continue;
    }
    // Un vertice esattamente sul taglio conta una volta sola: lo prende il tratto che parte da lì.
    // L'ultimo punto di una linea aperta non ha un tratto successivo: conta qui.
    if (b[0] === x && (closed || i < last - 1)) continue;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    cost += each;
    if (length > 0 && Math.abs(b[0] - a[0]) / length < GRAZING_SIN) cost += grazing;
  }
  return cost;
}

/** Il miglior insieme di `cuts` tagli, o null se non ce n'è uno che rispetti i limiti dei pezzi. */
function bestCuts(
  xs: readonly number[],
  costs: readonly number[],
  cuts: number,
  minX: number,
  maxX: number,
  maxPiece: number,
): { cost: number; chosen: number[] } | null {
  const width = maxX - minX;
  const ideal = width / (cuts + 1);
  const even = (piece: number): number => 1e-4 * Math.abs(piece - ideal);
  // best[i]: costo minimo con l'ultimo taglio piazzato nel candidato i.
  let best = xs.map((x, i) => {
    const piece = x - minX;
    return piece < MIN_PIECE || piece > maxPiece ? Infinity : costs[i]! + even(piece);
  });
  const from: number[][] = [];
  for (let k = 1; k < cuts; k++) {
    const next = new Array<number>(xs.length).fill(Infinity);
    const back = new Array<number>(xs.length).fill(-1);
    let lo = 0;
    for (let i = 0; i < xs.length; i++) {
      while (lo < i && xs[i]! - xs[lo]! > maxPiece) lo++;
      for (let j = lo; j < i; j++) {
        const piece = xs[i]! - xs[j]!;
        if (piece < MIN_PIECE) break;
        const value = best[j]! + costs[i]! + even(piece);
        if (value < next[i]!) {
          next[i] = value;
          back[i] = j;
        }
      }
    }
    from.push(back);
    best = next;
  }
  let end = -1;
  let endCost = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const piece = maxX - xs[i]!;
    if (piece < MIN_PIECE || piece > maxPiece) continue;
    const value = best[i]! + even(piece);
    if (value < endCost) {
      endCost = value;
      end = i;
    }
  }
  if (end < 0 || !Number.isFinite(endCost)) return null;
  const chosen: number[] = [];
  let at = end;
  for (let k = cuts - 1; k >= 0; k--) {
    chosen.push(xs[at]!);
    if (k > 0) at = from[k - 1]![at]!;
  }
  chosen.reverse();
  return { cost: endCost, chosen };
}

/** Dove tagliare perché ogni pezzo stia sul piatto. Deterministico. */
export function planSplit(input: SplitInput): SplitPlan {
  const warnings: string[] = [];
  const bounds = boundsOf(input.outline) ?? { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  const plan: SplitPlan = { cutsX: [], onChannel: 0, pieces: [{ x0: bounds.minX, x1: bounds.maxX }], bounds, warnings };
  const usableW = input.bedW - 2 * BED_MARGIN;
  const usableH = input.bedH - 2 * BED_MARGIN;
  if (!(usableW > MIN_PIECE) || !(usableH > MIN_PIECE)) {
    warnings.push(`Piatto di stampa ${input.bedW} × ${input.bedH} mm troppo piccolo: nessuna suddivisione.`);
    return plan;
  }
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (!(width > 0)) return plan;
  const fits = (w: number, h: number): boolean => w <= usableW + 1e-9 && h <= usableH + 1e-9;
  if (fits(width, height) || fits(height, width)) return plan;

  // I pezzi tengono l'altezza dell'insegna: sul piatto la si mette lungo il lato che la contiene.
  let maxPiece = usableW;
  if (height > usableH + 1e-9 && height <= usableW + 1e-9) maxPiece = usableH;
  else if (height > Math.max(usableW, usableH) + 1e-9) {
    warnings.push(
      `Insegna alta ${height.toFixed(0)} mm: oltre il piatto di stampa (${Math.max(usableW, usableH).toFixed(0)} mm utili). I tagli orizzontali non sono previsti.`,
    );
    maxPiece = Math.min(usableW, usableH);
  }
  if (width <= maxPiece + 1e-9) return plan;

  // Candidati: una griglia di passo STEP fra i due bordi.
  const count = Math.floor(width / STEP);
  const xs: number[] = [];
  const costs: number[] = [];
  const onChannel: boolean[] = [];
  for (let i = 1; i < count; i++) {
    const x = bounds.minX + i * STEP;
    let channels = 0;
    for (const line of input.centerlines) channels += crossingCost(line, false, x, COST_CROSSING, COST_GRAZING);
    let cost = channels;
    // Il profilo esterno non è un canale: un suo tratto verticale non è una scheggia da evitare.
    for (const ring of input.outline) cost += crossingCost(ring, true, x, COST_OUTLINE, 0);
    for (const zone of input.keepOut) {
      const dist = Math.max(0, zone.x0 - x, x - zone.x1);
      if (zone.kind === 'slot') {
        if (dist === 0) cost += COST_SLOT;
      } else if (dist < HOLE_PAD) cost += COST_HOLE * (1 - dist / HOLE_PAD);
    }
    xs.push(x);
    costs.push(cost);
    onChannel.push(channels > 0);
  }

  // Distanza di ogni candidato dal canale più vicino, in due passate: il premio mette il taglio
  // in mezzo al varco invece che a filo della lettera.
  const clearance = new Array<number>(xs.length).fill(Infinity);
  let run = Infinity;
  for (let i = 0; i < xs.length; i++) {
    run = onChannel[i] ? 0 : run + STEP;
    clearance[i] = run;
  }
  run = Infinity;
  for (let i = xs.length - 1; i >= 0; i--) {
    run = onChannel[i] ? 0 : run + STEP;
    if (run < clearance[i]!) clearance[i] = run;
  }
  for (let i = 0; i < xs.length; i++) costs[i] = costs[i]! - CLEARANCE_BONUS * Math.min(clearance[i]!, CLEARANCE_MAX);

  const minCuts = Math.ceil(width / maxPiece - 1e-9) - 1;
  const maxCuts = Math.max(minCuts, Math.floor(width / MIN_PIECE) - 1);
  const top = Math.min(maxCuts, minCuts + EXTRA_CUTS_MAX);
  let best: { cost: number; chosen: number[] } | null = null;
  for (let cuts = minCuts; cuts <= top; cuts++) {
    const got = bestCuts(xs, costs, cuts, bounds.minX, bounds.maxX, maxPiece);
    if (!got) continue;
    // Un pezzo in più si paga: conviene solo se toglie un giunto da saldare.
    const total = got.cost + COST_EXTRA_PIECE * (cuts - minCuts);
    if (!best || total < best.cost) best = { cost: total, chosen: got.chosen };
  }
  if (best) {
    const chosen = best.chosen;
    plan.cutsX = chosen;
    plan.pieces = chosen.map((x, i) => ({ x0: i === 0 ? bounds.minX : chosen[i - 1]!, x1: x }));
    plan.pieces.push({ x0: chosen[chosen.length - 1]!, x1: bounds.maxX });
    plan.onChannel = chosen.filter((x) => onChannel[Math.round((x - bounds.minX) / STEP) - 1]).length;
    if (plan.onChannel > 0) {
      warnings.push(
        `Suddivisione per il piatto: ${plan.onChannel} giunt${plan.onChannel === 1 ? 'o attraversa un canale acceso' : 'i attraversano un canale acceso'}: lì la striscia va interrotta e ricollegata.`,
      );
    }
    return plan;
  }
  warnings.push('Suddivisione per il piatto non riuscita: nessuna posizione di taglio valida.');
  return plan;
}
