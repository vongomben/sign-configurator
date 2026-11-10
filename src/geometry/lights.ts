// Punti luce lungo la linea centrale. Il passo viene dai parametri (oggi 160 LED/m
// della striscia COB); un pixel a passo libero userà lo stesso risultato.
import type { Params } from '../config';
import type { Point } from './rasterize';

export interface LightPoint {
  /** Faccia emittente, mm. Z verso chi guarda. */
  pos: [number, number, number];
  /** Tangente DIN → DOUT, nel piano dell'insegna. */
  dir: [number, number, number];
  segment: number;
  /** 0 al DIN, poi in ordine verso il DOUT. */
  index: number;
}

export interface LightChain {
  id: number;
  points: readonly Point[];
  closed: boolean;
  /** Puntino: la luce è tutto lo spezzone, senza asole. */
  dot?: boolean;
}

/** Un puntino porta un solo LED, al centro, qualunque sia la sua lunghezza (SPEC §5, I_DOT_MODE «dot»). */
export const DOT_LED_COUNT = 1;

/** Distanza fra la faccia del LED e il diffusore: profondità del canale meno lo spessore della striscia. */
export function ledToDiffuserMm(params: Pick<Params, 'CHANNEL_DEPTH' | 'STRIP_T'>): number {
  return Math.max(0.4, params.CHANNEL_DEPTH - params.STRIP_T);
}

const lengthOf = (points: readonly Point[]): number => {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  }
  return total;
};

function sample(points: readonly Point[], distance: number): { at: Point; dir: [number, number, number] } {
  let left = distance;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (seg < 1e-8) continue;
    if (left <= seg + 1e-6 || i === points.length - 1) {
      const t = Math.min(1, Math.max(0, left / seg));
      return {
        at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        dir: [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg, 0],
      };
    }
    left -= seg;
  }
  const last = points[points.length - 1] ?? [0, 0];
  return { at: [last[0], last[1]], dir: [1, 0, 0] };
}

/**
 * LED sulla parte illuminata di ogni spezzone: dopo l'asola d'ingresso, prima di quella
 * d'uscita. Il numero è lo stesso della BOM, `round(luce · LED_PER_M / 1000)`; un puntino ne ha uno.
 */
export function lightPointsFromChains(
  chains: readonly LightChain[],
  params: Pick<Params, 'LED_PER_M' | 'WIRE_SLOT_L' | 'FLOOR' | 'STRIP_T'>,
): LightPoint[] {
  const pitch = params.LED_PER_M > 0 ? 1000 / params.LED_PER_M : 0;
  const z = params.FLOOR + params.STRIP_T;
  const out: LightPoint[] = [];
  for (const chain of chains) {
    if (chain.points.length < 2 || !(pitch > 0)) continue;
    const length = lengthOf(chain.points);
    const slot = chain.closed || chain.dot ? 0 : Math.min(Math.max(params.WIRE_SLOT_L, 0), length / 2);
    const lit = Math.max(0, length - 2 * slot);
    const count = chain.dot ? DOT_LED_COUNT : Math.max(0, Math.round((lit * params.LED_PER_M) / 1000));
    for (let index = 0; index < count; index++) {
      const along = slot + ((index + 0.5) * lit) / count;
      const { at, dir } = sample(chain.points, along);
      out.push({ pos: [at[0], at[1], z], dir, segment: chain.id, index });
    }
  }
  return out;
}
