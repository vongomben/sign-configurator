// Pezzi di prova per misurare HINGE_MAX_DEG e R_MIN reali della striscia (SPEC §2, §10).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEFAULT_PARAMS, type EdgeProfile } from '../config';
import { meshToStl, type StlMesh } from '../export/stl';
import {
  buildBendTest,
  type BendTestKind,
  type BendTestParams,
  type BendTestResult,
} from './bendTestGeometry';

const BED_WARN_MM = 250;
/** Distanza fra A e B nell'anteprima (non negli STL, che restano separati). */
const PREVIEW_GAP = 20;
const PARAM_KEYS = [
  'CHANNEL_W',
  'CHANNEL_DEPTH',
  'WALL',
  'FLOOR',
  'STRIP_W',
  'STRIP_T',
  'BANK_TRANSITION_L',
  'HINGE_PITCH',
  'WIRE_SLOT_W',
  'WIRE_SLOT_L',
  'SLOT_LIP_CHAMFER',
  'CHAMFER_SIZE',
  'CHAMFER_ANGLE',
  'LAYER_STEP',
] as const satisfies readonly (keyof BendTestParams)[];
const PIECES: readonly { kind: BendTestKind; label: string; file: string }[] = [
  { kind: 'arcs', label: 'A (archi)', file: 'bend-test-A-archi' },
  { kind: 'corners', label: 'B (angoli)', file: 'bend-test-B-angoli' },
  { kind: 'bank', label: 'D (inclinazione)', file: 'bend-test-D-inclinazione' },
  { kind: 'joints', label: 'E (giunti)', file: 'bend-test-E-giunti' },
];

const form = document.querySelector<HTMLFormElement>('#controls')!;
const report = document.querySelector<HTMLPreElement>('#report')!;
const viewerEl = document.querySelector<HTMLDivElement>('#viewer')!;
const downloadBtns: Record<BendTestKind, HTMLButtonElement> = {
  arcs: document.querySelector<HTMLButtonElement>('#download-arcs')!,
  corners: document.querySelector<HTMLButtonElement>('#download-corners')!,
  bank: document.querySelector<HTMLButtonElement>('#download-bank')!,
  joints: document.querySelector<HTMLButtonElement>('#download-joints')!,
};

const input = (name: string): HTMLInputElement => form.elements.namedItem(name) as HTMLInputElement;
for (const key of PARAM_KEYS) input(key).value = String(DEFAULT_PARAMS[key]);
const profileSelect = form.elements.namedItem('EDGE_PROFILE') as HTMLSelectElement;
profileSelect.value = DEFAULT_PARAMS.EDGE_PROFILE;
const variantsBox = input('variants');
variantsBox.addEventListener('change', () => {
  input('CHANNEL_W').disabled = variantsBox.checked;
});

function createPreview(container: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  // Fuori dal flusso: la canvas non deve cambiare la dimensione osservata dal ResizeObserver.
  Object.assign(renderer.domElement.style, { position: 'absolute', inset: '0', display: 'block' });
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1d1f24);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-1, -2, 3);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.zoomToCursor = true;

  const material = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.6, flatShading: true });
  const content = new THREE.Group();
  scene.add(content);
  let grid: THREE.GridHelper | undefined;

  const resize = (): void => {
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(container);
  resize();
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  const toGeometry = (data: StlMesh): THREE.BufferGeometry => {
    const positions = new Float32Array((data.vertProperties.length / data.numProp) * 3);
    for (let i = 0, j = 0; j < positions.length; i += data.numProp, j += 3) {
      positions[j] = data.vertProperties[i]!;
      positions[j + 1] = data.vertProperties[i + 1]!;
      positions[j + 2] = data.vertProperties[i + 2]!;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.triVerts, 1));
    geometry.computeBoundingBox();
    return geometry;
  };

  return {
    /** Mostra i pezzi affiancati lungo X, allineati in basso. */
    show(meshes: readonly StlMesh[]): void {
      for (const child of [...content.children]) {
        content.remove(child);
        (child as THREE.Mesh).geometry.dispose();
      }
      let x = 0;
      for (const data of meshes) {
        const geometry = toGeometry(data);
        const box = geometry.boundingBox!;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x - box.min.x, -box.min.y, 0);
        content.add(mesh);
        x += box.max.x - box.min.x + PREVIEW_GAP;
      }

      const box = new THREE.Box3().setFromObject(content);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const span = Math.max(size.x, size.y);
      if (grid) {
        scene.remove(grid);
        grid.dispose();
      }
      const gridSize = Math.ceil(span / 10) * 10 + 20;
      grid = new THREE.GridHelper(gridSize, gridSize / 10, 0x555a66, 0x2f333b);
      grid.rotation.x = Math.PI / 2;
      grid.position.set(center.x, center.y, -0.01);
      scene.add(grid);

      controls.target.copy(center);
      camera.position.set(center.x, center.y - span * 0.8, center.z + span * 0.9);
      camera.near = span / 100;
      camera.far = span * 20;
      camera.updateProjectionMatrix();
    },
  };
}

