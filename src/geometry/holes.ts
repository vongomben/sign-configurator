// Fori di ancoraggio, fili e cavo (SPEC §5 "Fori").
// L'asola occupa gli ultimi WIRE_SLOT_L dello spezzone e la terminazione arrotondata:
// il labbro è WIRE_SLOT_L indietro dall'estremità. Stessa forma del fondo, passante.
// Il labbro, lato spezzone, ha uno smusso a 45°.
import type { CrossSection, Manifold, ManifoldToplevel, Mat4, Vec2 } from 'manifold-3d';
import type { Params } from '../config';
import { HOLE_CLEARANCE_MM, anchorStations } from '../export/bom';

export type WireSlotParams = Pick<
  Params,
  'CHANNEL_W' | 'WIRE_SLOT_W' | 'WIRE_SLOT_L' | 'FLOOR' | 'SLOT_LIP_CHAMFER'
>;

/** Estremità di uno spezzone. `outward` è unitario e punta verso la parete di testa. */
export interface SlotEnd {
  at: Vec2;
  outward: Vec2;
}

const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
const left = (v: Vec2): Vec2 => [-v[1], v[0]];

/** Labbro interno: dove finisce la parte illuminata, WIRE_SLOT_L indietro dall'estremità. */
export function slotLip(end: SlotEnd, slotL: number): Vec2 {
  return add(end.at, scale(end.outward, -slotL));
}

/**
 * Finestra sull'estremità, non un semipiano: il resto del percorso può ripiegare
 * dalla stessa parte senza entrare nell'asola.
 */
function endWindow(lip: Vec2, outward: Vec2, reach: number, halfWidth: number): Vec2[] {
  const side = scale(left(outward), halfWidth);
  const far = scale(outward, reach);
  return [
    add(lip, side),
    add(add(lip, far), side),
    add(add(lip, far), scale(side, -1)),
    add(lip, scale(side, -1)),
  ];
}

function widthStrip(lip: Vec2, outward: Vec2, width: number, reach: number): Vec2[] {
  return endWindow(add(lip, scale(outward, -1)), outward, reach + 1, width / 2);
}

/** Contorno in pianta dell'asola: canale ∩ finestra sull'estremità. */
export function wireSlotSection(
  wasm: ManifoldToplevel,
  channel: CrossSection,
  end: SlotEnd,
  p: Pick<WireSlotParams, 'CHANNEL_W' | 'WIRE_SLOT_W' | 'WIRE_SLOT_L'>,
): CrossSection {
  const { CrossSection } = wasm;
  const lip = slotLip(end, p.WIRE_SLOT_L);
  const reach = p.WIRE_SLOT_L + p.CHANNEL_W;
  const gate = new CrossSection([endWindow(lip, end.outward, reach, p.CHANNEL_W)], 'NonZero');
  let slot = channel.intersect(gate);
  gate.delete();
  const width = Math.min(p.WIRE_SLOT_W, p.CHANNEL_W);
  if (width < p.CHANNEL_W - 1e-6) {
    const band = new CrossSection([widthStrip(lip, end.outward, width, reach)], 'NonZero');
    const narrower = slot.intersect(band);
    slot.delete();
    band.delete();
    slot = narrower;
  }
  return slot;
}

/**
 * Prisma dello smusso a 45° sul labbro, lato spezzone.
 * In pianta X locale = verso lo spezzone, Y locale = Z mondo. Toglie solo il ciglio
 * superiore del fondo: il foro passante in pianta resta il contorno dell'asola.
 */
