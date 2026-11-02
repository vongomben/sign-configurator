// Caricamento dei TTF da public/fonts con opentype.js (SPEC §4).
// Nessun DOM: funziona nel main thread, nel worker e (con un lettore diverso) in Node.
import { parse, type Font } from 'opentype.js';
import { getFont } from './registry';

/** Legge i byte di un file relativo a `public/`. */
export type FontBytesReader = (file: string) => Promise<ArrayBuffer>;

/** Browser e worker: `BASE_URL` è assoluto, quindi l'URL vale anche dentro il worker. */
export const fetchFontBytes: FontBytesReader = async (file) => {
  const url = `${import.meta.env.BASE_URL}${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font non trovato: ${url} (HTTP ${res.status})`);
  return res.arrayBuffer();
};

const cache = new Map<string, Promise<Font>>();

/** Font del registro per id, analizzato una volta sola per contesto (main thread o worker). */
export function loadFont(id: string, read: FontBytesReader = fetchFontBytes): Promise<Font> {
  let font = cache.get(id);
  if (!font) {
    const entry = getFont(id);
    if (!entry) return Promise.reject(new Error(`Font sconosciuto: "${id}"`));
    font = read(entry.file).then((bytes) => parse(bytes));
    font.catch(() => cache.delete(id));
    cache.set(id, font);
  }
  return font;
}
