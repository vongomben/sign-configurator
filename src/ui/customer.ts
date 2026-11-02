// Cliente: testo, font, altezza, colore e anteprima 3D (SPEC §1).
import { DEFAULT_PARAMS, GENERATOR_VERSION, ORDER_SCHEMA_VERSION } from '../config';
import { FONTS } from '../fonts/registry';
import type { SignOrder } from '../order/schema';
import type { TraceMode } from '../order/schema';
import { importRaster, paintThresholdPreview, rebuildRaster } from '../sources/rasterImport';
import { IMAGE_MAX_BYTES, importSvg } from '../sources/svgImport';
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
    <p id="preview-status">Generazione…</p>
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

for (const input of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
  input.addEventListener('change', () => {
    if (input.checked) scene.setMode(input.value as PreviewMode);
  });
}
color.addEventListener('input', () => scene.setColor(color.value));
for (const input of document.querySelectorAll<HTMLInputElement>('input[name="effect"]')) {
  input.addEventListener('change', () => {
    if (input.checked) scene.setEffect(input.value === 'arcobaleno' ? 'arcobaleno' : 'fisso');
  });
}

let request = 0;
async function showSign(): Promise<void> {
  const id = ++request;
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
      paths: null,
      crossings: [],
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
        paths: null,
        crossings: [],
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
      paths: null,
      crossings: [],
    };
  }
  status.textContent = 'Generazione…';
  try {
    const result = await generator.generate(order);
    if (id !== request) return;
    scene.setSign({
      housing: result.housingMesh,
      diffuser: result.diffuserMesh,
      lights: result.lightPoints,
      ledGapMm: result.ledGapMm,
    });
    scene.setColor(color.value);
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
textInput.addEventListener('input', schedule);
fontInput.addEventListener('change', () => void showSign());
for (const input of document.querySelectorAll<HTMLInputElement>('input[name="sourceKind"]')) {
  input.addEventListener('change', () => void showSign());
}
traceInput.addEventListener('change', () => void showSign());
thresholdInput.addEventListener('input', () => {
  thresholdValue.textContent = thresholdInput.value;
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
invertInput.addEventListener('change', () => void showSign());
imageInput.addEventListener('change', () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  void loadImage(file);
});
heightInput.addEventListener('change', () => void showSign());
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

void showSign();
