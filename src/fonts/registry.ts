// Registro estendibile dei font (SPEC §4): per aggiungerne uno basta il TTF in public/fonts e una voce qui.
// Le misure sono in unità del font (font.unitsPerEm per em) e si ricavano una volta per font con
// measureFontMetrics (rasterize.ts) e measureTubes (tubes.ts); test/rasterize.test.ts verifica che
// corrispondano al TTF.

export interface TubeGeometry {
  /** Spessore di una linea del tubo. */
  lineWidth: number;
  /** Luce interna del tubo, mediana: varia molto lungo il tubo. */
  gap: number;
}

/**
 * centerline: lo scheletro è già la linea della striscia (Sacramento).
 * walls: ogni parete del tubo è una striscia a sé (Neonderthaw). L'accoppiamento in
 * una mediana è disattivato: gli occhielli piccoli non si accoppiano in modo affidabile.
 */
export type StripMode = 'centerline' | 'walls';

/** outline: TTF, pipeline [A]–[B]. stroke: tratto singolo, si entra in [C]. */
export type FontKind = 'outline' | 'stroke';

export interface FontEntry {
  id: string;
  name: string;
  kind: FontKind;
  /** Percorso relativo a `public/` */
  file: string;
  defaultTracking: number;
  /** Sommità del glifo "H" (ripiego "I") sopra la linea di base: è l'altezza richiesta dal cliente. */
  capHeightMeasured: number;
  /** Sommità del glifo "x". */
  xHeightMeasured: number;
  /** Lettere disegnate come tubi cavi: la bitmap ha due linee e la luce non si riempie. */
  hollowTubes: boolean;
  /** Obbligatorio con `hollowTubes`. */
  tube?: TubeGeometry;
  /** Come lo scheletro diventa la striscia. Vedi `StripMode`. */
  stripMode: StripMode;
  notes: string;
}

export const FONTS: readonly FontEntry[] = [
  {
    id: 'sacramento',
    name: 'Sacramento',
    kind: 'outline',
    file: 'fonts/Sacramento/Sacramento-Regular.ttf',
    defaultTracking: 0,
    capHeightMeasured: 1523,
    xHeightMeasured: 627,
    hollowTubes: false,
    stripMode: 'centerline',
    notes: 'SIL OFL. Tratto pieno, monolinea.',
  },
  {
    id: 'neonderthaw',
    name: 'Neonderthaw',
    kind: 'outline',
    file: 'fonts/Neonderthaw/Neonderthaw-Regular.ttf',
    defaultTracking: 0,
    capHeightMeasured: 789,
    xHeightMeasured: 391,
    hollowTubes: true,
    tube: { lineWidth: 19, gap: 41 },
    stripMode: 'walls',
    notes: 'SIL OFL. Tubi neon cavi: ogni parete è una striscia. L\'accoppiamento in mediana è disattivato.',
  },
  {
    id: 'hershey-script-simplex',
    name: 'Hershey Script Simplex',
    kind: 'stroke',
    file: 'fonts/HersheyScriptSimplex/HersheyScript1.svg',
    defaultTracking: 0,
    capHeightMeasured: 662,
    xHeightMeasured: 284,
    hollowTubes: false,
    stripMode: 'centerline',
    notes:
      'Hershey Script 1-stroke. Uso commerciale consentito con attribuzione (Hershey, National Bureau of Standards; formato di James Hurt). Vedi LICENSE.txt.',
  },
  {
    id: 'ems-allure',
    name: 'EMS Allure',
    kind: 'stroke',
    file: 'fonts/EMSAllure/EMSAllure.svg',
    defaultTracking: 0,
    capHeightMeasured: 699,
    xHeightMeasured: 346,
    hollowTubes: false,
    stripMode: 'centerline',
    notes: 'SIL OFL. Tratto singolo, derivato di Allura (nome riservato non usato). SVG di Sheldon B. Michaels e Windell H. Oskay.',
  },
];

export function getFont(id: string): FontEntry | undefined {
  return FONTS.find((f) => f.id === id);
}
