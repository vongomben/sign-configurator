// Contributo di ogni LED sul diffusore: una gaussiana la cui larghezza è la distanza
// fra la faccia del LED e il diffusore. Il passo largo rispetto a quella distanza
// lascia vedere i punti; il passo fitto li fonde.
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  ShaderMaterial,
  type Texture,
  Vector2,
} from 'three';

/** Esposizione ACES di partenza. In admin si regola; il cliente resta qui. */
export const DEFAULT_EXPOSURE = 0.85;
/** Alone di partenza: raggio del bloom. Resta stretto; la parete prende la gaussiana. */
export const DEFAULT_HALO = 0.16;
/** Sopra il fondo del tratto, così il bloom non allarga l'alone oltre la gaussiana. */
export const BLOOM_THRESHOLD = 0.85;
const GLOW_GAIN = 0.7;
const WALL_HALO_GAIN = 0.2;
const GLOW_FLOOR = 0;

/** Peso di un LED a (dx, dy) mm dal campione. `sigma` è la distanza LED–diffusore. */
export function gaussianWeight(dx: number, dy: number, sigma: number): number {
  const s = Math.max(sigma, 1e-3);
  return Math.exp(-(dx * dx + dy * dy) / (2 * s * s));
}

/** Curva ACES di Narkowicz, un canale. */
export function acesChannel(x: number): number {
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;
  const y = (x * (a * x + b)) / (x * (c * x + d) + e);
  return Math.min(1, Math.max(0, y));
}

/** Colore del diffusore in un punto: somma delle gaussiane, poi ACES. */
export function diffuserRgb(
  x: number,
  y: number,
  lights: readonly { x: number; y: number; rgb: readonly [number, number, number] }[],
  sigma: number,
  exposure = DEFAULT_EXPOSURE,
): [number, number, number] {
  let r = GLOW_FLOOR;
  let g = GLOW_FLOOR;
  let b = GLOW_FLOOR;
  for (const light of lights) {
    const weight = gaussianWeight(x - light.x, y - light.y, sigma);
    r += light.rgb[0] * weight * GLOW_GAIN;
    g += light.rgb[1] * weight * GLOW_GAIN;
    b += light.rgb[2] * weight * GLOW_GAIN;
  }
  return [acesChannel(r * exposure), acesChannel(g * exposure), acesChannel(b * exposure)];
}

/** Tinta in gradi, 0 = rosso. Un grigio restituisce 0. */
export function hueDegrees(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;
  if (span < 1e-6) return 0;
  let hue: number;
  if (max === r) hue = ((g - b) / span) % 6;
  else if (max === g) hue = (b - r) / span + 2;
  else hue = (r - g) / span + 4;
  return ((hue * 60) % 360 + 360) % 360;
}

/** Il punto copre ±3 sigma, dove la gaussiana è già trascurabile. */
export const GAUSSIAN_RADIUS_SIGMA = 3;

export function createSplatMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uPointSize: { value: 32 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 ledColor;
      varying vec3 vColor;
      uniform float uPointSize;
      void main() {
        vColor = ledColor;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uPointSize;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(p, p);
        if (r2 > 1.0) discard;
        float d = sqrt(r2) * ${GAUSSIAN_RADIUS_SIGMA.toFixed(1)};
        float g = exp(-0.5 * d * d);
        gl_FragColor = vec4(vColor * g, 1.0);
      }
    `,
  });
}

/** Diffusore acceso: la mappa è la somma delle gaussiane, già colorata. */
export function createDiffuserGlowMaterial(map: Texture): ShaderMaterial {
  return new ShaderMaterial({
    side: DoubleSide,
    uniforms: {
      uGlow: { value: map },
      uOrigin: { value: new Vector2() },
      uSpan: { value: new Vector2(1, 1) },
      uGain: { value: GLOW_GAIN },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uGlow;
      uniform vec2 uOrigin;
      uniform vec2 uSpan;
      uniform float uGain;
      varying vec3 vPos;
      void main() {
        vec2 uv = (vPos.xy - uOrigin) / uSpan;
        vec3 glow = texture2D(uGlow, uv).rgb * uGain;
        gl_FragColor = vec4(glow, 1.0);
      }
    `,
  });
}

/** Parete: il colore del muro più la stessa gaussiana, che si spegne a circa 3 sigma. */
export function createWallGlowMaterial(map: Texture, wall: Color): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uGlow: { value: map },
      uOrigin: { value: new Vector2() },
      uSpan: { value: new Vector2(1, 1) },
      uGain: { value: 0 },
      uWall: { value: wall.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uGlow;
      uniform vec2 uOrigin;
      uniform vec2 uSpan;
      uniform float uGain;
      uniform vec3 uWall;
      varying vec3 vPos;
      void main() {
        vec2 uv = (vPos.xy - uOrigin) / uSpan;
        vec3 glow = vec3(0.0);
        if (uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0) {
          glow = texture2D(uGlow, uv).rgb * uGain;
        }
        gl_FragColor = vec4(uWall + glow, 1.0);
      }
    `,
  });
}

export const WALL_GLOW_GAIN = WALL_HALO_GAIN;

/** LED nudo nel canale: dischetto morbido, già del colore dello spezzone. */
export function createEmitterMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uPointSize: { value: 8 } },
    vertexShader: /* glsl */ `
      attribute vec3 ledColor;
      varying vec3 vColor;
      uniform float uPointSize;
      void main() {
        vColor = ledColor;
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * view;
        gl_PointSize = uPointSize * (400.0 / max(1.0, -view.z));
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(p, p);
        if (r2 > 1.0) discard;
        float g = exp(-2.2 * r2);
        gl_FragColor = vec4(vColor * g * 1.6, g);
      }
    `,
  });
}

export function parseHexColor(hex: string, target: Color): Color {
  try {
    return target.set(hex);
  } catch {
    return target.set('#ff2fd6');
  }
}
