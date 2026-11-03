// Misure dei font a tubi cavi (SPEC §4): spessore della linea e luce interna del tubo, da una
// bitmap di riferimento. Servono a compilare il registro, una volta per font; l'accoppiamento
// delle due linee di ogni tubo avviene in [B]/[C] (SPEC §5).

import { squaredDistanceTo } from './distance';

/** Larghezze (px) misurate sull'asse dei pixel con valore `value`, ordinate. */
function ridgeWidths(data: Uint8Array, width: number, height: number, value: 0 | 1): number[] {
  const d2 = squaredDistanceTo(data, width, height, value === 1 ? 0 : 1);
  const out: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (data[i] !== value) continue;
      const di = d2[i]!;
      if (
        d2[i - 1]! > di || d2[i + 1]! > di || d2[i - width]! > di || d2[i + width]! > di ||
        d2[i - width - 1]! > di || d2[i - width + 1]! > di || d2[i + width - 1]! > di || d2[i + width + 1]! > di
      ) {
        continue;
      }
      // Distanza fra centri di pixel: un tratto largo n px ha l'asse a (n + 1) / 2 dal bordo opposto.
      out.push(2 * Math.sqrt(di) - 1);
    }
  }
  return out.sort((a, b) => a - b);
}

/**
 * Spessore della linea = moda delle larghezze sull'asse dei tratti pieni; luce del tubo = mediana
 * delle larghezze sull'asse dei vuoti fra 0.5 e 4 spessori (i vuoti più larghi sono occhielli e
 * spazi). La luce varia molto lungo il tubo (in Neonderthaw circa da 1.3 a 4 spessori).
 */
export function measureTubes(data: Uint8Array, width: number, height: number): { lineWidthPx: number; gapPx: number } {
  const counts = new Map<number, number>();
  for (const v of ridgeWidths(data, width, height, 1)) counts.set(Math.round(v), (counts.get(Math.round(v)) ?? 0) + 1);
  let lineWidthPx = 0;
  let best = -1;
  for (const [k, c] of [...counts].sort((a, b) => a[0] - b[0])) {
    if (c > best) {
      best = c;
      lineWidthPx = k;
    }
  }
  const gaps = ridgeWidths(data, width, height, 0).filter((v) => v >= 0.5 * lineWidthPx && v <= 4 * lineWidthPx);
  return { lineWidthPx, gapPx: gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 0 };
}
