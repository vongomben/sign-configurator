// [B] Scheletro (SPEC §5): thinning di Zhang-Suen sulla bitmap di [A], poi pulizia dei pixel
// ridondanti (gradini, blocchi 2×2) per avere uno scheletro 8-connesso largo un pixel.
// Modulo puro, deterministico. La bitmap deve avere almeno 1 px vuoto sul bordo (il margine di [A]).

/** Offset degli 8 vicini in senso orario a partire da nord: P2..P9 della notazione di Zhang-Suen. */
function ringOffsets(width: number): number[] {
  return [-width, -width + 1, 1, width + 1, width, width - 1, -1, -width - 1];
}

/** Vicini (0/1) di `i` nell'ordine N, NE, E, SE, S, SW, W, NW. */
function ring(data: Uint8Array, i: number, off: readonly number[], out: Uint8Array): void {
  for (let k = 0; k < 8; k++) out[k] = data[i + off[k]!] ? 1 : 0;
}

/** Numero di transizioni 0→1 percorrendo l'anello degli 8 vicini (crossing number). */
export function crossings(n: Uint8Array): number {
  let a = 0;
  for (let k = 0; k < 8; k++) if (!n[k] && n[(k + 1) % 8]) a++;
  return a;
}

const count = (n: Uint8Array): number => n[0]! + n[1]! + n[2]! + n[3]! + n[4]! + n[5]! + n[6]! + n[7]!;

/** Zhang & Suen (1984), sulle sole celle piene: restituisce una nuova bitmap. */
export function zhangSuen(data: Uint8Array, width: number, height: number): Uint8Array {
  const img = data.slice();
  const off = ringOffsets(width);
  const n = new Uint8Array(8);
  // Solo i pixel del fronte (con almeno un vicino vuoto) possono essere tolti: si esaminano solo
  // quelli, e il fronte avanza con i vicini dei pixel tolti. Il risultato è quello del metodo classico.
  const inFront = new Uint8Array(img.length);
  let front: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (img[i] && off.some((o) => !img[i + o])) {
        inFront[i] = 1;
        front.push(i);
      }
    }
  }
  const remove: number[] = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const step of [0, 1]) {
      remove.length = 0;
      for (const i of front) {
        ring(img, i, off, n);
        const b = count(n);
        if (b < 2 || b > 6 || crossings(n) !== 1) continue;
        // N=0 E=2 S=4 W=6
        if (step === 0 ? n[0]! * n[2]! * n[4]! || n[2]! * n[4]! * n[6]! : n[0]! * n[2]! * n[6]! || n[0]! * n[4]! * n[6]!) {
          continue;
        }
        remove.push(i);
      }
      if (remove.length) {
        changed = true;
        for (const i of remove) img[i] = 0;
        const next = front.filter((i) => img[i]);
        for (const i of remove) {
          inFront[i] = 0;
          for (const o of off) {
            const j = i + o;
            if (img[j] && !inFront[j]) {
              inFront[j] = 1;
              next.push(j);
            }
          }
        }
        front = next;
      }
    }
  }
  return img;
}

/**
 * Punto semplice per l'8-connessione del pieno: i vicini pieni formano una sola componente
 * (8-adiacenza nell'anello) e i vicini vuoti 4-adiacenti a p una sola componente (4-adiacenza).
 */
function isSimple(n: Uint8Array): boolean {
  // Componenti dei pieni nell'anello: nell'anello ordinato, i pieni ai lati (k pari) sono adiacenti
  // ai due angoli vicini; due lati consecutivi (N ed E) sono adiacenti fra loro anche se l'angolo è vuoto.
  const seen = new Uint8Array(8);
  let fgComponents = 0;
  for (let s = 0; s < 8; s++) {
    if (!n[s] || seen[s]) continue;
    fgComponents++;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      const nb = k % 2 === 0 ? [(k + 1) % 8, (k + 7) % 8, (k + 2) % 8, (k + 6) % 8] : [(k + 1) % 8, (k + 7) % 8];
      for (const j of nb) {
        if (n[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
  }
  if (fgComponents !== 1) return false;
  // Componenti dei vuoti (4-adiacenza nell'anello: solo k±1) che contengono un lato vuoto.
  const seenBg = new Uint8Array(8);
  let bgComponents = 0;
  for (const s of [0, 2, 4, 6]) {
    if (n[s] || seenBg[s]) continue;
    bgComponents++;
    const stack = [s];
    seenBg[s] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      for (const j of [(k + 1) % 8, (k + 7) % 8]) {
        if (!n[j] && !seenBg[j]) {
          seenBg[j] = 1;
          stack.push(j);
        }
      }
    }
  }
  return bgComponents === 1;
}

/**
 * Toglie i pixel semplici con almeno 2 vicini (gradini e blocchi 2×2 lasciati da Zhang-Suen):
 * le estremità restano, la connettività pure.
 */
export function cleanSkeleton(skel: Uint8Array, width: number, height: number): Uint8Array {
  const img = skel.slice();
  const off = ringOffsets(width);
  const n = new Uint8Array(8);
  // In ordine raster, come una scansione completa dell'immagine.
  let alive: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) if (img[y * width + x]) alive.push(y * width + x);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const i of alive) {
      ring(img, i, off, n);
      if (count(n) >= 2 && isSimple(n)) {
        img[i] = 0;
        changed = true;
      }
    }
    if (changed) alive = alive.filter((i) => img[i]);
  }
  return img;
}

/** [B]: bitmap di [A] → scheletro largo un pixel. */
export function skeletonize(data: Uint8Array, width: number, height: number): Uint8Array {
  return cleanSkeleton(zhangSuen(data, width, height), width, height);
}

export { ringOffsets, ring, count as ringCount };
