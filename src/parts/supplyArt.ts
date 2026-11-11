// Disegni degli alimentatori per la pagina parts: vista obliqua, tutti alla stessa scala
// (`ART_SCALE` px per mm), dalle misure del catalogo. Nessuna foto: niente diritti di terzi.

import type { SupplyFamily } from './supplies';

/** px per mm: il più lungo del catalogo (215 mm) resta sotto i 140 px. */
export const ART_SCALE = 0.6;
const DEPTH = 0.45; // la profondità obliqua è accorciata
const COS = Math.cos(Math.PI / 6);
const SIN = Math.sin(Math.PI / 6);
const VIEW_W = 175;
const VIEW_H = 72;

interface Palette {
  top: string;
  front: string;
  side: string;
  edge: string;
}

const PALETTES: Record<SupplyFamily['kind'], Palette> = {
  enclosed: { top: '#d3d6db', front: '#aeb2b8', side: '#959aa1', edge: '#6c7077' },
  adapter: { top: '#3b3b41', front: '#26262a', side: '#1d1d21', edge: '#0e0e10' },
  waterproof: { top: '#c3c7cd', front: '#9fa3aa', side: '#878b92', edge: '#5f636a' },
};

const f = (n: number): string => n.toFixed(1);
const pts = (list: [number, number][]): string => list.map(([x, y]) => `${f(x)},${f(y)}`).join(' ');

/** SVG di una famiglia: scatola L×W×H in obliquo, con i dettagli del tipo. */
export function supplyArt(family: SupplyFamily): string {
  const [L, W, H] = family.sizeMm;
  const l = L * ART_SCALE;
  const h = H * ART_SCALE;
  const dx = W * DEPTH * COS * ART_SCALE;
  const dy = W * DEPTH * SIN * ART_SCALE;
  // Centrata in orizzontale, appoggiata in basso.
  const x0 = (VIEW_W - l - dx) / 2;
  const y0 = VIEW_H - 8;
  const p = PALETTES[family.kind];
  const ftl: [number, number] = [x0, y0 - h];
  const ftr: [number, number] = [x0 + l, y0 - h];
  const fbr: [number, number] = [x0 + l, y0];
  const off = (q: [number, number]): [number, number] => [q[0] + dx, q[1] - dy];
  const parts: string[] = [];

  // Cavi dietro la scatola (escono dalle teste).
  if (family.kind === 'adapter') {
    const sx = x0 + l + dx / 2;
    const sy = y0 - h / 2 - dy / 2;
    parts.push(`<path d="M${f(sx)} ${f(sy)} c 6 0 8 6 4 10 s -6 8 2 9" fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round"/>`);
  }
  if (family.kind === 'waterproof') {
    const sy = y0 - h / 2 - dy / 2;
    parts.push(`<path d="M${f(x0 + dx / 2)} ${f(sy)} h -9" stroke="#222" stroke-width="2.4" stroke-linecap="round"/>`);
    parts.push(`<path d="M${f(x0 + l + dx / 2)} ${f(sy)} h 9" stroke="#222" stroke-width="2.4" stroke-linecap="round"/>`);
  }

  // Facce: lato destro, sopra, davanti.
  parts.push(`<polygon points="${pts([ftr, off(ftr), off(fbr), fbr])}" fill="${p.side}" stroke="${p.edge}" stroke-width="0.6" stroke-linejoin="round"/>`);
  parts.push(`<polygon points="${pts([ftl, ftr, off(ftr), off(ftl)])}" fill="${p.top}" stroke="${p.edge}" stroke-width="0.6" stroke-linejoin="round"/>`);
  parts.push(`<rect x="${f(x0)}" y="${f(y0 - h)}" width="${f(l)}" height="${f(h)}" fill="${p.front}" stroke="${p.edge}" stroke-width="0.6"/>`);

  if (family.kind === 'enclosed') {
    // Feritoie sul coperchio e morsettiera sul davanti, a sinistra.
    const term = Math.min(l * 0.32, 26);
    for (let i = 1; i <= 4; i++) {
      const t = i / 5;
      const a: [number, number] = [ftl[0] + term + 4 + dx * t, ftl[1] - dy * t];
      const b: [number, number] = [ftr[0] - 4 + dx * t, ftr[1] - dy * t];
      parts.push(`<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${p.edge}" stroke-width="0.7" stroke-dasharray="2.2 1.6"/>`);
    }
    const ty = y0 - h + h * 0.18;
    const th = h * 0.64;
    parts.push(`<rect x="${f(x0 + 1.5)}" y="${f(ty)}" width="${f(term)}" height="${f(th)}" rx="0.8" fill="#2b2b2f"/>`);
    const screws = Math.max(3, Math.round(term / 4.5));
    for (let i = 0; i < screws; i++) {
      const cx = x0 + 1.5 + (term * (i + 0.5)) / screws;
      parts.push(`<circle cx="${f(cx)}" cy="${f(ty + th / 2)}" r="${f(Math.min(1.5, term / screws / 3))}" fill="#b9bcc2"/>`);
    }
  }
  if (family.kind === 'adapter') {
    // Presa IEC C14 sul davanti e logo in rilievo sul coperchio.
    const iw = Math.min(10, l * 0.12);
    const ih = h * 0.55;
    parts.push(`<rect x="${f(x0 + 3)}" y="${f(y0 - h / 2 - ih / 2)}" width="${f(iw)}" height="${f(ih)}" rx="1.2" fill="#0b0b0d" stroke="#4a4a50" stroke-width="0.5"/>`);
    const c = off([x0 + l * 0.55, y0 - h]);
    parts.push(`<rect x="${f(c[0] - dx / 2 - 9)}" y="${f(c[1] + dy / 2 - 2)}" width="18" height="4" rx="2" fill="#4a4a52"/>`);
  }
  if (family.kind === 'waterproof') {
    // Etichetta sul coperchio.
    const a = off([x0 + l * 0.2, y0 - h]);
    parts.push(`<polygon points="${pts([
      [a[0] - dx * 0.75, a[1] + dy * 0.75],
      [a[0] - dx * 0.75 + l * 0.6, a[1] + dy * 0.75],
      [a[0] - dx * 0.25 + l * 0.6, a[1] + dy * 0.25],
      [a[0] - dx * 0.25, a[1] + dy * 0.25],
    ])}" fill="#e8eaee" opacity="0.8"/>`);
  }

  const [L0, W0, H0] = family.sizeMm;
  return `<svg class="supply-art" viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="${VIEW_W}" height="${VIEW_H}" role="img" aria-label="${family.name}, ${L0} × ${W0} × ${H0} mm, drawn to scale">${parts.join('')}</svg>`;
}
