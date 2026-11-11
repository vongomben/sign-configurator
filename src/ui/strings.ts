// Testi della pagina cliente (SPEC §12.2): il meno possibile, in inglese breve. Icone, numeri e
// unità (mm, cm, V, A, LED/m) fanno il resto. Admin, debug e bend test restano in italiano.
// Gli avvisi del generatore sono in italiano (servono all'admin): `customerMessage` li traduce in
// poche frasi per il cliente e scarta tutto il resto.

export const S = {
  pageTitle: 'Neon sign configurator',
  tools: {
    text: 'Text',
    font: 'Font',
    size: 'Size',
    color: 'Color',
    image: 'Image',
    plate: 'Backdrop',
    tech: 'Tech',
    more: 'More',
  },
  sections: {
    text: 'Text',
    font: 'Font',
    size: 'Size',
    color: 'Color',
    image: 'Image',
    plate: 'Backdrop',
    tech: 'Technical settings',
    more: 'More',
  },
  sheet: { configure: 'Configure', request: 'Order', done: 'Done', aria: 'Tools' },
  view: { aria: 'View', on: 'On', off: 'Off' },
  diffuser: { aria: 'Diffuser', on: 'Diffuser', off: 'No diffuser' },
  frame: { label: 'Frame mm', aria: 'Frame thickness in millimetres' },
  request: 'Order',
  generating: 'Building…',
  heightStepDown: 'Minus 10 mm',
  heightStepUp: 'Plus 10 mm',
  heightAria: 'Height in millimetres',
  textAria: 'Text',
  color: { free: 'Custom', effectAria: 'Effect', fixed: 'Solid', rainbow: 'Rainbow' },
  image: {
    upload: 'Upload an image',
    hint: 'SVG · PNG · JPG',
    trace: 'Trace',
    centerline: 'Centerline',
    outline: 'Outline',
    threshold: 'Threshold',
    invert: 'Invert',
    backToText: 'Back to text',
  },
  plate: {
    materialAria: 'Backdrop material',
    shapeAria: 'Backdrop shape',
    none: 'None',
    margin: 'Margin',
    corner: 'Corner radius',
    size: (w: string, h: string, holes: number) => `${w} × ${h} cm · ${holes} holes`,
  },
  tech: {
    note: 'These change the printed parts: preview, STL files and order.',
    reset: 'Reset',
    density: 'LED density',
    voltage: 'Strip voltage',
    profile: 'Edge profile',
    controller: 'Controller',
  },
  more: { editPaths: 'Edit paths', restorePaths: 'Restore original' },
  plug: {
    label: 'Plug',
    aria: 'Power supply plug',
    title: (country: string) => `Power supply plug: ${country}. Universal input 100–240 V.`,
  },
  supply: {
    /** Pillola: modello, tensione e corrente nominale. */
    pill: (model: string, volts: number, amps: number) => `${model} · ${volts} V · ${amps} A`,
    /** Nessun modello del catalogo basta: solo quanto serve. */
    bare: (volts: number, amps: number) => `${volts} V · ${amps} A`,
    title: (model: string, needA: number, volts: number) =>
      `Power supply: ${model}. The sign needs ${needA} A at ${volts} V (25 % margin). See all parts.`,
    none: (needA: number, volts: number) => `No listed power supply gives ${needA} A at ${volts} V. See all parts.`,
    value: (model: string, volts: number, amps: number, needA: number) => `${model} · ${volts} V ${amps} A (needs ${needA} A)`,
  },
  order: { send: 'Send order', download: 'Download STL', blockedFallback: 'Fix the design before sending.' },
  status: {
    leds: (n: number) => `${n} LED`,
    noLeds: 'No LEDs',
    needHeight: 'Enter a height.',
    needText: 'Enter a text and a height.',
    needImage: 'Upload an SVG, PNG or JPG file.',
    fileTooBig: 'File over 10 MB.',
    noInk: 'Nothing left at this threshold.',
    failed: 'Could not build this sign.',
  },
  discard: 'Changing text, font or image discards your path edits. Continue?',
  editorBlocked: 'Fix or undo the marked paths.',
  summary: {
    image: 'Image',
    text: 'Text',
    font: 'Font',
    size: 'Size',
    color: 'Color',
    effect: 'Effect',
    diffuser: 'Diffuser',
    yes: 'Yes',
    no: 'No',
    frame: 'Frame',
    plate: 'Backdrop',
    plateValue: (shape: string, material: string, margin: number) => `${shape} · ${material} · ${margin} mm margin`,
    density: 'LED density',
    controller: 'Controller',
    plug: 'Plug',
    plugValue: (country: string) => `${country} · 100–240 V`,
    supply: 'Power supply',
    warning: 'Warning',
    profile: 'Edge profile',
    voltage: 'Strip voltage',
  },
};

/** Avviso del generatore → frase per il cliente, oppure null se non lo riguarda. */
export function customerMessage(warning: string): string | null {
  const rules: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/curva troppo stretta/, () => 'Some curves are too tight for the LED strip: make the sign bigger.'],
    [/sotto il passo di taglio/, () => 'A stroke is too short for the LED strip: make the sign bigger.'],
    [/^Sagome che si fondono/, () => 'Some strokes are too close together: make the sign bigger.'],
    [/bassa risoluzione/, () => 'Low-resolution image for this size: upload a larger one.'],
    [/tratto non uniforme/, () => 'Uneven stroke: try the Outline trace.'],
    [/^Puntino troppo piccolo|^Puntino non/, () => 'The dot is too small to light at this size.'],
    [/^Trattino fuori/, () => 'The dash does not fit inside the dot.'],
    [/oltre i (\d+) A del controller/, (m) => `Over the controller's ${m[1]} A: needs power injection or a second controller.`],
    [/oltre (?:gli|il limite di) (\d+) IC del controller/, (m) => `Over the controller's ${m[1]} LEDs: needs a second controller.`],
  ];
  for (const [pattern, phrase] of rules) {
    const match = warning.match(pattern);
    if (match) return phrase(match);
  }
  return null;
}

/** Avvisi tradotti, senza doppioni; quelli che il cliente non deve vedere spariscono. */
export function customerMessages(warnings: readonly string[]): string[] {
  return [...new Set(warnings.map(customerMessage).filter((m): m is string => m !== null))];
}