const preview = createPreview(viewerEl);
const stls: Partial<Record<BendTestKind, { buffer: ArrayBuffer; name: string }>> = {};

function readParams(): Partial<BendTestParams> {
  const params: Partial<BendTestParams> = {};
  for (const key of PARAM_KEYS) {
    const value = input(key).valueAsNumber;
    const min = key === 'SLOT_LIP_CHAMFER' || key === 'BANK_TRANSITION_L' ? 0 : Number.MIN_VALUE;
    if (Number.isFinite(value) && value >= min) params[key] = value;
  }
  params.EDGE_PROFILE = profileSelect.value as EdgeProfile;
  return params;
}

function describe(label: string, result: BendTestResult, mesh: StlMesh): string[] {
  const { min, max } = result.bounds;
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const lines = [
    `— Pezzo ${label}`,
    `manifold.status(): ${result.status}`,
    `Ingombro: ${size.map((s) => s.toFixed(1)).join(' × ')} mm · ${mesh.triVerts.length / 3} triangoli`,
    `Lunghezza percorso: ${result.pathLength.toFixed(1)} mm`,
    ...result.pieces.map(
      (p) =>
        `W ${p.channelW.toFixed(2)} · tacche ${p.notches} · fori passanti ${p.genus}/${result.expectedHoles}` +
        (p.offsetY ? ` · Y +${p.offsetY.toFixed(1)}` : ''),
    ),
  ];
  if (Math.max(size[0]!, size[1]!) > BED_WARN_MM) {
    lines.push(`Attenzione: supera ${BED_WARN_MM} mm, separa gli oggetti nello slicer.`);
  }
  return lines;
}

async function generate(): Promise<void> {
  report.classList.remove('error');
  report.textContent = 'Generazione…';
  for (const kind of Object.keys(downloadBtns) as BendTestKind[]) {
    downloadBtns[kind].disabled = true;
    delete stls[kind];
  }

  const variants = variantsBox.checked;
  const params = readParams();
  const t0 = performance.now();
  const lines: string[] = [];
  const meshes: StlMesh[] = [];
  let ok = true;

  for (const [i, piece] of PIECES.entries()) {
    const result = await buildBendTest({ kind: piece.kind, params, variants });
    try {
      const mesh = result.manifold.getMesh();
      meshes.push(mesh);
      if (i === 0) {
        const c = result.chamfer;
        lines.push(
          c.height > 0
            ? `Bordi: ${c.profile}, smusso ${c.height.toFixed(2)} × ${c.run.toFixed(2)} mm (alto × largo)`
            : 'Bordi: square',
          ...c.warnings.map((w) => `Avviso: ${w}`),
        );
      }
      lines.push(...describe(piece.label, result, mesh));
      ok &&= result.status === 'NoError' && result.pieces.every((p) => p.genus === result.expectedHoles);
      if (result.status === 'NoError') {
        const widths = result.pieces.map((p) => p.channelW.toFixed(1)).join('-');
        stls[piece.kind] = { buffer: meshToStl(mesh), name: `${piece.file}_W${widths}.stl` };
        downloadBtns[piece.kind].disabled = false;
      }
    } finally {
      result.manifold.delete();
    }
  }

  lines.push(`(${(performance.now() - t0).toFixed(0)} ms)`);
  report.textContent = lines.join('\n');
  report.classList.toggle('error', !ok);
  preview.show(meshes);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  generate().catch((err: unknown) => {
    report.classList.add('error');
    report.textContent = `Errore: ${err instanceof Error ? err.message : String(err)}`;
  });
});

for (const [kind, btn] of Object.entries(downloadBtns) as [BendTestKind, HTMLButtonElement][]) {
  btn.addEventListener('click', () => {
    const stl = stls[kind];
    if (!stl) return;
    const url = URL.createObjectURL(new Blob([stl.buffer], { type: 'model/stl' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = stl.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

form.requestSubmit();
