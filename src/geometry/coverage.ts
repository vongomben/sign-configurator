// Copertura della striscia rispetto alla linea di riferimento (SPEC §5).
// Ogni millimetro è acceso o spento, e lo spento ha un motivo. Modulo puro.

import type { Params } from '../config';
import type { Point } from './rasterize';
import type { ValidationIssue } from './validate';

export type DarkReason = 'asola' | 'tasca' | 'incrocio' | 'avanzo' | 'corto' | 'validazione' | 'parete';

export const DARK_LABEL: Record<DarkReason, string> = {
  asola: 'asola',
  tasca: "tasca d'angolo",
  incrocio: "gap d'incrocio",
  avanzo: 'avanzo di taglio',
  corto: 'spezzone troppo corto',
  validazione: 'scartato dalla validazione',
  parete: 'parete senza compagna',
};

export interface DarkStretch {
  letter: string;
  reason: DarkReason;
  /** Lunghezza che entra nel conto. Per una parete è la metà del tratto. */
  lengthMm: number;
  points: Point[];
}

export interface LetterCoverage {
  letter: string;
  referenceMm: number;
  litMm: number;
  ratio: number;
}

export interface CoverageReport {
  letters: LetterCoverage[];
  stretches: DarkStretch[];
  /** null se ingrandire non basta, per esempio per le pareti senza compagna. */
  heightMm: number | null;
  warnings: { message: string; x: number; y: number }[];
}

interface GlyphMark {
  char: string | null;
  x: number;
}

interface CornerMark {
  x: number;
  y: number;
  segments: readonly number[];
}

const MAX_HEIGHT_MM = 2000;

const lengthOf = (points: readonly Point[]): number => {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  }
  return total;
};

function sliceSpan(points: readonly Point[], from: number, to: number): Point[] {
  if (points.length < 2 || to - from < 1e-4) return [];
  const out: Point[] = [];
  let traveled = 0;
  const push = (p: Point): void => {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 1e-4) out.push(p);
  };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const next = traveled + len;
    if (out.length === 0 && next >= from - 1e-9) {
      const t = len < 1e-9 ? 0 : Math.min(1, Math.max(0, (from - traveled) / len));
      push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    if (out.length > 0 && next >= to - 1e-9) {
      const t = len < 1e-9 ? 0 : Math.min(1, Math.max(0, (to - traveled) / len));
      push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      break;
    }
    if (out.length > 0 && next > from) push(b);
    traveled = next;
  }
  return out;
}

function lettersOf(glyphs: readonly GlyphMark[]): { char: string; x: number }[] {
  return glyphs.filter((glyph): glyph is { char: string; x: number } => glyph.char !== null && glyph.char.trim().length > 0);
}

function letterAt(x: number, letters: readonly { char: string; x: number }[]): string {
  let name = letters[0]?.char ?? '?';
  for (const letter of letters) if (x >= letter.x - 0.01) name = letter.char;
  return name;
}

function splitByLetter(points: readonly Point[], letters: readonly { char: string; x: number }[]): { letter: string; points: Point[] }[] {
  if (points.length < 2) return [];
  const parts: { letter: string; points: Point[] }[] = [];
  let letter = letterAt(points[0]![0], letters);
  let run: Point[] = [[points[0]![0], points[0]![1]]];
  const flush = (): void => {
    if (run.length >= 2) parts.push({ letter, points: run });
    run = [];
  };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const next = letterAt(b[0], letters);
    if (next === letter) {
      run.push([b[0], b[1]]);
      continue;
    }
    const boundary = letters.find((item) => item.char === next)?.x ?? b[0];
    const dx = b[0] - a[0];
    const t = Math.abs(dx) < 1e-6 ? 1 : Math.min(1, Math.max(0, (boundary - a[0]) / dx));
    const cut: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    run.push(cut);
    flush();
    letter = next;
    run = [cut, [b[0], b[1]]];
  }
  flush();
  return parts;
}

function pocketAt(
  id: number,
  points: readonly Point[],
  corners: readonly CornerMark[],
): { start: boolean; end: boolean } {
  const start = points[0];
  const end = points[points.length - 1];
  let atStart = false;
  let atEnd = false;
  if (!start || !end) return { start: false, end: false };
  for (const corner of corners) {
    if (!corner.segments.includes(id)) continue;
    const ds = Math.hypot(start[0] - corner.x, start[1] - corner.y);
    const de = Math.hypot(end[0] - corner.x, end[1] - corner.y);
    if (ds <= de) atStart = true;
    else atEnd = true;
  }
  return { start: atStart, end: atEnd };
}

interface Span {
  letter: string;
  reason: DarkReason | null;
  lengthMm: number;
  points: Point[];
  /** Quanto di questa lunghezza entra nel riferimento. */
  accountMm: number;
}

