// Tutte le misure in millimetri, gli angoli in gradi (SPEC §1-§3).

export const GENERATOR_VERSION = '0.2.0';
export const ORDER_SCHEMA_VERSION = 2;

/** Lato lungo massimo di una bitmap caricata, prima della soglia (SPEC §4bis). */
export const IMAGE_MAX_PX = 4096;

/** Profilo dello spigolo superiore della parete (SPEC §3). */
export type EdgeProfile = 'square' | 'outer' | 'inner' | 'both';

/** warn: lo spigolo resta un errore; split: lo spezzone si taglia nello spigolo. */
export type CuspMode = 'warn' | 'split';

/** omit: l'anello si esclude; dash: trattino; dot: spezzone con fori; unlit: rilievo senza striscia. */
export type IDotMode = 'omit' | 'dash' | 'dot' | 'unlit';

/**
 * Misure della striscia LED. R_MIN e MIN_LETTER_H non stanno qui: si ricavano dal profilo.
 * Oggi c'è solo la COB da 5 mm; le prossime strisce si aggiungono a STRIP_PROFILES.
 */
export interface StripProfile {
  id: string;
  name: string;
  STRIP_W: number;
  STRIP_T: number;
  CHANNEL_W: number;
  HINGE_PITCH: number;
  HINGE_MAX_DEG: number;
  CUT_PITCH: number;
  LED_PER_M: number;
}

/** TOPAI WS2812B COB 5 mm, 160 LED/m (SPEC §2). */
export const COB_5MM: StripProfile = Object.freeze({
  id: 'cob-5mm',
  name: 'TOPAI WS2812B COB 5 mm',
  STRIP_W: 5.0,
  STRIP_T: 2.0,
  CHANNEL_W: 5.4,
  HINGE_PITCH: 10.0,
  HINGE_MAX_DEG: 40,
  CUT_PITCH: 10.0,
  LED_PER_M: 160,
});

export const STRIP_PROFILES: readonly StripProfile[] = Object.freeze([COB_5MM]);
export const DEFAULT_STRIP: StripProfile = COB_5MM;

export interface Params {
  // Hardware (SPEC §2): copiati dal profilo striscia
  STRIP_W: number;
  /** DA MISURARE */
  STRIP_T: number;
  /**
   * Campione di piegatura, pezzo D: lunghezza della transizione lineare dell'inclinazione
   * prima e dopo ogni arco. Non entra ancora nella pipeline dell'insegna.
   */
  BANK_TRANSITION_L: number;
  HINGE_PITCH: number;
  /** Angolo massimo per cerniera. La striscia segue fino a 45°; 40° è il margine. */
  HINGE_MAX_DEG: number;
  CUT_PITCH: number;
  LED_PER_M: number;
  /** Corrente di un LED a bianco pieno, mA. Serve alla stima dell'alimentatore. */
  LED_MAX_MA: number;

  // Geometria (SPEC §3)
  CHANNEL_W: number;
  CHANNEL_DEPTH: number;
  WALL: number;
  /** Sotto questo spessore la parete interna non si assottiglia: la freccia in più genera un avviso. */
  WALL_MIN: number;
  /** Aria fra due sagome che non si toccano. Sotto, i tratti non contigui si fondono. */
  MIN_GAP: number;
  FLOOR: number;
  ANCHOR_HOLE_D: number;
  ANCHOR_HOLE_DEPTH: number;
  ANCHOR_SPACING: number;
  ANCHOR_MIN_PER_SEGMENT: number;
  ANCHOR_BOSS: boolean;
  ANCHOR_BOSS_D: number;
  ANCHOR_BOSS_H: number;
  /** Asola fili: larghezza, di default uguale al canale */
  WIRE_SLOT_W: number;
  /** Asola fili: ultimi mm dello spezzone, a filo della terminazione arrotondata */
  WIRE_SLOT_L: number;
  /** Smusso a 45° sul labbro interno dell'asola, lato spezzone, dove la striscia scende */
  SLOT_LIP_CHAMFER: number;
  CABLE_HOLE_D: number;
  CROSSING_GAP: number;
  DIFFUSER_T: number;
  DIFFUSER_CLEARANCE: number;
  EDGE_PROFILE: EdgeProfile;
  /** Altezza verticale dello smusso; ≤ CHANNEL_DEPTH */
  CHAMFER_SIZE: number;
  /** Angolo dello smusso rispetto all'orizzontale, in gradi */
  CHAMFER_ANGLE: number;
  /** Altezza delle fette dello smusso a gradini (= altezza layer di stampa) */
  LAYER_STEP: number;
  /** Derivato: 2·R_MIN, diametro della piega più stretta. `resolveParams` lo ricalcola. */
  MIN_LETTER_H: number | null;
  /** Spigoli di font o scheletro: avviso, oppure taglio dello spezzone. */
  CUSP_MODE: CuspMode;
  /** Sotto questa distanza le asole DIN/DOUT vicine diventano una tasca d'angolo. */
  CORNER_MERGE_DIST: number;
  /** Puntini e anelli sotto R_MIN. */
  I_DOT_MODE: IDotMode;
  /** Foro passante sotto ciascuna piazzola del puntino, al posto delle asole. */
  DOT_WIRE_HOLE_D: number;
  /** Di quanto la pillola, parete compresa, può uscire dall'ingombro del puntino. */
  DOT_OVERHANG_MM: number;
  /** Sotto questa frazione di linea centrale illuminata, la lettera avvisa. */
  COVERAGE_MIN: number;
}