export function lipChamferSolid(wasm: ManifoldToplevel, end: SlotEnd, p: WireSlotParams): Manifold | null {
  const size = Math.min(Math.max(p.SLOT_LIP_CHAMFER, 0), p.FLOOR);
  if (size < 1e-6) return null;
  const { CrossSection } = wasm;
  const lip = slotLip(end, p.WIRE_SLOT_L);
  const inward = scale(end.outward, -1);
  const across = left(inward);
  const span = Math.min(p.WIRE_SLOT_W, p.CHANNEL_W) + 0.2;
  // −0.05 verso l'asola e +0.05 sopra il fondo: le facce coincidenti non restano nel booleano.
  const eps = 0.05;
  const z0 = p.FLOOR - size;
  const profile: Vec2[] = [
    [-eps, z0],
    [0, z0],
    [size, p.FLOOR],
    [size, p.FLOOR + eps],
    [-eps, p.FLOOR + eps],
  ];
  const section = new CrossSection([profile], 'NonZero');
  const extruded = section.extrude(span);
  section.delete();
  // translate restituisce un nuovo solido: senza usarlo il prisma resta da una parte sola e fora la parete.
  const centered = extruded.translate([0, 0, -span / 2]);
  if (centered !== extruded) extruded.delete();
  const m: Mat4 = [
    inward[0], inward[1], 0, 0,
    0, 0, 1, 0,
    across[0], across[1], 0, 0,
    lip[0], lip[1], 0, 1,
  ];
  const placed = centered.transform(m);
  if (placed !== centered) centered.delete();
  return placed;
}

export interface AnchorHole {
  x: number;
  y: number;
  /** Distanza dal DIN lungo lo spezzone, mm. */
  along: number;
}

const lengthOf = (points: readonly Vec2[]): number => {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
};

function pointAt(points: readonly Vec2[], distance: number): Vec2 {
  if (points.length === 0) return [0, 0];
  let left = Math.max(0, distance);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (left <= len || i === points.length - 1) {
      const t = len > 1e-9 ? Math.min(1, left / len) : 0;
      return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    }
    left -= len;
  }
  return points[points.length - 1] ?? [0, 0];
}

export interface AnchorPlacement {
  holes: AnchorHole[];
  warnings: string[];
}

/**
 * Fori di ancoraggio sulla linea centrale. Se una stazione interseca un'asola, una tasca
 * o un incrocio, il foro si sposta lungo il percorso verso il punto valido più vicino
 * (sempre a ≥ 10 mm da estremi, ostacoli e altri fori). Se ne restano meno di
 * ANCHOR_MIN_PER_SEGMENT, l'avviso porta la posizione dello spezzone.
 */
export function placeAnchorHoles(
  points: readonly Vec2[],
  params: Pick<Params, 'ANCHOR_SPACING' | 'ANCHOR_MIN_PER_SEGMENT' | 'WIRE_SLOT_L'>,
  opts: {
    crossings?: readonly Vec2[];
    /** true se (x, y) è a meno di 10 mm da un'asola o da una tasca. */
    occupies?: (x: number, y: number) => boolean;
    segmentId?: number;
    /** Mm di asola da lasciare in più ai capi. 0 su un anello chiuso. */
    endClear?: number;
  } = {},
): AnchorPlacement {
  const length = lengthOf(points);
  const endClear = opts.endClear ?? params.WIRE_SLOT_L;
  const margin = HOLE_CLEARANCE_MM + endClear;
  const targets = anchorStations(length, { ...params, WIRE_SLOT_L: endClear });
  const crossings = opts.crossings ?? [];
  const taken: number[] = [];
  const blocked = (t: number): boolean => {
    if (t < margin - 1e-6 || t > length - margin + 1e-6) return true;
    if (taken.some((u) => Math.abs(u - t) < HOLE_CLEARANCE_MM - 1e-6)) return true;
    const at = pointAt(points, t);
    if (crossings.some((c) => Math.hypot(c[0] - at[0], c[1] - at[1]) < HOLE_CLEARANCE_MM - 1e-6)) return true;
    return opts.occupies?.(at[0], at[1]) ?? false;
  };
  const nearest = (target: number): number | null => {
    if (!blocked(target)) return target;
    let best: number | null = null;
    let bestDist = Infinity;
    for (let t = margin; t <= length - margin + 1e-6; t += 0.5) {
      if (blocked(t)) continue;
      const dist = Math.abs(t - target);
      if (dist < bestDist - 1e-9) {
        bestDist = dist;
        best = t;
      }
    }
    return best;
  };
  const holes: AnchorHole[] = [];
  for (const target of targets) {
    const along = nearest(target);
    if (along === null) continue;
    const at = pointAt(points, along);
    holes.push({ x: at[0], y: at[1], along });
    taken.push(along);
  }
  const warnings: string[] = [];
  if (holes.length < params.ANCHOR_MIN_PER_SEGMENT) {
    const mid = pointAt(points, length / 2);
    const id = opts.segmentId ?? 0;
    warnings.push(
      `Spezzone ${id}: ${holes.length} fori di ancoraggio su ${params.ANCHOR_MIN_PER_SEGMENT} richiesti, in (${mid[0].toFixed(1)}, ${mid[1].toFixed(1)}).`,
    );
  }
  return { holes, warnings };
}