function spansOf(points: readonly Point[], letters: readonly { char: string; x: number }[], reason: DarkReason | null, accountRatio: number): Span[] {
  return splitByLetter(points, letters).map((part) => {
    const lengthMm = lengthOf(part.points);
    return { letter: part.letter, reason, lengthMm, points: part.points, accountMm: lengthMm * accountRatio };
  });
}

export function coverSign(input: {
  glyphs: readonly GlyphMark[];
  paths: readonly { points: Point[]; closed: boolean; reference?: boolean }[];
  gaps: readonly { points: Point[]; lengthMm: number }[];
  excluded: readonly { points: Point[] }[];
  walls: readonly { points: Point[] }[];
  corners: readonly CornerMark[];
  params: Pick<Params, 'CUT_PITCH' | 'WIRE_SLOT_L' | 'COVERAGE_MIN'>;
  heightMm: number;
}): CoverageReport {
  const letters = lettersOf(input.glyphs);
  const pitch = input.params.CUT_PITCH > 0 ? input.params.CUT_PITCH : 1;
  const slotL = Math.max(0, input.params.WIRE_SLOT_L);
  const spans: Span[] = [];

  input.paths.forEach((path, index) => {
    if (path.reference === false) return;
    const total = lengthOf(path.points);
    if (total < 1e-3) return;
    const slots = path.closed ? 0 : Math.min(slotL, total / 2);
    const useful = Math.max(0, total - 2 * slots);
    if (!path.closed && useful < pitch - 1e-6) {
      spans.push(...spansOf(path.points, letters, 'corto', 1));
      return;
    }
    const cut = Math.floor((useful + 1e-6) / pitch) * pitch;
    const pocket = path.closed ? { start: false, end: false } : pocketAt(index + 1, path.points, input.corners);
    const intervals: { from: number; to: number; reason: DarkReason | null }[] = [];
    if (!path.closed && slots > 1e-4) {
      intervals.push({ from: 0, to: slots, reason: pocket.start ? 'tasca' : 'asola' });
    }
    const litFrom = slots;
    const litTo = slots + cut;
    if (litTo - litFrom > 1e-4) intervals.push({ from: litFrom, to: litTo, reason: null });
    const tail = total - slots;
    if (tail - litTo > 1e-4) intervals.push({ from: litTo, to: tail, reason: 'avanzo' });
    if (!path.closed && slots > 1e-4 && total - tail > 1e-4) {
      intervals.push({ from: tail, to: total, reason: pocket.end ? 'tasca' : 'asola' });
    }
    for (const interval of intervals) {
      const slice = sliceSpan(path.points, interval.from, interval.to);
      if (slice.length < 2) continue;
      spans.push(...spansOf(slice, letters, interval.reason, 1));
    }
  });

  for (const gap of input.gaps) {
    if (gap.points.length >= 2) spans.push(...spansOf(gap.points, letters, 'incrocio', 1));
  }
  // Il puntino segue I_DOT_MODE: non è un tratto spento «scartato dalla validazione».
  for (const wall of input.walls) {
    if (wall.points.length >= 2) spans.push(...spansOf(wall.points, letters, 'parete', 0.5));
  }

  const byLetter = new Map<string, { reference: number; lit: number }>();
  const order = letters.map((letter) => letter.char);
  for (const name of order) byLetter.set(name, { reference: 0, lit: 0 });
  const stretches: DarkStretch[] = [];
  for (const span of spans) {
    if (span.accountMm < 1e-3) continue;
    const bucket = byLetter.get(span.letter) ?? { reference: 0, lit: 0 };
    bucket.reference += span.accountMm;
    if (span.reason === null) bucket.lit += span.accountMm;
    else stretches.push({ letter: span.letter, reason: span.reason, lengthMm: span.accountMm, points: span.points });
    byLetter.set(span.letter, bucket);
  }

  const reportLetters: LetterCoverage[] = [];
  for (const name of order) {
    const bucket = byLetter.get(name);
    if (!bucket || bucket.reference < 1e-3) continue;
    reportLetters.push({
      letter: name,
      referenceMm: bucket.reference,
      litMm: bucket.lit,
      ratio: bucket.lit / bucket.reference,
    });
  }

  const warnings: { message: string; x: number; y: number }[] = [];
  const heights: number[] = [];
  const minimum = input.params.COVERAGE_MIN;
  let blocked = false;
  for (const letter of reportLetters) {
    if (letter.ratio >= minimum - 1e-9) continue;
    const height = heightToClear(input, letters, pitch, slotL, letter.letter);
    if (height === null) blocked = true;
    else heights.push(height);
    const advice =
      height === null
        ? 'ingrandire non basta (restano tratti che scalano con la lettera)'
        : `altezza consigliata ${height.toFixed(0)} mm`;
    const stretch = stretches.find((item) => item.letter === letter.letter);
    const mid = stretch?.points[Math.floor((stretch.points.length - 1) / 2)] ?? [0, 0];
    warnings.push({
      message: `Lettera ${letter.letter}: copertura ${(letter.ratio * 100).toFixed(0)}% sotto ${(minimum * 100).toFixed(0)}%, ${advice}.`,
      x: mid[0],
      y: mid[1],
    });
  }
  const heightMm = blocked || heights.length === 0 ? (blocked ? null : input.heightMm) : Math.max(...heights);

  return { letters: reportLetters, stretches, heightMm, warnings };
}

