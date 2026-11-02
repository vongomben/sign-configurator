// Profilo dello spigolo superiore della parete: smusso esterno, interno o entrambi (SPEC §3).
// Smusso a gradini: fette alte LAYER_STEP, ognuna con un offset del profilo crescente verso l'alto.
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import type { EdgeProfile, Params } from '../config';

/** Larghezza minima di parete che deve restare in cima con smusso interno. */
export const MIN_TOP_WALL = 0.8;
const ROUND_SEGMENTS = 96;
/**
 * Gli offset moltiplicano i vertici delle curve già fitte; togliere quelli entro 5 µm dalla
 * corda rende l'union delle fette ~5× più veloce senza effetti misurabili sul pezzo.
 */
const SLICE_SIMPLIFY = 0.005;

export type EdgeProfileParams = Pick<
  Params,
  'EDGE_PROFILE' | 'CHAMFER_SIZE' | 'CHAMFER_ANGLE' | 'LAYER_STEP' | 'WALL' | 'CHANNEL_DEPTH'
>;

/** Smusso effettivo, dopo la validazione. */
export interface ChamferPlan {
  profile: EdgeProfile;
  outer: boolean;
  inner: boolean;
  /** Altezza verticale; 0 = spigoli vivi. */
  height: number;
  /** Larghezza orizzontale = height / tan(CHAMFER_ANGLE). */
  run: number;
  layerStep: number;
  warnings: string[];
}

const fmt = (x: number): string => x.toFixed(2);

export function planChamfer(p: EdgeProfileParams): ChamferPlan {
  const warnings: string[] = [];
  const square = (): ChamferPlan => ({
    profile: 'square',
    outer: false,
    inner: false,
    height: 0,
    run: 0,
    layerStep: p.LAYER_STEP,
    warnings,
  });
  if (p.EDGE_PROFILE === 'square') return square();

  if (!(p.CHAMFER_ANGLE > 0 && p.CHAMFER_ANGLE < 90)) {
    warnings.push(`CHAMFER_ANGLE = ${p.CHAMFER_ANGLE}° fuori da (0°, 90°): smusso ignorato.`);
    return square();
  }
  if (!(p.LAYER_STEP > 0)) {
    warnings.push(`LAYER_STEP = ${p.LAYER_STEP} non valido: smusso ignorato.`);
    return square();
  }
  if (!(p.CHAMFER_SIZE > 0)) {
    warnings.push(`CHAMFER_SIZE = ${p.CHAMFER_SIZE}: smusso ignorato.`);
    return square();
  }

  let height = p.CHAMFER_SIZE;
  if (height > p.CHANNEL_DEPTH) {
    warnings.push(`CHAMFER_SIZE ${fmt(height)} > CHANNEL_DEPTH: ridotto a ${fmt(p.CHANNEL_DEPTH)} mm.`);
    height = p.CHANNEL_DEPTH;
  }

  const tan = Math.tan((p.CHAMFER_ANGLE * Math.PI) / 180);
  const outer = p.EDGE_PROFILE === 'outer' || p.EDGE_PROFILE === 'both';
  const inner = p.EDGE_PROFILE === 'inner' || p.EDGE_PROFILE === 'both';

  if (inner) {
    const sides = outer ? 2 : 1;
    const maxRun = (p.WALL - MIN_TOP_WALL) / sides;
    if (maxRun <= 0) {
      warnings.push(`WALL ${fmt(p.WALL)} mm: non resta spazio per lo smusso interno (min ${MIN_TOP_WALL} mm in cima). Smusso ignorato.`);
      return square();
    }
    const top = p.WALL - (sides * height) / tan;
    if (top < MIN_TOP_WALL - 1e-9) {
      const reduced = maxRun * tan;
      warnings.push(
        `In cima resterebbero ${fmt(top)} mm di parete (< ${MIN_TOP_WALL}): ` +
          `CHAMFER_SIZE ridotto da ${fmt(height)} a ${fmt(reduced)} mm.`,
      );
      height = reduced;
    }
  }

  return { profile: p.EDGE_PROFILE, outer, inner, height, run: height / tan, layerStep: p.LAYER_STEP, warnings };
}

/**
 * Corpo pieno della parete (profilo esterno estruso fino a `totalHeight`) con lo smusso in cima.
 * Con smusso interno le fette sono già scavate dal canale allargato; il chiamante sottrae comunque
 * il canale e i fori come per il profilo "square", che restituisce esattamente `outline.extrude()`.
 */
export function profiledBody(
  wasm: ManifoldToplevel,
  outline: CrossSection,
  channel: CrossSection,
  totalHeight: number,
  plan: ChamferPlan,
): Manifold {
  if (plan.height <= 0) return outline.extrude(totalHeight);

  const { Manifold } = wasm;
  const z0 = totalHeight - plan.height;
  const slope = plan.run / plan.height;
  const count = Math.ceil(plan.height / plan.layerStep - 1e-9);
  const temps: { delete(): void }[] = [];
  const tmp = <T extends { delete(): void }>(x: T): T => (temps.push(x), x);

  try {
    const parts: Manifold[] = [tmp(outline.extrude(z0))];
    for (let i = 0; i < count; i++) {
      const zb = z0 + i * plan.layerStep;
      const zt = Math.min(z0 + (i + 1) * plan.layerStep, totalHeight);
      // Offset a metà fetta: il volume dei gradini coincide con quello dello smusso ideale.
      const d = ((zb + zt) / 2 - z0) * slope;
      let section = plan.outer ? tmp(outline.offset(-d, 'Round', 2, ROUND_SEGMENTS)) : outline;
      if (plan.inner) {
        const grown = tmp(channel.offset(d, 'Round', 2, ROUND_SEGMENTS));
        section = tmp(section.subtract(grown));
      }
      const simplified = tmp(section.simplify(SLICE_SIMPLIFY));
      parts.push(tmp(tmp(simplified.extrude(zt - zb)).translate([0, 0, zb])));
    }
    return Manifold.union(parts);
  } finally {
    for (const t of temps) t.delete();
  }
}
