// Font a tratto singolo, senza raster (SPEC §4). Due formati, niente DOM:
// - SVG 1.1 `<font><glyph d="...">` (EMS / Evil Mad Scientist, e gli Hershey in SVG)
// - JSON: glifi con `advance` e Y verso l'alto, oppure l'array `chars` di hersheytextjs
//   (indice 0 = spazio, avanzamento `o`, Y verso il basso).
import type { Point } from '../geometry/rasterize';

export interface StrokePath {
  points: Point[];
  closed: boolean;
}

export interface StrokeGlyph {
  unicode: string;
  /** Avanzamento in unità del font. */
  advance: number;
  strokes: StrokePath[];
}

export interface StrokeFont {
  name: string;
  unitsPerEm: number;
  defaultAdvance: number;
  glyphs: Map<string, StrokeGlyph>;
  /** Quanto togliere fra due caratteri, in unità del font. Chiave `prev\\0next`. */
  kerning: Map<string, number>;
}

const kernKey = (prev: string, next: string): string => `${prev}\0${next}`;

export function kerningOf(font: StrokeFont, prev: string, next: string): number {
  return font.kerning.get(kernKey(prev, next)) ?? 0;
}

/** Sommità del glifo sopra la linea di base, in unità del font. */
export function strokeTop(font: StrokeFont, ch: string): number | null {
  const glyph = font.glyphs.get(ch);
  if (!glyph) return null;
  let top = -Infinity;
  for (const stroke of glyph.strokes) {
    for (const p of stroke.points) if (p[1] > top) top = p[1];
  }
  return top > 0 ? top : null;
}

export function parseStrokeFont(text: string): StrokeFont {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('<')) return parseSvgFont(text);
  if (trimmed.startsWith('{')) return parseJsonFont(text);
  throw new Error('Font a tratto singolo: atteso un SVG `<font>` o un JSON.');
}

// ---------------------------------------------------------------- SVG font

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1]!] = decodeXml(m[2]!);
  return out;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseSvgFont(text: string): StrokeFont {
  const fontTag = text.match(/<font\b[^>]*>/);
  const face = text.match(/<font-face\b[^>]*>/);
  const fontAttrs = fontTag ? attrs(fontTag[0]) : {};
  const faceAttrs = face ? attrs(face[0]) : {};
  const units = Number(faceAttrs['units-per-em'] ?? 1000);
  const fallback = Number(fontAttrs['horiz-adv-x'] ?? 0);
  const glyphs = new Map<string, StrokeGlyph>();
  const glyphRe = /<glyph\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = glyphRe.exec(text))) {
    const a = attrs(m[1] ?? '');
    const unicode = a.unicode ?? '';
    if (!unicode) continue;
    const advance = Number(a['horiz-adv-x'] ?? fallback);
    const strokes = a.d ? svgPath(a.d, 0.5) : [];
    for (const ch of unicode) {
      glyphs.set(ch, { unicode: ch, advance, strokes });
    }
  }
  const kerning = new Map<string, number>();
  const kernRe = /<hkern\b([^>]*)\/?>/g;
  while ((m = kernRe.exec(text))) {
    const a = attrs(m[1] ?? '');
    const k = Number(a.k ?? 0);
    if (!Number.isFinite(k) || k === 0) continue;
    const left = splitKern(a.u1 ?? a.g1 ?? '');
    const right = splitKern(a.u2 ?? a.g2 ?? '');
    for (const prev of left) {
      for (const next of right) kerning.set(kernKey(prev, next), k);
    }
  }
  return {
    name: faceAttrs['font-family'] ?? fontAttrs.id ?? 'stroke',
    unitsPerEm: Number.isFinite(units) && units > 0 ? units : 1000,
    defaultAdvance: Number.isFinite(fallback) ? fallback : 0,
    glyphs,
    kerning,
  };
}

/** `u1="A,V"` sono alternative; un token di più lettere è una sequenza di glifi. */
function splitKern(value: string): string[] {
  const out: string[] = [];
  for (const part of value.split(',')) {
    const token = part.trim();
    if (!token) continue;
    if (token.length === 1) out.push(token);
    else for (const ch of token) out.push(ch);
  }
  return out;
}

// ---------------------------------------------------------------- JSON

interface JsonGlyph {
  d?: string;
  advance?: number;
  o?: number | string;
  unicode?: string;
}

interface JsonFont {
  name?: string;
  unitsPerEm?: number;
  yDown?: boolean;
  glyphs?: Record<string, JsonGlyph>;
  chars?: JsonGlyph[];
}

function parseJsonFont(text: string): StrokeFont {
  const data = JSON.parse(text) as JsonFont;
  const glyphs = new Map<string, StrokeGlyph>();
  const yDown = data.yDown === true || (data.glyphs === undefined && Array.isArray(data.chars));
  const tol = 0.35;
  if (data.glyphs) {
    for (const [unicode, glyph] of Object.entries(data.glyphs)) {
      glyphs.set(unicode, {
        unicode,
        advance: Number(glyph.advance ?? glyph.o ?? 0),
        strokes: flip(svgPath(glyph.d ?? '', tol), yDown),
      });
    }
  } else if (Array.isArray(data.chars)) {
    data.chars.forEach((glyph, index) => {
      const unicode = glyph.unicode ?? String.fromCharCode(32 + index);
      glyphs.set(unicode, {
        unicode,
        advance: Number(glyph.o ?? glyph.advance ?? 0),
        strokes: flip(svgPath(glyph.d ?? '', tol), yDown),
      });
    });
  }
  return {
    name: data.name ?? 'hershey',
    unitsPerEm: data.unitsPerEm && data.unitsPerEm > 0 ? data.unitsPerEm : 1000,
    defaultAdvance: glyphs.get(' ')?.advance ?? 0,
    glyphs,
    kerning: new Map(),
  };
}