/** Pareti rimaste senza coppia accettata: niente striscia sopra. */
export function unpairedWalls(
  edges: readonly { id: number; points: Point[] }[],
  pairing: { pairs: readonly { a: number; b: number }[]; dubious: readonly { a: number; b: number }[] } | null,
): { points: Point[] }[] {
  if (!pairing) return [];
  const paired = new Set<number>();
  for (const pair of pairing.pairs) {
    paired.add(pair.a);
    paired.add(pair.b);
  }
  const ids = new Set<number>();
  for (const doubt of pairing.dubious) {
    if (!paired.has(doubt.a)) ids.add(doubt.a);
    if (!paired.has(doubt.b)) ids.add(doubt.b);
  }
  return [...ids]
    .sort((a, b) => a - b)
    .map((id) => edges.find((edge) => edge.id === id))
    .filter((edge): edge is { id: number; points: Point[] } => edge !== undefined && edge.points.length >= 2)
    .map((edge) => ({ points: edge.points }));
}

/** Inserisce gli avvisi di copertura fra quelli dello spezzone e alza l'altezza minima. */
export function applyCoverage(
  strip: { issues: ValidationIssue[]; suggestion: { heightMm: number | null } },
  report: CoverageReport,
): void {
  for (const warning of report.warnings) {
    strip.issues.push({
      level: 'warning',
      bend: null,
      segmentId: null,
      radiusMm: null,
      message: warning.message,
      x: warning.x,
      y: warning.y,
    });
  }
  if (report.warnings.length > 0 && report.heightMm !== null) {
    const current = strip.suggestion.heightMm;
    if (current === null || report.heightMm > current) strip.suggestion.heightMm = report.heightMm;
  }
}

function ratioAt(
  input: Parameters<typeof coverSign>[0],
  letters: readonly { char: string; x: number }[],
  pitch: number,
  slotL: number,
  scale: number,
  letter: string | null,
): number {
  let reference = 0;
  let lit = 0;
  const add = (points: readonly Point[], account: number, illuminated: number): void => {
    const whole = Math.max(lengthOf(points), 1e-9);
    for (const part of splitByLetter(points, letters)) {
      if (letter && part.letter !== letter) continue;
      const share = lengthOf(part.points) / whole;
      reference += account * share;
      lit += illuminated * share;
    }
  };
  for (const path of input.paths) {
    if (path.reference === false) continue;
    const total = lengthOf(path.points) * scale;
    if (total < 1e-3) continue;
    const slots = path.closed ? 0 : Math.min(slotL, total / 2);
    const useful = Math.max(0, total - 2 * slots);
    const cut = useful < pitch - 1e-6 ? 0 : Math.floor((useful + 1e-6) / pitch) * pitch;
    add(path.points, total, cut);
  }
  for (const gap of input.gaps) add(gap.points, gap.lengthMm, 0);
  for (const wall of input.walls) add(wall.points, (lengthOf(wall.points) * scale) / 2, 0);
  return reference > 1e-3 ? lit / reference : 1;
}

function heightToClear(
  input: Parameters<typeof coverSign>[0],
  letters: readonly { char: string; x: number }[],
  pitch: number,
  slotL: number,
  letter: string,
): number | null {
  const minimum = input.params.COVERAGE_MIN;
  const at = (scale: number): number => ratioAt(input, letters, pitch, slotL, scale, letter);
  if (at(1) >= minimum - 1e-9) return input.heightMm;
  const limit = MAX_HEIGHT_MM / Math.max(input.heightMm, 1);
  if (at(limit) < minimum - 1e-9) return null;
  let lo = 1;
  let hi = limit;
  while (hi - lo > 0.02) {
    const mid = (lo + hi) / 2;
    if (at(mid) >= minimum) hi = mid;
    else lo = mid;
  }
  return Math.min(MAX_HEIGHT_MM, Math.ceil(input.heightMm * hi - 1e-9));
}