/** Stazioni della BOM, spostate se cadono su un incrocio o su un punto da evitare. */
export function anchorHolesAlong(
  points: readonly Vec2[],
  crossings: readonly Vec2[],
  params: Pick<Params, 'ANCHOR_SPACING' | 'ANCHOR_MIN_PER_SEGMENT' | 'WIRE_SLOT_L'>,
  /** Labbra di tasche e altri punti da cui restare ad almeno 10 mm. */
  avoid: readonly Vec2[] = [],
): AnchorHole[] {
  return placeAnchorHoles(points, params, { crossings: [...crossings, ...avoid] }).holes;
}

const HOLE_SEGMENTS = 20;

/** Cilindro cieco dal retro. Con i boss parte dal retro del distanziale. */
export function anchorHoleSolid(
  wasm: ManifoldToplevel,
  hole: AnchorHole,
  p: Pick<Params, 'ANCHOR_HOLE_D' | 'ANCHOR_HOLE_DEPTH' | 'ANCHOR_BOSS' | 'ANCHOR_BOSS_H' | 'FLOOR'>,
): Manifold {
  const { Manifold } = wasm;
  const radius = Math.max(p.ANCHOR_HOLE_D, 0) / 2;
  const depth = Math.max(p.ANCHOR_HOLE_DEPTH, 0);
  const from = p.ANCHOR_BOSS ? -Math.max(p.ANCHOR_BOSS_H, 0) : 0;
  const top = Math.min(from + depth, Math.max(p.FLOOR - 0.4, from));
  const height = Math.max(top - from, 0) + 0.1;
  return Manifold.cylinder(height, radius, radius, HOLE_SEGMENTS).translate([hole.x, hole.y, from - 0.1]);
}

/** Distanziale sul retro, centrato sul foro. */
export function anchorBossSolid(
  wasm: ManifoldToplevel,
  hole: AnchorHole,
  p: Pick<Params, 'ANCHOR_BOSS_D' | 'ANCHOR_BOSS_H'>,
): Manifold {
  const { Manifold } = wasm;
  const radius = Math.max(p.ANCHOR_BOSS_D, 0) / 2;
  const height = Math.max(p.ANCHOR_BOSS_H, 0);
  return Manifold.cylinder(height + 0.15, radius, radius, HOLE_SEGMENTS).translate([hole.x, hole.y, -height]);
}

/** Foro passante del cavo, all'inizio del primo spezzone. */
export function cableHoleSolid(
  wasm: ManifoldToplevel,
  at: Vec2,
  p: Pick<Params, 'CABLE_HOLE_D' | 'FLOOR'>,
): Manifold {
  const { Manifold } = wasm;
  const radius = Math.max(p.CABLE_HOLE_D, 0) / 2;
  return Manifold.cylinder(p.FLOOR + 2, radius, radius, HOLE_SEGMENTS).translate([at[0], at[1], -1]);
}

/** Solidi da sottrarre al fondo: asola passante e smusso del labbro, per ogni estremità. */
export function wireSlotCuts(
  wasm: ManifoldToplevel,
  channel: CrossSection,
  ends: readonly SlotEnd[],
  p: WireSlotParams,
): Manifold[] {
  const cuts: Manifold[] = [];
  for (const end of ends) {
    const section = wireSlotSection(wasm, channel, end, p);
    if (section.area() > 1e-8) {
      const extruded = section.extrude(p.FLOOR + 2);
      const hole = extruded.translate([0, 0, -1]);
      if (hole !== extruded) extruded.delete();
      cuts.push(hole);
      const lip = lipChamferSolid(wasm, end, p);
      if (lip) cuts.push(lip);
    }
    section.delete();
  }
  return cuts;
}
