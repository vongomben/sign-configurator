// Validazione dal vivo, nel main thread, solo sugli spezzoni toccati (SPEC §5bis).
// Catena [F] e distanza fra linee centrali. Niente Chaikin e niente mesh.

import type { Params } from '../config';
import { resampleChain } from '../geometry/chain';
import type { Point } from '../geometry/rasterize';
import { centerlineClearance, validateStrip } from '../geometry/validate';

export interface LiveSegment {
  id: string;
  points: readonly Point[];
  closed: boolean;
  /** Il puntino non è una curva: niente cerniere né luce minima. */
  dot?: boolean;
}

export interface LiveMarker {
  kind: 'curva' | 'spigolo' | 'fusione' | 'corto';
  x: number;
  y: number;
  pathId: string;
}

export interface LiveReport {
  markers: LiveMarker[];
  /** Curve sotto R_MIN, fusioni, spezzoni sotto CUT_PITCH. Lo spigolo non blocca. */
  blocked: boolean;
}

function distanceToPolyline(point: Point, line: readonly Point[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const len2 = abx * abx + aby * aby;
    const t = len2 < 1e-18 ? 0 : Math.min(1, Math.max(0, ((point[0] - a[0]) * abx + (point[1] - a[1]) * aby) / len2));
    best = Math.min(best, Math.hypot(a[0] + t * abx - point[0], a[1] + t * aby - point[1]));
  }
  return best;
}

function scaledChain(points: readonly Point[], closed: boolean, params: Params, id: number) {
  const grown = points.map((point): Point => [point[0] * 2, point[1] * 2]);
  const chain = resampleChain(grown, {
    hingePitch: params.HINGE_PITCH,
    hingeMaxDeg: params.HINGE_MAX_DEG,
    channelW: params.CHANNEL_W,
    closed,
  });
  return {
    ...chain,
    id,
    points: chain.points.map((point): Point => [point[0] / 2, point[1] / 2]),
    hinges: chain.hinges.map((hinge) => ({ ...hinge, x: hinge.x / 2, y: hinge.y / 2 })),
  };
}

/**
 * Controlla gli spezzoni in `touched`. `touched` vuoto controlla tutti.
 * La fusione usa la griglia di `centerlineClearance` sull'insieme intero,
 * ma entra nel referto solo se coinvolge uno spezzone toccato.
 */
export function liveCheck(
  segments: readonly LiveSegment[],
  touched: readonly string[],
  params: Params,
): LiveReport {
  const focus = new Set(touched.length > 0 ? touched : segments.map((segment) => segment.id));
  const markers: LiveMarker[] = [];
  let chainId = 1;
  for (const segment of segments) {
    if (!focus.has(segment.id) || segment.dot === true || segment.points.length < 2) continue;
    const id = chainId;
    chainId += 1;
    const chain = {
      ...resampleChain(segment.points, {
        hingePitch: params.HINGE_PITCH,
        hingeMaxDeg: params.HINGE_MAX_DEG,
        channelW: params.CHANNEL_W,
        closed: segment.closed,
      }),
      id,
    };
    const issues = validateStrip({
      chains: [chain],
      scaledChains: [scaledChain(segment.points, segment.closed, params, id)],
      notices: [],
      params,
    });
    for (const issue of issues) {
      const kind: LiveMarker['kind'] | null =
        issue.bend === 'curva' ? 'curva' : issue.bend === 'spigolo' ? 'spigolo' : issue.message.includes('passo di taglio') ? 'corto' : null;
      if (!kind) continue;
      markers.push({ kind, x: issue.x, y: issue.y, pathId: segment.id });
    }
  }

  const lines = segments
    .filter((segment) => segment.points.length >= 2)
    .map((segment) => ({ points: segment.points, closed: segment.closed }));
  const clash = lines.length >= 2 ? centerlineClearance(lines, params, []) : null;
  if (clash) {
    let nearest = '';
    let best = Infinity;
    for (const segment of segments) {
      if (!focus.has(segment.id)) continue;
      const d = distanceToPolyline([clash.x, clash.y], segment.points);
      if (d < best) {
        best = d;
        nearest = segment.id;
      }
    }
    const limit = params.CHANNEL_W + 2 * params.WALL + params.MIN_GAP;
    if (nearest && best <= limit) markers.push({ kind: 'fusione', x: clash.x, y: clash.y, pathId: nearest });
  }

  const blocked = markers.some((marker) => marker.kind === 'curva' || marker.kind === 'fusione' || marker.kind === 'corto');
  return { markers, blocked };
}
