// Editor dei tracciati (SPEC §5bis). Paper.js arriva solo qui, con import() dinamico.

import { EDIT_FIT_TOL, EDIT_MIN_NODE_DIST, type Params } from '../config';
import type { Point } from '../geometry/rasterize';
import { flattenPaths, type EditSegment } from './paths';
import { liveCheck } from './liveCheck';
import type { CurveNode, CurvePath, DotPath, OrderCrossing, OrderPath } from '../order/schema';

type Paper = typeof import('paper/dist/paper-core');

export interface PathEditor {
  /** Spezzoni [D] → curve, con Path.simplify alla tolleranza dell'editor. */
  freeze(segments: readonly EditSegment[]): OrderPath[];
  load(paths: readonly OrderPath[], crossings: readonly OrderCrossing[]): void;
  show(): void;
  close(): void;
}

export interface PathEditorOptions {
  canvas: HTMLCanvasElement;
  toolbar: HTMLElement;
  getParams(): Params;
  /** Modifica conclusa: il worker può rigenerare. */
  onCommit(paths: OrderPath[], crossings: OrderCrossing[]): void;
  /** Durante il gesto: blocca l'invio senza rigenerare la mesh. */
  onLive(blocked: boolean): void;
}

const MAX_UNDO = 50;
const JOIN_MM = 1;

interface Doc {
  paths: OrderPath[];
  crossings: OrderCrossing[];
}

interface CurveItem {
  id: string;
  path: paper.Path;
  dot: boolean;
  angle: number;
}

async function loadPaper(): Promise<Paper> {
  const mod = await import('paper/dist/paper-core');
  const scope = mod as Paper & { default?: Paper };
  return scope.default ?? scope;
}

