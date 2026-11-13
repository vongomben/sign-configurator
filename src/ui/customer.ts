// Cliente: l'insegna a tutto schermo, gli strumenti in un foglio (SPEC §12.2).
import './customer.css';
import { controllerOf, CUSTOMER_STL_DOWNLOAD, DEFAULT_PARAMS, GENERATOR_VERSION, ORDER_SCHEMA_VERSION, resolveParams, type Params } from '../config';
import { PRICING_VERSION } from '../pricing';
import { decodeShare, encodeShare } from '../order/share';
import type { RasterImageSource, SvgImageSource } from '../order/schema';
import { meshToStl } from '../export/stl';
import type { EditSegment } from '../editor/paths';
import { scalePaths } from '../editor/paths';
import type { PathEditor } from '../editor/editor';
import { FONTS } from '../fonts/registry';
import {
  DEFAULT_CUSTOMER,
  type LightEffect,
  type OrderCrossing,
  type OrderPath,
  type OrderSource,
  type SignOrderV4,
  type SizePreset,
  type TraceMode,
} from '../order/schema';
import { importRaster, paintThresholdPreview, rebuildRaster } from '../sources/rasterImport';
import { IMAGE_MAX_BYTES, importSvg } from '../sources/svgImport';
import { S, customerMessage, customerMessages } from './strings';
import type { BomBox, BomSupply } from '../export/bom';
import { BOXES } from '../parts/boxes';
import { plateSvgFileName, signSlug, stlFileName } from './signSlug';
import { plateToSvg } from '../export/plate';
import {
  DEFAULT_PLATE,
  PLATE_MATERIALS,
  PLATE_SHAPES,
  clampCornerR,
  clampMargin,
  type PlateChoice,
  type PlateMaterial,
  type PlateShape,
} from '../geometry/plate';
import { PLATE_CORNER_R_MAX, PLATE_CORNER_R_MIN, PLATE_MARGIN_MAX, PLATE_MARGIN_MIN } from '../config';
import { SIZES } from './sizes';
import { PLUGS, plugOf } from './plugs';
import { DEFAULT_LED_DENSITY, LED_DENSITIES, EDGE_PROFILES, TECH_FIELDS, TECH_GROUPS, ledDensityOptions, voltageOptions, controllerOptions, boxOptions, techFieldInvalid, techParams, type TechNumericKey } from './techParams';
import { mountSignScene, type PreviewMode } from '../viewer/scene';
import { createGenerator } from '../worker/api';

const WALL_MIN_MM = 1.6;
const WALL_MAX_MM = 5;
const HEIGHT_MIN_MM = 40;
const HEIGHT_MAX_MM = 800;
const SWATCHES = ['#ff2fd6', '#ff3b30', '#ff9500', '#ffd60a', '#30d158', '#64d2ff', '#0a84ff', '#bf5af2', '#f5f5f7'] as const;

const TITLES: Record<string, string> = { ...S.sections, request: S.sheet.request };

function icon(path: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
}

const ICONS: Record<string, string> = {
  text: icon('M5 6h14M5 12h14M5 18h9'),
  font: icon('M6 19 L12 5 L18 19M8.5 14h7'),
  size: icon('M4 20 L20 4M14 4h6v6M4 14v6h6'),
  color: icon('M12 5a7 7 0 1 0 0.01 0'),
  image: icon('M4 6h16v12H4zM4 15l4-4 3 3 3-4 6 5'),
  plate: icon('M4 5h16v14H4zM8 9h8M8 13h5'),
  tech: icon('M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4'),
  more: icon('M6 12h.01M12 12h.01M18 12h.01'),
};

const app = document.querySelector<HTMLElement>('#app')!;
const fontOptions = FONTS.map((font) => `<option value="${font.id}">${font.name}</option>`).join('');
const fontCards = FONTS.map((font, index) => `
  <button type="button" class="font-card" data-font="${font.id}" aria-pressed="${index === 0 ? 'true' : 'false'}">
    <span class="font-sample">Ciao</span>
    <span class="font-name">${font.name}</span>
  </button>`).join('');
const sizeChips = SIZES.map((size) => `
  <button type="button" class="size-chip" data-size="${size.heightMm}" aria-pressed="${size.id === 'M' ? 'true' : 'false'}">
    ${size.id}<span>${size.heightMm / 10} cm</span>
  </button>`).join('');
const swatches = SWATCHES.map((hex) => `
  <button type="button" class="swatch" data-color="${hex}" aria-label="${hex}" aria-pressed="${hex === '#ff2fd6' ? 'true' : 'false'}"></button>`).join('');
const tools = [
  ['text', S.tools.text],
  ['font', S.tools.font],
  ['size', S.tools.size],
  ['color', S.tools.color],
  ['image', S.tools.image],
  ['plate', S.tools.plate],
  ['tech', S.tools.tech],
  ['more', S.tools.more],
] as const;
const techGroups = TECH_GROUPS.map((group) => `
  <fieldset class="tech-group">
    <legend>${group.title}</legend>
    ${group.fields.map((field) => `
    <label class="tech-field">
      <span>${field.label} <small>${field.key}</small></span>
      <span class="tech-input">
        <input name="tech-${field.key}" type="number" inputmode="decimal" min="${field.min}" max="${field.max}" step="${field.step}" value="${DEFAULT_PARAMS[field.key]}">
        <span>${field.unit}</span>
      </span>
    </label>`).join('')}
    ${group.id === 'strip' ? `
    <label class="tech-field">
      <span>${S.tech.density} <small>LED_PER_M</small></span>
      <select name="tech-LED_PER_M">
        ${ledDensityOptions().map((o) => `<option value="${o.value}"${o.isDefault ? ' selected' : ''}>${o.label}</option>`).join('')}
      </select>
    </label>
    <label class="tech-field">
      <span>${S.tech.voltage} <small>STRIP_V</small></span>
      <select name="tech-STRIP_V">
        ${voltageOptions().map((o) => `<option value="${o.value}"${o.isDefault ? ' selected' : ''}>${o.label}</option>`).join('')}
      </select>
    </label>
    <label class="tech-field">
      <span>${S.tech.controller} <small>CONTROLLER_ID</small></span>
      <select name="tech-CONTROLLER_ID">
        ${controllerOptions().map((o) => `<option value="${o.value}"${o.isDefault ? ' selected' : ''}>${o.label}</option>`).join('')}
      </select>
    </label>
    <label class="tech-field">
      <span>${S.tech.box} <small>BOX_ID</small></span>
      <select name="tech-BOX_ID">
        ${boxOptions().map((o) => `<option value="${o.value}"${o.isDefault ? ' selected' : ''}>${o.label}</option>`).join('')}
      </select>
    </label>` : ''}
    ${group.id === 'edges' ? `
    <label class="tech-field">
      <span>${S.tech.profile} <small>EDGE_PROFILE</small></span>
      <select name="tech-EDGE_PROFILE">
        ${EDGE_PROFILES.map((p) => `<option value="${p.value}"${p.value === DEFAULT_PARAMS.EDGE_PROFILE ? ' selected' : ''}>${p.label}</option>`).join('')}
      </select>
    </label>` : ''}
  </fieldset>`).join('');

