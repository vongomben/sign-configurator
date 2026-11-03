// Testi della pagina cliente (SPEC §12). Una voce null non è ancora decisa (§10) e non si mostra.

export interface FaqEntry {
  id: string;
  question: string;
  /** null: il dato non è deciso e la voce non si mostra. */
  answer: string | null;
}

export const copy = {
  title: 'Scrivi o disegna. Guarda la tua insegna come verrà stampata davvero.',
  productName: 'Insegna neon',
  /** Tre voci. Un null si omette. */
  trust: [
    'Quello che vedi è quello che stampiamo.',
    'Il tuo disegno, non solo un font.',
    'Fatta qui, riparabile.',
  ] as (string | null)[],
  infoButton: 'Info',
  infoTitle: 'Informazioni',
  infoBack: "Torna all'insegna",
  steps: [
    { id: 'source', name: 'Testo o immagine', short: 'Sorgente' },
    { id: 'font', name: 'Font', short: 'Font' },
    { id: 'size', name: 'Dimensione', short: 'Misura' },
    { id: 'edit', name: 'Ritocca', short: 'Ritocca' },
    { id: 'color', name: 'Colore ed effetto', short: 'Colore' },
    { id: 'finish', name: 'Finitura', short: 'Finitura' },
    { id: 'request', name: 'Riepilogo e richiesta', short: 'Invio' },
  ],
  buttons: {
    back: 'Indietro',
    next: 'Avanti',
    skip: 'Salta',
    send: 'Invia richiesta',
    editPaths: 'Modifica tracciati',
    restorePaths: 'Ripristina originale',
    editorDone: 'Fatto',
    undo: 'Annulla',
    redo: 'Ripeti',
    customQuote: 'Non riesci a ottenere quello che vuoi?',
    share: 'Salva o condividi',
    downloadJson: 'Scarica il design (.json)',
    uploadJson: 'Carica un design',
    downloadStl: 'Scarica STL (test)',
    downloadCustomerStl: 'Scarica STL',
    generating: 'Generazione…',
    bringToSize: 'porta a {cm} cm',
    useOutline: 'Contorno',
    priceDetail: 'Dettaglio prezzo (test)',
  },
  price: {
    indicative: 'Prezzo indicativo',
    note: 'IVA inclusa, spedizione a parte. Si conferma con la bozza.',
  },
  source: {
    textTab: 'Testo',
    imageTab: 'Immagine',
    textLabel: 'Testo',
    counter: '{n} caratteri',
    fileLabel: 'Immagine',
    trace: 'Traccia',
    centerline: 'Linea centrale',
    outline: 'Contorno',
    threshold: 'Soglia',
    invert: 'Inverti',
  },
  font: {
    intro: 'Il testo che hai scritto, in ciascun font.',
  },
  size: {
    free: 'Misura libera',
    height: 'Altezza',
    footprint: 'Ingombro {w} × {h} cm',
    tooSmall: 'Sotto l\'altezza minima ({cm} cm)',
  },
  color: {
    palette: 'Colore',
    custom: 'Colore libero',
    fixed: 'Colore fisso',
    rainbow: 'Arcobaleno',
  },
  finish: {
    diffuserOn: 'Con diffusore',
    diffuserOff: 'Senza diffusore',
    soft: 'Luce morbida',
    bare: 'LED a vista',
    edgeSquare: 'Bordo dritto',
    edgeOuter: 'Bordo smussato',
    wall: 'Spessore cornice',
  },
  request: {
    summary: 'Riepilogo',
    supply: 'Alimentatore',
    plug: 'Spina EU',
    mount: 'Fissaggio a parete',
    proof: 'Bozza di approvazione',
    name: 'Nome',
    email: 'Email',
    phone: 'Telefono',
    phoneOptional: 'facoltativo',
    cap: 'CAP',
    city: 'Città',
    date: 'Entro quando ti serve',
    dateOptional: 'facoltativa',
    notes: 'Note',
    privacy: 'Ho letto l\'informativa e acconsento al trattamento dei dati per questa richiesta.',
    rights: 'Ho i diritti per usare questa immagine sull\'insegna.',
    subject: 'Richiesta insegna — {name}',
    attachJson: 'Allega il file del design: il link sarebbe troppo lungo.',
    confirmTitle: 'Richiesta pronta',
    confirmBody: 'Si apre il programma di posta con il riepilogo. La richiesta non è un ordine pagato.',
  },
  quote: {
    title: 'Preventivo su misura',
    description: 'Descrivi cosa non riesci a ottenere',
    approx: 'Misura approssimativa',
    budget: 'Budget',
    budgets: ['Fino a 150 €', '150–300 €', '300–600 €', 'Oltre 600 €', 'Non so'],
  },
  preview: {
    background: 'Sfondo',
    backgrounds: ['Muro chiaro', 'Muro scuro', 'Mattoni', 'Legno', 'Neutro'],
    dimensions: 'Quote',
    scale: 'Riferimento di scala',
    power: 'Accesa',
    off: 'Spenta',
  },
  warnings: {
    tight: 'A questa misura le curve sono troppo strette: da {cm} cm in su',
    editor: 'correggi o annulla',
    glyph: 'Questo font non ha il carattere "{ch}"',
    lowRes: 'Immagine poco definita per questa misura: fino a {cm} cm, o caricane una più grande',
    uneven: 'Prova la modalità Contorno',
    coverage: 'Alcuni tratti restano poco illuminati a questa misura',
    dot: 'Il puntino non si accende sotto {cm} cm',
  },
  info: {
    how: {
      title: 'Come funziona',
      steps: ['Crea l\'insegna e invia la richiesta.', 'Ricevi la bozza e la confermi.', 'Ricevi l\'insegna.'],
    },
    box: {
      title: "Cosa c'è nella scatola",
      parts: ['Cornice', 'Striscia', 'Diffusore', 'Alimentatore', 'Fissaggi'],
    },
    beforeAfter: {
      title: 'Prima e dopo',
      /** Nessuna foto nostra ancora: il pannello non mostra lo slider. */
      caption: null as string | null,
    },
    faq: [
      { id: 'safety', question: 'È sicura?', answer: 'Funziona a 5 V: niente vetro e niente calore da lampada.' },
      { id: 'power', question: 'Quanto consuma?', answer: null },
      { id: 'mount', question: 'Come si monta?', answer: 'Si fissa a parete. I pezzi si possono separare e sostituire.' },
      { id: 'clean', question: 'Come si pulisce?', answer: 'Con un panno morbido asciutto, a insegna spenta.' },
      { id: 'effects', question: 'Gli effetti costano di più?', answer: 'No: ogni LED è indirizzabile e gli effetti sono di serie.' },
      { id: 'warranty', question: 'Che garanzia ha?', answer: null },
      { id: 'shipping', question: 'Tempi e spedizione?', answer: null },
      { id: 'rights', question: 'Immagini e diritti?', answer: 'Se carichi un\'immagine, confermi di poterne fare un\'insegna.' },
      { id: 'changes', question: 'Posso modificarla dopo l\'ordine?', answer: null },
    ] as FaqEntry[],
  },
  /** Dati di §10 ancora aperti: restano null e non si mostrano. */
  pending: {
    leadTime: null as string | null,
    shipping: null as string | null,
    warranty: null as string | null,
    invoice: null as string | null,
    requestEmail: null as string | null,
    privacyBody: null as string | null,
  },
};

export function shown(value: string | null): value is string {
  return value != null;
}
