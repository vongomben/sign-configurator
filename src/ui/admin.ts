// Admin: taratura di intensità e alone. Il cliente resta sui default.
import { GENERATOR_VERSION, ORDER_SCHEMA_VERSION } from '../config';
import { DEFAULT_EXPOSURE, DEFAULT_HALO } from '../viewer/neonMaterial';
import { mountSignScene } from '../viewer/scene';
import { createGenerator } from '../worker/api';

const app = document.querySelector<HTMLElement>('#app')!;
app.innerHTML = `
  <h1>Admin</h1>
  <section class="preview">
    <div id="stage"></div>
    <p id="preview-status">Generazione…</p>
    <p class="preview-controls">
      <label>Intensità <input name="exposure" type="range" min="0.4" max="1.6" step="0.05" value="${DEFAULT_EXPOSURE}"></label>
      <label>Alone <input name="halo" type="range" min="0" max="0.55" step="0.01" value="${DEFAULT_HALO}"></label>
    </p>
  </section>
`;

const stage = document.querySelector<HTMLElement>('#stage')!;
const status = document.querySelector<HTMLElement>('#preview-status')!;
const exposure = document.querySelector<HTMLInputElement>('input[name="exposure"]')!;
const halo = document.querySelector<HTMLInputElement>('input[name="halo"]')!;
const scene = mountSignScene(stage);
scene.setExposure(Number(exposure.value));
scene.setHalo(Number(halo.value));
scene.setEffect('fisso');
exposure.addEventListener('input', () => scene.setExposure(Number(exposure.value)));
halo.addEventListener('input', () => scene.setHalo(Number(halo.value)));

const generator = createGenerator();
void generator
  .generate({
    schemaVersion: ORDER_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    source: { kind: 'text', text: 'Ciao', fontId: 'sacramento' },
    heightMm: 120,
    color: '#ff2fd6',
    params: {},
    paths: null,
    crossings: [],
  })
  .then((result) => {
    scene.setSign({
      housing: result.housingMesh,
      diffuser: result.diffuserMesh,
      lights: result.lightPoints,
      ledGapMm: result.ledGapMm,
    });
    scene.setExposure(Number(exposure.value));
    scene.setHalo(Number(halo.value));
    status.textContent = 'Taratura sull\'anteprima. Il cliente usa questi valori di partenza.';
  })
  .catch((err: unknown) => {
    status.textContent = err instanceof Error ? err.message : String(err);
  });
