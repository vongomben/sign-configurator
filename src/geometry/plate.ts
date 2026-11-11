// Fondale (SPEC §13): lastra da tagliare al laser dietro l'housing, rettangolare, a pillola o
// sagomata attorno all'insegna. Anteprima, STL e SVG di taglio vengono dagli stessi poligoni in mm.
// La scelta del cliente è `plate` dell'ordine v4 (SPEC §6); le misure fisse stanno in config.
import type { CrossSection, Manifold, ManifoldToplevel, Vec2 } from 'manifold-3d';
import {
  PLATE_CORNER_R,
  PLATE_CORNER_R_MAX,
  PLATE_CORNER_R_MIN,
  PLATE_FIX_HOLE_D,
  PLATE_KERF,
  PLATE_MARGIN,
  PLATE_MARGIN_MAX,
  PLATE_MARGIN_MIN,
  PLATE_MOUNT_CLEARANCE,
  PLATE_MOUNT_HOLE_D,
  PLATE_MOUNT_INSET,
  PLATE_T,
  PLATE_WIRE_HOLE_D,
  PLATE_WIRE_HOLES,
} from '../config';
import type { PlateChoice, PlateMaterial, PlateShape } from '../order/schema';
import type { HousingModel } from './housing';

export type { PlateChoice, PlateMaterial, PlateShape };

export const PLATE_SHAPES: readonly { value: PlateShape; label: string }[] = [
  { value: 'rect', label: 'Rectangle' },
  { value: 'pill', label: 'Pill' },
  { value: 'contour', label: 'Contour' },
];

/** Etichette per il cliente (in inglese, SPEC §12.2); lo spessore viene da `PLATE_T` (segnaposto). */
export const PLATE_MATERIALS: Readonly<Record<PlateMaterial, { label: string; thicknessMm: number }>> = {
  clear: { label: 'Clear acrylic', thicknessMm: PLATE_T.clear },
  black: { label: 'Smoked black acrylic', thicknessMm: PLATE_T.black },
  wood: { label: 'Wood', thicknessMm: PLATE_T.wood },
};

export const DEFAULT_PLATE: Readonly<PlateChoice> = Object.freeze({
  shape: 'rect',
  material: 'black',
  marginMm: PLATE_MARGIN,
  cornerRMm: PLATE_CORNER_R,
});

export type PlateHoleKind = 'fix' | 'cable' | 'wire' | 'mount';

export interface PlateHole {
  kind: PlateHoleKind;
  x: number;
  y: number;
  /** Diametro nominale: quello dopo il taglio. */
  d: number;
}

export interface PlateModel {
  choice: PlateChoice;
  thicknessMm: number;
  /** Contorno esterno in vista frontale, mm (senza kerf). */
  outline: [number, number][][];
  holes: PlateHole[];
  widthMm: number;
  heightMm: number;
  areaMm2: number;
  warnings: string[];
  /** Lastra fra Z = −spessore e Z = 0, dietro l'housing. Chi la riceve la cancella. */
  solid: Manifold;
}

/** Riepilogo del fondale nella BOM (SPEC §13). */
export interface PlateBom {
  shape: PlateShape;
  material: PlateMaterial;
  widthMm: number;
  heightMm: number;
  areaMm2: number;
  /** Lunghezza di taglio: contorno più circonferenze dei fori. */
  cutLengthMm: number;
  thicknessMm: number;
  fixHoles: number;
  mountHoles: number;
  wireHoles: number;
}

const ROUND_SEGMENTS = 48;
const HOLE_SEGMENTS = 32;
/** Raggi di chiusura provati per unire le parti di un fondale sagomato. */
const CLOSING_STEPS = [10, 20, 40, 80, 160];

