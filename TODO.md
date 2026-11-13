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
- [ ] Taglie sotto il minimo disattivate, con il motivo
- [ ] Alimentatore, fissaggio e bozza di approvazione nel riepilogo
- [ ] Pannello Info: come funziona, esploso, FAQ (§12.9)
- [ ] Miniature 2D dei font a tratto singolo
- [ ] Un colore per spezzone
- [ ] Trasformazioni per lettera nell'editor (§11)

### Scritture non latine (§4ter)
- [ ] Fase 0: i quattro font in `debug.html` a 200 e 400 mm; confermare o passare al ripiego
- [ ] Registro: `script`, `direction`, `shaper`, `heightGlyph`, `lazy`
- [ ] Caricamento `lazy` e miniature statiche
- [ ] Cinese (LXGW WenKai) e giapponese (M PLUS Rounded 1c)
- [ ] harfbuzzjs + bidi; ebraico (Playpen Sans Hebrew), poi arabo (Playpen Sans Arabic)
- [ ] Strumento Font: gruppi per scrittura, proposta del font giusto
- [ ] Test di §4ter

### Geometria e produzione
- [ ] Suddivisione per il piatto di stampa: scrivere la sezione (oggi fuori scope, §9)
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