app.innerHTML = `
  <div class="shell" data-sheet="">
    <h1 class="sr-only">${S.pageTitle}</h1>
    <div class="sr-only">
      <input type="radio" name="sourceKind" value="text" checked>
      <input type="radio" name="sourceKind" value="image">
    </div>
    <div class="stage-wrap">
      <div id="stage"></div>
      <canvas id="path-editor" hidden></canvas>
      <div class="dims" id="dims" aria-hidden="true" hidden>
        <div class="dim dim-w"><i class="dim-line"></i><span id="dim-w"></span></div>
        <div class="dim dim-h"><i class="dim-line"></i><span id="dim-h"></span></div>
      </div>
      <div class="hud">
        <div class="hud-view">
          <div class="mode-switch" role="radiogroup" aria-label="${S.view.aria}">
            <label><input type="radio" name="mode" value="accesa" checked><span>${S.view.on}</span></label>
            <label><input type="radio" name="mode" value="spenta"><span>${S.view.off}</span></label>
          </div>
          <div class="mode-switch diffuser-switch" role="radiogroup" aria-label="${S.diffuser.aria}">
            <label><input type="radio" name="diffuser" value="on" checked><span>${S.diffuser.on}</span></label>
            <label><input type="radio" name="diffuser" value="off"><span>${S.diffuser.off}</span></label>
          </div>
        </div>
        <label class="wall-field">
          <span>${S.frame.label}</span>
          <input name="wallMm" type="number" min="${WALL_MIN_MM}" max="${WALL_MAX_MM}" step="0.1" value="${DEFAULT_PARAMS.WALL}" aria-label="${S.frame.aria}">
        </label>
        <button type="button" id="open-request" aria-pressed="false">${S.request}</button>
      </div>
      <div class="stage-meta">
        <p id="preview-status" data-generation="0">${S.generating}</p>
        <div class="stage-power">
          <label class="plug-pill" title="${S.plug.title(PLUGS[0]!.label)}">
            <span class="plug-icon">${PLUGS[0]!.icon}</span>
            <span class="plug-label">${S.plug.label}</span>
            <select name="plug" aria-label="${S.plug.aria}">
              ${PLUGS.map((plug) => `<option value="${plug.value}">${plug.short}</option>`).join('')}
            </select>
          </label>
          <a id="preview-supply" href="parts.html" target="_blank" rel="noopener" hidden></a>
        </div>
      </div>
    </div>
    <section class="sheet" aria-label="${S.sheet.aria}">
      <header class="sheet-bar">
        <h2 id="sheet-title">${S.sheet.configure}</h2>
        <button type="button" id="sheet-close">${S.sheet.done}</button>
      </header>
      <div class="sheet-body">
        <div class="pane" data-pane="text" hidden>
          <input name="text" value="Ciao" autocomplete="off" aria-label="${S.textAria}">
        </div>
        <div class="pane" data-pane="font" hidden>
          <div class="font-row">${fontCards}</div>
          <select name="fontId" hidden>${fontOptions}</select>
        </div>
        <div class="pane" data-pane="size" hidden>
          <p class="tech-note">${S.size.letter}</p>
          <div class="sizes">${sizeChips}</div>
          <div class="height-step">
            <button type="button" data-height-step="-10" aria-label="${S.heightStepDown}">−</button>
            <input name="heightMm" type="number" min="${HEIGHT_MIN_MM}" max="${HEIGHT_MAX_MM}" value="120" aria-label="${S.heightAria}">
            <button type="button" data-height-step="10" aria-label="${S.heightStepUp}">+</button>
          </div>
          <p id="size-overall" class="tech-note" hidden></p>
        </div>
        <div class="pane" data-pane="color" hidden>
          <div class="swatches">${swatches}</div>
          <label class="color-free">${S.color.free} <input type="color" name="color" value="#ff2fd6"></label>
          <div class="choice" role="radiogroup" aria-label="${S.color.effectAria}">
            <label><input type="radio" name="effect" value="fisso" checked><span>${S.color.fixed}</span></label>
            <label><input type="radio" name="effect" value="arcobaleno"><span>${S.color.rainbow}</span></label>
          </div>
        </div>
        <div class="pane" data-pane="image" hidden>
          <label class="image-drop">
            <span>${S.image.upload}</span>
            <small>${S.image.hint}</small>
            <input name="image" type="file" accept=".svg,image/svg+xml,.png,.jpg,.jpeg,image/png,image/jpeg">
          </label>
          <label class="field" data-source="trace" hidden>${S.image.trace}
            <select name="trace">
              <option value="centerline" selected>${S.image.centerline}</option>
              <option value="outline">${S.image.outline}</option>
            </select>
          </label>
          <label class="field" data-source="raster" hidden>${S.image.threshold}
            <input name="threshold" type="range" min="0" max="255" step="1" value="128">
            <span id="threshold-value">128</span>
          </label>
          <label data-source="raster" hidden><input name="invert" type="checkbox"> ${S.image.invert}</label>
          <canvas id="threshold-preview" data-source="raster" hidden></canvas>
          <button type="button" id="back-to-text" data-source="trace" hidden>${S.image.backToText}</button>
        </div>
        <div class="pane" data-pane="plate" hidden>
          <div class="choice plate-material" role="radiogroup" aria-label="${S.plate.materialAria}">
            <label><input type="radio" name="plateMaterial" value="none" checked><span>${S.plate.none}</span></label>
            ${(Object.keys(PLATE_MATERIALS) as PlateMaterial[]).map((id) => `<label><input type="radio" name="plateMaterial" value="${id}"><span>${PLATE_MATERIALS[id].label} · ${PLATE_MATERIALS[id].thicknessMm} mm</span></label>`).join('')}
          </div>
          <div class="choice plate-shape plate-option" role="radiogroup" aria-label="${S.plate.shapeAria}">
            ${PLATE_SHAPES.map((shape) => `<label><input type="radio" name="plateShape" value="${shape.value}"${shape.value === DEFAULT_PLATE.shape ? ' checked' : ''}><span>${shape.label}</span></label>`).join('')}
          </div>
          <label class="tech-field plate-option">
            <span>${S.plate.margin}</span>
            <span class="tech-input">
              <input name="plateMarginMm" type="number" inputmode="decimal" min="${PLATE_MARGIN_MIN}" max="${PLATE_MARGIN_MAX}" step="1" value="${DEFAULT_PLATE.marginMm}">
              <span>mm</span>
            </span>
          </label>
          <label class="tech-field plate-option plate-corner">
            <span>${S.plate.corner}</span>
            <span class="tech-input">
              <input name="plateCornerRMm" type="number" inputmode="decimal" min="${PLATE_CORNER_R_MIN}" max="${PLATE_CORNER_R_MAX}" step="1" value="${DEFAULT_PLATE.cornerRMm}">
              <span>mm</span>
            </span>
          </label>
          <p id="plate-size" class="tech-note" hidden></p>
        </div>
        <div class="pane" data-pane="tech" hidden>
          <p class="tech-note">${S.tech.note}</p>
          ${techGroups}
          <div class="actions">
            <button type="button" id="tech-reset">${S.tech.reset}</button>
          </div>
        </div>
        <div class="pane" data-pane="more" hidden>
          <div class="actions">
            <button type="button" id="edit-paths" disabled>${S.more.editPaths}</button>
            <button type="button" id="restore-paths" disabled>${S.more.restorePaths}</button>
          </div>
          <div id="path-toolbar" hidden></div>
          <div class="actions design-actions">
            <button type="button" id="share-design" disabled>${S.more.share}</button>
            <button type="button" id="download-design" disabled>${S.more.downloadDesign}</button>
            <button type="button" id="load-design">${S.more.loadDesign}</button>
            <button type="button" id="new-design">${S.more.startOver}</button>
            <input type="file" id="design-file" accept=".json,application/json" hidden>
          </div>
          <p id="design-note" class="tech-note" role="status" hidden></p>
        </div>
        <div class="pane" data-pane="request" hidden>
          <dl id="summary"></dl>
          <p id="blocked-reason" hidden></p>
          <div class="request-actions">
            <button type="button" id="submit-order">${S.order.send}</button>
            ${CUSTOMER_STL_DOWNLOAD ? `<button type="button" id="download-stl" disabled>${S.generating}</button>` : ''}
          </div>
        </div>
      </div>
    </section>
    <nav class="dock" aria-label="${S.sheet.aria}">
      ${tools.map(([id, label]) => `<button type="button" data-tool="${id}" aria-pressed="false">${ICONS[id]}<span>${label}</span></button>`).join('')}
    </nav>
  </div>
`;

const shell = document.querySelector<HTMLElement>('.shell')!;
const sheetTitle = document.querySelector<HTMLElement>('#sheet-title')!;
const sheetClose = document.querySelector<HTMLButtonElement>('#sheet-close')!;
const openRequest = document.querySelector<HTMLButtonElement>('#open-request')!;
const stage = document.querySelector<HTMLElement>('#stage')!;
const status = document.querySelector<HTMLElement>('#preview-status')!;
const supply = document.querySelector<HTMLAnchorElement>('#preview-supply')!;
const plugInput = document.querySelector<HTMLSelectElement>('select[name="plug"]')!;
const plugPill = document.querySelector<HTMLElement>('.plug-pill')!;
const plugIcon = document.querySelector<HTMLElement>('.plug-icon')!;