function flip(strokes: StrokePath[], yDown: boolean): StrokePath[] {
  if (!yDown) return strokes;
  return strokes.map((stroke) => ({
    closed: stroke.closed,
    points: stroke.points.map((p): Point => [p[0], p[1] === 0 ? 0 : -p[1]]),
  }));
}

// ---------------------------------------------------------------- path SVG

/** `d` → spezzate. `tol` è l'errore massimo di una curva, nelle unità del path. */
export function svgPath(d: string, tol: number): StrokePath[] {
  const tokens = tokenize(d);
  const strokes: StrokePath[] = [];
  let current: Point[] = [];
  let closed = false;
  let start: Point = [0, 0];
  let pen: Point = [0, 0];
  let ctrl: Point = [0, 0];
  let prevCmd = '';
  let i = 0;

  const push = (p: Point): void => {
    const last = current[current.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) current.push(p);
    pen = p;
  };
  const finish = (): void => {
    if (current.length >= 2) strokes.push({ points: current, closed });
    current = [];
    closed = false;
  };
  const read = (): number => {
    const value = tokens[i++];
    if (typeof value !== 'number') throw new Error('Path SVG: atteso un numero.');
    return value;
  };
  const pair = (rel: boolean): Point => {
    const x = read();
    const y = read();
    return rel ? [pen[0] + x, pen[1] + y] : [x, y];
  };
  const reflect = (): Point => [2 * pen[0] - ctrl[0], 2 * pen[1] - ctrl[1]];
  const quad = (p0: Point, p1: Point, p2: Point): void => {
    const n = segmentsFor(2 * Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]), tol);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const u = 1 - t;
      push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
    }
    ctrl = p1;
  };
  const cubic = (p0: Point, p1: Point, p2: Point, p3: Point): void => {
    const d1 = Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]);
    const d2 = Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1]);
    const n = segmentsFor(6 * Math.max(d1, d2), tol);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const c = 3 * u * t * t;
      const e = t * t * t;
      push([a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]]);
    }
    ctrl = p2;
  };

  while (i < tokens.length) {
    let cmd = tokens[i];
    if (typeof cmd === 'number') {
      cmd = prevCmd === 'M' ? 'L' : prevCmd === 'm' ? 'l' : prevCmd;
    } else {
      i++;
    }
    if (typeof cmd !== 'string' || cmd === '') break;
    const rel = cmd.toLowerCase() === cmd;
    switch (cmd) {
      case 'M':
      case 'm': {
        finish();
        const p = pair(rel);
        start = p;
        push(p);
        prevCmd = rel ? 'l' : 'L';
        ctrl = p;
        break;
      }
      case 'L':
      case 'l': {
        const p = pair(rel);
        push(p);
        ctrl = p;
        prevCmd = cmd;
        break;
      }
      case 'H':
      case 'h': {
        const x = read();
        const p: Point = [rel ? pen[0] + x : x, pen[1]];
        push(p);
        ctrl = p;
        prevCmd = cmd;
        break;
      }
      case 'V':
      case 'v': {
        const y = read();
        const p: Point = [pen[0], rel ? pen[1] + y : y];
        push(p);
        ctrl = p;
        prevCmd = cmd;
        break;
      }
      case 'Q':
      case 'q': {
        const p1 = pair(rel);
        const p2 = pair(rel);
        quad(pen, p1, p2);
        prevCmd = cmd;
        break;
      }
      case 'T':
      case 't': {
        const smooth = prevCmd === 'Q' || prevCmd === 'q' || prevCmd === 'T' || prevCmd === 't';
        const p1 = smooth ? reflect() : pen;
        const p2 = pair(rel);
        quad(pen, p1, p2);
        prevCmd = cmd;
        break;
      }
      case 'C':
      case 'c': {
        const p1 = pair(rel);
        const p2 = pair(rel);
        const p3 = pair(rel);
        cubic(pen, p1, p2, p3);
        prevCmd = cmd;
        break;
      }
      case 'S':
      case 's': {
        const smooth = prevCmd === 'C' || prevCmd === 'c' || prevCmd === 'S' || prevCmd === 's';
        const p1 = smooth ? reflect() : pen;
        const p2 = pair(rel);
        const p3 = pair(rel);
        cubic(pen, p1, p2, p3);
        prevCmd = cmd;
        break;
      }
      case 'Z':
      case 'z':
        if (current.length >= 2) {
          const first = current[0]!;
          if (pen[0] !== first[0] || pen[1] !== first[1]) current.push([first[0], first[1]]);
          closed = true;
        }
        pen = start;
        ctrl = start;
        finish();
        prevCmd = cmd;
        break;
      default:
        throw new Error(`Path SVG: comando "${cmd}" non gestito.`);
    }
  }
  finish();
  return strokes;
}

function segmentsFor(m: number, tol: number): number {
  if (!(m > 0) || !(tol > 0)) return 1;
  return Math.max(1, Math.ceil(Math.sqrt(m / (8 * tol))));
}

function tokenize(d: string): (string | number)[] {
  const out: (string | number)[] = [];
  let i = 0;
  while (i < d.length) {
    const c = d[i]!;
    if (c === ',' || c === ' ' || c === '\n' || c === '\r' || c === '\t') {
      i++;
      continue;
    }
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
      out.push(c);
      i++;
      continue;
    }
    const rest = d.slice(i);
    const m = /^[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?/.exec(rest);
    if (!m || m[0] === '' || m[0] === '+' || m[0] === '-') throw new Error(`Path SVG illeggibile vicino a "${rest.slice(0, 12)}".`);
    out.push(Number(m[0]));
    i += m[0].length;
  }
  return out;
}
