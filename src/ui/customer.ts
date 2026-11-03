// Cliente: testo, font, altezza, colore e anteprima 3D (SPEC §1).
import { CUSTOMER_STL_DOWNLOAD, DEFAULT_PARAMS, GENERATOR_VERSION, ORDER_SCHEMA_VERSION, resolveParams } from '../config';
import { meshToStl } from '../export/stl';
import type { EditSegment } from '../editor/paths';
import { scalePaths } from '../editor/paths';
import type { PathEditor } from '../editor/editor';
import { FONTS } from '../fonts/registry';
import type { OrderCrossing, OrderPath, SignOrder } from '../order/schema';
import type { TraceMode } from '../order/schema';
import { importRaster, paintThresholdPreview, rebuildRaster } from '../sources/rasterImport';
import { IMAGE_MAX_BYTES, importSvg } from '../sources/svgImport';
import { copy } from './copy.it';
import { stlFileName } from './signSlug';
import { mountSignScene, type PreviewMode } from '../viewer/scene';
import { createGenerator } from '../worker/api';

const WALL_MIN_MM = 1.6;
const WALL_MAX_MM = 5;

const app = document.querySelector<HTMLElement>('#app')!;
const fontOptions = FONTS.map((font) => `<option value="${font.id}">${font.name}</option>`).join('');
app.innerHTML = `
  <h1>Configuratore insegne neon</h1>
  <section class="preview">
    <p class="preview-fields">
      <span>
        <label><input type="radio" name="sourceKind" value="text" checked> Testo</label>
        <label><input type="radio" name="sourceKind" value="image"> Immagine</label>
      </span>
      <label data-source="text">Testo <input name="text" value="Ciao" autocomplete="off"></label>
      <label data-source="text">Font <select name="fontId">${fontOptions}</select></label>
      <label data-source="image" hidden>File <input name="image" type="file" accept=".svg,image/svg+xml,.png,.jpg,.jpeg,image/png,image/jpeg"></label>
      <label data-source="trace" hidden>Traccia
        <select name="trace">
          <option value="centerline" selected>Linea centrale</option>
          <option value="outline">Contorno</option>
        </select>
      </label>
      <label data-source="raster" hidden>Soglia <input name="threshold" type="range" min="0" max="255" step="1" value="128"> <span id="threshold-value">128</span></label>
      <label data-source="raster" hidden><input name="invert" type="checkbox"> Inverti</label>
      <canvas id="threshold-preview" data-source="raster" hidden></canvas>
      <label>Altezza mm <input name="heightMm" type="number" min="40" max="800" value="120"></label>
      <label>Cornice mm <input name="wallMm" type="number" min="${WALL_MIN_MM}" max="${WALL_MAX_MM}" step="0.1" value="${DEFAULT_PARAMS.WALL}"></label>
    </p>
    <div id="stage"></div>
    <p class="editor-actions">
      <button type="button" id="edit-paths" disabled>Modifica tracciati</button>
      <button type="button" id="restore-paths" disabled>Ripristina originale</button>
      <button type="button" id="submit-order">Invio</button>
      ${CUSTOMER_STL_DOWNLOAD ? `<button type="button" id="download-stl" disabled>${copy.buttons.generating}</button>` : ''}
    </p>
    <canvas id="path-editor" hidden></canvas>
    <div id="path-toolbar" hidden></div>
    <p id="preview-status" data-generation="0">Generazione…</p>
    <div class="preview-controls">
      <fieldset>
        <legend>Vista</legend>
        <label><input type="radio" name="mode" value="spenta"> Spenta</label>
        <label><input type="radio" name="mode" value="accesa" checked> Accesa</label>
        <label><input type="radio" name="mode" value="senza diffusore"> Senza diffusore</label>
      </fieldset>
      <fieldset>
        <legend>Effetto</legend>
        <label><input type="radio" name="effect" value="fisso" checked> Colore fisso</label>
        <label><input type="radio" name="effect" value="arcobaleno"> Arcobaleno</label>
      </fieldset>
      <label>Colore <input type="color" name="color" value="#ff2fd6"></label>
    </div>
  </section>
`;