/** Disegno e title della pillola seguono la spina scelta. */
function syncPlug(): void {
  const plug = plugOf(plugInput.value);
  plugIcon.innerHTML = plug.icon;
  plugPill.title = S.plug.title(plug.label);
}
plugInput.addEventListener('change', () => {
  syncPlug();
  if (shell.dataset.sheet === 'request') renderSummary();
});
const editButton = document.querySelector<HTMLButtonElement>('#edit-paths')!;
const restoreButton = document.querySelector<HTMLButtonElement>('#restore-paths')!;
const submitButton = document.querySelector<HTMLButtonElement>('#submit-order')!;
const downloadButton = document.querySelector<HTMLButtonElement>('#download-stl');
const blockedReason = document.querySelector<HTMLElement>('#blocked-reason')!;
const summary = document.querySelector<HTMLElement>('#summary')!;
const editorCanvas = document.querySelector<HTMLCanvasElement>('#path-editor')!;
const editorToolbar = document.querySelector<HTMLElement>('#path-toolbar')!;
const textInput = document.querySelector<HTMLInputElement>('input[name="text"]')!;
const fontInput = document.querySelector<HTMLSelectElement>('select[name="fontId"]')!;
const imageInput = document.querySelector<HTMLInputElement>('input[name="image"]')!;
const heightInput = document.querySelector<HTMLInputElement>('input[name="heightMm"]')!;
const wallInput = document.querySelector<HTMLInputElement>('input[name="wallMm"]')!;
const traceInput = document.querySelector<HTMLSelectElement>('select[name="trace"]')!;
const thresholdInput = document.querySelector<HTMLInputElement>('input[name="threshold"]')!;
const thresholdValue = document.querySelector<HTMLElement>('#threshold-value')!;
const invertInput = document.querySelector<HTMLInputElement>('input[name="invert"]')!;
const thresholdPreview = document.querySelector<HTMLCanvasElement>('#threshold-preview')!;
const backToText = document.querySelector<HTMLButtonElement>('#back-to-text')!;
const fontTool = document.querySelector<HTMLButtonElement>('[data-tool="font"]')!;
const color = document.querySelector<HTMLInputElement>('input[name="color"]')!;
const desktop = window.matchMedia('(min-width: 900px)');
const dims = document.querySelector<HTMLElement>('#dims')!;
const dimW = document.querySelector<HTMLElement>('#dim-w')!;
const dimH = document.querySelector<HTMLElement>('#dim-h')!;
const sizeOverall = document.querySelector<HTMLElement>('#size-overall')!;

/** Ingombro dell'ultima insegna generata, mm: il fondale se c'è, altrimenti la cornice. */
let lastSize: { w: number; h: number } | null = null;

function overallLabel(size: { w: number; h: number }): string {
  return `${cmLabel(size.w).replace(' cm', '')} × ${cmLabel(size.h)}`;
}

function showSize(size: { w: number; h: number } | null): void {
  lastSize = size;
  dims.hidden = !size;
  sizeOverall.hidden = !size;
  if (!size) return;
  dimW.textContent = S.size.width(Math.round(size.w));
  dimH.textContent = S.size.height(Math.round(size.h));
  sizeOverall.textContent = S.size.overall(overallLabel(size));
}

function outlineSize(outline: readonly (readonly [number, number][])[]): { w: number; h: number } | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of outline) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX > minX && maxY > minY ? { w: maxX - minX, h: maxY - minY } : null;
}

let svgMarkup: string | null = null;
/** Immagine arrivata da un design salvato: la forma normalizzata dell'ordine, senza il file originale. */
let loadedSource: SvgImageSource | RasterImageSource | null = null;
/** L'ultimo ordine generato: è quello che si salva e si condivide (SPEC §12.6). */
let lastOrder: SignOrderV4 | null = null;
let svgName = 'immagine.svg';
let lastTool = 'text';
let blockReason = '';

interface RasterSession {
  name: string;
  luminance: Uint8Array;
  width: number;
  height: number;
  warnings: string[];
}

let raster: RasterSession | null = null;

function isDesktop(): boolean {
  return desktop.matches;
}

function imageMode(): boolean {
  return document.querySelector<HTMLInputElement>('input[name="sourceKind"][value="image"]')!.checked;
}

function traceMode(): TraceMode {
  return traceInput.value === 'outline' ? 'outline' : 'centerline';
}

function diffuserOn(): boolean {
  return document.querySelector<HTMLInputElement>('input[name="diffuser"][value="on"]')!.checked;
}

function effectOf(): LightEffect {
  const effect = document.querySelector<HTMLInputElement>('input[name="effect"]:checked');
  return effect?.value === 'arcobaleno' ? 'arcobaleno' : 'colore fisso';
}

function sizePresetOf(heightMm: number): SizePreset | null {
  return SIZES.find((size) => size.heightMm === heightMm)?.id ?? null;
}

function customerOrder(source: OrderSource): SignOrderV4 {
  const heightMm = Number(heightInput.value);
  return {
    schemaVersion: ORDER_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    pricingVersion: PRICING_VERSION,
    source,
    heightMm,
    sizePreset: sizePresetOf(heightMm),
    color: color.value,
    params: orderParams(),
    paths: edited?.paths ?? null,
    crossings: edited?.crossings ?? [],
    customer: { ...DEFAULT_CUSTOMER, effect: effectOf(), diffuser: diffuserOn(), plug: plugOf(plugInput.value).value },
    plate: plateChoice(),
  };
}

function litOn(): boolean {
  return document.querySelector<HTMLInputElement>('input[name="mode"][value="accesa"]')!.checked;
}

function syncSourceFields(): void {
  const image = imageMode();
  const hasRaster = image && raster != null;
  const hasImage = image && (raster != null || svgMarkup != null);
  for (const el of document.querySelectorAll<HTMLElement>('[data-source]')) {
    const slot = el.dataset.source;
    const show = (slot === 'trace' && hasImage) || (slot === 'raster' && hasRaster);
    el.hidden = !show;
  }
  fontTool.classList.toggle('is-dimmed', image);
}

function wallMm(): number {
  const n = Number(wallInput.value);
  if (!Number.isFinite(n)) return DEFAULT_PARAMS.WALL;
  return Math.min(WALL_MAX_MM, Math.max(WALL_MIN_MM, n));
}

const techNumberInputs = new Map<TechNumericKey, HTMLInputElement>(
  TECH_FIELDS.map((field) => [field.key, document.querySelector<HTMLInputElement>(`input[name="tech-${field.key}"]`)!]),
);
const techProfileInput = document.querySelector<HTMLSelectElement>('select[name="tech-EDGE_PROFILE"]')!;
const techDensityInput = document.querySelector<HTMLSelectElement>('select[name="tech-LED_PER_M"]')!;
const techVoltageInput = document.querySelector<HTMLSelectElement>('select[name="tech-STRIP_V"]')!;
const techControllerInput = document.querySelector<HTMLSelectElement>('select[name="tech-CONTROLLER_ID"]')!;
const techBoxInput = document.querySelector<HTMLSelectElement>('select[name="tech-BOX_ID"]')!;
const boxLabels = new Map([...techBoxInput.options].map((o) => [o.value, o.textContent ?? '']));

/** Scatole che non contengono alimentatore e controller: «too small» nel menu. */
function markBoxes(fitting: readonly string[] | null): void {
  for (const option of techBoxInput.options) {
    const base = boxLabels.get(option.value) ?? option.textContent ?? '';
    const small = fitting !== null && BOXES.some((b) => b.id === option.value) && !fitting.includes(option.value);
    option.textContent = small ? `${base} — ${S.tech.tooSmall}` : base;
  }
}
const techReset = document.querySelector<HTMLButtonElement>('#tech-reset')!;

/** Override dell'ordine: la cornice dalla barra, il resto dallo strumento Tecnica. */
function orderParams(): Partial<Params> {
  const numbers: Partial<Record<TechNumericKey, string>> = {};
  for (const [key, input] of techNumberInputs) numbers[key] = input.value;
  return { WALL: wallMm(), ...techParams({ numbers, edgeProfile: techProfileInput.value, ledPerM: techDensityInput.value, stripV: techVoltageInput.value, controller: techControllerInput.value, box: techBoxInput.value }) };
}

