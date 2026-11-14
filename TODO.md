# TODO — configuratore insegne neon LED

Elenco di lavoro, aggiornato al 13 novembre 2026. Riferimenti: `SPEC.md` e le bozze in `docs/`.
Una voce si spunta quando `npm run check` passa.

## 1. Core

### Repo
- [x] Repo nell'organizzazione `lampados`
- [x] Licenza GPL-3.0-or-later
- [ ] README: cos'è, come si avvia, come si contribuisce
- [ ] Portare in `SPEC.md` §4ter (`docs/`)
- [ ] Riscrivere §12.5: formula e costanti di prezzo pubbliche, calcolo nel browser
- [x] Togliere `.github/workflows/deploy.yml` e lo script `deploy` (gh-pages)
- [x] `base` in `vite.config.ts`: `/` su Cloudflare Pages, `/sign-configurator/` altrove

### Prezzo (§12.5)
- [ ] Valori veri al posto dei segnaposto in `src/pricing.ts`
- [ ] Catalogo: strisce con `eurPerM` (`src/parts/strips.ts`)
- [ ] Catalogo: filamento con `eurPerG` (`src/parts/filament.ts`)
- [ ] Catalogo: materiali del fondale con `eurPerM2`
- [ ] `priceDate` e `priceSource` su ogni parte
- [ ] `PARTS_VERSION`; `partsVersion` nell'ordine, schema v5, migrazione v4 → v5
- [ ] Riga «Parts ≈ … €» nel riepilogo, con elenco e link a `parts.html`
- [ ] `new-part.yml`: campi prezzo, data, fonte

### Pagina cliente (v1.1)
- [x] Ingombro dell'insegna: frecce larghezza/altezza sull'anteprima, «Size» nel riepilogo, «Letter height» nello strumento Size
- [ ] L'insegna di partenza («Ciao» a 12 cm) nasce con «curves too tight» e l'invio bloccato: alzare la misura di partenza o attendere `HINGE_PITCH` misurato
- [ ] Puntino della *i*: l'accesso sono due fori Ø2,5 (`DOT_WIRE_HOLE_D`), stretti per 3 fili e per la striscia da 10 mm: decidere fra fori più larghi, asola piena o puntino non illuminato
- [x] Spessore della cornice spostato dall'anteprima allo strumento Tech, gruppo Channel, come «Wall thickness»
- [ ] Strumento Tech: disegno della sezione del pezzo (canale, pareti, fondo, striscia) con le quote, e una riga di spiegazione **in inglese** per ogni parametro (es. «Channel width: the groove the strip sits in. Strip width plus a little play.»)
- [ ] Strumento Tech: avviso in inglese quando il canale è più stretto della striscia (`CHANNEL_W` < `STRIP_W`) o meno profondo del suo spessore (`CHANNEL_DEPTH` < `STRIP_T`); oggi la pagina li accetta in silenzio
- [ ] Taglie sotto il minimo disattivate, con il motivo
- [ ] Alimentatore, fissaggio e bozza di approvazione nel riepilogo
- [ ] Pannello Info: come funziona, esploso, FAQ (§12.9)
- [ ] Miniature 2D dei font a tratto singolo
- [ ] Un colore per spezzone
- [ ] Trasformazioni per lettera nell'editor (§11)
- [ ] Editor dei tracciati più visibile nella home (oggi è in More → «Edit paths»): pulsante sull'anteprima o strumento suo nella barra
- [x] Salvare il design: salvataggio automatico nel browser, link `#o=`, file `.json`, «Start over» (strumento More)
- [x] Tolta `admin.html`. Gli slider di taratura (intensità, alone) non ci sono più: se servono, vanno in `debug.html`
- [ ] File di produzione (DXF dei fori, `bom.json`, ZIP): oggi non si scaricano da nessuna pagina
- [ ] «Send order» è ancora finto: diventa vero con `functions/api/request.ts`
- [ ] SPEC: togliere i riferimenti ad admin (§1, §5, §7, §8, §12)