const stage = document.querySelector<HTMLElement>('#stage')!;
const status = document.querySelector<HTMLElement>('#preview-status')!;
const editButton = document.querySelector<HTMLButtonElement>('#edit-paths')!;
const restoreButton = document.querySelector<HTMLButtonElement>('#restore-paths')!;
const submitButton = document.querySelector<HTMLButtonElement>('#submit-order')!;
const downloadButton = document.querySelector<HTMLButtonElement>('#download-stl');
const orderActions = document.querySelector<HTMLElement>('.editor-actions')!;
Object.assign(orderActions.style, {
  position: 'fixed',
  left: '0',
  right: '0',
  bottom: '0',
  zIndex: '5',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px',
  margin: '0',
  padding: '10px 12px',
  background: '#f7f4ee',
  boxShadow: '0 -1px 0 rgba(0,0,0,0.15)',
});
document.body.style.paddingBottom = '64px';
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
thresholdPreview.style.imageRendering = 'pixelated';
thresholdPreview.style.background = '#111';
thresholdPreview.style.maxWidth = '220px';

let svgMarkup: string | null = null;
let svgName = 'immagine.svg';

interface RasterSession {
  name: string;
  luminance: Uint8Array;
  width: number;
  height: number;
  warnings: string[];
}

let raster: RasterSession | null = null;

function imageMode(): boolean {
  return document.querySelector<HTMLInputElement>('input[name="sourceKind"][value="image"]')!.checked;
}

function traceMode(): TraceMode {
  return traceInput.value === 'outline' ? 'outline' : 'centerline';
}

function syncSourceFields(): void {
  const image = imageMode();
  const hasRaster = image && raster != null;
  const hasImage = image && (raster != null || svgMarkup != null);
  for (const el of document.querySelectorAll<HTMLElement>('[data-source]')) {
    const slot = el.dataset.source;
    const show =
      (slot === 'text' && !image) ||
      (slot === 'image' && image) ||
      (slot === 'trace' && hasImage) ||
      (slot === 'raster' && hasRaster);
    el.hidden = !show;
  }
}

function wallMm(): number {
  const n = Number(wallInput.value);
  if (!Number.isFinite(n)) return DEFAULT_PARAMS.WALL;
  return Math.min(WALL_MAX_MM, Math.max(WALL_MIN_MM, n));
}
const color = document.querySelector<HTMLInputElement>('input[name="color"]')!;

const scene = mountSignScene(stage);
const generator = createGenerator();
scene.setColor(color.value);
scene.setMode('accesa');
scene.setEffect('fisso');

let previewDiffuser = true;
for (const input of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    scene.setMode(input.value as PreviewMode);
    const next = input.value !== 'senza diffusore';
    if (next === previewDiffuser) return;
    previewDiffuser = next;
    void showSign();
  });
}
color.addEventListener('input', () => scene.setColor(color.value));
for (const input of document.querySelectorAll<HTMLInputElement>('input[name="effect"]')) {
  input.addEventListener('change', () => {
    if (input.checked) scene.setEffect(input.value === 'arcobaleno' ? 'arcobaleno' : 'fisso');
  });
}

const DISCARD = 'Cambiare testo, font o immagine scarta le modifiche ai tracciati. Continuare?';

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
  submitButton.disabled = liveBlocked || workerBlocked;
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
}

let readyStl: ReadyStl | null = null;

function clearStl(): void {
  readyStl = null;
  if (!downloadButton) return;
  downloadButton.disabled = true;
  downloadButton.textContent = copy.buttons.generating;
  delete downloadButton.dataset.ready;
}

/** Il risultato in volo non è più quello chiesto: non si pubblica la mesh vecchia. */
function invalidateStl(): void {
  request += 1;
  clearStl();
}

function saveStl(name: string, buffer: ArrayBuffer): void {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'model/stl' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
});