const plateMarginInput = document.querySelector<HTMLInputElement>('input[name="plateMarginMm"]')!;
const plateCornerInput = document.querySelector<HTMLInputElement>('input[name="plateCornerRMm"]')!;
const plateSize = document.querySelector<HTMLElement>('#plate-size')!;

/** Fondale scelto (SPEC §13). `null`: nessun fondale. */
function plateChoice(): PlateChoice | null {
  const material = document.querySelector<HTMLInputElement>('input[name="plateMaterial"]:checked')?.value ?? 'none';
  if (!(material in PLATE_MATERIALS)) return null;
  const shape = (document.querySelector<HTMLInputElement>('input[name="plateShape"]:checked')?.value ?? DEFAULT_PLATE.shape) as PlateShape;
  return {
    shape,
    material: material as PlateMaterial,
    marginMm: clampMargin(Number(plateMarginInput.value)),
    cornerRMm: clampCornerR(Number(plateCornerInput.value)),
  };
}

function syncPlateFields(): void {
  const plate = plateChoice();
  for (const el of document.querySelectorAll<HTMLElement>('.plate-option')) el.classList.toggle('is-dimmed', !plate);
  for (const input of document.querySelectorAll<HTMLInputElement>('.plate-option input')) input.disabled = !plate;
  // Il raggio vale solo per il rettangolo: la pillola ha metà del lato corto, il sagomato segue l'insegna.
  document.querySelector<HTMLElement>('.plate-corner')!.hidden = plate !== null && plate.shape !== 'rect';
  if (!plate) plateSize.hidden = true;
}

function cmLabel(mm: number): string {
  const cm = Math.round((mm / 10) * 10) / 10;
  return `${Number.isInteger(cm) ? String(cm) : cm.toFixed(1)} cm`;
}

function inkFor(hex: string): string {
  const raw = hex.replace('#', '');
  if (raw.length !== 6) return '#fffaf6';
  const channel = (index: number): number => {
    const value = Number.parseInt(raw.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.55 ? '#1c1916' : '#fffaf6';
}

function applyNeon(hex: string): void {
  document.documentElement.style.setProperty('--neon', hex);
  document.documentElement.style.setProperty('--on-neon', inkFor(hex));
  for (const swatch of document.querySelectorAll<HTMLButtonElement>('.swatch')) {
    swatch.setAttribute('aria-pressed', swatch.dataset.color?.toLowerCase() === hex.toLowerCase() ? 'true' : 'false');
  }
}

function syncFontSamples(): void {
  const sample = textInput.value.trim() || 'Ciao';
  for (const el of document.querySelectorAll<HTMLElement>('.font-sample')) el.textContent = sample;
  for (const card of document.querySelectorAll<HTMLButtonElement>('.font-card')) {
    card.setAttribute('aria-pressed', card.dataset.font === fontInput.value ? 'true' : 'false');
  }
}

function syncSizeChips(): void {
  const mm = Number(heightInput.value);
  for (const chip of document.querySelectorAll<HTMLButtonElement>('.size-chip')) {
    chip.setAttribute('aria-pressed', Number(chip.dataset.size) === mm ? 'true' : 'false');
  }
}

function renderSummary(): void {
  const effect = document.querySelector<HTMLInputElement>('input[name="effect"]:checked');
  const rows: [string, string][] = [];
  const t = S.summary;
  if (imageMode()) rows.push([t.image, fileLabel() || '—']);
  else {
    const font = FONTS.find((entry) => entry.id === fontInput.value);
    rows.push([t.text, textInput.value], [t.font, font?.name ?? fontInput.value]);
  }
  const mm = Number(heightInput.value);
  rows.push(
    [t.size, lastSize ? overallLabel(lastSize) : '…'],
    [t.letter, Number.isFinite(mm) ? cmLabel(mm) : ''],
    [t.color, color.value],
    [t.effect, effect?.value === 'arcobaleno' ? S.color.rainbow : S.color.fixed],
    [t.diffuser, diffuserOn() ? t.yes : t.no],
    [t.frame, `${wallMm().toFixed(1)} mm`],
  );
  const plate = plateChoice();
  rows.push([
    t.plate,
    plate
      ? t.plateValue(
          PLATE_SHAPES.find((shape) => shape.value === plate.shape)?.label ?? plate.shape,
          PLATE_MATERIALS[plate.material].label,
          plate.marginMm,
        )
      : S.plate.none,
  ]);
  const overrides = orderParams();
  for (const field of TECH_FIELDS) {
    const value = overrides[field.key];
    if (value !== undefined) rows.push([field.label, `${value} ${field.unit}`]);
  }
  if (overrides.LED_PER_M) rows.push([t.density, `${overrides.LED_PER_M} LED/m`]);
  const controller = controllerOf(overrides.CONTROLLER_ID);
  rows.push([t.controller, `${controller.name} (${controller.model})`]);
  rows.push([t.plug, t.plugValue(plugOf(plugInput.value).label)]);
  if (lastPower) {
    const model = lastPower.supply;
    rows.push([
      t.supply,
      model
        ? S.supply.value(model.model, lastPower.voltageV, model.amps, lastPower.supplyA)
        : S.supply.bare(lastPower.voltageV, lastPower.supplyA),
    ]);
    const box = lastPower.box;
    rows.push([t.box, box ? t.boxValue(`${box.brand} ${box.model}`, box.innerMm.join(' × '), box.auto) : t.noBox]);
    for (const warning of customerMessages(lastPower.warnings)) rows.push([t.warning, warning]);
  }
  if (overrides.EDGE_PROFILE) {
    rows.push([t.profile, EDGE_PROFILES.find((p) => p.value === overrides.EDGE_PROFILE)?.label ?? overrides.EDGE_PROFILE]);
  }
  summary.replaceChildren();
  for (const [term, detail] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = detail;
    summary.append(dt, dd);
  }
}

// Tutti gli strumenti stanno in un solo foglio, uno sotto l'altro, ciascuno in una sezione
// richiudibile (SPEC §12.2). La barra a destra è l'indice: porta alla sezione e la apre.
const sheetBody = document.querySelector<HTMLElement>('.sheet-body')!;
const sectionsBox = document.createElement('div');
sectionsBox.className = 'sections';
const sections = new Map<string, HTMLDetailsElement>();
for (const [id] of tools) {
  const pane = document.querySelector<HTMLElement>(`.pane[data-pane="${id}"]`)!;
  const details = document.createElement('details');
  details.className = 'section';
  details.dataset.section = id;
  details.open = true;
  const summaryEl = document.createElement('summary');
  summaryEl.textContent = TITLES[id] ?? id;
  pane.hidden = false;
  details.append(summaryEl, pane);
  sectionsBox.append(details);
  sections.set(id, details);
}
sheetBody.prepend(sectionsBox);
const requestPane = document.querySelector<HTMLElement>('.pane[data-pane="request"]')!;

function markTool(tool: string | null): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
    button.setAttribute('aria-pressed', button.dataset.tool === tool ? 'true' : 'false');
  }
}

/** La sezione in cima al foglio: è quella evidenziata nella barra. */
function sectionInView(): string | null {
  const top = sheetBody.getBoundingClientRect().top + 8;
  let current: string | null = null;
  for (const [id, details] of sections) {
    if (details.getBoundingClientRect().top <= top) current = id;
  }
  return current ?? tools[0][0];
}

let jumping = false;
function scrollToSection(details: HTMLElement): void {
  const offset = details.getBoundingClientRect().top - sheetBody.getBoundingClientRect().top + sheetBody.scrollTop;
  jumping = true;
  sheetBody.scrollTo({ top: Math.max(0, offset - 4), behavior: 'auto' });
  window.requestAnimationFrame(() => {
    jumping = false;
  });
}

sheetBody.addEventListener('scroll', () => {
  if (jumping || shell.dataset.sheet !== 'config') return;
  const id = sectionInView();
  if (id) {
    lastTool = id;
    markTool(id);
  }
});

function openSheet(pane: string): void {
  const config = pane !== 'request';
  shell.dataset.sheet = config ? 'config' : 'request';
  sheetTitle.textContent = config ? S.sheet.configure : S.sheet.request;
  sectionsBox.hidden = !config;
  requestPane.hidden = config;
  openRequest.setAttribute('aria-pressed', config ? 'false' : 'true');
  if (!config) {
    markTool(null);
    sheetBody.scrollTop = 0;
    renderSummary();
    return;
  }
  const details = sections.get(pane);
  if (details) {
    details.open = true;
    scrollToSection(details);
  }
  lastTool = pane;
  markTool(pane);
}

