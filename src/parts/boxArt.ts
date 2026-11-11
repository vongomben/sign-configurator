// Disegni delle scatole per la pagina parts: vista obliqua, stessa scala per tutte
// (`BOX_ART_SCALE`), dalle misure esterne (o interne, se l'esterno non è noto).

import type { BoxSpec } from './boxes';

/** px per mm: la più grande del catalogo (316 mm) resta sotto i 130 px. */
export const BOX_ART_SCALE = 0.4;
const DEPTH = 0.45;
const COS = Math.cos(Math.PI / 6);
const SIN = Math.sin(Math.PI / 6);
const VIEW_W = 175;
const VIEW_H = 72;

const f = (n: number): string => n.toFixed(1);
const pts = (list: [number, number][]): string => list.map(([x, y]) => `${f(x)},${f(y)}`).join(' ');

export function boxArt(box: BoxSpec): string {
  const [L, W, H] = box.outerMm ?? box.innerMm;
  const s = BOX_ART_SCALE;
  const l = L * s;
  const h = H * s;
  const dx = W * DEPTH * COS * s;
  const dy = W * DEPTH * SIN * s;
  const x0 = (VIEW_W - l - dx) / 2;
  const y0 = VIEW_H - 6;
  const p =
    box.brand === 'Gewiss'
      ? { top: '#e3e4e1', front: '#c9cac6', side: '#b3b4b0', edge: '#85867f', lid: '#f0f1ee' }
      : { top: '#34343a', front: '#26262b', side: '#1c1c20', edge: '#0d0d10', lid: '#3e3e45' };
  const ftl: [number, number] = [x0, y0 - h];
  const ftr: [number, number] = [x0 + l, y0 - h];
  const fbr: [number, number] = [x0 + l, y0];
  const off = (q: [number, number], t = 1): [number, number] => [q[0] + dx * t, q[1] - dy * t];
  const lidH = Math.min(h * 0.25, 4);
  const parts = [
    `<polygon points="${pts([ftr, off(ftr), off(fbr), fbr])}" fill="${p.side}" stroke="${p.edge}" stroke-width="0.6"/>`,
    `<polygon points="${pts([ftl, ftr, off(ftr), off(ftl)])}" fill="${p.lid}" stroke="${p.edge}" stroke-width="0.6"/>`,
    `<rect x="${f(x0)}" y="${f(y0 - h)}" width="${f(l)}" height="${f(h)}" fill="${p.front}" stroke="${p.edge}" stroke-width="0.6"/>`,
    // Giunto del coperchio.
    `<line x1="${f(x0)}" y1="${f(y0 - h + lidH)}" x2="${f(x0 + l)}" y2="${f(y0 - h + lidH)}" stroke="${p.edge}" stroke-width="0.6"/>`,
    `<line x1="${f(x0 + l)}" y1="${f(y0 - h + lidH)}" x2="${f(x0 + l + dx)}" y2="${f(y0 - h + lidH - dy)}" stroke="${p.edge}" stroke-width="0.6"/>`,
  ];
  // Viti del coperchio negli angoli.
  for (const [u, t] of [[0.06, 0.15], [0.94, 0.15], [0.06, 0.85], [0.94, 0.85]] as const) {
    const c = off([x0 + l * u, y0 - h], t);
    parts.push(`<circle cx="${f(c[0])}" cy="${f(c[1])}" r="1.1" fill="${p.edge}" opacity="0.7"/>`);
  }
  if (box.brand === 'Gewiss') {
    // Passacavi sul fianco.
    const c: [number, number] = [x0 + l * 0.5, y0 - h * 0.45];
    parts.push(`<circle cx="${f(c[0])}" cy="${f(c[1])}" r="${f(Math.min(4, h * 0.18))}" fill="${p.side}" stroke="${p.edge}" stroke-width="0.5"/>`);
  }
  const size = `${L} × ${W} × ${H} mm ${box.outerMm ? 'outside' : 'inside'}`;
  return `<svg class="part-art" viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="${VIEW_W}" height="${VIEW_H}" role="img" aria-label="${box.brand} ${box.model}, ${size}, drawn to scale">${parts.join('')}</svg>`;
}
