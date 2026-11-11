// Pagina parts (SPEC §2, Alimentatori): alimentatori del catalogo, controller e strisce.
// Solo inglese, come la pagina cliente.

import './parts.css';
import { CONTROLLER, CONTROLLERS, STRIP_PROFILES, STRIP_VOLTAGES } from '../config';
import { supplyArt } from '../parts/supplyArt';
import { SUPPLIES, type SupplyFamily, type SupplyKind } from '../parts/supplies';

const KINDS: { kind: SupplyKind; title: string; text: string }[] = [
  {
    kind: 'adapter',
    title: 'Plug-in adapter',
    text: 'Desktop brick with a mains cord: the customer plugs it into the wall. Our first choice when it is big enough.',
  },
  {
    kind: 'enclosed',
    title: 'Enclosed',
    text: 'Screw terminals, mounted in a box or behind the backdrop. Cheap and compact; the mains side must be wired and covered.',
  },
  {
    kind: 'waterproof',
    title: 'Waterproof (IP67)',
    text: 'Potted, with cables. For outdoor or damp places. Not picked automatically.',
  },
];

const esc = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const num = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));

function ampsCell(family: SupplyFamily, volts: number): string {
  const variant = family.variants.find((v) => v.volts === volts);
  if (!variant) return '<td class="none" data-label="' + volts + ' V">—</td>';
  return `<td data-label="${volts} V"><span class="amps">${num(variant.amps)} A</span><span class="code">${esc(variant.model)}</span></td>`;
}

function row(family: SupplyFamily): string {
  const [l, w, h] = family.sizeMm;
  return `<tr id="${family.id}">
    <td class="art" data-label="">${supplyArt(family)}</td>
    <th scope="row"><a href="${esc(family.datasheet)}" target="_blank" rel="noopener">${esc(family.name)}</a>
      ${family.note ? `<small>${esc(family.note)}</small>` : ''}</th>
    <td data-label="Power">${family.watts} W</td>
    ${STRIP_VOLTAGES.map((v) => ampsCell(family, v)).join('')}
    <td data-label="Size">${num(l)} × ${num(w)} × ${num(h)} mm</td>
    <td data-label="Price">€${family.priceEur[0]}–${family.priceEur[1]}</td>
  </tr>`;
}

function table(kind: SupplyKind): string {
  const families = SUPPLIES.filter((f) => f.kind === kind);
  return `<table>
    <thead><tr><th scope="col"><span class="sr-only">Drawing</span></th><th scope="col">Model</th><th scope="col">Power</th>
      ${STRIP_VOLTAGES.map((v) => `<th scope="col">${v} V</th>`).join('')}
      <th scope="col">Size (L × W × H)</th><th scope="col">Price</th></tr></thead>
    <tbody>${families.map(row).join('')}</tbody>
  </table>`;
}

const strips = STRIP_PROFILES.map(
  (p) => `<tr><th scope="row">${num(p.STRIP_W)} × ${num(p.STRIP_T)} mm</th>
    <td>${num(p.CHANNEL_W)} mm</td><td>${p.LED_PER_M} LED/m</td><td>${num(p.HINGE_PITCH)} mm</td><td>${num(p.CUT_PITCH)} mm</td></tr>`,
).join('');

const controllers = CONTROLLERS.map((c) => {
  const size = c.sizeMm ? `${num(c.sizeMm[0])} × ${num(c.sizeMm[1])} × ${num(c.sizeMm[2])} mm` : '—';
  return `<tr id="${c.id}"><th scope="row"><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a>
    <small>${esc(c.model)}${c.id === CONTROLLER.id ? ' · standard' : ''}${c.note ? `. ${esc(c.note)}` : ''}</small></th>
    <td>${c.minV}–${c.maxV} V</td><td>${c.maxA} A</td><td>${c.maxIcs}</td><td>${c.outputs}</td><td>${size}</td></tr>`;
}).join('');

document.querySelector('#parts')!.innerHTML = `
  <header>
    <a class="back" href="./">← Configurator</a>
    <h1>Parts</h1>
    <p>What goes behind the sign. The configurator sizes the power supply from the number of LEDs,
      the strip voltage and a 25 % margin, then picks the smallest part below that fits.</p>
  </header>

  <section id="power-supplies">
    <h2>Power supplies</h2>
    <p class="lead">Mean Well, universal input 100–240 V AC. Each model comes in 5, 12 and 24 V;
      the cells give the output current and the order code.</p>
    ${KINDS.map(
      ({ kind, title, text }) => `<h3>${title}</h3><p>${text}</p><div class="scroll">${table(kind)}</div>`,
    ).join('')}
    <p class="fine">Prices: average for one piece, excluding VAT, November 2026. They vary a lot by seller.
      Current and size from the datasheets (click a model): check them before ordering.
      Drawings are not photos: they are all at the same scale, from the sizes above.</p>
  </section>

  <section id="controllers">
    <h2>Controllers</h2>
    <p class="lead">ESP32 boards running WLED. Input voltage = strip voltage. The ${esc(CONTROLLER.name)} is
      standard; the others are options in Tech, for longer signs or more power.</p>
    <div class="scroll"><table>
      <thead><tr><th scope="col">Model</th><th scope="col">Input</th><th scope="col">Max current</th>
        <th scope="col">Max LEDs</th><th scope="col">Outputs</th><th scope="col">Size (L × W × H)</th></tr></thead>
      <tbody>${controllers}</tbody>
    </table></div>
    <p class="fine">Above the max current the power supply still fits, but the strip needs power injection
      or a bigger controller. Max LEDs: the maker's figure, or about 600 per output, which WLED suggests for a
      smooth frame rate. Check the maker's page (click a model) before ordering.</p>
  </section>

  <section id="strips">
    <h2>LED strips</h2>
    <div class="scroll"><table>
      <thead><tr><th scope="col">Strip (W × T)</th><th scope="col">Channel</th><th scope="col">Density</th>
        <th scope="col">Hinge pitch</th><th scope="col">Cut pitch</th></tr></thead>
      <tbody>${strips}</tbody>
    </table></div>
  </section>
`;

// L'ancora del link della pagina cliente evidenzia la riga del modello consigliato.
const target = location.hash ? document.getElementById(location.hash.slice(1)) : null;
target?.scrollIntoView({ block: 'center' });