function roundMm(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function isDot(path: OrderPath): path is DotPath {
  return 'type' in path && path.type === 'dot';
}

function cloneDoc(doc: Doc): Doc {
  return JSON.parse(JSON.stringify(doc)) as Doc;
}

function sameDoc(a: Doc, b: Doc): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function coarsePointer(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

/** Apre l'editor sul canvas. Paper.js non è nel bundle finché non si chiama questa funzione. */
export async function openPathEditor(options: PathEditorOptions): Promise<PathEditor> {
  const paper = await loadPaper();
  const { canvas, toolbar } = options;
  paper.setup(canvas);
  const geometry = paper.project.activeLayer;
  const chrome = new paper.Layer();
  geometry.activate();

  const items: CurveItem[] = [];
  let crossings: OrderCrossing[] = [];
  const undo: Doc[] = [];
  const redo: Doc[] = [];
  let mode: 'select' | 'pen' | 'cut' | 'move-all' | 'move-one' = 'select';
  let pen: paper.Path | null = null;
  let selectedId: string | null = null;
  let selectedIndex: number | null = null;
  let gesture = false;
  let dragging: 'node' | 'handle' | 'rotate' | 'path' | 'all' | 'pan' | null = null;
  let dragIndex = -1;
  let dragHandle: 'in' | 'out' | null = null;
  let anchor = new paper.Point(0, 0);
  const pointers = new Map<number, paper.Point>();
  let pinch: { dist: number; midX: number; midY: number } | null = null;

  const buttons = new Map<string, HTMLButtonElement>();

  function toPaper(point: readonly [number, number]): paper.Point {
    return new paper.Point(point[0], -point[1]);
  }

  function fromPaper(point: paper.Point): [number, number] {
    return [roundMm(point.x), roundMm(-point.y)];
  }

  function fromVector(point: paper.Point): [number, number] {
    return [roundMm(point.x), roundMm(-point.y)];
  }

  function px(screen: number): number {
    const zoom = paper.view.zoom || 1;
    return screen / zoom;
  }

  function hitPad(): number {
    return coarsePointer() ? 22 : 8;
  }

  function itemOf(id: string | null): CurveItem | null {
    return items.find((item) => item.id === id) ?? null;
  }

  function stylePath(path: paper.Path, selected: boolean, dot: boolean): void {
    path.strokeColor = new paper.Color(selected ? '#ff2fd6' : dot ? '#9ad7ff' : '#f4efe4');
    path.strokeWidth = px(dot ? 3 : 2);
    path.strokeCap = 'round';
    path.strokeJoin = 'round';
    path.fillColor = null;
  }

  function nextId(prefix: 'p' | 'd'): string {
    const used = new Set(items.map((item) => item.id));
    let n = 1;
    while (used.has(`${prefix}${n}`)) n += 1;
    return `${prefix}${n}`;
  }

  function read(): Doc {
    const paths: OrderPath[] = items.map((item) => {
      if (item.dot) {
        const center = fromPaper(item.path.bounds.center);
        return { id: item.id, type: 'dot' as const, center, angle: roundMm(item.angle) };
      }
      const curve: CurvePath = {
        id: item.id,
        closed: item.path.closed,
        nodes: item.path.segments.map((segment) => ({
          p: fromPaper(segment.point),
          in: fromVector(segment.handleIn),
          out: fromVector(segment.handleOut),
        })),
      };
      return curve;
    });
    return { paths, crossings: crossings.map((crossing) => ({ at: [crossing.at[0], crossing.at[1]] as [number, number], under: crossing.under })) };
  }

  function buildCurve(path: CurvePath): paper.Path {
    const item = new paper.Path();
    for (const node of path.nodes) {
      item.add(new paper.Segment(toPaper(node.p), new paper.Point(node.in[0], -node.in[1]), new paper.Point(node.out[0], -node.out[1])));
    }
    item.closed = path.closed;
    item.data = { role: 'curve', id: path.id };
    return item;
  }

  function buildDot(path: DotPath, params: Params): paper.Path {
    const center = toPaper(path.center);
    const half = params.CUT_PITCH / 2;
    const dir = new paper.Point(Math.cos(path.angle), -Math.sin(path.angle));
    const item = new paper.Path([center.subtract(dir.multiply(half)), center.add(dir.multiply(half))]);
    item.data = { role: 'curve', id: path.id };
    return item;
  }

  function clearItems(): void {
    for (const item of items) item.path.remove();
    items.length = 0;
    pen?.remove();
    pen = null;
  }

  function apply(doc: Doc): void {
    clearItems();
    crossings = doc.crossings.map((crossing) => ({ at: [crossing.at[0], crossing.at[1]] as [number, number], under: crossing.under }));
    const params = options.getParams();
    for (const path of doc.paths) {
      if (isDot(path)) {
        const drawn = buildDot(path, params);
        items.push({ id: path.id, path: drawn, dot: true, angle: path.angle });
      } else if (path.nodes.length >= 2) {
        const drawn = buildCurve(path);
        items.push({ id: path.id, path: drawn, dot: false, angle: 0 });
      }
    }
    drawChrome();
    publishNodes();
    reportLive(null);
  }

  function segmentsFor(doc: Doc): { id: string; points: Point[]; closed: boolean; dot: boolean }[] {
    const flat = flattenPaths(doc.paths);
    const curves = flat.curves.map((curve) => ({ id: curve.id, points: curve.points, closed: curve.closed, dot: false }));
    const params = options.getParams();
    const dots = flat.dots.map((dot) => {
      const half = params.CUT_PITCH / 2;
      const c = Math.cos(dot.angle);
      const s = Math.sin(dot.angle);
      return {
        id: dot.id,
        closed: false,
        dot: true,
        points: [
          [dot.center[0] - c * half, dot.center[1] - s * half] as Point,
          [dot.center[0] + c * half, dot.center[1] + s * half] as Point,
        ],
      };
    });
    return [...curves, ...dots];
  }

  function reportLive(touched: readonly string[] | null): void {
    const doc = read();
    const report = liveCheck(segmentsFor(doc), touched ?? [], options.getParams());
    options.onLive(report.blocked);
    drawMarkers(report.markers);
  }

  function drawMarkers(markers: readonly { kind: string; x: number; y: number }[]): void {
    const old = chrome.children.filter((child) => child.data?.role === 'marker');
    for (const child of old) child.remove();
    chrome.activate();
    for (const marker of markers) {
      const at = toPaper([marker.x, marker.y]);
      let shape: paper.Item;
      if (marker.kind === 'spigolo') shape = new paper.Path.RegularPolygon(at, 3, px(7));
      else if (marker.kind === 'fusione') shape = new paper.Path.Rectangle(at.subtract(new paper.Point(px(5), px(5))), new paper.Size(px(10), px(10)));
      else shape = new paper.Path.Circle(at, px(marker.kind === 'corto' ? 4 : 6));
      shape.strokeColor = new paper.Color(marker.kind === 'spigolo' ? '#ffb020' : '#ff5c5c');
      shape.strokeWidth = px(1.5);
      shape.fillColor = null;
      shape.data = { role: 'marker' };
      shape.locked = true;
    }
    geometry.activate();
  }

  function drawChrome(): void {
    const markers = chrome.children.filter((child) => child.data?.role === 'marker').map((child) => child);
    chrome.removeChildren();
    for (const marker of markers) chrome.addChild(marker);
    chrome.activate();
    for (const item of items) {
      const selected = item.id === selectedId;
      stylePath(item.path, selected, item.dot);
      if (item.path.length > 1) {
        const mid = item.path.getPointAt(item.path.length / 2);
        const ahead = item.path.getPointAt(Math.min(item.path.length - 0.05, item.path.length / 2 + Math.max(2, px(10))));
        if (mid && ahead) {
          const dir = ahead.subtract(mid);
          if (dir.length > 1e-6) {
            const tip = mid.add(dir.normalize(px(14)));
            const unit = dir.normalize(px(6));
            const side = new paper.Point(-unit.y, unit.x);
            const arrow = new paper.Path([tip, mid.add(side), mid.subtract(side)]);
            arrow.closed = true;
            arrow.fillColor = new paper.Color('#ffb020');
            arrow.data = { role: 'arrow' };
            arrow.locked = true;
          }
        }
      }
      if (item.dot) {
        const center = item.path.bounds.center;
        const knob = new paper.Path.Circle(center, px(coarsePointer() ? 22 : 7));
        knob.fillColor = new paper.Color(selected ? '#ff2fd6' : '#9ad7ff');
        knob.data = { role: 'dot', id: item.id };
        const tip = item.path.lastSegment?.point;
        if (tip) {
          const handle = new paper.Path.Circle(tip, px(coarsePointer() ? 16 : 5));
          handle.fillColor = new paper.Color('#ffb020');
          handle.data = { role: 'rotate', id: item.id };
        }
        continue;
      }
      item.path.segments.forEach((segment, index) => {
        const node = new paper.Path.Circle(segment.point, px(coarsePointer() ? 22 : 6));
        node.fillColor = new paper.Color(selected && selectedIndex === index ? '#ff2fd6' : '#ffffff');
        node.data = { role: 'node', id: item.id, index };
        if (selected && selectedIndex === index) {
          for (const which of ['in', 'out'] as const) {
            const handle = which === 'in' ? segment.handleIn : segment.handleOut;
            if (handle.length < 1e-4) continue;
            const at = segment.point.add(handle);
            const line = new paper.Path.Line(segment.point, at);
            line.strokeColor = new paper.Color('#7ec8ff');
            line.strokeWidth = px(1);
            line.data = { role: 'handle-line' };
            line.locked = true;
            const knob = new paper.Path.Circle(at, px(5));
            knob.fillColor = new paper.Color('#7ec8ff');
            knob.data = { role: 'handle', id: item.id, index, which };
          }
        }
      });
    }
    geometry.activate();
    refreshButtons();
  }

  function publishNodes(): void {
    const rect = canvas.getBoundingClientRect();
    const pins: { pathId: string; index: number; x: number; y: number }[] = [];
    for (const item of items) {
      if (item.dot) continue;
      item.path.segments.forEach((segment, index) => {
        const view = paper.view.projectToView(segment.point);
        pins.push({ pathId: item.id, index, x: rect.left + view.x, y: rect.top + view.y });
      });
    }
    canvas.dataset.nodes = JSON.stringify(pins);
  }

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    paper.view.viewSize = new paper.Size(rect.width, rect.height);
    drawChrome();
    publishNodes();
  }

  function fitView(): void {
    if (items.length === 0) return;
    let bounds = items[0]!.path.bounds;
    for (const item of items.slice(1)) bounds = bounds.unite(item.path.bounds);
    if (bounds.width < 1 && bounds.height < 1) return;
    const pad = 32;
    const size = paper.view.viewSize;
    const zoom = Math.min((size.width - pad) / Math.max(bounds.width, 1), (size.height - pad) / Math.max(bounds.height, 1));
    paper.view.zoom = Math.min(40, Math.max(0.2, zoom));
    paper.view.center = bounds.center;
    drawChrome();
    publishNodes();
  }

  function zoomAt(viewX: number, viewY: number, factor: number): void {
    const next = Math.min(40, Math.max(0.2, paper.view.zoom * factor));
    const cursor = new paper.Point(viewX, viewY);
    const before = paper.view.viewToProject(cursor);
    paper.view.zoom = next;
    const after = paper.view.viewToProject(cursor);
    paper.view.center = paper.view.center.add(before.subtract(after));
    drawChrome();
    publishNodes();
  }

  function pushUndo(): void {
    undo.push(cloneDoc(read()));
    if (undo.length > MAX_UNDO) undo.shift();
    redo.length = 0;
    refreshButtons();
  }

  function finishGesture(commit: boolean): void {
    if (!gesture) return;
    gesture = false;
    const now = read();
    const prev = undo[undo.length - 1];
    if (!prev || sameDoc(prev, now)) undo.pop();
    refreshButtons();
    if (commit && prev && !sameDoc(prev, now)) options.onCommit(now.paths, now.crossings);
    else reportLive(null);
  }

  function beginGesture(): void {
    if (gesture) return;
    pushUndo();
    gesture = true;
  }

  function mutate(run: () => void): void {
    pushUndo();
    run();
    drawChrome();
    publishNodes();
    const doc = read();
    reportLive(null);
    options.onCommit(doc.paths, doc.crossings);
  }

  function hitAt(point: paper.Point): paper.HitResult | null {
    return paper.project.hitTest(point, {
      segments: false,
      stroke: true,
      fill: true,
      tolerance: hitPad(),
    });
  }

  function clampNode(path: paper.Path, index: number, point: paper.Point): paper.Point {
    const others: paper.Point[] = [];
    const prev = index > 0 ? path.segments[index - 1] : path.closed ? path.segments[path.segments.length - 1] : null;
    const next = index < path.segments.length - 1 ? path.segments[index + 1] : path.closed ? path.segments[0] : null;
    if (prev && prev !== path.segments[index]) others.push(prev.point);
    if (next && next !== path.segments[index] && next !== prev) others.push(next.point);
    let current = point;
    for (let pass = 0; pass < 4; pass++) {
      for (const other of others) {
        const delta = current.subtract(other);
        const dist = delta.length;
        if (dist >= EDIT_MIN_NODE_DIST) continue;
        current = dist < 1e-6 ? other.add(new paper.Point(EDIT_MIN_NODE_DIST, 0)) : other.add(delta.normalize(EDIT_MIN_NODE_DIST));
      }
    }
    for (const other of others) {
      if (current.getDistance(other) < EDIT_MIN_NODE_DIST - 1e-6) return anchor;
    }
    return current;
  }

  function liveTouched(): string[] {
    return selectedId ? [selectedId] : [];
  }

  const tool = new paper.Tool();
  tool.onMouseDown = (event: { point: paper.Point; delta: paper.Point }) => {
    if (pinch) return;
    const hit = hitAt(event.point);
    const role = hit?.item.data?.role as string | undefined;
    if (mode === 'pen') {
      beginGesture();
      if (!pen) {
        pen = new paper.Path();
        pen.strokeColor = new paper.Color('#ff2fd6');
        pen.strokeWidth = px(2);
        pen.add(event.point);
      }
      pen.add(event.point);
      return;
    }
    if (mode === 'cut' && role === 'curve') {
      const item = itemOf(hit?.item.data?.id as string);
      if (!item || item.dot) return;
      const location = item.path.getNearestLocation(event.point);
      if (!location) return;
      mutate(() => {
        const rest = item.path.splitAt(location);
        if (rest) {
          rest.data = { role: 'curve', id: nextId('p') };
          items.push({ id: rest.data.id as string, path: rest, dot: false, angle: 0 });
        }
      });
      return;
    }
    if (mode === 'move-all') {
      beginGesture();
      dragging = 'all';
      return;
    }
    if (role === 'node') {
      selectedId = hit!.item.data.id as string;
      selectedIndex = hit!.item.data.index as number;
      const item = itemOf(selectedId);
      anchor = item?.path.segments[selectedIndex]?.point.clone() ?? event.point;
      beginGesture();
      dragging = mode === 'move-one' ? 'path' : 'node';
      dragIndex = selectedIndex;
      drawChrome();
      return;
    }
    if (role === 'handle') {
      selectedId = hit!.item.data.id as string;
      selectedIndex = hit!.item.data.index as number;
      dragHandle = hit!.item.data.which as 'in' | 'out';
      beginGesture();
      dragging = 'handle';
      dragIndex = selectedIndex;
      return;
    }
    if (role === 'dot') {
      selectedId = hit!.item.data.id as string;
      selectedIndex = null;
      beginGesture();
      dragging = 'path';
      drawChrome();
      return;
    }
    if (role === 'rotate') {
      selectedId = hit!.item.data.id as string;
      beginGesture();
      dragging = 'rotate';
      return;
    }
    if (role === 'curve') {
      selectedId = hit!.item.data.id as string;
      selectedIndex = null;
      if (mode === 'move-one' || mode === 'select') {
        beginGesture();
        dragging = mode === 'move-one' ? 'path' : 'pan';
        if (mode === 'select') dragging = 'pan';
      }
      drawChrome();
      return;
    }
    selectedIndex = null;
    beginGesture();
    dragging = 'pan';
    drawChrome();
  };

  tool.onMouseDrag = (event: { point: paper.Point; delta: paper.Point }) => {
    if (pinch || !dragging) return;
    if (dragging === 'pan') {
      paper.view.center = paper.view.center.subtract(event.delta);
      publishNodes();
      return;
    }
    if (dragging === 'all') {
      for (const item of items) item.path.translate(event.delta);
      drawChrome();
      publishNodes();
      reportLive(items.map((item) => item.id));
      return;
    }
    const item = itemOf(selectedId);
    if (!item) return;
    if (dragging === 'path') {
      item.path.translate(event.delta);
    } else if (dragging === 'node') {
      const segment = item.path.segments[dragIndex];
      if (!segment) return;
      segment.point = clampNode(item.path, dragIndex, event.point);
    } else if (dragging === 'handle' && dragHandle) {
      const segment = item.path.segments[dragIndex];
      if (!segment) return;
      const vector = event.point.subtract(segment.point);
      if (dragHandle === 'in') segment.handleIn = vector;
      else segment.handleOut = vector;
    } else if (dragging === 'rotate') {
      const center = item.path.bounds.center;
      const vector = event.point.subtract(center);
      if (vector.length > 1e-3) {
        item.angle = Math.atan2(-vector.y, vector.x);
        const half = options.getParams().CUT_PITCH / 2;
        const dir = new paper.Point(Math.cos(item.angle), -Math.sin(item.angle));
        const start = item.path.firstSegment;
        const end = item.path.lastSegment;
        if (start && end) {
          start.point = center.subtract(dir.multiply(half));
          end.point = center.add(dir.multiply(half));
        }
      }
    }
    drawChrome();
    publishNodes();
    reportLive(liveTouched());
  };

  tool.onMouseUp = () => {
    const wasPan = dragging === 'pan';
    dragging = null;
    dragHandle = null;
    if (wasPan) {
      if (gesture) undo.pop();
      gesture = false;
      refreshButtons();
      return;
    }
    finishGesture(true);
  };

  function finishPen(): void {
    if (!pen) return;
    if (pen.segments.length >= 2) {
      const last = pen.segments[pen.segments.length - 1]!;
      const prev = pen.segments[pen.segments.length - 2]!;
      if (last.point.getDistance(prev.point) < 0.2) pen.removeSegment(pen.segments.length - 1);
    }
    if (pen.segments.length < 2) {
      pen.remove();
      pen = null;
      if (gesture) undo.pop();
      gesture = false;
      return;
    }
    const drawn = pen;
    pen = null;
    const id = nextId('p');
    drawn.data = { role: 'curve', id };
    if (!drawn.closed && drawn.segments.length >= 2) {
      const a = fromPaper(drawn.firstSegment!.point);
      const b = fromPaper(drawn.lastSegment!.point);
      if (b[0] < a[0] - 1e-9 || (Math.abs(b[0] - a[0]) <= 1e-9 && b[1] < a[1])) drawn.reverse();
    }
    items.push({ id, path: drawn, dot: false, angle: 0 });
    selectedId = id;
    gesture = true;
    finishGesture(true);
    setMode('select');
  }

  function deleteNode(): void {
    const item = itemOf(selectedId);
    if (!item || item.dot || selectedIndex === null) return;
    if (item.path.segments.length <= 2) return;
    const index = selectedIndex;
    mutate(() => {
      item.path.removeSegment(index);
      selectedIndex = null;
    });
  }

  function deletePath(): void {
    const item = itemOf(selectedId);
    if (!item) return;
    mutate(() => {
      item.path.remove();
      const at = items.indexOf(item);
      if (at >= 0) items.splice(at, 1);
      selectedId = null;
      selectedIndex = null;
    });
  }

  function toggleCorner(): void {
    const item = itemOf(selectedId);
    if (!item || item.dot || selectedIndex === null) return;
    const index = selectedIndex;
    mutate(() => {
      const segment = item.path.segments[index];
      if (!segment) return;
      if (segment.handleIn.length + segment.handleOut.length < 0.05) segment.smooth();
      else {
        segment.handleIn = new paper.Point(0, 0);
        segment.handleOut = new paper.Point(0, 0);
      }
    });
  }

  function joinEnds(): void {
    type End = { item: CurveItem; atEnd: boolean; point: paper.Point };
    const ends: End[] = [];
    for (const item of items) {
      if (item.dot || item.path.closed || item.path.segments.length < 2) continue;
      ends.push({ item, atEnd: false, point: item.path.firstSegment!.point });
      ends.push({ item, atEnd: true, point: item.path.lastSegment!.point });
    }
    let best: { a: End; b: End; d: number } | null = null;
    for (const a of ends) {
      for (const b of ends) {
        if (a.item === b.item) continue;
        if (selectedId && a.item.id !== selectedId && b.item.id !== selectedId) continue;
        const d = a.point.getDistance(b.point);
        if (d > JOIN_MM) continue;
        if (!best || d < best.d) best = { a, b, d };
      }
    }
    if (!best) return;
    const left = best.a;
    const right = best.b;
    mutate(() => {
      if (!left.atEnd) left.item.path.reverse();
      if (right.atEnd) right.item.path.reverse();
      const tail = right.item.path.firstSegment;
      const head = left.item.path.lastSegment;
      if (tail && head) tail.point = head.point.clone();
      left.item.path.join(right.item.path);
      const at = items.indexOf(right.item);
      if (at >= 0) items.splice(at, 1);
      selectedId = left.item.id;
    });
  }

  function undoAction(): void {
    gesture = false;
    dragging = null;
    const prev = undo.pop();
    if (!prev) return;
    redo.push(cloneDoc(read()));
    apply(prev);
    options.onCommit(prev.paths, prev.crossings);
    refreshButtons();
  }

  function redoAction(): void {
    gesture = false;
    dragging = null;
    const next = redo.pop();
    if (!next) return;
    undo.push(cloneDoc(read()));
    apply(next);
    options.onCommit(next.paths, next.crossings);
    refreshButtons();
  }

  function refreshButtons(): void {
    const undoBtn = buttons.get('undo');
    const redoBtn = buttons.get('redo');
    if (undoBtn) undoBtn.disabled = undo.length === 0;
    if (redoBtn) redoBtn.disabled = redo.length === 0;
    for (const [name, button] of buttons) {
      if (name === 'pen' || name === 'cut' || name === 'move-all' || name === 'move-one' || name === 'select') {
        button.setAttribute('aria-pressed', mode === name ? 'true' : 'false');
      }
    }
  }

  function setMode(next: typeof mode): void {
    if (mode === 'pen' && next !== 'pen') finishPen();
    mode = next;
    canvas.style.cursor = next === 'pen' || next === 'cut' ? 'crosshair' : 'default';
    refreshButtons();
  }

  function button(label: string, name: string, run: () => void): void {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.addEventListener('click', run);
    toolbar.append(el);
    buttons.set(name, el);
  }

  toolbar.replaceChildren();
  button('Seleziona', 'select', () => setMode('select'));
  button('Annulla', 'undo', () => undoAction());
  button('Ripeti', 'redo', () => redoAction());
  button('Elimina nodo', 'delete-node', () => deleteNode());
  button('Elimina spezzone', 'delete-path', () => deletePath());
  button('Spigolo o curva', 'corner', () => toggleCorner());
  button('Taglia', 'cut', () => setMode('cut'));
  button('Unisci', 'join', () => joinEnds());
  button('Penna', 'pen', () => setMode(mode === 'pen' ? 'select' : 'pen'));
  button('Sposta tutto', 'move-all', () => setMode(mode === 'move-all' ? 'select' : 'move-all'));
  button('Sposta spezzone', 'move-one', () => setMode(mode === 'move-one' ? 'select' : 'move-one'));
  refreshButtons();

  function onKey(event: KeyboardEvent): void {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
    const meta = event.ctrlKey || event.metaKey;
    if (meta && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      undoAction();
    } else if (meta && (event.key.toLowerCase() === 'z' && event.shiftKey || event.key.toLowerCase() === 'y')) {
      event.preventDefault();
      redoAction();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteNode();
    } else if (event.key === 'Enter' && mode === 'pen') {
      event.preventDefault();
      finishPen();
    }
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomAt(event.clientX - rect.left, event.clientY - rect.top, factor);
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse') return;
    pointers.set(event.pointerId, new paper.Point(event.clientX, event.clientY));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      if (!a || !b) return;
      pinch = { dist: a.getDistance(b), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
      dragging = null;
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, new paper.Point(event.clientX, event.clientY));
    if (!pinch || pointers.size < 2) return;
    event.preventDefault();
    const [a, b] = [...pointers.values()];
    if (!a || !b || pinch.dist < 1) return;
    const dist = a.getDistance(b);
    const rect = canvas.getBoundingClientRect();
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    zoomAt(midX - rect.left, midY - rect.top, dist / pinch.dist);
    const shift = new paper.Point(midX - pinch.midX, midY - pinch.midY);
    const project = paper.view.viewToProject(new paper.Point(rect.width / 2, rect.height / 2));
    const moved = paper.view.viewToProject(new paper.Point(rect.width / 2 - shift.x, rect.height / 2 - shift.y));
    paper.view.center = paper.view.center.add(moved.subtract(project));
    pinch = { dist, midX, midY };
    publishNodes();
  }

  function onPointerUp(event: PointerEvent): void {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
  }

  function onDblClick(event: MouseEvent): void {
    if (mode === 'pen') {
      finishPen();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const point = paper.view.viewToProject(new paper.Point(event.clientX - rect.left, event.clientY - rect.top));
    const hit = hitAt(point);
    if (hit?.item.data?.role !== 'curve') return;
    const item = itemOf(hit.item.data.id as string);
    if (!item || item.dot) return;
    const location = item.path.getNearestLocation(point);
    if (!location) return;
    mutate(() => {
      item.path.divideAt(location);
    });
  }

  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', resize);
  window.addEventListener('scroll', publishNodes, true);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('dblclick', onDblClick);
  tool.activate();

  function simplifySegment(segment: EditSegment): CurveNode[] {
    geometry.activate();
    const path = new paper.Path();
    for (const point of segment.points) path.add(toPaper(point));
    path.closed = segment.closed;
    if (path.segments.length > 2) path.simplify(EDIT_FIT_TOL);
    const nodes = path.segments.map((part) => ({
      p: fromPaper(part.point),
      in: fromVector(part.handleIn),
      out: fromVector(part.handleOut),
    }));
    path.remove();
    return nodes;
  }

  function dotSegment(segment: EditSegment, id: string): DotPath {
    const points = segment.points;
    const start = points[0] ?? [0, 0];
    const end = points[points.length - 1] ?? start;
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      length += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    let left = length / 2;
    let center: [number, number] = [start[0], start[1]];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (left <= span || i === points.length - 1) {
        const t = span > 1e-9 ? Math.min(1, left / span) : 0;
        center = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
        break;
      }
      left -= span;
    }
    const angle = Math.atan2(end[1] - start[1], end[0] - start[0]);
    return { id, type: 'dot', center: [roundMm(center[0]), roundMm(center[1])], angle: roundMm(angle) };
  }

  const api: PathEditor = {
    freeze(segments) {
      const ranked = segments
        .map((segment, index) => ({ segment, index }))
        .filter((item) => item.segment.points.length >= 1);
      ranked.sort((a, b) => {
        const ax = Math.min(...a.segment.points.map((point) => point[0]));
        const bx = Math.min(...b.segment.points.map((point) => point[0]));
        const ay = Math.min(...a.segment.points.map((point) => point[1]));
        const by = Math.min(...b.segment.points.map((point) => point[1]));
        return ax - bx || ay - by || a.index - b.index;
      });
      const paths: OrderPath[] = [];
      let curves = 0;
      let dots = 0;
      for (const item of ranked) {
        if (item.segment.dot) {
          dots += 1;
          paths.push(dotSegment(item.segment, `d${dots}`));
          continue;
        }
        const nodes = simplifySegment(item.segment);
        if (nodes.length < 2) continue;
        curves += 1;
        paths.push({ id: `p${curves}`, closed: item.segment.closed && nodes.length >= 2, nodes });
      }
      return paths;
    },
    load(paths, nextCrossings) {
      undo.length = 0;
      redo.length = 0;
      selectedId = null;
      selectedIndex = null;
      apply({ paths: cloneDoc({ paths: paths.slice(), crossings: nextCrossings.slice() }).paths, crossings: nextCrossings.slice() });
      resize();
      fitView();
    },
    show() {
      canvas.hidden = false;
      toolbar.hidden = false;
      canvas.dataset.open = 'true';
      canvas.tabIndex = 0;
      canvas.style.touchAction = 'none';
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = '320px';
      canvas.style.background = '#141414';
      toolbar.style.display = 'flex';
      toolbar.style.flexWrap = 'wrap';
      toolbar.style.gap = '6px';
      toolbar.style.margin = '8px 0';
      resize();
    },
    close() {
      finishPen();
      canvas.hidden = true;
      toolbar.hidden = true;
      delete canvas.dataset.open;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', publishNodes, true);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('dblclick', onDblClick);
    },
  };

  api.show();
  return api;
}