export const DEFAULT_PARAMS: Readonly<Params> = Object.freeze({
  STRIP_W: DEFAULT_STRIP.STRIP_W,
  STRIP_T: DEFAULT_STRIP.STRIP_T,
  BANK_TRANSITION_L: 25,
  HINGE_PITCH: DEFAULT_STRIP.HINGE_PITCH,
  HINGE_MAX_DEG: DEFAULT_STRIP.HINGE_MAX_DEG,
  CUT_PITCH: DEFAULT_STRIP.CUT_PITCH,
  LED_PER_M: DEFAULT_STRIP.LED_PER_M,
  LED_MAX_MA: 60,

  CHANNEL_W: DEFAULT_STRIP.CHANNEL_W,
  CHANNEL_DEPTH: 8.0,
  WALL: 2.2,
  WALL_MIN: 1.2,
  MIN_GAP: 1.0,
  FLOOR: 4.0,
  ANCHOR_HOLE_D: 3.2,
  ANCHOR_HOLE_DEPTH: 3.0,
  ANCHOR_SPACING: 70,
  ANCHOR_MIN_PER_SEGMENT: 2,
  ANCHOR_BOSS: false,
  ANCHOR_BOSS_D: 8,
  ANCHOR_BOSS_H: 6,
  WIRE_SLOT_W: 5.4,
  WIRE_SLOT_L: 6.0,
  SLOT_LIP_CHAMFER: 1.0,
  CABLE_HOLE_D: 6.0,
  CROSSING_GAP: 3.0,
  DIFFUSER_T: 1.2,
  DIFFUSER_CLEARANCE: 0.15,
  EDGE_PROFILE: 'square',
  CHAMFER_SIZE: 1.5,
  CHAMFER_ANGLE: 45,
  LAYER_STEP: 0.2,
  MIN_LETTER_H: minLetterH(DEFAULT_STRIP),
  CUSP_MODE: 'split',
  CORNER_MERGE_DIST: 4,
  I_DOT_MODE: 'dot',
  DOT_WIRE_HOLE_D: 2.5,
  DOT_OVERHANG_MM: 1.5,
  COVERAGE_MIN: 0.85,
});

/** Applica gli override di `order.params` ai default e ricalcola MIN_LETTER_H dal profilo. */
export function resolveParams(overrides: Partial<Params> = {}): Params {
  const merged = { ...DEFAULT_PARAMS, ...overrides };
  merged.MIN_LETTER_H = minLetterH(merged);
  return merged;
}

/** Raggio minimo di piega: R_MIN = HINGE_PITCH / (2·sin(HINGE_MAX_DEG/2)). */
export function rMin(p: Pick<StripProfile, 'HINGE_PITCH' | 'HINGE_MAX_DEG'>): number {
  const halfRad = (p.HINGE_MAX_DEG * Math.PI) / 360;
  return p.HINGE_PITCH / (2 * Math.sin(halfRad));
}

/** Altezza minima di lettera derivata dal profilo: diametro della piega più stretta. */
export function minLetterH(p: Pick<StripProfile, 'HINGE_PITCH' | 'HINGE_MAX_DEG'>): number {
  return 2 * rMin(p);
}

/** Altezza totale del corpo: FLOOR + CHANNEL_DEPTH. */
export function totalHeight(p: Pick<Params, 'FLOOR' | 'CHANNEL_DEPTH'>): number {
  return p.FLOOR + p.CHANNEL_DEPTH;
}