function closeSheet(): void {
  if (isDesktop()) {
    openSheet(lastTool || 'text');
    return;
  }
  shell.dataset.sheet = '';
  markTool(null);
  openRequest.setAttribute('aria-pressed', 'false');
}

function toggleSheet(pane: string): void {
  const config = pane !== 'request';
  const showing = config ? shell.dataset.sheet === 'config' && lastTool === pane : shell.dataset.sheet === 'request';
  if (!isDesktop() && showing) {
    closeSheet();
    return;
  }
  openSheet(pane);
}

function selectKind(kind: 'text' | 'image'): void {
  const input = document.querySelector<HTMLInputElement>(`input[name="sourceKind"][value="${kind}"]`);
  if (!input || input.checked) return;
  input.checked = true;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// Grigio scuro: il neon resta acceso sul fondo, e cornice nera e fondali si staccano (SPEC §12.2).
const STAGE_BACKGROUND = 0x5c5c62;
const scene = mountSignScene(stage, { background: STAGE_BACKGROUND });
const generator = createGenerator();
applyNeon(color.value);
scene.setColor(color.value);
scene.setMode('accesa');
scene.setEffect('fisso');

let previewDiffuser = true;

function applyPreviewMode(): void {
  const on = diffuserOn();
  const mode: PreviewMode = on ? (litOn() ? 'accesa' : 'spenta') : 'senza diffusore';
  scene.setMode(mode);
  if (on === previewDiffuser) return;
  previewDiffuser = on;
  void showSign();
}

for (const input of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
  input.addEventListener('change', () => {
    if (input.checked) applyPreviewMode();
  });
}
for (const input of document.querySelectorAll<HTMLInputElement>('input[name="diffuser"]')) {
  input.addEventListener('change', () => {
    if (input.checked) applyPreviewMode();
  });
}
color.addEventListener('input', () => {
  applyNeon(color.value);
  scene.setColor(color.value);
});
for (const swatch of document.querySelectorAll<HTMLButtonElement>('.swatch')) {
  swatch.addEventListener('click', () => {
    const hex = swatch.dataset.color;
    if (!hex) return;
    color.value = hex;
    color.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
for (const input of document.querySelectorAll<HTMLInputElement>('input[name="effect"]')) {
  input.addEventListener('change', () => {
    if (input.checked) scene.setEffect(input.value === 'arcobaleno' ? 'arcobaleno' : 'fisso');
  });
}

const DISCARD = S.discard;

let edited: { paths: OrderPath[]; crossings: OrderCrossing[] } | null = null;
let sourceSegments: EditSegment[] = [];
let editor: PathEditor | null = null;
let liveBlocked = false;
let workerBlocked = false;
let editEpoch = 0;
let heightAtEdit = Number(heightInput.value);
const sourceMemory = {
  text: textInput.value,
  font: fontInput.value,
  kind: 'text',
  trace: traceInput.value,
  threshold: thresholdInput.value,
  invert: invertInput.checked,
};

function blocksSubmit(warnings: readonly string[]): boolean {
  return warnings.some(
    (warning) =>
      warning.includes('curva troppo stretta') ||
      warning.includes('sotto il passo di taglio') ||
      warning.startsWith('Sagome che si fondono'),
  );
}

function updateSubmit(): void {
  const blocked = liveBlocked || workerBlocked;
  submitButton.disabled = blocked;
  blockedReason.hidden = !blocked;
  blockedReason.textContent = blocked ? (liveBlocked ? S.editorBlocked : blockReason || S.order.blockedFallback) : '';
}

function rememberSource(): void {
  sourceMemory.text = textInput.value;
  sourceMemory.font = fontInput.value;
  sourceMemory.kind = imageMode() ? 'image' : 'text';
  sourceMemory.trace = traceInput.value;
  sourceMemory.threshold = thresholdInput.value;
  sourceMemory.invert = invertInput.checked;
}

function revertSource(): void {
  textInput.value = sourceMemory.text;
  fontInput.value = sourceMemory.font;
  traceInput.value = sourceMemory.trace;
  thresholdInput.value = sourceMemory.threshold;
  thresholdValue.textContent = sourceMemory.threshold;
  invertInput.checked = sourceMemory.invert;
  const kind = document.querySelector<HTMLInputElement>(`input[name="sourceKind"][value="${sourceMemory.kind}"]`);
  if (kind) kind.checked = true;
  syncSourceFields();
  syncFontSamples();
}

function dropEdits(): void {
  edited = null;
  editor?.close();
  editor = null;
  liveBlocked = false;
  restoreButton.disabled = true;
  updateSubmit();
}

function keepOrDrop(changed: boolean): boolean {
  if (!edited || !changed) return true;
  if (!window.confirm(DISCARD)) {
    revertSource();
    return false;
  }
  dropEdits();
  rememberSource();
  return true;
}

interface ReadyStl {
  housing: ArrayBuffer;
  diffuser: ArrayBuffer;
  label: string;
  heightMm: number;
  diffuserOn: boolean;
  /** Fondale: STL della lastra e SVG di taglio laser. */
  plate: { stl: ArrayBuffer; svg: string } | null;
}

let readyStl: ReadyStl | null = null;

function clearStl(): void {
  readyStl = null;
  if (!downloadButton) return;
  downloadButton.disabled = true;
  downloadButton.textContent = S.generating;
  delete downloadButton.dataset.ready;
}

/** Il risultato in volo non è più quello chiesto: non si pubblica la mesh vecchia. */
function invalidateStl(): void {
  request += 1;
  clearStl();
}

function saveStl(name: string, buffer: ArrayBuffer | string, type = 'model/stl'): void {
  const url = URL.createObjectURL(new Blob([buffer], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Alimentatore consigliato e limiti del controller, dall'ultima generazione. */
let lastPower: {
  voltageV: number;
  supplyA: number;
  supply: BomSupply | null;
  box: BomBox | null;
  warnings: string[];
} | null = null;

/**
 * Pillola in basso a destra, accanto alla spina: il modello consigliato dal catalogo, link alla
 * pagina parts. Rossa oltre i limiti del controller.
 */
function showSupply(
  bom: {
    assembly?: {
      supplyA?: number;
      voltageV?: number;
      supply?: BomSupply | null;
      box?: BomBox | null;
      boxWarnings?: string[];
      boxesThatFit?: string[];
      controllerWarnings?: string[];
    };
  } | null,
): void {
  const amps = bom?.assembly?.supplyA ?? 0;
  if (!(amps > 0)) {
    lastPower = null;
    markBoxes(null);
    supply.hidden = true;
    supply.textContent = '';
    supply.classList.remove('is-over');
    supply.removeAttribute('title');
    supply.href = 'parts.html';
    return;
  }
  const volts = bom?.assembly?.voltageV ?? DEFAULT_PARAMS.STRIP_V;
  const warnings = bom?.assembly?.controllerWarnings ?? [];
  const model = bom?.assembly?.supply ?? null;
  const box = bom?.assembly?.box ?? null;
  lastPower = { voltageV: volts, supplyA: amps, supply: model, box, warnings: [...warnings, ...(bom?.assembly?.boxWarnings ?? [])] };
  markBoxes(bom?.assembly?.boxesThatFit ?? null);
  supply.hidden = false;
  supply.textContent = model ? S.supply.pill(model.model.replace(/-P1J$/, ''), volts, model.amps) : S.supply.bare(volts, amps);
  supply.href = model ? `parts.html#${model.family}` : 'parts.html#power-supplies';
  supply.classList.toggle('is-over', warnings.length > 0);
  const base = model ? S.supply.title(model.model, amps, volts) : S.supply.none(amps, volts);
  supply.title = [base, ...customerMessages(warnings)].join(' ');
}

function fileLabel(): string {
  if (!imageMode()) return textInput.value.trim();
  const name = raster?.name ?? svgName;
  return name.replace(/\.[^.]+$/, '');
}

downloadButton?.addEventListener('click', () => {
  const ready = readyStl;
  if (!ready || downloadButton?.disabled) return;
  saveStl(stlFileName(ready.label, ready.heightMm, 'housing'), ready.housing);
  if (ready.diffuserOn) saveStl(stlFileName(ready.label, ready.heightMm, 'diffuser'), ready.diffuser);
  if (ready.plate) {
    saveStl(stlFileName(ready.label, ready.heightMm, 'fondale'), ready.plate.stl);
    saveStl(plateSvgFileName(ready.label, ready.heightMm), ready.plate.svg, 'image/svg+xml');
  }
});

let request = 0;
async function showSign(): Promise<void> {
  const id = ++request;
  const epoch = editEpoch;
  clearStl();
  showSupply(null);
  syncSourceFields();
  const heightMm = Number(heightInput.value);
  if (!(heightMm > 0)) {
    showSize(null);
    status.textContent = S.status.needHeight;
    return;
  }
  const image = imageMode();
  const text = textInput.value.trim();
  if (!image && !text) {
    showSize(null);
    status.textContent = S.status.needText;
    return;
  }
  if (image && !svgMarkup && !raster && !loadedSource) {
    showSize(null);
    status.textContent = S.status.needImage;
    return;
  }
  let order: SignOrderV4;
  let notes: string[] = [];
  if (image && raster) {
    const built = rebuildRaster(raster.luminance, raster.width, raster.height, {
      name: raster.name,
      threshold: Number(thresholdInput.value),
      invert: invertInput.checked,
      trace: traceMode(),
    });
    if (!built) {
      if (id !== request) return;
      showSize(null);
      status.textContent = S.status.noInk;
      return;
    }
    paintThresholdPreview(thresholdPreview, built.binary);
    notes = raster.warnings;
    order = customerOrder(built.source);
  } else if (image && svgMarkup) {
    try {
      const imported = importSvg(svgMarkup, { heightMm, name: svgName, trace: traceMode() });
      notes = imported.warnings;
      order = customerOrder(imported.source);
    } catch (err) {
      if (id !== request) return;
      console.warn(err);
    showSize(null);
    status.textContent = S.status.failed;
      return;
    }
  } else if (image && loadedSource) {
    order = customerOrder(loadedSource);
  } else {
    order = customerOrder({ kind: 'text', text, fontId: fontInput.value });
  }
  status.textContent = S.generating;
  const label = fileLabel();
  const withDiffuser = previewDiffuser;
  try {
    const result = await generator.generate(order);
    if (id !== request || epoch !== editEpoch) return;
    if (!edited) sourceSegments = result.segments;
    rememberDesign(order);
    if (downloadButton && result.housingMesh) {
      readyStl = {
        housing: meshToStl(result.housingMesh, 'housing'),
        diffuser: meshToStl(result.diffuserMesh, 'diffuser'),
        label,
        heightMm,
        diffuserOn: withDiffuser,
        plate:
          result.plate && result.plateMesh
            ? { stl: meshToStl(result.plateMesh, 'fondale'), svg: plateToSvg(result.plate) }
            : null,
      };
      downloadButton.disabled = false;
      downloadButton.textContent = S.order.download;
      downloadButton.dataset.ready = stlFileName(label, heightMm, 'housing');
    }
    editButton.disabled = sourceSegments.length === 0 && !edited;
    scene.setSign({
      housing: result.housingMesh,
      diffuser: result.diffuserMesh,
      lights: result.lightPoints,
      ledGapMm: result.ledGapMm,
      plate: result.plate && result.plateMesh ? { mesh: result.plateMesh, material: result.plate.choice.material } : null,
    });
    if (result.plate) {
      plateSize.hidden = false;
      plateSize.textContent = S.plate.size(
        cmLabel(result.plate.widthMm).replace(' cm', ''),
        cmLabel(result.plate.heightMm).replace(' cm', ''),
        result.plate.holes.length,
      );
    } else {
      plateSize.hidden = true;
    }
    scene.setColor(color.value);
    showSize(result.plate ? { w: result.plate.widthMm, h: result.plate.heightMm } : outlineSize(result.outline));
    showSupply(result.bom);
    status.dataset.generation = String(Number(status.dataset.generation ?? '0') + 1);
    const blocking = result.warnings.find(
      (warning) =>
        warning.includes('curva troppo stretta') ||
        warning.includes('sotto il passo di taglio') ||
        warning.startsWith('Sagome che si fondono'),
    );
    blockReason = blocking ? (customerMessage(blocking) ?? '') : '';
    workerBlocked = blocksSubmit(result.warnings);
    updateSubmit();
    if (shell.dataset.sheet === 'request') renderSummary();
    const leds = result.lightPoints.length > 0 ? S.status.leds(result.lightPoints.length) : S.status.noLeds;
    // Al cliente solo gli avvisi che lo riguardano, tradotti; i bloccanti stanno in Richiedi.
    const shown = result.warnings.filter((warning) => {
      if (/bassa risoluzione|tratto non uniforme|^Puntino troppo piccolo|^Puntino non|^Trattino fuori/.test(warning)) return true;
      return image && warning.startsWith('Sagome che si fondono');
    });
    const extra = customerMessages([...notes, ...shown]).join(' ');
    status.textContent = extra ? `${leds} ${extra}` : leds;
  } catch (err) {
    if (id !== request) return;
    console.warn(err);
    showSize(null);
    status.textContent = S.status.failed;
  }
}

let timer = 0;
const schedule = (): void => {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void showSign(), 350);
};
// Con tutte le sezioni aperte non c'è più «aprire Testo»: è il campo del testo a riportare la sorgente al testo.
textInput.addEventListener('focus', () => selectKind('text'));
textInput.addEventListener('input', () => {
  syncFontSamples();
  if (!keepOrDrop(textInput.value !== sourceMemory.text)) return;
  invalidateStl();
  schedule();
});
fontInput.addEventListener('change', () => {
  syncFontSamples();
  if (!keepOrDrop(fontInput.value !== sourceMemory.font)) return;
  void showSign();
});
for (const input of document.querySelectorAll<HTMLInputElement>('input[name="sourceKind"]')) {
  input.addEventListener('change', () => {
    const kind = imageMode() ? 'image' : 'text';
    if (!keepOrDrop(kind !== sourceMemory.kind)) return;
    void showSign();
  });
}
traceInput.addEventListener('change', () => {
  if (!keepOrDrop(traceInput.value !== sourceMemory.trace)) return;
  void showSign();
});
thresholdInput.addEventListener('input', () => {
  thresholdValue.textContent = thresholdInput.value;
  if (!keepOrDrop(thresholdInput.value !== sourceMemory.threshold)) return;
  if (!raster) return;
  const built = rebuildRaster(raster.luminance, raster.width, raster.height, {
    name: raster.name,
    threshold: Number(thresholdInput.value),
    invert: invertInput.checked,
    trace: traceMode(),
  });
  if (built) paintThresholdPreview(thresholdPreview, built.binary);
  schedule();
});
invertInput.addEventListener('change', () => {
  if (!keepOrDrop(invertInput.checked !== sourceMemory.invert)) return;
  void showSign();
});
imageInput.addEventListener('change', () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  if (!keepOrDrop(true)) {
    imageInput.value = '';
    return;
  }
  const imageRadio = document.querySelector<HTMLInputElement>('input[name="sourceKind"][value="image"]');
  if (imageRadio) imageRadio.checked = true;
  void loadImage(file);
});
heightInput.addEventListener('change', () => {
  const next = Number(heightInput.value);
  const clamped = Math.min(HEIGHT_MAX_MM, Math.max(HEIGHT_MIN_MM, Number.isFinite(next) ? next : 120));
  if (clamped !== next) heightInput.value = String(clamped);
  syncSizeChips();
  if (edited && clamped > 0 && heightAtEdit > 0 && Math.abs(clamped - heightAtEdit) > 1e-9) {
    const factor = clamped / heightAtEdit;
    edited = {
      paths: scalePaths(edited.paths, factor),
      crossings: edited.crossings.map((crossing) => ({
        at: [Math.round(crossing.at[0] * factor * 1000) / 1000, Math.round(crossing.at[1] * factor * 1000) / 1000],
        under: crossing.under,
      })),
    };
    heightAtEdit = clamped;
    editor?.load(edited.paths, edited.crossings);
  } else if (clamped > 0) {
    heightAtEdit = clamped;
  }
  void showSign();
});
for (const chip of document.querySelectorAll<HTMLButtonElement>('.size-chip')) {
  chip.addEventListener('click', () => {
    const mm = chip.dataset.size;
    if (!mm) return;
    heightInput.value = mm;
    heightInput.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-height-step]')) {
  button.addEventListener('click', () => {
    const delta = Number(button.dataset.heightStep);
    const current = Number(heightInput.value);
    const base = Number.isFinite(current) ? current : 120;
    const next = Math.min(HEIGHT_MAX_MM, Math.max(HEIGHT_MIN_MM, Math.round(base + delta)));
    heightInput.value = String(next);
    heightInput.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
wallInput.addEventListener('input', schedule);
wallInput.addEventListener('change', () => {
  wallInput.value = wallMm().toFixed(1);
  void showSign();
});

/** L'asola è larga quanto il canale (SPEC §3) finché non la si cambia a mano. */
let lastChannelW = techNumberInputs.get('CHANNEL_W')!.value;
function onTechChange(): void {
  const channel = techNumberInputs.get('CHANNEL_W')!;
  const slot = techNumberInputs.get('WIRE_SLOT_W')!;
  if (channel.value !== lastChannelW) {
    if (slot.value === lastChannelW) slot.value = channel.value;
    lastChannelW = channel.value;
  }
  for (const field of TECH_FIELDS) {
    const input = techNumberInputs.get(field.key)!;
    input.setAttribute('aria-invalid', techFieldInvalid(field, input.value) ? 'true' : 'false');
  }
  invalidateStl();
  schedule();
}
for (const input of techNumberInputs.values()) input.addEventListener('input', onTechChange);
techProfileInput.addEventListener('change', onTechChange);
techDensityInput.addEventListener('change', onTechChange);
techVoltageInput.addEventListener('change', onTechChange);
techControllerInput.addEventListener('change', onTechChange);
techBoxInput.addEventListener('change', onTechChange);
for (const input of document.querySelectorAll<HTMLInputElement>('input[name="plateShape"], input[name="plateMaterial"]')) {
  input.addEventListener('change', () => {
    syncPlateFields();
    invalidateStl();
    void showSign();
  });
}
for (const input of [plateMarginInput, plateCornerInput]) {
  input.addEventListener('input', () => {
    invalidateStl();
    schedule();
  });
}
plateMarginInput.addEventListener('change', () => {
  plateMarginInput.value = String(clampMargin(Number(plateMarginInput.value)));
});
plateCornerInput.addEventListener('change', () => {
  plateCornerInput.value = String(clampCornerR(Number(plateCornerInput.value)));
});
syncPlateFields();
techReset.addEventListener('click', () => {
  for (const field of TECH_FIELDS) techNumberInputs.get(field.key)!.value = String(DEFAULT_PARAMS[field.key]);
  techProfileInput.value = DEFAULT_PARAMS.EDGE_PROFILE;
  techDensityInput.value = String(DEFAULT_LED_DENSITY);
  techVoltageInput.value = String(DEFAULT_PARAMS.STRIP_V);
  techControllerInput.value = DEFAULT_PARAMS.CONTROLLER_ID;
  techBoxInput.value = DEFAULT_PARAMS.BOX_ID;
  lastChannelW = techNumberInputs.get('CHANNEL_W')!.value;
  onTechChange();
});
for (const card of document.querySelectorAll<HTMLButtonElement>('.font-card')) {
  card.addEventListener('click', () => {
    const id = card.dataset.font;
    if (!id || fontInput.value === id) return;
    fontInput.value = id;
    fontInput.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function isSvgFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith('.svg') || file.type === 'image/svg+xml';
}

function isRasterFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith('.png') ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    file.type === 'image/png' ||
    file.type === 'image/jpeg'
  );
}

async function loadImage(file: File): Promise<void> {
  svgMarkup = null;
  raster = null;
  loadedSource = null;
  if (file.size > IMAGE_MAX_BYTES) {
    syncSourceFields();
    showSupply(null);
    showSize(null);
    status.textContent = S.status.fileTooBig;
    return;
  }
  if (isSvgFile(file)) {
    svgMarkup = await file.text();
    svgName = file.name || 'immagine.svg';
    void showSign();
    return;
  }
  if (!isRasterFile(file)) {
    syncSourceFields();
    showSupply(null);
    showSize(null);
    status.textContent = S.status.needImage;
    return;
  }
  try {
    const imported = await importRaster(file, { name: file.name || 'immagine' });
    raster = {
      name: imported.source.name,
      luminance: imported.luminance,
      width: imported.width,
      height: imported.height,
      warnings: imported.warnings,
    };
    thresholdInput.value = String(imported.source.threshold);
    thresholdValue.textContent = thresholdInput.value;
    invertInput.checked = imported.source.invert;
    void showSign();
  } catch (err) {
    syncSourceFields();
    showSupply(null);
    console.warn(err);
    showSize(null);
    status.textContent = S.status.failed;
  }
}

editButton.addEventListener('click', () => void openEditor());
restoreButton.addEventListener('click', () => {
  if (!edited) return;
  dropEdits();
  void showSign();
});
submitButton.addEventListener('click', () => {
  if (submitButton.disabled) return;
  status.dataset.sent = 'true';
});
backToText.addEventListener('click', () => {
  selectKind('text');
  openSheet('text');
});
sheetClose.addEventListener('click', () => closeSheet());
openRequest.addEventListener('click', () => toggleSheet('request'));
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
  button.addEventListener('click', () => {
    const tool = button.dataset.tool;
    if (tool) toggleSheet(tool);
  });
}
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
  if (shell.dataset.sheet === 'config' && editorCanvas.dataset.open === 'true') return;
  if (!shell.dataset.sheet) return;
  if (isDesktop() && shell.dataset.sheet !== 'request') return;
  closeSheet();
});
desktop.addEventListener('change', () => {
  if (isDesktop() && !shell.dataset.sheet) openSheet('text');
});

async function openEditor(): Promise<void> {
  if (sourceSegments.length === 0 && !edited) return;
  editButton.disabled = true;
  try {
  if (!editor) {
    const { openPathEditor } = await import('../editor/editor');
    editor = await openPathEditor({
      canvas: editorCanvas,
      toolbar: editorToolbar,
      getParams: () => resolveParams(orderParams()),
      onCommit(paths, crossings) {
        edited = { paths, crossings };
        restoreButton.disabled = false;
        editEpoch += 1;
        workerBlocked = false;
        updateSubmit();
        window.clearTimeout(timer);
        const epoch = editEpoch;
        timer = window.setTimeout(() => {
          if (epoch === editEpoch) void showSign();
        }, 300);
      },
      onLive(blocked) {
        editEpoch += 1;
        liveBlocked = blocked;
        workerBlocked = false;
        updateSubmit();
      },
    });
  } else {
    editor.show();
  }
  if (!edited) {
    const paths = editor.freeze(sourceSegments);
    edited = { paths, crossings: [] };
    heightAtEdit = Number(heightInput.value);
    rememberSource();
  }
  editor.load(edited.paths, edited.crossings);
  restoreButton.disabled = false;
  editEpoch += 1;
  void showSign();
  } finally {
    editButton.disabled = sourceSegments.length === 0 && !edited;
  }
}

// --- Salvare, condividere e riaprire un design (SPEC §12.6) ---

const DESIGN_KEY = 'sign-configurator:design:v1';
/** Oltre questa misura il design non si salva nel browser: resta il file. */
const DESIGN_STORE_MAX = 1_500_000;
const shareButton = document.querySelector<HTMLButtonElement>('#share-design')!;
const downloadDesignButton = document.querySelector<HTMLButtonElement>('#download-design')!;
const loadDesignButton = document.querySelector<HTMLButtonElement>('#load-design')!;
const newDesignButton = document.querySelector<HTMLButtonElement>('#new-design')!;
const designFile = document.querySelector<HTMLInputElement>('#design-file')!;
const designNote = document.querySelector<HTMLElement>('#design-note')!;

function noteDesign(message: string): void {
  designNote.hidden = message === '';
  designNote.textContent = message;
}

/** Dopo ogni generazione riuscita: l'ordine resta nel browser, così un ricaricamento non lo perde. */
function rememberDesign(order: SignOrderV4): void {
  lastOrder = order;
  shareButton.disabled = false;
  downloadDesignButton.disabled = false;
  try {
    const { json } = encodeShare(order);
    if (json && json.length <= DESIGN_STORE_MAX) window.localStorage.setItem(DESIGN_KEY, json);
    else window.localStorage.removeItem(DESIGN_KEY);
  } catch {
    // Archivio pieno o bloccato: il design si salva comunque con il link o con il file.
  }
}

function storedDesign(): string | null {
  try {
    return window.localStorage.getItem(DESIGN_KEY);
  } catch {
    return null;
  }
}

function checkRadio(name: string, value: string): boolean {
  const input = document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
  if (!input) return false;
  input.checked = true;
  return true;
}

function setSelect(select: HTMLSelectElement, value: string, fallback: string): void {
  select.value = value;
  if (select.selectedIndex < 0) select.value = fallback;
}

/** Porta un ordine nei controlli della pagina. La generazione la chiede chi chiama. */
function applyOrder(order: SignOrderV4): void {
  window.clearTimeout(timer);
  editor?.close();
  editor = null;
  liveBlocked = false;
  svgMarkup = null;
  raster = null;
  loadedSource = null;
  imageInput.value = '';
  const source = order.source;
  if (source.kind === 'text') {
    textInput.value = source.text;
    setSelect(fontInput, source.fontId, fontInput.value);
    checkRadio('sourceKind', 'text');
  } else {
    loadedSource = source;
    svgName = source.name;
    setSelect(traceInput, source.trace, traceInput.value);
    checkRadio('sourceKind', 'image');
  }
  heightInput.value = String(order.heightMm);
  heightAtEdit = order.heightMm;
  syncSizeChips();
  color.value = order.color;
  applyNeon(color.value);
  scene.setColor(color.value);

  const params = order.params;
  const wall = typeof params.WALL === 'number' ? params.WALL : DEFAULT_PARAMS.WALL;
  wallInput.value = Math.min(WALL_MAX_MM, Math.max(WALL_MIN_MM, wall)).toFixed(1);
  for (const field of TECH_FIELDS) {
    const input = techNumberInputs.get(field.key)!;
    input.value = String(params[field.key] ?? DEFAULT_PARAMS[field.key]);
    input.setAttribute('aria-invalid', techFieldInvalid(field, input.value) ? 'true' : 'false');
  }
  lastChannelW = techNumberInputs.get('CHANNEL_W')!.value;
  setSelect(techProfileInput, params.EDGE_PROFILE ?? DEFAULT_PARAMS.EDGE_PROFILE, DEFAULT_PARAMS.EDGE_PROFILE);
  const density = params.LED_PER_M ?? DEFAULT_PARAMS.LED_PER_M;
  techDensityInput.value = String(LED_DENSITIES.includes(density) ? density : DEFAULT_LED_DENSITY);
  setSelect(techVoltageInput, String(params.STRIP_V ?? DEFAULT_PARAMS.STRIP_V), String(DEFAULT_PARAMS.STRIP_V));
  setSelect(techControllerInput, params.CONTROLLER_ID ?? DEFAULT_PARAMS.CONTROLLER_ID, DEFAULT_PARAMS.CONTROLLER_ID);
  setSelect(techBoxInput, params.BOX_ID ?? DEFAULT_PARAMS.BOX_ID, DEFAULT_PARAMS.BOX_ID);

  const rainbow = order.customer.effect === 'arcobaleno';
  checkRadio('effect', rainbow ? 'arcobaleno' : 'fisso');
  scene.setEffect(rainbow ? 'arcobaleno' : 'fisso');
  checkRadio('diffuser', order.customer.diffuser ? 'on' : 'off');
  previewDiffuser = order.customer.diffuser;
  scene.setMode(previewDiffuser ? (litOn() ? 'accesa' : 'spenta') : 'senza diffusore');
  setSelect(plugInput, order.customer.plug, PLUGS[0]!.value);
  syncPlug();

  if (order.plate && checkRadio('plateMaterial', order.plate.material)) {
    checkRadio('plateShape', order.plate.shape);
    plateMarginInput.value = String(clampMargin(order.plate.marginMm));
    plateCornerInput.value = String(clampCornerR(order.plate.cornerRMm));
  } else {
    checkRadio('plateMaterial', 'none');
  }
  syncPlateFields();

  edited = order.paths ? { paths: order.paths, crossings: order.crossings } : null;
  restoreButton.disabled = !edited;
  sourceSegments = [];
  rememberSource();
  syncSourceFields();
  syncFontSamples();
  updateSubmit();
}

/** Colore, effetto e spina non rigenerano l'insegna: il design salvato li segue lo stesso. */
let refreshTimer = 0;
function refreshDesign(): void {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    if (!lastOrder) return;
    rememberDesign({
      ...lastOrder,
      color: color.value,
      customer: { ...lastOrder.customer, effect: effectOf(), plug: plugOf(plugInput.value).value },
    });
  }, 400);
}
color.addEventListener('input', refreshDesign);
plugInput.addEventListener('change', refreshDesign);
for (const input of document.querySelectorAll<HTMLInputElement>('input[name="effect"]')) {
  input.addEventListener('change', refreshDesign);
}

/** Link, URL o JSON del file → pagina. `false` se non è un design leggibile. */
function openDesign(input: string): boolean {
  const read = decodeShare(input);
  if (!read.order) return false;
  applyOrder(read.order);
  noteDesign(read.warnings.length > 0 ? S.more.adjusted : '');
  return true;
}

/** Il design aperto da un link vive poi nel browser: senza l'hash, un ricaricamento non torna indietro. */
function dropHash(): void {
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

function designUrl(hash: string): string {
  return `${window.location.origin}${window.location.pathname}${hash}`;
}

shareButton.addEventListener('click', () => {
  if (!lastOrder) return;
  const link = encodeShare(lastOrder);
  if (!link.hash) {
    delete designNote.dataset.link;
    noteDesign(S.more.tooBig);
    return;
  }
  const url = designUrl(link.hash);
  designNote.dataset.link = url;
  void (async () => {
    try {
      if (!isDesktop() && typeof navigator.share === 'function') {
        await navigator.share({ title: document.title, url });
        noteDesign('');
        return;
      }
      await navigator.clipboard.writeText(url);
      noteDesign(S.more.copied);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      window.prompt(S.more.copyPrompt, url);
    }
  })();
});
downloadDesignButton.addEventListener('click', () => {
  if (!lastOrder) return;
  const { json } = encodeShare(lastOrder);
  if (!json) return;
  saveStl(`${signSlug(fileLabel())}-design.json`, json, 'application/json');
});
loadDesignButton.addEventListener('click', () => designFile.click());
designFile.addEventListener('change', () => {
  const file = designFile.files?.[0];
  designFile.value = '';
  if (!file) return;
  void (async () => {
    if (edited && !window.confirm(S.more.replace)) return;
    if (!openDesign(await file.text())) {
      noteDesign(S.more.badFile);
      return;
    }
    invalidateStl();
    void showSign();
  })();
});
newDesignButton.addEventListener('click', () => {
  if (!window.confirm(S.more.startOverConfirm)) return;
  try {
    window.localStorage.removeItem(DESIGN_KEY);
  } catch {
    // Niente da togliere.
  }
  dropHash();
  window.location.reload();
});
window.addEventListener('hashchange', () => {
  if (!window.location.hash.startsWith('#o=')) return;
  const ok = openDesign(window.location.hash);
  dropHash();
  if (!ok) {
    noteDesign(S.more.badLink);
    return;
  }
  invalidateStl();
  void showSign();
});

// All'apertura: prima il link, poi l'ultimo design rimasto nel browser.
if (window.location.hash.startsWith('#o=')) {
  if (!openDesign(window.location.hash)) noteDesign(S.more.badLink);
  dropHash();
} else {
  const stored = storedDesign();
  if (stored) openDesign(stored);
}

void (async () => {
  await Promise.all(
    FONTS.filter((font) => font.kind === 'outline').map(async (font) => {
      try {
        const face = new FontFace(font.id, `url(${import.meta.env.BASE_URL}${font.file})`);
        await face.load();
        document.fonts.add(face);
      } catch {
        // Senza il file resta il font di sistema. Le miniature dei tratti singoli sono v1.1.
      }
    }),
  );
})();

if (isDesktop()) openSheet('text');
void showSign();
