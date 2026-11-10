// Fondale (SPEC §13): lastra da tagliare al laser dietro l'housing, rettangolare o sagomata
// attorno all'insegna. Anteprima, STL e SVG di taglio vengono dagli stessi poligoni in mm.
import type { CrossSection, Manifold, ManifoldToplevel, Vec2 } from 'manifold-3d';
import { PLATE_PARAMS } from '../config';
import type { HousingModel } from './housing';

export type PlateShape = 'rect' | 'contour';
export type PlateMaterial = 'smoke' | 'wood';

/** Scelta del cliente, nell'ordine. `null` = nessun fondale. */
export interface PlateChoice {
  shape: PlateShape;
  material: PlateMaterial;
  /** Margine fra l'ingombro dell'insegna e il bordo della lastra. */
  marginMm: number;
}

export const PLATE_SHAPES: readonly { value: PlateShape; label: string }[] = [
  { value: 'rect', label: 'Rettangolare' },
  { value: 'contour', label: 'Sagomato attorno ai LED' },
];

/** Spessori segnaposto finché non si misurano i materiali acquistati (§10). */
export const PLATE_MATERIALS: Readonly<Record<PlateMaterial, { label: string; thicknessMm: number }>> = {
  smoke: { label: 'Plexi nero trasparente', thicknessMm: 3 },
  wood: { label: 'Legno', thicknessMm: 4 },
};

export const PLATE_MARGIN_MIN = 5;
export const PLATE_MARGIN_MAX = 80;
export const DEFAULT_PLATE: Readonly<PlateChoice> = Object.freeze({ shape: 'rect', material: 'smoke', marginMm: 20 });

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

const ROUND_SEGMENTS = 48;
const HOLE_SEGMENTS = 32;
/** Raggi di chiusura provati per unire le parti di un fondale sagomato. */
const CLOSING_STEPS = [10, 20, 40, 80, 160];

export function clampMargin(mm: number): number {
  if (!Number.isFinite(mm)) return DEFAULT_PLATE.marginMm;
  return Math.min(PLATE_MARGIN_MAX, Math.max(PLATE_MARGIN_MIN, mm));
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

/**
 * Fori del fondale: fissaggio sotto gli ancoraggi, cavo principale, passaggi dei fili sotto le asole
 * e i puntini, montaggio a parete negli angoli (solo rettangolare, se non cadono sotto l'insegna).
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
  for (const anchor of housing.holes.anchors) holes.push({ kind: 'fix', x: anchor.x, y: anchor.y, d: PLATE_PARAMS.FIX_HOLE_D });
  const cable = housing.holes.cable;
  if (cable) holes.push({ kind: 'cable', x: cable.x, y: cable.y, d: cable.d });
  for (const slot of housing.holes.wireSlots) {
    const [x, y] = centroid(slot.points);
    holes.push({ kind: 'wire', x, y, d: PLATE_PARAMS.WIRE_HOLE_D });
  }
  for (const pocket of housing.holes.cornerPockets) {
    const [x, y] = centroid(pocket.points);
    holes.push({ kind: 'wire', x, y, d: PLATE_PARAMS.WIRE_HOLE_D });
  }
  for (const dot of housing.holes.dotWires) holes.push({ kind: 'wire', x: dot.x, y: dot.y, d: dot.d });

  if (shape === 'rect') {
    const inset = PLATE_PARAMS.MOUNT_INSET + PLATE_PARAMS.MOUNT_HOLE_D / 2;
    const corners: Vec2[] = [
      [min[0] + inset, min[1] + inset],
      [max[0] - inset, min[1] + inset],
      [max[0] - inset, max[1] - inset],
      [min[0] + inset, max[1] - inset],
    ];
    let dropped = 0;
    for (const [x, y] of corners) {
      const hole: PlateHole = { kind: 'mount', x, y, d: PLATE_PARAMS.MOUNT_HOLE_D };
      const disk = circle(wasm, { ...hole, d: hole.d + 2 * PLATE_PARAMS.MOUNT_CLEARANCE }, 0);
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
  }
  return holes;
}

/**
 * Lastra dietro l'insegna. `housing.outline` è la sagoma frontale dell'housing (mm): il fondale
 * la contiene con `marginMm` di margine. Il kerf allarga il contorno e restringe i fori di kerf/2.
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
  const thicknessMm = PLATE_MATERIALS[choice.material].thicknessMm;
  const kerf = Math.max(0, PLATE_PARAMS.KERF[choice.material]);
  const sign = new wasm.CrossSection(polys, 'NonZero');
  const temps: { delete(): void }[] = [sign];
  try {
    const box = sign.bounds();
    const min: Vec2 = [box.min[0] - margin, box.min[1] - margin];
    const max: Vec2 = [box.max[0] + margin, box.max[1] + margin];
    const shape =
      choice.shape === 'rect'
        ? roundedRect(wasm, min, max, PLATE_PARAMS.CORNER_R)
        : contourSection(wasm, sign, margin, warnings);
    temps.push(shape);
    const shapeBox = shape.bounds();
    const holes = plateHoles(wasm, housing, sign, choice.shape, shapeBox.min, shapeBox.max, warnings);

    const cutOutline = kerf > 0 ? shape.offset(kerf / 2, 'Round', 2, ROUND_SEGMENTS) : shape;
    if (cutOutline !== shape) temps.push(cutOutline);
    const holeCuts = holes.map((hole) => circle(wasm, hole, kerf));
    temps.push(...holeCuts);
    const drilled = holeCuts.length > 0 ? wasm.CrossSection.difference([shape, ...holeCuts]) : shape;
    if (drilled !== shape) temps.push(drilled);
    const solid = drilled.extrude(thicknessMm).translate([0, 0, -thicknessMm]);

    const outline = shape
      .toPolygons()
      .filter((poly) => signedArea(poly) > 0)
      .map((poly) => poly.map((p): [number, number] => [p[0], p[1]]));
    return {
      choice: { shape: choice.shape, material: choice.material, marginMm: margin },
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

/** Legge una scelta da un valore sconosciuto (link condiviso, file). `null` se assente o non valida. */
export function plateChoiceOf(value: unknown, warnings: string[]): PlateChoice | null {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    warnings.push('Fondale non valido: ignorato.');
    return null;
  }
  const record = value as Record<string, unknown>;
  const shape = PLATE_SHAPES.some((entry) => entry.value === record.shape) ? (record.shape as PlateShape) : null;
  const material = record.material === 'smoke' || record.material === 'wood' ? record.material : null;
  if (!shape || !material) {
    warnings.push('Fondale sconosciuto: ignorato.');
    return null;
  }
  const raw = typeof record.marginMm === 'number' ? record.marginMm : DEFAULT_PLATE.marginMm;
  const marginMm = clampMargin(raw);
  if (marginMm !== raw) warnings.push(`Margine del fondale ${raw} mm fuori limite: riportato a ${marginMm} mm.`);
  return { shape, material, marginMm };
}