### Scritture non latine (§4ter)
- [ ] Fase 0: i quattro font in `debug.html` a 200 e 400 mm; confermare o passare al ripiego
- [ ] Registro: `script`, `direction`, `shaper`, `heightGlyph`, `lazy`
- [ ] Caricamento `lazy` e miniature statiche
- [ ] Cinese (LXGW WenKai) e giapponese (M PLUS Rounded 1c)
- [ ] harfbuzzjs + bidi; ebraico (Playpen Sans Hebrew), poi arabo (Playpen Sans Arabic)
- [ ] Strumento Font: gruppi per scrittura, proposta del font giusto
- [ ] Test di §4ter

### Geometria e produzione
- [x] Suddivisione per il piatto di stampa: tagli verticali automatici, piatto 300 × 300 modificabile in Tech, cornice e diffusore, ZIP con tutti i pezzi, tagli tratteggiati sull'anteprima
- [ ] Suddivisione: scrivere la sezione nella SPEC (§14) e togliere la voce da «Fuori scope» (§9)
- [ ] Suddivisione: tagli orizzontali per insegne più alte del piatto (oggi solo un avviso)
- [ ] Suddivisione: tagli spostabili a mano sull'anteprima
- [ ] Suddivisione: spine di allineamento o incastri, per chi non usa il fondale
- [ ] `plate.dxf`
- [ ] Incisione «RETRO» sul fondale
- [ ] Test nuovi di §12.10

## 2. Cloudflare Pages + Functions → WooCommerce

I segreti (chiavi WooCommerce, secret di Turnstile, email delle richieste) stanno nelle variabili
di Cloudflare, mai nel repo. I nomi sono in `.dev.vars.example`.

### Infrastruttura
- [x] Progetto Cloudflare Pages collegato a questo repo, build `npm run build:public`, output `dist`
- [ ] Dominio
- [ ] Variabili e segreti (`.dev.vars.example`)
- [x] Spegnere GitHub Pages quando Cloudflare risponde

### `functions/api/request.ts` (Richiedi)
- [ ] Verifica del token Turnstile
- [ ] Ricalcolo del prezzo con `src/pricing.ts` (non ci si fida del numero mandato dal browser)
- [ ] Ordine WooCommerce «In attesa di pagamento» via REST, con configurazione e link `#o=`
- [ ] Honeypot e rate limit
- [ ] Email di notifica e conferma al cliente
- [ ] `mailto:` come ripiego

### WooCommerce
- [ ] Chiavi REST con i permessi minimi
- [ ] Prodotto o tipo d'ordine «insegna su misura»
- [ ] Informativa privacy e casella di consenso
- [ ] Casella sui diritti d'uso delle immagini caricate

### Pagina cliente, parti legate all'endpoint
- [ ] Widget Turnstile
- [ ] Prezzo nel riepilogo e su ogni taglia
- [ ] Modulo Richiedi (§12.7) e pagina di conferma
- [ ] Admin: scomposizione del prezzo voce per voce

### Contenuti
- [ ] Foto reali per galleria e «prima e dopo» (`public/gallery/`)
- [ ] Testi di vendita e barra di fiducia (`src/ui/copy.it.ts`)

## 3. Decisioni e misure

- [ ] Nome del progetto
- [ ] Valori delle costanti di prezzo
- [ ] Tempi di produzione e consegna
- [ ] Garanzia
- [ ] Costi e zone di spedizione
- [ ] Chi emette la fattura
- [ ] `HINGE_PITCH` della striscia da 10 mm
- [ ] Passo di taglio rispetto agli intagli
- [ ] Limite del controller: 10 A totali o per canale
- [ ] Cosa entra nei fori Ø3 (perni, viti M3, inserti a caldo)
- [ ] Kerf e spessori reali dei materiali del fondale
- [ ] Piano utile del laser (`PLATE_MAX_W` / `_H`)
- [ ] Fissaggio housing → lastra; conferma dei fori per i fili