const clamp = (v: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

export function clampMargin(mm: number): number {
  return clamp(mm, PLATE_MARGIN_MIN, PLATE_MARGIN_MAX, PLATE_MARGIN);
}

export function clampCornerR(mm: number): number {
  return clamp(mm, PLATE_CORNER_R_MIN, PLATE_CORNER_R_MAX, PLATE_CORNER_R);
}

function signedArea(poly: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function perimeter(poly: readonly (readonly [number, number])[]): number {
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    total += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  return total;
}

/** Tiene solo i contorni esterni: i buchi della sagoma (l'occhiello della «o») si riempiono. */
function fillHoles(wasm: ManifoldToplevel, section: CrossSection): CrossSection {
  const outers = section.toPolygons().filter((poly) => signedArea(poly) > 0);
  return new wasm.CrossSection(outers, 'NonZero');
}

function roundedRect(wasm: ManifoldToplevel, min: Vec2, max: Vec2, radius: number): CrossSection {
  const w = max[0] - min[0];
  const h = max[1] - min[1];
  const r = Math.max(0, Math.min(radius, w / 2 - 0.01, h / 2 - 0.01));
  if (r <= 0.01) return wasm.CrossSection.square([w, h]).translate(min);
  const core = wasm.CrossSection.square([w - 2 * r, h - 2 * r]).translate([min[0] + r, min[1] + r]);
  const out = core.offset(r, 'Round', 2, ROUND_SEGMENTS);
  core.delete();
  return out;
}

/** Offset della sagoma; se resta in più pezzi, una chiusura morfologica li unisce. */
function contourSection(wasm: ManifoldToplevel, sign: CrossSection, margin: number, warnings: string[]): CrossSection {
  let best = sign.offset(margin, 'Round', 2, ROUND_SEGMENTS);
  for (const close of CLOSING_STEPS) {
    const parts = best.decompose();
    const count = parts.length;
    for (const part of parts) part.delete();
    if (count <= 1) break;
    const grown = sign.offset(margin + close, 'Round', 2, ROUND_SEGMENTS);
    const closed = grown.offset(-close, 'Round', 2, ROUND_SEGMENTS);
    grown.delete();
    best.delete();
    best = closed;
  }
  const parts = best.decompose();
  if (parts.length > 1) {
    warnings.push('Fondale sagomato: le parti restano separate, si usa il loro inviluppo convesso.');
    const hull = best.hull();
    best.delete();
    best = hull;
  }
  for (const part of parts) part.delete();
  const filled = fillHoles(wasm, best);
  best.delete();
  return filled;
}

function circle(wasm: ManifoldToplevel, hole: PlateHole, kerf: number): CrossSection {
  return wasm.CrossSection.circle(Math.max(0.2, (hole.d - kerf) / 2), HOLE_SEGMENTS).translate([hole.x, hole.y]);
}

function centroid(points: readonly (readonly [number, number])[]): [number, number] {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
  }
  const n = Math.max(1, points.length);
  return [x / n, y / n];
}

/** Dove vanno i fori di montaggio: quattro angoli del rettangolo, i due centri delle teste della pillola. */
function mountSpots(shape: PlateShape, min: Vec2, max: Vec2): Vec2[] {
  const inset = PLATE_MOUNT_INSET + PLATE_MOUNT_HOLE_D / 2;
  if (shape === 'rect') {
    return [
      [min[0] + inset, min[1] + inset],
      [max[0] - inset, min[1] + inset],
      [max[0] - inset, max[1] - inset],
      [min[0] + inset, max[1] - inset],
    ];
  }
  if (shape === 'pill') {
    const cx = (min[0] + max[0]) / 2;
    const cy = (min[1] + max[1]) / 2;
    return max[0] - min[0] >= max[1] - min[1]
      ? [
          [min[0] + inset, cy],
          [max[0] - inset, cy],
        ]
      : [
          [cx, min[1] + inset],
          [cx, max[1] - inset],
        ];
  }
  return [];
}

/**
 * Fori del fondale: fissaggio sotto gli ancoraggi, cavo principale, passaggi dei fili sotto le
 * asole e i puntini (se `PLATE_WIRE_HOLES`), montaggio a parete se non cadono sotto l'insegna.
 */
function plateHoles(
  wasm: ManifoldToplevel,
  housing: Pick<HousingModel, 'holes'>,
  sign: CrossSection,
  shape: PlateShape,
  min: Vec2,
  max: Vec2,
  warnings: string[],
): PlateHole[] {
  const holes: PlateHole[] = [];
  for (const anchor of housing.holes.anchors) holes.push({ kind: 'fix', x: anchor.x, y: anchor.y, d: PLATE_FIX_HOLE_D });
  const cable = housing.holes.cable;
  if (cable) holes.push({ kind: 'cable', x: cable.x, y: cable.y, d: cable.d });
  if (PLATE_WIRE_HOLES) {
    for (const slot of housing.holes.wireSlots) {
      const [x, y] = centroid(slot.points);
      holes.push({ kind: 'wire', x, y, d: PLATE_WIRE_HOLE_D });
    }
    for (const pocket of housing.holes.cornerPockets) {
      const [x, y] = centroid(pocket.points);
      holes.push({ kind: 'wire', x, y, d: PLATE_WIRE_HOLE_D });
    }
    for (const dot of housing.holes.dotWires) holes.push({ kind: 'wire', x: dot.x, y: dot.y, d: dot.d });
  }

  let dropped = 0;
  for (const [x, y] of mountSpots(shape, min, max)) {
    const hole: PlateHole = { kind: 'mount', x, y, d: PLATE_MOUNT_HOLE_D };
    const disk = circle(wasm, { ...hole, d: hole.d + 2 * PLATE_MOUNT_CLEARANCE }, 0);
    const hit = sign.intersect(disk);
    const blocked = hit.area() > 1e-6;
    hit.delete();
    disk.delete();
    if (blocked) dropped += 1;
    else holes.push(hole);
  }
  if (dropped > 0) {
    warnings.push(`Fondale: ${dropped} fori di montaggio cadono sotto l'insegna e sono stati tolti. Aumenta il margine.`);
  }
  return holes;
}

/**
 * Lastra dietro l'insegna. `housing.outline` è la sagoma frontale dell'housing (mm): il fondale
 * la contiene con il margine scelto. Il kerf allarga il contorno e restringe i fori di kerf/2.
 */
export function buildPlate(
  wasm: ManifoldToplevel,
  housing: Pick<HousingModel, 'outline' | 'holes'>,
  choice: PlateChoice,
): PlateModel | null {
  const polys = housing.outline.filter((poly) => poly.length >= 3);
  if (polys.length === 0) return null;
  const warnings: string[] = [];
  const margin = clampMargin(choice.marginMm);
  const cornerRMm = clampCornerR(choice.cornerRMm);
  const thicknessMm = PLATE_MATERIALS[choice.material].thicknessMm;
  const kerf = Math.max(0, PLATE_KERF[choice.material] ?? 0);
  const sign = new wasm.CrossSection(polys, 'NonZero');
  const temps: { delete(): void }[] = [sign];
  try {
    const box = sign.bounds();
    const min: Vec2 = [box.min[0] - margin, box.min[1] - margin];
    const max: Vec2 = [box.max[0] + margin, box.max[1] + margin];
    const shortSide = Math.min(max[0] - min[0], max[1] - min[1]);
    const shape =
      choice.shape === 'contour'
        ? contourSection(wasm, sign, margin, warnings)
        : roundedRect(wasm, min, max, choice.shape === 'pill' ? shortSide / 2 : cornerRMm);
    temps.push(shape);
    const shapeBox = shape.bounds();
    const holes = plateHoles(wasm, housing, sign, choice.shape, shapeBox.min, shapeBox.max, warnings);

    const cutOutline = kerf > 0 ? shape.offset(kerf / 2, 'Round', 2, ROUND_SEGMENTS) : shape;
    if (cutOutline !== shape) temps.push(cutOutline);
    const holeCuts = holes.map((hole) => circle(wasm, hole, kerf));
    temps.push(...holeCuts);
    const drilled = holeCuts.length > 0 ? wasm.CrossSection.difference([cutOutline, ...holeCuts]) : cutOutline;
    if (drilled !== cutOutline) temps.push(drilled);
    const solid = drilled.extrude(thicknessMm).translate([0, 0, -thicknessMm]);

    const outline = shape
      .toPolygons()
      .filter((poly) => signedArea(poly) > 0)
      .map((poly) => poly.map((p): [number, number] => [p[0], p[1]]));
    return {
      choice: { shape: choice.shape, material: choice.material, marginMm: margin, cornerRMm },
      thicknessMm,
      outline,
      holes,
      widthMm: shapeBox.max[0] - shapeBox.min[0],
      heightMm: shapeBox.max[1] - shapeBox.min[1],
      areaMm2: shape.area(),
      warnings,
      solid,
    };
  } finally {
    for (const t of temps) t.delete();
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Riepilogo del fondale per la BOM: misure, taglio e fori per tipo. */
export function plateBom(plate: Omit<PlateModel, 'solid'>): PlateBom {
  const count = (kind: PlateHoleKind): number => plate.holes.filter((hole) => hole.kind === kind).length;
  const cut =
    plate.outline.reduce((sum, poly) => sum + perimeter(poly), 0) +
    plate.holes.reduce((sum, hole) => sum + Math.PI * hole.d, 0);
  return {
    shape: plate.choice.shape,
    material: plate.choice.material,
    widthMm: round2(plate.widthMm),
    heightMm: round2(plate.heightMm),
    areaMm2: round2(plate.areaMm2),
    cutLengthMm: round2(cut),
    thicknessMm: plate.thicknessMm,
    fixHoles: count('fix'),
    mountHoles: count('mount'),
    wireHoles: count('wire') + count('cable'),
  };
}
