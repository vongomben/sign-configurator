// [J] Fondale: SVG di taglio laser in mm, visto dal retro come back.dxf (SPEC §13).
// Blu = fori (si tagliano per primi), rosso = contorno (per ultimo).
import type { PlateModel } from '../geometry/plate';
import { PLATE_MATERIALS } from '../geometry/plate';

const CUT_HOLES = '#0000ff';
const CUT_OUTLINE = '#ff0000';
const STROKE = 0.1;
const PAD = 5;

function num(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

/** SVG del fondale. Le coordinate in ingresso sono frontali: qui X si specchia, Y va verso il basso. */
export function plateToSvg(plate: Pick<PlateModel, 'outline' | 'holes' | 'choice' | 'thicknessMm'>): string {
  const xs = plate.outline.flatMap((poly) => poly.map((p) => p[0]));
  const ys = plate.outline.flatMap((poly) => poly.map((p) => p[1]));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  // Vista dal retro: x' = maxX − x. SVG ha Y in giù: y' = maxY − y.
  const X = (x: number): number => maxX - x + PAD;
  const Y = (y: number): number => maxY - y + PAD;
  const width = maxX - minX + 2 * PAD;
  const height = maxY - minY + 2 * PAD;
  const material = PLATE_MATERIALS[plate.choice.material];

  const holes = plate.holes
    .map((hole) => `    <circle cx="${num(X(hole.x))}" cy="${num(Y(hole.y))}" r="${num(hole.d / 2)}" data-kind="${hole.kind}"/>`)
    .join('\n');
  const outline = plate.outline
    .map((poly) => `    <path d="M ${poly.map((p) => `${num(X(p[0]))} ${num(Y(p[1]))}`).join(' L ')} Z"/>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}mm" height="${num(height)}mm" viewBox="0 0 ${num(width)} ${num(height)}">
  <title>Fondale — ${material.label}, ${num(plate.thicknessMm)} mm, visto dal retro</title>
  <desc>Unità: mm. Blu: fori, da tagliare per primi. Rosso: contorno, per ultimo. ${num(maxX - minX)} × ${num(maxY - minY)} mm.</desc>
  <g id="fori" fill="none" stroke="${CUT_HOLES}" stroke-width="${STROKE}">
${holes}
  </g>
  <g id="contorno" fill="none" stroke="${CUT_OUTLINE}" stroke-width="${STROKE}">
${outline}
  </g>
</svg>
`;
}
