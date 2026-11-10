// Admin: taratura di intensità e alone. Il cliente resta sui default.
// Lo stesso editor dei tracciati della pagina cliente (SPEC §5bis).
import { GENERATOR_VERSION, ORDER_SCHEMA_VERSION, resolveParams } from '../config';
import type { EditSegment } from '../editor/paths';
import type { PathEditor } from '../editor/editor';
import { DEFAULT_CUSTOMER, type OrderCrossing, type OrderPath, type SignOrderV4 } from '../order/schema';
import { DEFAULT_EXPOSURE, DEFAULT_HALO } from '../viewer/neonMaterial';
import { mountSignScene } from '../viewer/scene';
import { createGenerator } from '../worker/api';

const app = document.querySelector<HTMLElement>('#app')!;
app.innerHTML = `
  <h1>Admin</h1>
  <section class="preview">
    <div id="stage"></div>
    <p class="editor-actions">
      <button type="button" id="edit-paths" disabled>Modifica tracciati</button>
      <button type="button" id="restore-paths" disabled>Ripristina originale</button>
      <button type="button" id="submit-order">Invio</button>
    </p>
    <canvas id="path-editor" hidden></canvas>
    <div id="path-toolbar" hidden></div>
    <p id="preview-status" data-generation="0">Generazione…</p>
    <p class="preview-controls">
      <label>Intensità <input name="exposure" type="range" min="0.4" max="1.6" step="0.05" value="${DEFAULT_EXPOSURE}"></label>
      <label>Alone <input name="halo" type="range" min="0" max="0.55" step="0.01" value="${DEFAULT_HALO}"></label>
    </p>
  </section>
`;

const stage = document.querySelector<HTMLElement>('#stage')!;
const status = document.querySelector<HTMLElement>('#preview-status')!;
const editButton = document.querySelector<HTMLButtonElement>('#edit-paths')!;
const restoreButton = document.querySelector<HTMLButtonElement>('#restore-paths')!;
const submitButton = document.querySelector<HTMLButtonElement>('#submit-order')!;
const editorCanvas = document.querySelector<HTMLCanvasElement>('#path-editor')!;
const editorToolbar = document.querySelector<HTMLElement>('#path-toolbar')!;
const exposure = document.querySelector<HTMLInputElement>('input[name="exposure"]')!;
const halo = document.querySelector<HTMLInputElement>('input[name="halo"]')!;
const scene = mountSignScene(stage);
scene.setExposure(Number(exposure.value));
scene.setHalo(Number(halo.value));
scene.setEffect('fisso');
exposure.addEventListener('input', () => scene.setExposure(Number(exposure.value)));
halo.addEventListener('input', () => scene.setHalo(Number(halo.value)));

const generator = createGenerator();
const baseOrder = {
  schemaVersion: ORDER_SCHEMA_VERSION,
  generatorVersion: GENERATOR_VERSION,
  pricingVersion: null,
  source: { kind: 'text' as const, text: 'Ciao', fontId: 'sacramento' },
  heightMm: 120,
  sizePreset: 'M' as const,
  color: '#ff2fd6',
  params: {},
  customer: { ...DEFAULT_CUSTOMER },
  plate: null,
};

let edited: { paths: OrderPath[]; crossings: OrderCrossing[] } | null = null;
let sourceSegments: EditSegment[] = [];
let editor: PathEditor | null = null;
let liveBlocked = false;
let workerBlocked = false;
let editEpoch = 0;
let timer = 0;

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

function orderOf(): SignOrderV4 {
  return {
    ...baseOrder,
    paths: edited?.paths ?? null,
    crossings: edited?.crossings ?? [],
  };
}

async function showSign(): Promise<void> {
  const epoch = editEpoch;
  try {
    const result = await generator.generate(orderOf());
    if (epoch !== editEpoch) return;
    if (!edited) sourceSegments = result.segments;
    editButton.disabled = sourceSegments.length === 0 && edited == null;
    scene.setSign({
      housing: result.housingMesh,
      diffuser: result.diffuserMesh,
      lights: result.lightPoints,
      ledGapMm: result.ledGapMm,
    });
    scene.setExposure(Number(exposure.value));
    scene.setHalo(Number(halo.value));
    status.dataset.generation = String(Number(status.dataset.generation ?? '0') + 1);
    workerBlocked = blocksSubmit(result.warnings);
    updateSubmit();
    status.textContent = 'Taratura sull\'anteprima. Il cliente usa questi valori di partenza.';
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : String(err);
  }
}

editButton.addEventListener('click', () => void openEditor());
restoreButton.addEventListener('click', () => {
  if (!edited) return;
  edited = null;
  editor?.close();
  editor = null;
  liveBlocked = false;
  restoreButton.disabled = true;
  updateSubmit();
  void showSign();
});
submitButton.addEventListener('click', () => {
  if (submitButton.disabled) return;
  status.dataset.sent = 'true';
});

async function openEditor(): Promise<void> {
  if (sourceSegments.length === 0 && !edited) return;
  editButton.disabled = true;
  if (!editor) {
    const { openPathEditor } = await import('../editor/editor');
    editor = await openPathEditor({
      canvas: editorCanvas,
      toolbar: editorToolbar,
      getParams: () => resolveParams({}),
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
  if (!edited) edited = { paths: editor.freeze(sourceSegments), crossings: [] };
  editor.load(edited.paths, edited.crossings);
  restoreButton.disabled = false;
  editButton.disabled = false;
  editEpoch += 1;
  void showSign();
}

void showSign();
