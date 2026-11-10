// Nome file degli STL del cliente (SPEC §5). Minuscolo, ASCII, trattini, al massimo 40 caratteri.

const SLUG_MAX = 40;

/** «Ciao Torino» → `ciao-torino`. Vuoto o senza lettere → `insegna`. */
export function signSlug(value: string): string {
  const ascii = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const cut = ascii.slice(0, SLUG_MAX).replace(/-+$/g, '');
  return cut || 'insegna';
}

export function stlFileName(source: string, heightMm: number, part: 'housing' | 'diffuser' | 'fondale'): string {
  return `${signSlug(source)}-${heightMm}mm-${part}.stl`;
}

/** File di taglio laser del fondale (SPEC §13): stesso nome dell'STL, in SVG. */
export function plateSvgFileName(source: string, heightMm: number): string {
  return `${signSlug(source)}-${heightMm}mm-fondale.svg`;
}
