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
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { StlMesh } from '../export/stl';
import type { LightPoint } from '../geometry/lights';
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
const WALL = 0xe6e0d6;

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
  geometry.computeVertexNormals();
  return geometry;
}

export function mountSignScene(host: HTMLElement): SignScene {
  const mobile = coarsePointer();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  host.replaceChildren();
  host.style.position = 'relative';
  host.style.minHeight = '70vh';
  host.style.background = '#e6e0d6';
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
  scene.background = new Color(WALL);

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
  const wallMaterial = createWallGlowMaterial(glowTarget.texture, new Color(WALL));
  wall.material = wallMaterial;
  const emitterMaterial = createEmitterMaterial();
  const emitters = new Points(ledGeometry, emitterMaterial);
  emitters.frustumCulled = false;
  emitters.visible = false;
  scene.add(emitters);

  let housingMesh: Mesh | null = null;
  let diffuserMesh: Mesh | null = null;
  let lights: readonly LightPoint[] = [];
  let ledGap = 6;
  let mode: PreviewMode = 'accesa';
  let rainbowAsked = false;
  let haloRadius = DEFAULT_HALO;
  const baseColor = new Color('#ff2fd6');
  const scratch = new Color();
  let maxIndex = new Map<number, number>();

  const rainbowOn = (): boolean => rainbowAsked;

  const resize = (): void => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, Math.round(host.clientHeight || window.innerHeight * 0.7));
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    bloom.setSize(Math.max(1, Math.floor(width * bloomScale)), Math.max(1, Math.floor(height * bloomScale)));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
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
    daylight.intensity = on || open ? 0.22 : 0.9;
    sun.intensity = on || open ? 0.28 : 1.15;
    bloom.threshold = BLOOM_THRESHOLD;
    bloom.radius = haloRadius;
    bloom.strength = on || open ? haloRadius * 0.35 : 0;
    const spread = DEFAULT_HALO > 0 ? haloRadius / DEFAULT_HALO : 0;
    wallMaterial.uniforms.uGain!.value = on ? WALL_GLOW_GAIN * spread : 0;
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

  const frame = (box: Box3): void => {
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const span = Math.max(size.x, size.y, 40);
    controls.minAzimuthAngle = -Infinity;
    controls.maxAzimuthAngle = Infinity;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
    controls.target.copy(center);
    camera.position.set(center.x, center.y, center.z + span * 1.35);
    camera.near = Math.max(0.1, span / 200);
    camera.far = span * 30;
    camera.updateProjectionMatrix();
    controls.update();
    const azimuth = controls.getAzimuthalAngle();
    const polar = controls.getPolarAngle();
    controls.minAzimuthAngle = azimuth - FRONT_LIMIT;
    controls.maxAzimuthAngle = azimuth + FRONT_LIMIT;
    controls.minPolarAngle = Math.max(0.05, polar - FRONT_LIMIT);
    controls.maxPolarAngle = Math.min(Math.PI - 0.05, polar + FRONT_LIMIT);

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
      ledGap = Math.max(0.4, sign.ledGapMm);
      housingMesh = new Mesh(geometryOf(sign.housing), housingMaterial);
      diffuserMesh = new Mesh(geometryOf(sign.diffuser), diffuserOff);
      scene.add(housingMesh, diffuserMesh);
      setLights(sign.lights);
      const box = new Box3().setFromObject(housingMesh);
      if (box.isEmpty()) box.set(new Vector3(-10, -10, 0), new Vector3(10, 10, 12));
      layoutGlow(box);
      frame(box);
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
      splat.geometry.dispose();
      housingMaterial.dispose();
      diffuserOff.dispose();
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
