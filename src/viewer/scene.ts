// Anteprima three.js, indipendente dal tipo di LED (SPEC §5). I lightPoints arrivano
// dalla pipeline: oggi la striscia COB, domani un pixel a passo libero.
import {
  ACESFilmicToneMapping,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  HalfFloatType,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  MOUSE,
  OrthographicCamera,
  PerspectiveCamera,
  Points,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { StlMesh } from '../export/stl';
import type { LightPoint } from '../geometry/lights';
import type { PlateMaterial } from '../geometry/plate';
import {
  createDiffuserGlowMaterial,
  createEmitterMaterial,
  createSplatMaterial,
  createWallGlowMaterial,
  BLOOM_THRESHOLD,
  DEFAULT_EXPOSURE,
  DEFAULT_HALO,
  WALL_GLOW_GAIN,
  GAUSSIAN_RADIUS_SIGMA,
  parseHexColor,
} from './neonMaterial';

export type PreviewMode = 'spenta' | 'accesa' | 'senza diffusore';

export interface SignViewData {
  housing: StlMesh;
  diffuser: StlMesh;
  lights: readonly LightPoint[];
  /** Distanza LED–diffusore, mm. Larghezza della gaussiana. */
  ledGapMm: number;
  /** Fondale dietro l'housing (SPEC §13), con il suo materiale. Assente: nessun fondale. */
  plate?: { mesh: StlMesh; material: PlateMaterial } | null;
  /** Tagli per il piatto di stampa (SPEC §14): segmenti verticali a x costante, sopra l'insegna. */
  cuts?: readonly { x: number; y0: number; y1: number; z: number }[];
}

export interface SignScene {
  setSign(sign: SignViewData): void;
  setMode(mode: PreviewMode): void;
  setColor(hex: string): void;
  /** colore fisso usa il selettore; arcobaleno scorre e si ferma con prefers-reduced-motion. */
  setEffect(effect: 'fisso' | 'arcobaleno'): void;
  /** Esposizione ACES. Il cliente resta sul default. */
  setExposure(value: number): void;
  /** Raggio dell'alone. La soglia del bloom non scende. */
  setHalo(radius: number): void;
  dispose(): void;
}

const FRONT_LIMIT = (40 * Math.PI) / 180;
/** Oltre quest'angolo fra due facce lo spigolo resta vivo nell'ombreggiatura. */
const CREASE_ANGLE = (35 * Math.PI) / 180;
const WALL = 0xe6e0d6;

function cssHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function coarsePointer(): boolean {
  return window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(max-width: 720px)').matches;
}

function geometryOf(mesh: StlMesh): BufferGeometry {
  const count = Math.floor(mesh.vertProperties.length / mesh.numProp);
  const positions = new Float32Array(count * 3);
  for (let i = 0, j = 0; i < count; i++, j += 3) {
    const base = i * mesh.numProp;
    positions[j] = mesh.vertProperties[base]!;
    positions[j + 1] = mesh.vertProperties[base + 1]!;
    positions[j + 2] = mesh.vertProperties[base + 2]!;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(mesh.triVerts, 1));
  // Normali a spigolo: le pareti curve restano morbide, le facce piane (cima del diffusore, bordo,
  // lastra) restano piane invece di sfumare a ventaglio verso i vertici condivisi con le pareti.
  const creased = toCreasedNormals(geometry, CREASE_ANGLE);
  geometry.dispose();
  return creased;
}

export function mountSignScene(host: HTMLElement, options?: { background?: number }): SignScene {
  const mobile = coarsePointer();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const backdrop = options?.background ?? WALL;

  host.replaceChildren();
  host.style.position = 'relative';
  host.style.minHeight = '70vh';
  host.style.background = cssHex(backdrop);
  host.style.overflow = 'hidden';

  const renderer = new WebGLRenderer({ antialias: !mobile, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1 : 1.5));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = DEFAULT_EXPOSURE;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '70vh';
  renderer.domElement.style.touchAction = 'none';
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(backdrop);

  const daylight = new HemisphereLight(0xfff6ea, 0xc9c2b6, 0.85);
  const sun = new DirectionalLight(0xfffaf3, 1.15);
  sun.position.set(0.4, 0.8, 1);
  scene.add(daylight, sun);

  const wall = new Mesh(new BufferGeometry());
  scene.add(wall);

  const camera = new PerspectiveCamera(38, 1, 0.1, 8000);
  camera.position.set(0, 0, 400);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.zoomSpeed = 0.6;
  controls.rotateSpeed = 0.45;
  controls.mouseButtons.LEFT = MOUSE.ROTATE;
  controls.maxPolarAngle = Math.PI / 2 + FRONT_LIMIT;
  controls.minPolarAngle = Math.PI / 2 - FRONT_LIMIT;

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  const bloomScale = mobile ? 0.5 : 1;
  const bloom = new UnrealBloomPass(new Vector2(256, 256), DEFAULT_HALO * 0.35, DEFAULT_HALO, BLOOM_THRESHOLD);
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const housingMaterial = new MeshStandardMaterial({
    color: 0x141414,
    roughness: 0.78,
    metalness: 0.12,
    side: DoubleSide,
  });
  const diffuserOff = new MeshStandardMaterial({ color: 0xf7f4ef, roughness: 0.94, metalness: 0, side: DoubleSide });
  // Fondale: plexi nero trasparente (fumé lucido, si vede il muro dietro) o legno opaco.
  const plateMaterials: Record<PlateMaterial, MeshStandardMaterial> = {
    // Plexi trasparente: quasi invisibile, lucido; si vedono fori e fili dietro.
    clear: new MeshStandardMaterial({
      color: 0xc8d4de,
      roughness: 0.04,
      metalness: 0.25,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      side: DoubleSide,
      emissive: 0xffffff,
    }),
    // Plexi nero trasparente (fumé).
    black: new MeshStandardMaterial({
      // Sullo sfondo nero del cliente un nero pieno sparirebbe: un grigio fumé lucido lo stacca.
      color: 0x3a3a48,
      roughness: 0.16,
      metalness: 0.4,
      transparent: true,
      opacity: 0.8,
      // Il bagliore del neon sulla lastra: il plexi lucido lo riflette, un po' smorzato.
      emissive: 0xb4b4c8,
      depthWrite: false,
      side: DoubleSide,
    }),
    // Il legno opaco diffonde il bagliore in caldo.
    wood: new MeshStandardMaterial({ color: 0xa2713f, roughness: 0.82, metalness: 0, side: DoubleSide, emissive: 0xffd2a0 }),
  };

  const glowTarget = new WebGLRenderTarget(128, 128, { type: HalfFloatType, depthBuffer: false });
  glowTarget.texture.generateMipmaps = false;
  const glowScene = new Scene();
  const glowCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  glowCamera.position.set(0, 0, 80);
  const splatMaterial = createSplatMaterial();
  const ledGeometry = new BufferGeometry();
  const splat = new Points(ledGeometry, splatMaterial);
  splat.frustumCulled = false;
  glowScene.add(splat);
  const glowMaterial = createDiffuserGlowMaterial(glowTarget.texture);
  // La lastra sta davanti al muro e ne coprirebbe il bagliore: lo riceve lei, dalla stessa texture.
  for (const material of Object.values(plateMaterials)) {
    material.emissiveMap = glowTarget.texture;
    material.emissiveIntensity = 0;
  }
  const wallMaterial = createWallGlowMaterial(glowTarget.texture, new Color(backdrop));
  wall.material = wallMaterial;
  const emitterMaterial = createEmitterMaterial();
  const emitters = new Points(ledGeometry, emitterMaterial);
  emitters.frustumCulled = false;
  emitters.visible = false;
  scene.add(emitters);

  let housingMesh: Mesh | null = null;
  let diffuserMesh: Mesh | null = null;
  let plateMesh: Mesh | null = null;
  let cutLines: LineSegments | null = null;
  const cutMaterial = new LineDashedMaterial({ color: 0xffffff, dashSize: 4, gapSize: 3, depthTest: false, transparent: true, opacity: 0.9 });
  let lights: readonly LightPoint[] = [];
  let ledGap = 6;
  let mode: PreviewMode = 'accesa';
  let rainbowAsked = false;
  let haloRadius = DEFAULT_HALO;
  const baseColor = new Color('#ff2fd6');
  const scratch = new Color();
  let maxIndex = new Map<number, number>();

  const rainbowOn = (): boolean => rainbowAsked;

  // Dichiarati prima di resize(): l'observer chiama resize subito, a insegna ancora assente.
  let viewBox: Box3 | null = null;

  const fitDistance = (size: Vector3): number => {
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const aspect = Math.max(camera.aspect, 0.2);
    const distForHeight = Math.max(size.y, 1) / 2 / tan;
    const distForWidth = Math.max(size.x, 1) / 2 / (tan * aspect);
    return Math.max(distForHeight, distForWidth, 40) * 1.28;
  };

  const aimCamera = (box: Box3, resetAngle: boolean): void => {
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const distance = fitDistance(size);
    controls.target.copy(center);
    if (resetAngle) {
      controls.minAzimuthAngle = -Infinity;
      controls.maxAzimuthAngle = Infinity;
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = Math.PI;
      camera.position.set(center.x, center.y, center.z + distance);
    } else {
      const offset = new Vector3().subVectors(camera.position, center);
      if (offset.lengthSq() < 1) offset.set(0, 0, 1);
      offset.setLength(distance);
      camera.position.copy(center).add(offset);
    }
    camera.near = Math.max(0.1, distance / 200);
    camera.far = Math.max(distance * 30, 100);
    camera.updateProjectionMatrix();
    controls.update();
    if (!resetAngle) return;
    const azimuth = controls.getAzimuthalAngle();
    const polar = controls.getPolarAngle();
    controls.minAzimuthAngle = azimuth - FRONT_LIMIT;
    controls.maxAzimuthAngle = azimuth + FRONT_LIMIT;
    controls.minPolarAngle = Math.max(0.05, polar - FRONT_LIMIT);
    controls.maxPolarAngle = Math.min(Math.PI - 0.05, polar + FRONT_LIMIT);
  };

  const frame = (box: Box3): void => {
    viewBox = box.clone();
    aimCamera(box, true);

    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const span = Math.max(size.x, size.y, 40);
    wall.geometry.dispose();
    const plane = new BufferGeometry();
    const z = box.min.z - 12;
    const w = span * 4;
    const positions = new Float32Array([
      center.x - w, center.y - w, z,
      center.x + w, center.y - w, z,
      center.x + w, center.y + w, z,
      center.x - w, center.y - w, z,
      center.x + w, center.y + w, z,
      center.x - w, center.y + w, z,
    ]);
    plane.setAttribute('position', new BufferAttribute(positions, 3));
    plane.computeVertexNormals();
    wall.geometry = plane;
  };

  const resize = (): void => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, Math.round(host.clientHeight || window.innerHeight * 0.7));
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    bloom.setSize(Math.max(1, Math.floor(width * bloomScale)), Math.max(1, Math.floor(height * bloomScale)));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (viewBox) aimCamera(viewBox, false);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  const applyMode = (): void => {
    const on = mode === 'accesa';
    const open = mode === 'senza diffusore';
    if (diffuserMesh) {
      diffuserMesh.visible = !open;
      diffuserMesh.material = on ? glowMaterial : diffuserOff;
    }
    emitters.visible = open && lights.length > 0;
    // Con un fondale la stanza resta un po' più chiara, altrimenti la lastra sparisce nel nero.
    const room = plateMesh ? 3 : 1;
    daylight.intensity = on || open ? 0.22 * room : 0.9;
    sun.intensity = on || open ? 0.28 * room : 1.15;
    bloom.threshold = BLOOM_THRESHOLD;
    bloom.radius = haloRadius;
    bloom.strength = on || open ? haloRadius * 0.35 : 0;
    const spread = DEFAULT_HALO > 0 ? haloRadius / DEFAULT_HALO : 0;
    wallMaterial.uniforms.uGain!.value = on ? WALL_GLOW_GAIN * spread : 0;
    const plateGlow = on ? WALL_GLOW_GAIN * spread : 0;
    plateMaterials.wood.emissiveIntensity = plateGlow * 0.9;
    plateMaterials.black.emissiveIntensity = plateGlow * 0.85;
    plateMaterials.clear.emissiveIntensity = plateGlow * 0.5;
    bloom.enabled = on || open;
  };

  const layoutGlow = (box: Box3): void => {
    const span = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, 10);
    const pad = Math.max(ledGap * GAUSSIAN_RADIUS_SIGMA, 8);
    const minX = box.min.x - pad;
    const maxX = box.max.x + pad;
    const minY = box.min.y - pad;
    const maxY = box.max.y + pad;
    const worldW = Math.max(maxX - minX, 1);
    const worldH = Math.max(maxY - minY, 1);
    const cap = mobile ? 256 : 512;
    const scale = Math.min(cap / worldW, cap / worldH, mobile ? 2 : 4);
    const texW = Math.max(32, Math.round(worldW * scale));
    const texH = Math.max(32, Math.round(worldH * scale));
    glowTarget.setSize(texW, texH);
    glowCamera.left = minX;
    glowCamera.right = maxX;
    glowCamera.top = maxY;
    glowCamera.bottom = minY;
    glowCamera.updateProjectionMatrix();
    const pixelsPerMm = texH / worldH;
    splatMaterial.uniforms.uPointSize!.value = ledGap * GAUSSIAN_RADIUS_SIGMA * 2 * pixelsPerMm;
    glowMaterial.uniforms.uOrigin!.value.set(minX, minY);
    glowMaterial.uniforms.uSpan!.value.set(worldW, worldH);
    wallMaterial.uniforms.uOrigin!.value.set(minX, minY);
    wallMaterial.uniforms.uSpan!.value.set(worldW, worldH);
    emitterMaterial.uniforms.uPointSize!.value = Math.max(6, 2.2 * pixelsPerMm);
    void span;
  };

  /** Coordinate della texture del bagliore sulla lastra: le stesse del muro, dal piano XY. */
  const plateGlowUv = (geometry: BufferGeometry): void => {
    const origin = wallMaterial.uniforms.uOrigin!.value as Vector2;
    const span = wallMaterial.uniforms.uSpan!.value as Vector2;
    const pos = geometry.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = (pos.getX(i) - origin.x) / span.x;
      uv[i * 2 + 1] = (pos.getY(i) - origin.y) / span.y;
    }
    geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  };

  const paintColors = (time: number): void => {
    const attr = splat.geometry.getAttribute('ledColor') as BufferAttribute | undefined;
    if (!attr) return;
    const data = attr.array as Float32Array;
    const rainbow = rainbowOn();
    const shift = rainbow && !reducedMotion.matches ? (time * 0.00008) % 1 : 0;
    for (let i = 0; i < lights.length; i++) {
      const light = lights[i]!;
      if (rainbow) {
        const span = Math.max(1, maxIndex.get(light.segment) ?? 1);
        scratch.setHSL((light.index / span + shift) % 1, 0.9, 0.58);
      } else {
        scratch.copy(baseColor);
      }
      data[i * 3] = scratch.r;
      data[i * 3 + 1] = scratch.g;
      data[i * 3 + 2] = scratch.b;
    }
    attr.needsUpdate = true;
  };

  const renderGlow = (): void => {
    if (lights.length === 0) return;
    const previous = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(glowTarget);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(glowScene, glowCamera);
    renderer.setRenderTarget(previous);
    renderer.autoClear = autoClear;
  };

  const setLights = (next: readonly LightPoint[]): void => {
    lights = next;
    maxIndex = new Map();
    for (const light of next) maxIndex.set(light.segment, Math.max(maxIndex.get(light.segment) ?? 0, light.index));
    const positions = new Float32Array(next.length * 3);
    const colors = new Float32Array(next.length * 3);
    for (let i = 0; i < next.length; i++) {
      const light = next[i]!;
      positions[i * 3] = light.pos[0];
      positions[i * 3 + 1] = light.pos[1];
      positions[i * 3 + 2] = light.pos[2];
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('ledColor', new BufferAttribute(colors, 3));
    splat.geometry.dispose();
    splat.geometry = geometry;
    emitters.geometry = geometry;
    paintColors(0);
  };

  let disposed = false;
  renderer.setAnimationLoop((time) => {
    if (disposed) return;
    controls.update();
    const glowing = mode !== 'spenta';
    if (glowing && rainbowOn() && !reducedMotion.matches) paintColors(time);
    if (mode === 'accesa') renderGlow();
    if (glowing) composer.render();
    else renderer.render(scene, camera);
  });

  const onMotion = (): void => {
    paintColors(0);
    if (mode === 'accesa') renderGlow();
  };
  reducedMotion.addEventListener('change', onMotion);

  return {
    setSign(sign: SignViewData): void {
      housingMesh?.geometry.dispose();
      diffuserMesh?.geometry.dispose();
      if (housingMesh) scene.remove(housingMesh);
      if (diffuserMesh) scene.remove(diffuserMesh);
      if (plateMesh) {
        scene.remove(plateMesh);
        plateMesh.geometry.dispose();
        plateMesh = null;
      }
      if (cutLines) {
        scene.remove(cutLines);
        cutLines.geometry.dispose();
        cutLines = null;
      }
      if (sign.cuts && sign.cuts.length > 0) {
        const positions = new Float32Array(sign.cuts.length * 6);
        sign.cuts.forEach((cut, i) => positions.set([cut.x, cut.y0, cut.z, cut.x, cut.y1, cut.z], i * 6));
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(positions, 3));
        cutLines = new LineSegments(geometry, cutMaterial);
        cutLines.computeLineDistances();
        cutLines.renderOrder = 10;
        scene.add(cutLines);
      }
      ledGap = Math.max(0.4, sign.ledGapMm);
      housingMesh = new Mesh(geometryOf(sign.housing), housingMaterial);
      diffuserMesh = new Mesh(geometryOf(sign.diffuser), diffuserOff);
      scene.add(housingMesh, diffuserMesh);
      if (sign.plate) {
        // Facce piane: normali per faccia, altrimenti la faccia grande si sfuma verso i bordi e
        // mostra i triangoli lunghi della triangolazione.
        plateMesh = new Mesh(geometryOf(sign.plate.mesh), plateMaterials[sign.plate.material]);
        plateMesh.renderOrder = -1;
        scene.add(plateMesh);
      }
      setLights(sign.lights);
      const box = new Box3().setFromObject(housingMesh);
      if (box.isEmpty()) box.set(new Vector3(-10, -10, 0), new Vector3(10, 10, 12));
      layoutGlow(box);
      if (plateMesh) plateGlowUv(plateMesh.geometry);
      // L'inquadratura comprende il fondale; il bagliore resta calcolato sull'insegna.
      const view = plateMesh ? box.clone().union(new Box3().setFromObject(plateMesh)) : box;
      frame(view);
      applyMode();
      paintColors(0);
      renderGlow();
    },
    setMode(next: PreviewMode): void {
      mode = next;
      applyMode();
    },
    setColor(hex: string): void {
      parseHexColor(hex, baseColor);
      paintColors(0);
      if (mode === 'accesa') renderGlow();
    },
    setEffect(effect: 'fisso' | 'arcobaleno'): void {
      rainbowAsked = effect === 'arcobaleno';
      paintColors(reducedMotion.matches ? 0 : performance.now());
      if (mode === 'accesa') renderGlow();
    },
    setExposure(value: number): void {
      renderer.toneMappingExposure = Math.min(1.8, Math.max(0.2, value));
    },
    setHalo(radius: number): void {
      haloRadius = Math.min(0.6, Math.max(0, radius));
      applyMode();
    },
    dispose(): void {
      disposed = true;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      reducedMotion.removeEventListener('change', onMotion);
      controls.dispose();
      housingMesh?.geometry.dispose();
      diffuserMesh?.geometry.dispose();
      plateMesh?.geometry.dispose();
      cutLines?.geometry.dispose();
      cutMaterial.dispose();
      splat.geometry.dispose();
      housingMaterial.dispose();
      diffuserOff.dispose();
      plateMaterials.clear.dispose();
      plateMaterials.black.dispose();
      plateMaterials.wood.dispose();
      splatMaterial.dispose();
      glowMaterial.dispose();
      wallMaterial.dispose();
      emitterMaterial.dispose();
      glowTarget.dispose();
      composer.dispose();
      renderer.dispose();
      host.replaceChildren();
    },
  };
}

export type { LightPoint };