let request = 0;
async function showSign(): Promise<void> {
  const id = ++request;
  const epoch = editEpoch;
  clearStl();
  syncSourceFields();
  const heightMm = Number(heightInput.value);
  if (!(heightMm > 0)) {
    status.textContent = "Scrivi un'altezza.";
    return;
  }
  const image = imageMode();
  const text = textInput.value.trim();
  if (!image && !text) {
    status.textContent = "Scrivi un testo e un'altezza.";
    return;
  }
  if (image && !svgMarkup && !raster) {
    status.textContent = 'Carica un file SVG, PNG o JPG.';
    return;
  }
  let order: SignOrder;
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
      status.textContent = 'Nessun pixel di inchiostro con questa soglia.';
      return;
    }
    paintThresholdPreview(thresholdPreview, built.binary);
    notes = raster.warnings;
    order = {
      schemaVersion: ORDER_SCHEMA_VERSION,
      generatorVersion: GENERATOR_VERSION,
      source: built.source,
      heightMm,
      color: color.value,
      params: { WALL: wallMm() },
      paths: edited?.paths ?? null,
      crossings: edited?.crossings ?? [],
    };
  } else if (image && svgMarkup) {
    try {
      const imported = importSvg(svgMarkup, { heightMm, name: svgName, trace: traceMode() });
      notes = imported.warnings;
      order = {
        schemaVersion: ORDER_SCHEMA_VERSION,
        generatorVersion: GENERATOR_VERSION,
        source: imported.source,
        heightMm,
        color: color.value,
        params: { WALL: wallMm() },
        paths: edited?.paths ?? null,
        crossings: edited?.crossings ?? [],
      };
    } catch (err) {
      if (id !== request) return;
      status.textContent = err instanceof Error ? err.message : String(err);
      return;
    }
  } else {
    order = {
      schemaVersion: ORDER_SCHEMA_VERSION,
      generatorVersion: GENERATOR_VERSION,
      source: { kind: 'text', text, fontId: fontInput.value },
      heightMm,
      color: color.value,
      params: { WALL: wallMm() },
      paths: edited?.paths ?? null,
      crossings: edited?.crossings ?? [],
    };
  }
  status.textContent = 'Generazione…';
  const label = fileLabel();
  const withDiffuser = previewDiffuser;
  try {
    const result = await generator.generate(order);
    if (id !== request || epoch !== editEpoch) return;
    if (!edited) sourceSegments = result.segments;
    if (downloadButton && result.housingMesh) {
      readyStl = {
        housing: meshToStl(result.housingMesh, 'housing'),
        diffuser: meshToStl(result.diffuserMesh, 'diffuser'),
        label,
        heightMm,
        diffuserOn: withDiffuser,
      };
      downloadButton.disabled = false;
      downloadButton.textContent = copy.buttons.downloadCustomerStl;
      downloadButton.dataset.ready = stlFileName(label, heightMm, 'housing');
    }
    editButton.disabled = sourceSegments.length === 0 && !edited;
    scene.setSign({
      housing: result.housingMesh,
      diffuser: result.diffuserMesh,
      lights: result.lightPoints,
      ledGapMm: result.ledGapMm,
    });
    scene.setColor(color.value);
    status.dataset.generation = String(Number(status.dataset.generation ?? '0') + 1);
    workerBlocked = blocksSubmit(result.warnings);
    updateSubmit();
    const leds = result.lightPoints.length > 0 ? `${result.lightPoints.length} LED` : 'Nessun LED sulla striscia.';
    const shown = result.warnings.filter((warning) => {
      if (/bassa risoluzione|tratto non uniforme|^Puntino|^Trattino fuori/.test(warning)) return true;
      return image && warning.startsWith('Sagome che si fondono');
    });
    const extra = [...notes, ...shown].join(' ');
    status.textContent = extra ? `${leds} ${extra}` : leds;
  } catch (err) {
    if (id !== request) return;
    status.textContent = err instanceof Error ? err.message : String(err);
  }
}

let timer = 0;
const schedule = (): void => {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void showSign(), 350);
};
textInput.addEventListener('input', () => {
  if (!keepOrDrop(textInput.value !== sourceMemory.text)) return;
  invalidateStl();
  schedule();
});
fontInput.addEventListener('change', () => {
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
  void loadImage(file);
});
heightInput.addEventListener('change', () => {
  const next = Number(heightInput.value);
  if (edited && next > 0 && heightAtEdit > 0 && Math.abs(next - heightAtEdit) > 1e-9) {
    const factor = next / heightAtEdit;
    edited = {
      paths: scalePaths(edited.paths, factor),
      crossings: edited.crossings.map((crossing) => ({
        at: [Math.round(crossing.at[0] * factor * 1000) / 1000, Math.round(crossing.at[1] * factor * 1000) / 1000],
        under: crossing.under,
      })),
    };
    heightAtEdit = next;
    editor?.load(edited.paths, edited.crossings);
  } else if (next > 0) {
    heightAtEdit = next;
  }
  void showSign();
});
wallInput.addEventListener('input', schedule);
wallInput.addEventListener('change', () => {
  wallInput.value = wallMm().toFixed(1);
  void showSign();
});

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
  if (file.size > IMAGE_MAX_BYTES) {
    syncSourceFields();
    status.textContent = 'Il file supera 10 MB.';
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
    status.textContent = 'Carica un file SVG, PNG o JPG.';
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
    status.textContent = err instanceof Error ? err.message : String(err);
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

async function openEditor(): Promise<void> {
  if (sourceSegments.length === 0 && !edited) return;
  editButton.disabled = true;
  try {
  if (!editor) {
    const { openPathEditor } = await import('../editor/editor');
    editor = await openPathEditor({
      canvas: editorCanvas,
      toolbar: editorToolbar,
      getParams: () => resolveParams({ WALL: wallMm() }),
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

void showSign();
