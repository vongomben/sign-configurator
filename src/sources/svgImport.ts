// Lettura SVG nel main thread (SPEC §4bis). DOMParser una volta sola: l'ordine riceve
// la forma normalizzata, e da lì la pipeline è pura.
import type { SvgImageSource, TraceMode } from '../order/schema';
import {
  geometryToD,
  IDENTITY,
  multiply,
  normalizeShapes,
  parseLength,
  parseTransform,
  translate,
  viewBoxMatrix,
  type Matrix,
  type RawShape,
} from './svgPaths';

/** File immagine massimo, come SPEC §4bis. */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export interface SvgImportOptions {
  heightMm: number;
  name?: string;
  trace?: TraceMode;
}

export interface SvgImportResult {
  source: SvgImageSource;
  warnings: string[];
}

const XLINK = 'http://www.w3.org/1999/xlink';
const SHAPES = new Set(['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse']);
const SKIP = new Set([
  'defs',
  'clippath',
  'pattern',
  'marker',
  'lineargradient',
  'radialgradient',
  'stop',
  'script',
  'style',
  'title',
  'desc',
  'metadata',
  'foreignobject',
]);

const WARNING: Record<string, string> = {
  text: 'Testo SVG ignorato (`text`).',
  image: 'Immagine SVG ignorata (`image`).',
  use: 'Riferimento esterno (`use`) ignorato.',
  mask: 'Maschere SVG ignorate.',
  filter: 'Filtri SVG ignorati.',
  empty: 'Elemento senza tratto né riempimento ignorato.',
};

interface Rule {
  selector: string;
  props: Map<string, string>;
  specificity: [number, number, number];
  order: number;
}

interface Paint {
  fill: string | null;
  stroke: string | null;
  fillRule: 'nonzero' | 'evenodd';
  fillOpacity: number;
  strokeOpacity: number;
  strokeWidth: number | null;
  opacity: number;
  displayNone: boolean;
  visibilityHidden: boolean;
}

const INITIAL_PAINT: Paint = {
  fill: null,
  stroke: null,
  fillRule: 'nonzero',
  fillOpacity: 1,
  strokeOpacity: 1,
  strokeWidth: null,
  opacity: 1,
  displayNone: false,
  visibilityHidden: false,
};

const PAINT_ATTRS = ['fill', 'stroke', 'fill-rule', 'fill-opacity', 'stroke-opacity', 'stroke-width', 'opacity', 'display', 'visibility'];

/** SVG → sorgente dell'ordine. I tratti sono `stroke`, le aree `fill` con `fillRule`. */
export function importSvg(svgText: string, options: SvgImportOptions): SvgImportResult {
  if (!(options.heightMm > 0)) throw new Error("Altezza dell'immagine non valida.");
  const doc = new DOMParser().parseFromString(svgText.replace(/^\uFEFF/, ''), 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || local(root) !== 'svg') throw new Error('SVG non valido.');

  const rules = collectRules(doc);
  const shapes: RawShape[] = [];
  const warned = new Set<string>();
  const warnings: string[] = [];
  const warn = (type: string): void => {
    if (warned.has(type)) return;
    warned.add(type);
    const message = WARNING[type];
    if (message) warnings.push(message);
  };

  const walk = (el: Element, parentMatrix: Matrix, parentPaint: Paint, stack: Set<Element>): void => {
    const tag = local(el);
    if (tag === 'text' || tag === 'tspan' || tag === 'textpath') {
      warn('text');
      return;
    }
    if (tag === 'image') {
      warn('image');
      return;
    }
    if (tag === 'mask') {
      warn('mask');
      return;
    }
    if (tag === 'filter') {
      warn('filter');
      return;
    }
    if (SKIP.has(tag)) return;
    if (el.hasAttribute('mask')) warn('mask');
    if (el.hasAttribute('filter')) warn('filter');

    const paint = applyPaint(parentPaint, el, rules);
    const matrix = contentMatrix(el, parentMatrix);

    if (tag === 'use') {
      const href = el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? el.getAttributeNS(XLINK, 'href');
      const id = href ? localHash(href.trim()) : null;
      const target = id ? findId(doc, id) : null;
      if (!id || !target) {
        warn('use');
        return;
      }
      if (stack.has(target)) return;
      const placed = multiply(matrix, translate(parseLength(el.getAttribute('x')), parseLength(el.getAttribute('y'))));
      stack.add(target);
      walk(target, placed, paint, stack);
      stack.delete(target);
      return;
    }

    if (tag === 'switch') {
      const first = el.firstElementChild;
      if (first) walk(first, matrix, paint, stack);
      return;
    }

    if (SHAPES.has(tag)) {
      if (paint.displayNone || paint.visibilityHidden || paint.opacity <= 0) return;
      const kind = classify(paint);
      const d = geometryToD(tag, (name) => el.getAttribute(name));
      if (!d || !kind) {
        warn('empty');
        return;
      }
      shapes.push({ d, transform: matrix, kind, fillRule: paint.fillRule });
      return;
    }

    for (let i = 0; i < el.children.length; i++) walk(el.children[i]!, matrix, paint, stack);
  };

  walk(root, IDENTITY, INITIAL_PAINT, new Set());
  if (shapes.length === 0) {
    const extra = warnings.length ? ` ${warnings.join(' ')}` : '';
    throw new Error(`L'SVG non contiene tratti né aree.${extra}`);
  }
  return {
    source: {
      kind: 'image',
      format: 'svg',
      name: options.name?.trim() || 'immagine.svg',
      trace: options.trace ?? 'centerline',
      svg: { elements: normalizeShapes(shapes, options.heightMm) },
    },
    warnings,
  };
}

