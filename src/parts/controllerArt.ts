// Disegni dei controller per la pagina parts, come quelli degli alimentatori: vista obliqua,
// stessa scala per tutti (`CONTROLLER_ART_SCALE`). Senza misure del costruttore: sagoma
// tratteggiata di misura indicativa, segnata «size not published».

import type { ControllerSpec } from '../config';

/** px per mm: i controller sono piccoli, scala doppia rispetto agli alimentatori. */
export const CONTROLLER_ART_SCALE = 1.2;
/** Misura indicativa quando il costruttore non la pubblica. */
const FALLBACK_MM: [number, number, number] = [60, 35, 20];
const DEPTH = 0.45;
const COS = Math.cos(Math.PI / 6);
const SIN = Math.sin(Math.PI / 6);
const VIEW_W = 175;
const VIEW_H = 72;

const f = (n: number): string => n.toFixed(1);
const pts = (list: [number, number][]): string => list.map(([x, y]) => `${f(x)},${f(y)}`).join(' ');

/** Scheda nuda (QuinLED Dig-Uno, Dig-Quad) o scheda in custodia (GLEDOPTO, Dig-Next-2). */
function isBareBoard(c: ControllerSpec): boolean {
  return c.id === 'quinled-dig-uno' || c.id === 'quinled-dig-quad';
}

export function controllerArt(c: ControllerSpec): string {
  const known = c.sizeMm !== null;
  const [L, W, H] = c.sizeMm ?? FALLBACK_MM;
  const s = CONTROLLER_ART_SCALE;
  const bare = isBareBoard(c);
  const l = L * s;
  // Una scheda nuda è un circuito sottile con i componenti sopra.
  const h = (bare ? 1.6 : H) * s;
  const dx = W * DEPTH * COS * s;
  const dy = W * DEPTH * SIN * s;
  const x0 = (VIEW_W - l - dx) / 2;
  const y0 = VIEW_H - 10;
  const ftl: [number, number] = [x0, y0 - h];
  const ftr: [number, number] = [x0 + l, y0 - h];
  const fbr: [number, number] = [x0 + l, y0];
  const off = (q: [number, number], t = 1): [number, number] => [q[0] + dx * t, q[1] - dy * t];
  const dash = known ? '' : ' stroke-dasharray="3 2"';
  const p = bare
    ? { top: '#1f3a2c', front: '#16291f', side: '#10201a', edge: '#0a140f' }
    : c.brand === 'GLEDOPTO'
      ? { top: '#f2f2f0', front: '#d9d9d6', side: '#c4c4c0', edge: '#8d8d88' }
      : { top: '#2e2e33', front: '#232327', side: '#1a1a1e', edge: '#0c0c0e' };
  const parts: string[] = [];
  parts.push(`<polygon points="${pts([ftr, off(ftr), off(fbr), fbr])}" fill="${p.side}" stroke="${p.edge}" stroke-width="0.6"${dash}/>`);
  parts.push(`<polygon points="${pts([ftl, ftr, off(ftr), off(ftl)])}" fill="${p.top}" stroke="${p.edge}" stroke-width="0.6"${dash}/>`);
  parts.push(`<rect x="${f(x0)}" y="${f(y0 - h)}" width="${f(l)}" height="${f(h)}" fill="${p.front}" stroke="${p.edge}" stroke-width="0.6"${dash}/>`);

  // Un blocco in rilievo sul piano superiore: punto (u lungo L, t lungo W), misure in mm.
  const block = (u: number, t: number, bl: number, bw: number, bh: number, fill: string, edge: string): void => {
    const base: [number, number] = off([x0 + u * s, y0 - h], t);
    const bx = bl * s;
    const bdx = bw * DEPTH * COS * s;
    const bdy = bw * DEPTH * SIN * s;
    const z = bh * s;
    const a: [number, number] = [base[0], base[1] - z];
    const b: [number, number] = [base[0] + bx, base[1] - z];
    parts.push(`<polygon points="${pts([b, [b[0] + bdx, b[1] - bdy], [b[0] + bdx, b[1] - bdy + z], [b[0], b[1] + z]])}" fill="${edge}"/>`);
    parts.push(`<polygon points="${pts([a, b, [b[0] + bdx, b[1] - bdy], [a[0] + bdx, a[1] - bdy]])}" fill="${fill}"/>`);
    parts.push(`<rect x="${f(a[0])}" y="${f(a[1])}" width="${f(bx)}" height="${f(z)}" fill="${edge}" opacity="0.85"/>`);
  };

  if (bare) {
    // Modulo ESP32 al centro, morsettiere verdi sui due lati corti.
    const termW = Math.min(12, L * 0.18);
    block(1, 0.1, termW, W * 0.8, 9, '#3fa35b', '#2b7a42');
    block(L - termW - 1, 0.1, termW, W * 0.8, 9, '#3fa35b', '#2b7a42');
    block(L * 0.36, 0.25, L * 0.28, W * 0.5, 3, '#c9ccd1', '#8e9298');
    // Portafusibile.
    block(L * 0.7 - 2, 0.55, 6, W * 0.25, 5, '#e8b73c', '#a8801f');
  } else {
    // Custodia: morsettiera sul lato corto sinistro, LED di stato e scritta sul coperchio.
    const th = h * 0.55;
    parts.push(`<rect x="${f(x0 + 2)}" y="${f(y0 - h / 2 - th / 2)}" width="${f(Math.min(14, l * 0.22))}" height="${f(th)}" rx="1" fill="#3fa35b" stroke="#2b7a42" stroke-width="0.5"/>`);
    const led = off([x0 + l * 0.82, y0 - h], 0.5);
    parts.push(`<circle cx="${f(led[0])}" cy="${f(led[1])}" r="1.4" fill="#ff2fd6"/>`);
    const label = off([x0 + l * 0.25, y0 - h], 0.5);
    parts.push(`<rect x="${f(label[0])}" y="${f(label[1] - 1.5)}" width="${f(l * 0.4)}" height="3" rx="1.5" fill="${p.edge}" opacity="0.45"/>`);
  }
  if (!known) {
    parts.push(`<text x="${VIEW_W - 4}" y="${VIEW_H - 2}" text-anchor="end" font-size="7" fill="#6f675f" font-family="system-ui, sans-serif">size not published</text>`);
  }
  const size = known ? `${L} × ${W} × ${H} mm, drawn to scale` : 'size not published, approximate drawing';
  return `<svg class="part-art" viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="${VIEW_W}" height="${VIEW_H}" role="img" aria-label="${c.name}, ${size}">${parts.join('')}</svg>`;
}