function contentMatrix(el: Element, parent: Matrix): Matrix {
  const tag = local(el);
  const transform = parseTransform(el.getAttribute('transform'));
  if (tag === 'svg' || tag === 'symbol') {
    const placed = multiply(parent, translate(parseLength(el.getAttribute('x')), parseLength(el.getAttribute('y'))));
    return multiply(
      multiply(placed, transform),
      viewBoxMatrix(el.getAttribute('viewBox'), el.getAttribute('width'), el.getAttribute('height'), el.getAttribute('preserveAspectRatio')),
    );
  }
  return multiply(parent, transform);
}

function classify(paint: Paint): 'stroke' | 'fill' | null {
  const fillPaint = isPaint(paint.fill) && paint.fillOpacity > 0;
  const strokePaint = isPaint(paint.stroke) && paint.strokeOpacity > 0 && (paint.strokeWidth ?? 1) > 0;
  if (fillPaint) return 'fill';
  if (strokePaint) return 'stroke';
  return null;
}

function isPaint(value: string | null): boolean {
  if (value == null || value === 'none') return false;
  return alpha(value) > 0;
}

function alpha(value: string): number {
  const v = value.trim().toLowerCase();
  if (v === 'none' || v === 'transparent') return 0;
  const match = /^rgba?\(([^)]+)\)$/.exec(v);
  if (!match) return 1;
  const parts = match[1]!.trim().split(/[\s,/]+/);
  return parts.length >= 4 ? Number(parts[3]) : 1;
}

function applyPaint(parent: Paint, el: Element, rules: Rule[]): Paint {
  const props = new Map<string, string>();
  for (const name of PAINT_ATTRS) {
    const attr = el.getAttribute(name);
    if (attr != null && attr.trim()) props.set(name, attr.trim());
  }
  const matched = rules.filter((rule) => {
    try {
      return el.matches(rule.selector);
    } catch {
      return false;
    }
  });
  matched.sort((a, b) => cmp(a.specificity, b.specificity) || a.order - b.order);
  for (const rule of matched) for (const [name, value] of rule.props) props.set(name, value);
  for (const [name, value] of parseDecls(el.getAttribute('style') ?? '')) props.set(name, value);

  const next: Paint = { ...parent };
  const take = (name: string): string | null => {
    const value = props.get(name);
    if (value == null) return null;
    return value.trim() === 'inherit' ? null : value.trim();
  };
  const fill = take('fill');
  if (fill != null) next.fill = fill === 'none' || fill === 'transparent' ? 'none' : fill === 'initial' || fill === 'unset' ? null : fill;
  const stroke = take('stroke');
  if (stroke != null) {
    next.stroke = stroke === 'none' || stroke === 'transparent' || stroke === 'initial' || stroke === 'unset' ? 'none' : stroke;
  }
  const rule = take('fill-rule');
  if (rule != null) next.fillRule = rule === 'evenodd' ? 'evenodd' : 'nonzero';
  const fillOpacity = take('fill-opacity');
  if (fillOpacity != null) next.fillOpacity = clamp01(Number(fillOpacity));
  const strokeOpacity = take('stroke-opacity');
  if (strokeOpacity != null) next.strokeOpacity = clamp01(Number(strokeOpacity));
  const strokeWidth = take('stroke-width');
  if (strokeWidth != null) next.strokeWidth = parseLength(strokeWidth, 0);
  const opacity = take('opacity');
  next.opacity = parent.opacity * (opacity == null ? 1 : clamp01(Number(opacity)));
  const display = take('display');
  if (display === 'none' || parent.displayNone) next.displayNone = true;
  const visibility = take('visibility');
  if (visibility === 'hidden') next.visibilityHidden = true;
  else if (visibility === 'visible') next.visibilityHidden = false;
  return next;
}

function collectRules(doc: Document): Rule[] {
  const rules: Rule[] = [];
  let order = 0;
  for (const style of doc.querySelectorAll('style')) {
    const text = (style.textContent ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const hit of text.matchAll(/([^{]+)\{([^}]*)\}/g)) {
      const props = parseDecls(hit[2] ?? '');
      for (const selector of (hit[1] ?? '').split(',')) {
        const trimmed = selector.trim();
        if (!trimmed) continue;
        rules.push({ selector: trimmed, props, specificity: specificityOf(trimmed), order: order++ });
      }
    }
  }
  return rules;
}

function parseDecls(block: string): Map<string, string> {
  const props = new Map<string, string>();
  for (const decl of block.split(';')) {
    const colon = decl.indexOf(':');
    if (colon < 0) continue;
    const name = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim();
    if (name && value) props.set(name, value);
  }
  return props;
}

function specificityOf(selector: string): [number, number, number] {
  const ids = selector.match(/#[\w-]+/g)?.length ?? 0;
  const classes = (selector.match(/\.[\w-]+/g)?.length ?? 0) + (selector.match(/\[[^\]]+\]/g)?.length ?? 0);
  const tags = selector.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g)?.length ?? 0;
  return [ids, classes, tags];
}

function cmp(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function localHash(href: string): string | null {
  if (!href.startsWith('#')) return null;
  const id = href.slice(1).trim();
  return id && !id.includes('/') ? id : null;
}

function findId(doc: Document, id: string): Element | null {
  if (typeof doc.getElementById === 'function') {
    const found = doc.getElementById(id);
    if (found) return found;
  }
  const all = doc.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) if (all[i]!.getAttribute('id') === id) return all[i]!;
  return null;
}

function local(el: Element): string {
  return (el.localName || el.tagName).toLowerCase();
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
}
