# SPEC — Configuratore insegne neon LED (browser)

Documento di riferimento del progetto. Ogni prompt a Cursor lo richiama con `@SPEC.md`.
Se il codice e questo documento divergono, si aggiorna prima il documento.

## 1. Obiettivo

Web app 100% client-side (sito statico, nessun backend per la geometria):

- **Cliente**: scrive un testo e sceglie il font, oppure carica un'immagine (SVG, PNG, JPG, §4bis); sceglie altezza, spessore della cornice (`WALL`, da 1,6 a 5 mm) e colore; se vuole ritocca i tracciati nell'editor (§5bis); vede un'anteprima 3D dell'insegna accesa, invia l'ordine. Cambiare lo spessore rigenera l'anteprima.
- **Admin (Davide)**: dallo stesso JSON d'ordine rigenera in modo deterministico i file di produzione:
  1. `housing.stl` — cornice/canale da stampare in nero
  2. `diffuser.stl` — coperchio diffusore opzionale (bianco/naturale)
  3. `back.dxf` (+ `back.svg`) — fori sul retro per la CNC, visti dal retro
  4. `bom.json` — distinta: spezzoni di striscia, LED, fori, lunghezze

Unità: **millimetri** ovunque. Piano XY = piano dell'insegna, Z verso chi guarda. Il retro sta a Z = 0.

## 2. Hardware (vincoli fisici)

Striscia: TOPAI WS2812B COB 5 mm, RGBIC indirizzabile, 160 IC/m, connettori 3 pin.

| Parametro | Valore | Note |
|---|---|---|
| `STRIP_W` | 5.0 | larghezza striscia |
| `STRIP_T` | 2.0 | **DA MISURARE** |
| `BANK_TRANSITION_L` | 25 | pezzo D del campione di piegatura: transizione lineare dell'inclinazione prima e dopo l'arco. Non usata da [H]/[I] |
| `HINGE_PITCH` | 10.0 | intagli sui bordi ogni ~1 cm: la striscia piegata di lato si comporta come una catena di tratti rigidi |
| `HINGE_MAX_DEG` | 40 | sul pezzo B la striscia segue fino a 45° con leggera tensione; 40° è il margine del generatore |
| `CUT_PITCH` | 10.0 | passo di taglio (verificare se coincide con gli intagli) |
| `LED_PER_M` | 160 | |
| `LED_MAX_MA` | 60 | corrente di un LED a bianco pieno, per la stima a 5 V |
| Tensione | 5 V | l'annuncio dice anche 24 V: **DA VERIFICARE** |

Montaggio: striscia **piatta sul fondo del canale, LED verso chi guarda**, piegata di lato sfruttando le cerniere.

Raggio minimo derivato dal profilo: `R_MIN = HINGE_PITCH / (2·sin(HINGE_MAX_DEG/2))` (≈ 14,6 mm con 40°).
Altezza minima di lettera derivata: `MIN_LETTER_H = 2·R_MIN`, il diametro della piega più stretta.

### Profilo striscia (`src/config.ts`)

`STRIP_W`, `STRIP_T`, `CHANNEL_W`, `HINGE_PITCH`, `HINGE_MAX_DEG`, `CUT_PITCH` e `LED_PER_M`
stanno nel profilo `cob-5mm` (TOPAI WS2812B COB 5 mm), l'unica voce di `STRIP_PROFILES`.
Le altre strisce si aggiungono lì, senza un secondo elenco di numeri. `DEFAULT_PARAMS` copia
questi campi dal profilo di default. `R_MIN` e `MIN_LETTER_H` non si impostano: `resolveParams`
ricalcola `MIN_LETTER_H` da cerniera e passo.

## 3. Parametri geometrici (tutti in `src/config.ts`, sovrascrivibili)

| Parametro | Default | Significato |
|---|---|---|
| `CHANNEL_W` | 5.4 | larghezza canale su tratto dritto (STRIP_W + tolleranza) |
| `CHANNEL_DEPTH` | 8.0 | profondità canale |
| `WALL` | 2.2 | spessore parete (la "cornice") |
| `WALL_MIN` | 1.2 | spessore minimo della parete interna: la freccia non la assottiglia oltre |
| `MIN_GAP` | 1.0 | aria minima fra due sagome che non devono fondersi |
| `FLOOR` | 4.0 | spessore fondo |
| `ANCHOR_HOLE_D` | 3.2 | fori di ancoraggio sul retro (ciechi) |
| `ANCHOR_HOLE_DEPTH` | 3.0 | |
| `ANCHOR_SPACING` | 70 | distanza target fra fori lungo il percorso |
| `ANCHOR_MIN_PER_SEGMENT` | 2 | |
| `ANCHOR_BOSS` | false | se true: distanziali cilindrici sul retro |
| `ANCHOR_BOSS_D` / `_H` | 8 / 6 | |
| `WIRE_SLOT_W` | 5.4 | larghezza asola fili, di default = `CHANNEL_W`: tutta l'estremità del canale |
| `WIRE_SLOT_L` | 6.0 | ultimi mm dello spezzone occupati dall'asola, a filo della terminazione arrotondata |
| `SLOT_LIP_CHAMFER` | 1.0 | smusso a 45° sul labbro interno dell'asola, lato spezzone |
| `CORNER_MERGE_DIST` | 4.0 | sotto questa distanza due asole DIN/DOUT diventano una tasca d'angolo |
| `CABLE_HOLE_D` | 6.0 | ingresso del cavo principale |
| `CROSSING_GAP` | 3.0 | interruzione della striscia per lato a un incrocio |
| `DIFFUSER_T` | 1.2 | spessore diffusore (incastro a pressione in cima al canale) |
| `DIFFUSER_CLEARANCE` | 0.15 | |
| `MIN_LETTER_H` | `2·R_MIN` | derivato dal profilo striscia: diametro della piega più stretta |
| `CUSP_MODE` | `"split"` | `"split"` taglia lo spezzone nello spigolo; `"warn"` lo segnala soltanto |
| `I_DOT_MODE` | `"dot"` | puntino sotto R_MIN: `"dot"` spezzone con due fori, `"dash"` trattino con asole, `"omit"` lo esclude, `"unlit"` rilievo senza striscia |
| `DOT_WIRE_HOLE_D` | 2.5 | foro passante sotto ciascuna piazzola del puntino |
| `DOT_OVERHANG_MM` | 1.5 | di quanto la pillola, parete compresa, può uscire dal puntino |
| `COVERAGE_MIN` | 0.85 | sotto questa frazione di linea centrale illuminata, la lettera avvisa |
| `EDGE_PROFILE` | `"square"` | profilo dello spigolo superiore della parete: `"square"` \| `"outer"` \| `"inner"` \| `"both"` |
| `CHAMFER_SIZE` | 1.5 | altezza **verticale** dello smusso (≤ `CHANNEL_DEPTH`) |
| `CHAMFER_ANGLE` | 45 | angolo dello smusso rispetto all'orizzontale (0° < α < 90°) |
| `LAYER_STEP` | 0.2 | altezza delle fette dello smusso a gradini (= altezza layer di stampa) |
| `IMAGE_MAX_PX` | 4096 | lato lungo massimo di una bitmap caricata, dopo il ritaglio (§4bis) |
| `EDIT_FIT_TOL` | 0.3 | tolleranza della conversione spezzone → Bézier all'apertura dell'editor (§5bis) |
| `EDIT_MIN_NODE_DIST` | 0.5 | distanza minima fra due nodi consecutivi nell'editor |

Altezza totale = `FLOOR + CHANNEL_DEPTH`.

### Profilo dei bordi (`src/geometry/edgeProfile.ts`)

- `"square"`: spigoli vivi, geometria invariata.
- `"outer"`: smusso sullo spigolo superiore esterno della parete.
- `"inner"`: smusso sullo spigolo superiore interno, verso il canale: allarga l'apertura.
- `"both"`: entrambi.

Lo smusso è alto `CHAMFER_SIZE` e largo in orizzontale `run = CHAMFER_SIZE / tan(CHAMFER_ANGLE)`.
Si costruisce a gradini, con fette alte `LAYER_STEP`: per ogni fetta, offset con giunzioni
arrotondate (valore preso a metà fetta, crescente verso l'alto) del profilo esterno verso
l'interno e del canale verso l'esterno; tutte le fette si uniscono al corpo sottostante con
**un'unica** union.

Validazione (con avviso):
- `CHAMFER_SIZE` ≤ `CHANNEL_DEPTH`, altrimenti ridotto a `CHANNEL_DEPTH`.
- `"inner"` / `"both"`: la parete che resta in cima (`WALL − run`, o `WALL − 2·run`) deve essere
  ≥ 0.8 mm, altrimenti `CHAMFER_SIZE` viene ridotto finché lo è.
- `CHAMFER_ANGLE` fuori da (0°, 90°) o `LAYER_STEP` ≤ 0: smusso ignorato (profilo `"square"`).

## 4. Font

- **Sacramento** e **Neonderthaw** (Google Fonts, SIL OFL), font a contorno (`kind: "outline"`). Gli TTF vanno in `public/fonts/` insieme a `OFL.txt`.
- **Hershey Script Simplex** e **EMS Allure**, font a tratto singolo (`kind: "stroke"`). Non si rasterizzano: i path dei glifi sono già la linea della striscia. Hershey è di pubblico dominio con obbligo di attribuzione (`LICENSE.txt`). EMS Allure è un derivato OFL di Allura (`OFL.txt`); il nome riservato Allura non è usato.
- I font a contorno hanno tratto costante: la linea centrale si ricava per scheletrizzazione (sezione 5).
  - **Sacramento**: tratto pieno, monolinea; ogni lettera è un'unica regione (la *i* ha anche il puntino).
  - **Neonderthaw**: disegna il **tubo neon cavo** ed è il più adatto al prodotto. Ogni tubo è una
    **coppia di linee parallele**, spesso contorni separati (la *o* ne ha 4), a volte unite da una curva a U
    a un capo; le estremità delle due linee sono spesso sfalsate e il tubo si interrompe dove "passa
    dietro" un altro. Alcuni elementi sono **a linea singola** (barra della *t*, puntino della *i* ad
    anello). Lo spazio fra tubi vicini è largo quanto la luce interna: un criterio di sola larghezza sulla
    bitmap non distingue "dentro il tubo" da "fra due tubi", quindi la luce **non si riempie** in [A]
    (§5, [B]/[C]).
- Il registro dei font (`src/fonts/registry.ts`) è estendibile:
  `{ id, name, kind, file, defaultTracking, capHeightMeasured, xHeightMeasured, hollowTubes, tube?, stripMode, notes }`,
  con `file` relativo a `public/`. `kind` è `"outline"` (TTF) o `"stroke"` (tratto singolo).
  Per aggiungere un font basta il file in `public/fonts/` e una voce nel registro; le misure si
  ricavano una volta per font e un test verifica che corrispondano al glifo.
- `src/fonts/loadFont.ts` analizza il TTF con `opentype.parse`. `src/fonts/strokeFont.ts` legge i tratti
  singoli: SVG 1.1 `<font><glyph d="...">` (con avanzamento `horiz-adv-x` e kerning `hkern`, se ci sono)
  e JSON (glifi con `advance`, oppure l'array Hershey `chars` con avanzamento `o` e Y verso il basso).
  Niente DOM: funziona nel main thread, nel worker e in Node. I byte arrivano da un lettore iniettabile:
  `fetch` su `BASE_URL + file` nel browser, `fs` nei test.
- **Altezza**: le metriche dichiarate (OS/2) dei font script sono inaffidabili, quindi l'altezza richiesta
  dal cliente è la **sommità reale del glifo "H"** (ripiego "I"), misurata sul contorno dalla linea di base
  al punto più alto: `capHeightMeasured`. La **x-height** è la sommità del glifo "x": `xHeightMeasured`.
  Vale anche per i tratti singoli: la sommità è il punto più alto del path di "H", non il `cap-height`
  dichiarato. Valori (unità font): Sacramento 1523 / 627 (upm 2048), Neonderthaw 789 / 391 (upm 1000),
  Hershey Script Simplex 662 / 284, EMS Allure 699 / 346. Le altre
  maiuscole dei corsivi possono stare sopra o sotto la "H" (Neonderthaw: N ≈ +10 %).
- **`hollowTubes`**: `true` per Neonderthaw, `false` per Sacramento. Con `hollowTubes` il registro riporta
  `tube = { lineWidth, gap }` (unità font), misurati con `measureTubes` (`src/geometry/tubes.ts`) su
  maiuscole e minuscole: spessore della linea = moda delle larghezze sull'asse dei tratti pieni; luce =
  mediana delle larghezze sull'asse dei vuoti fra 0.5 e 4 spessori. Neonderthaw: linea 19, luce 41
  (varia circa da 25 a 75 lungo il tubo). La luce non si riempie in [A].
- **`stripMode`**: `"centerline"` o `"walls"`. Sacramento è `"centerline"`: lo scheletro è già la
  linea della striscia. Neonderthaw è `"walls"`: ogni parete del tubo è una linea monolinea e diventa
  un percorso di striscia, come Sacramento, da [B] a [D] senza accoppiamento.
- **Tratto singolo** (`src/geometry/strokeLayout.ts`, `strokeGraph.ts`): ogni sotto-path del glifo è
  una polilinea. L'avanzamento e il kerning, se il font li ha, spostano la penna. Gli estremi che
  distano al più 0,3 mm (lettere legate, o un estremo che cade sul filo di un altro tratto) diventano
  lo stesso nodo. Un incrocio fra due tratti diventa un nodo di grado 4. Non ci sono rami spuri da
  potare. In debug le linee del font stanno al posto della bitmap.

## 4bis. Sorgenti immagine

Al posto di testo + font il cliente può caricare un'immagine. Formati: **SVG**, **PNG**, **JPG**
(file ≤ 10 MB). L'immagine non lascia il browser finché l'ordine non è inviato.

Principio: la lettura del file (DOM, decodifica, gestione del colore) può cambiare da un browser
all'altro, quindi avviene **una volta sola, nel main thread**, e produce una forma normalizzata che
va nell'ordine (§6). La pipeline parte da quella forma, con moduli puri: stesso ordine, stessi file.
L'immagine originale non entra nell'ordine.

### Dimensioni

- `heightMm` per un'immagine è l'**altezza del riquadro d'ingombro** del disegno (tracciati SVG o
  pixel di inchiostro), non la sommità di una «H». La larghezza segue, a proporzioni bloccate.
- L'origine è l'angolo in basso a sinistra del riquadro d'ingombro; Y verso l'alto, come §5 [A].

### SVG (`src/sources/svgImport.ts` nel main thread, `src/sources/svgPaths.ts` puro)

- **Lettura** (main thread, `DOMParser`): si raccolgono `path`, `line`, `polyline`, `polygon`, `rect`,
  `circle`, `ellipse`, con le trasformazioni (`transform` di elemento e gruppi, `viewBox`) applicate
  e le coordinate portate in mm a `heightMm`. Ogni forma diventa un `d` assoluto (solo `M L C Q Z`),
  numeri arrotondati a 0,001 mm. `text`, `image`, `use` verso file esterni, maschere e filtri si
  ignorano, con un avviso per tipo.
- **Classificazione** per elemento, dagli stili calcolati:
  - `stroke` visibile e `fill` assente o `none` → **tratto** (`kind: "stroke"`): il path è già la
    linea della striscia ed entra in [C] come i font a tratto singolo (§4), senza [A] né [B].
    Gli estremi entro 0,3 mm diventano lo stesso nodo. Lo spessore del tratto SVG si ignora.
  - `fill` visibile → **area** (`kind: "fill"`, con `fillRule` `nonzero` o `evenodd`): i poligoni
    appiattiti (tolleranza 0,02 mm) entrano nel rasterizzatore [A], che accetta anche `evenodd`.
    Da lì prosegue secondo `trace` (sotto).
  - né l'uno né l'altro → ignorato, con avviso.
- Un SVG con tratti e aree insieme è valido: le due strade si uniscono in [C].

### PNG / JPG (`src/sources/rasterImport.ts` nel main thread, `src/sources/bitmapCodec.ts` puro)

- **Decodifica** (main thread): `createImageBitmap`, poi `getImageData` in `srgb`. La trasparenza si
  compone su bianco. Luminanza Rec. 709.
- **Soglia**: default Otsu, regolabile con uno slider 0–255; opzione `invert` (default: scuro =
  tratto). L'anteprima della soglia si aggiorna dal vivo.
- **Ritaglio** al riquadro dei pixel di inchiostro; lato lungo al massimo `IMAGE_MAX_PX` (4096):
  oltre si riduce prima della soglia, con avviso.
- **Bitmap nell'ordine**: binaria, alla risoluzione nativa dopo il ritaglio, codificata da
  `bitmapCodec.ts` in RLE: righe dall'alto, sequenze alternate che iniziano da 0, lunghezze in
  varint LEB128, tutto in base64.
- **Risoluzione**: `pxPerMm` = altezza in px / `heightMm`. Sotto 8 px/mm (limite noto di [B])
  avviso «immagine a bassa risoluzione per questa altezza», con l'altezza massima a 8 px/mm.
  Cambiare `heightMm` non richiede di rileggere l'immagine. Si aggiungono i 5 px vuoti di [A].

### `trace`: linea centrale o contorno

Vale per le aree SVG e per le bitmap.

- `"centerline"` (default): [B] → [C] come Sacramento. Adatto a firme e disegni a tratto uniforme.
  Se lo spessore del tratto (distance transform sui pixel dello scheletro) ha coefficiente di
  variazione > 0,35, avviso «tratto non uniforme: prova Contorno».
- `"outline"`: il **bordo** di ogni regione (e di ogni buco ≥ 0,05 mm²) è un percorso di striscia
  chiuso, come le pareti di `stripMode` `"walls"`. Contorni estratti con marching squares sulla
  bitmap, semplificati con Douglas-Peucker a 0,75 px. Adatto a loghi pieni. Le regioni più strette
  di `CHANNEL_W + 2·WALL + MIN_GAP` danno il solito avviso di fusione con l'altezza che le separa.

### Copertura e avvisi

Al posto delle lettere, il riferimento della copertura (§5) sono le **componenti connesse** del
disegno, numerate da sinistra a destra («regione 1», «regione 2»…). Tutto il resto (curve, spigoli,
puntini, `I_DOT_MODE`, fori, BOM) è invariato.

## 5. Pipeline

Vista di fronte, il solido è solo `offset(linea centrale levigata [E], CHANNEL_W/2 + WALL)`, con giunzioni e terminazioni arrotondate. Niente sporge da questa sagoma: asole, tasche, fori, canaline e distanziali stanno dentro la sagoma o sul retro. Il profilo esterno ha larghezza costante. La catena [F] non disegna il profilo: serve a validare le pieghe e a calcolare la freccia, che si ricava dalla parete interna e non la porta sotto `WALL_MIN`.

```
testo + font + altezza, oppure immagine (§4bis)
 → con "paths" nell'ordine (editor, §5bis): le curve entrano direttamente in [E], senza [A]–[D]
 → SVG a tratto: i path, in mm, entrano direttamente in [C]; aree SVG e bitmap: [A] con trace (§4bis)
 → con kind "stroke": i path dei glifi, in mm, entrano direttamente in [C] (niente [A] né [B])
 → [A] rasterizzazione, solo kind "outline" (rasterizzatore proprio, non canvas: contorni opentype.js → bitmap binaria)
 → [B] scheletro (thinning Zhang-Suen; fallback: asse mediano via d3-delaunay)
 → [C] grafo (nodi = estremi/giunzioni, archi = polilinee in mm), potatura rami spuri < larghezza tratto,
        fusione delle coppie di Y in incroci di grado 4.
        Con stripMode "walls" ogni parete è già un arco e prosegue in [D] come una monolinea.
 → [D] segmentazione:
        - nodi grado 4 = INCROCI: si accoppiano i rami per continuità di tangente; una coppia prosegue,
          l'altra viene interrotta di CROSSING_GAP per lato
        - componenti sconnesse (puntini, accenti) = spezzoni separati; un anello chiuso più piccolo del
          raggio minimo (es. puntino della i) segue `I_DOT_MODE`: `"dot"` (default) è uno spezzone
          con due fori, `"dash"` un trattino, `"omit"` lo esclude, `"unlit"` è un rilievo senza striscia
        - nodi grado 3: si sceglie la continuazione più dritta, il ramo restante diventa spezzone
 → [E] levigatura (Chaikin o spline) + ricampionamento
 → [F] simulazione catena: ricampionamento a corde di HINGE_PITCH, verifica angolo ≤ HINGE_MAX_DEG,
        freccia locale s = HINGE_PITCH² / (8R) → allarga il canale localmente
 → [G] validazione: ogni piega oltre il massimo è una curva (il raggio cresce con la scala) o uno
        spigolo (angolo in al più 2 cerniere, raggio che non cresce). L'altezza minima è la più alta
        fra curve, spezzoni corti e tratti non contigui che si fonderebbero.
        Gli spigoli si elencano a parte. `CUSP_MODE` `"split"` taglia lo spezzone nello spigolo
 → [H] 2D (manifold-3d CrossSection): offset della linea levigata [E] → canale (CHANNEL_W/2) e
        profilo esterno (CHANNEL_W/2 + WALL), giunzioni e terminazioni arrotondate, larghezza esterna costante;
        la freccia della catena allarga solo il lato interno, senza scendere sotto WALL_MIN;
        ai CROSSING_GAP il canale resta continuo, solo la striscia si interrompe;
        l'asola è gli ultimi WIRE_SLOT_L dello spezzone, a filo della terminazione arrotondata
 → [I] 3D (manifold-3d): estrusione profilo esterno (con smusso EDGE_PROFILE in cima) − canale
        − fori (ancoraggio, cavo) − asole fili e tasche d'angolo, con smusso SLOT_LIP_CHAMFER (+ boss)
 → [J] export: STL binario, DXF/SVG, BOM JSON
```

Tutto ciò che va da [A] a [J] gira in un **Web Worker** (Comlink). L'interfaccia non si blocca mai.

`generate(order)` esegue [A]–[I] nel worker e restituisce
`{ housingMesh, diffuserMesh, holes, slots, pockets, outline, centerlines, lightPoints, ledGapMm, bom, warnings }`.
Le mesh sono i triangoli in mm, nello stesso riferimento dell'STL. `holes` sono gli ancoraggi (ciechi)
e il cavo; `slots` e `pockets` i contorni reali di asole e tasche; `outline` il profilo esterno;
`centerlines` le linee centrali degli spezzoni. `lightPoints` sono i LED sulla parte illuminata di
ogni linea centrale (`pos`, `dir` da DIN a DOUT, `segment`, `index`): oggi a `LED_PER_M` (160 al metro
della striscia COB); un pixel a passo libero userà lo stesso elenco. `ledGapMm` è
`CHANNEL_DEPTH − STRIP_T`, la distanza fra la faccia del LED e il diffusore.
La pagina di debug mostra il solido in grigio, senza
effetti, e scarica `housing.stl` e `diffuser.stl`. «Ciao Torino» con entrambi i font resta sotto i 3 secondi.
L'interfaccia non aspetta il solido: la generazione 3D parte dopo il disegno 2D.

### Anteprima (`src/viewer/scene.ts`)

La scena three.js non sa se la sorgente è una striscia COB o un pixel: legge `lightPoints`.

- **Housing**: nero opaco, appena satinato. Il **diffusore** è una mesh a parte.
- **Spenta**: diffusore bianco opaco, luce ambiente diurna, niente bloom.
- **Accesa**: sul diffusore la luminosità è la somma di gaussiane centrate sui `lightPoints`.
  La sigma è `ledGapMm`, così se il passo è grande rispetto alla profondità i punti restano
  visibili, e se è fitto si fondono. Il bloom (`UnrealBloomPass`) ha soglia alta, intensità e
  raggio bassi: il nucleo resta del colore del LED e non sbianca. Sulla parete la stessa
  gaussiana disegna l'alone, che si spegne entro circa 2–3 volte la larghezza del tratto.
  Il tone mapping è ACES; l'esposizione si regola.
- **Senza diffusore**: la mesh del coperchio si nasconde e i LED sono piccoli emettitori nel canale.
- **Effetto**: `"colore fisso"` (default) dà a ogni LED esattamente il colore scelto;
  `"arcobaleno"` lo fa scorrere lungo lo spezzone, dal DIN al DOUT. Con `prefers-reduced-motion`
  lo scorrimento si ferma.
- In admin due slider, intensità (esposizione, default 0,85) e alone (gaussiana sulla parete
  e raggio del bloom, default 0,16), per tarare. Il cliente non li vede e usa quei default.
- Sfondo a muro. `OrbitControls` restano sulla vista frontale, ±40° in azimut e in altezza.
- Su un laptop si punta ai 60 fps (pixel ratio al massimo 1,5, mappa di luminosità fino a 512 px).
  Su mobile il pixel ratio è 1, la mappa arriva a 256 px e il bloom è calcolato a metà risoluzione.

### [A] Rasterizzazione (`src/geometry/rasterize.ts`)

Modulo puro, **senza DOM e senza canvas**: lo stesso codice dà gli stessi byte nel worker, nel main
thread e in Node. Canvas e OffscreenCanvas sono esclusi perché applicano l'antialiasing e il risultato
dipende da browser e GPU, il che romperebbe il determinismo (§6).

- **Input**: testo su una riga (gli a capo diventano spazi, con avviso), `fontId`, `heightMm` (= sommità
  della "H", `capHeightMeasured`, §4), risoluzione `pxPerMm` (default 10).
- **Contorni**: `font.forEachGlyph` con kerning attivo e `letterSpacing` 0 (`defaultTracking` non si
  applica qui); le legature standard del font restano attive. Le curve di Bézier quadratiche e cubiche
  sono appiattite in poligoni con tolleranza **0.02 mm** (numero di segmenti dalla stima della curvatura
  massima). Coordinate in mm, origine sulla linea di base all'inizio del testo, Y verso l'alto.
- **Riempimento**: scanline scritto a mano, regola **nonzero**, un campione al centro di ogni pixel, nessun
  antialiasing. Un pixel vale 1 se il suo centro sta dentro il contorno.
- **Output**: `Uint8Array` binaria (0/1, riga per riga dall'alto), `width`, `height`, con **5 px vuoti** su
  ogni lato. La trasformazione px→mm è `x = originX + px · mmPerPx`, `y = originY − py · mmPerPx` (bordi
  dei pixel su coordinate intere, centri a +0.5). La griglia è allineata all'origine del testo, quindi
  la linea di base cade su un bordo di pixel.
- **Misure esposte (mm)**: altezza (sommità della "H"), x-height (sommità della "x"), **ingombro totale
  reale** (bbox dei contorni: larghezza × altezza, discendenti e svolazzi compresi) e di ogni glifo,
  avanzamento totale, corpo del font (em); per i font `hollowTubes` anche spessore della linea e luce del
  tubo alla scala del testo. Con `stripMode` `"walls"` non servono all'accoppiamento: le pareti sono le strisce.
- **Font a tubi cavi**: la bitmap è fedele al font, con due linee per tubo; nessun riempimento della luce
  (§4). La pagina di debug lo segnala con un avviso.
- **Tetto di 40 milioni di pixel**: oltre, la risoluzione si riduce in proporzione, con avviso.
- **Avvisi**: un avviso per ogni carattere senza glifo nel font (con il codice U+XXXX); il carattere viene
  saltato, senza il riquadro `.notdef`.
- **Test** (`test/rasterize.test.ts`, `test/distance.test.ts`): misure del registro uguali al TTF; sommità
  di "H" e "x" alle altezze attese e maiuscole entro ±1 px; determinismo byte per byte; area di rettangolo
  e anello sintetici entro 1%; topologia (regioni e buchi ≥ 0.05 mm²) di ogni lettera identica a 10 e a
  30 px/mm; carattere mancante → avviso; distance transform uguale alla forza bruta; `measureTubes` su
  tubi sintetici e coerente con il registro.

### [B] Scheletro (`src/geometry/skeleton.ts`) e [C] grafo (`src/geometry/graph.ts`)

Moduli puri e deterministici come [A]. Valgono per i font monolinea e, con `stripMode` `"walls"`, per
ogni parete di un tubo cavo: gli archi del grafo sono già i percorsi della striscia.

- **Forellini**: prima del thinning si riempiono i buchi con area < (tratto/6)² (`HOLE_FILL_MAX_W`), nati
  dalla sovrapposizione dei contorni del font (in Sacramento < 0,1 mm² a 100 mm). I buchi veri (puntino
  della *i*, occhielli, da ~2 mm²) restano.
- **[B]**: thinning di **Zhang-Suen** (solo i pixel del fronte, stesso risultato del metodo classico),
  poi pulizia dei pixel semplici con almeno 2 vicini (gradini, angoli): scheletro 8-connesso largo 1 px,
  con la stessa topologia della bitmap.
- **Larghezza del tratto**: mediana di 2·d − 1 px sui pixel dello scheletro, con d dalla distance
  transform euclidea esatta (`distance.ts`). È il metro di tutte le soglie del grafo.
- **[C] nodi**: pixel con un numero di vicini ≠ 2 o crossing number ≠ 2; i pixel-nodo adiacenti formano
  **un solo nodo** (baricentro). Un anello senza nodi (puntino della *i*) riceve un nodo di grado 2.
  **Archi**: polilinee in mm da nodo a nodo, semplificate con Douglas-Peucker a 0,75 px (la catena di
  pixel a gradini allungherebbe gli archi del 5–8%).
- **Semplificazione**, ripetuta finché il grafo cambia:
  1. **rami spuri**: arco estremo–giunzione più corto della larghezza del tratto → potato;
  2. piccoli anelli (< π · tratto) su una giunzione → potati; **bolle** (due archi fra gli stessi nodi,
     somma < π · tratto) → resta il più corto;
  3. **incroci**: il thinning restituisce un incrocio come due Y unite da un arco corto. Si contrae in
     un nodo di grado 4 (a metà dell'arco) se l'arco è più corto del tratto; oppure, fra due giunzioni di
     grado 3, se è entro 2 tratti e i quattro rami formano due percorsi passanti con deviazione ≤ 60°;
     oppure se è entro 5 tratti e i rami esterni tornano indietro di almeno 120° rispetto all'arco e
     proseguono in linea retta (± 35°) dall'altra parte (X stretta, fino a ~20°). Due T a 3 tratti
     (come in una "H") restano distinte;
  4. nodi di grado 2 fra due archi diversi → archi uniti.
- **Lettere isolate**: in Sacramento "l", "e", "b" da sole non hanno tratto d'attacco. Il tratto parte
  dentro l'asola e finisce di testa sull'asta, quindi il nodo è di grado 3. In una parola il tratto
  arriva dalla lettera precedente e l'asola diventa un incrocio di grado 4.
- **Limite noto**: sotto gli 8 px/mm un varco di ~0,2 mm fra due tratti (occhiello della "d" di
  Sacramento) si chiude nella bitmap e cambia la topologia; a 10 px/mm (default) è corretto.
- **Debug**: scheletro sopra la bitmap schiarita, archi come polilinee, nodi colorati per grado
  (1 verde, 2 grigio, 3 arancio, 4 rosso, ≥ 5 viola), conteggi di nodi per grado e archi, larghezza del
  tratto, rami potati, giunzioni fuse, forellini riempiti, tempo nel worker.
- **Test** (`test/graph.test.ts`): linea, anello (lunghezza 2π·r ± 3%), "X" a 20°/30°/40°/60°/90° →
  un nodo di grado 4, "T" → grado 3, "H" stretta → due T distinte, forellino riempito, determinismo;
  Sacramento: in "alebe" le asole di l, e, b sono nodi di grado 4 e gli estremi sono solo i 4 veri,
  topologia uguale a 8, 10 e 15 px/mm; l/e/b isolate senza incroci né rami spuri; alfabeto senza rami
  più corti del tratto, uguale a 8, 10 e 12 px/mm; i puntini delle *i* di "Ciao Torino" restano anelli.

### Font a tubi cavi (`stripMode` `"walls"`)

Neonderthaw ha `stripMode` `"walls"`. La luce del tubo non si riempie sulla bitmap (§4), lo scheletro
resta due linee, e **ogni parete è un percorso di striscia**: [B] → [C] → [D] come per Sacramento.

`src/geometry/tubePairing.ts` accoppiava le due pareti lungo la normale reciproca e le sostituiva con
la linea mediana. **Non è nella pipeline.** Gli occhielli piccoli non si accoppiano in modo
affidabile: sono archi concentrici di lunghezza molto diversa. Sulla *g* di «Ciao» a 200 mm il tratto
reciproco era 26,5 mm, sotto i 30,4 mm richiesti (2 volte la distanza nominale), e la parete restava
senza compagna. Allargare le soglie avrebbe accoppiato tubi diversi. Il modulo resta nel codice, con
i suoi test, ma `generate` e il worker non lo chiamano.

Le due pareti dello stesso tubo sono due tratti non contigui. La validazione delle distanze vale
anche fra loro: l'altezza minima tiene i due canali affiancati, con almeno `MIN_GAP` fra le sagome
(`CHANNEL_W + 2·WALL + MIN_GAP` fra le linee centrali).

### Curve, spigoli e puntini

Una cerniera oltre `HINGE_MAX_DEG` si classifica confrontando la catena con la stessa geometria a scala ×2:

- **curva**: il raggio locale cresce (almeno ×1,5). Si risolve ingrandendo il testo. L'altezza minima
  consigliata è la più piccola che porta ogni curva almeno a R_MIN, cioè altezza × R_MIN / raggio,
  e che tiene i tratti non contigui della linea centrale ad almeno `CHANNEL_W + 2·WALL + MIN_GAP`.
  Con `stripMode` `"walls"` le due pareti dello stesso tubo sono due tratti non contigui: l'altezza
  minima garantisce due canali affiancati con `MIN_GAP` fra le sagome.
  Se due tratti non contigui sono più vicini, le sagome si fondono: avviso con la posizione e
  l'altezza che li separa (le distanze scalano con l'altezza). Quel valore entra nel riepilogo
  «altezza minima». Se non ci sono curve né fusioni, l'altezza può scendere fino al passo di taglio.
  Gli spigoli non entrano nel conto.
- **spigolo**: l'angolo è concentrato in al più 2 cerniere e il raggio non cresce (cuspide del font o
  dello scheletro). Non si risolve con la scala. Si riporta a parte, con conteggio e posizione.
  Con `CUSP_MODE` `"split"` (default) lo spezzone si taglia nello spigolo in due spezzoni, ma solo se
  entrambi restano almeno a `CUT_PITCH` di luce dopo le asole. Altrimenti lo spigolo resta un errore
  e la striscia non si interrompe. Uno spezzone sotto quella luce si unisce al capo vicino, se i due
  estremi si toccano; non si scarta in silenzio. Ciascuno spezzone ha
  il proprio verso (DIN = estremità con x minore, poi y minore). Se l'asola d'uscita di uno e quella
  d'ingresso dell'altro si sovrappongono, o i labbri distano meno di `CORNER_MERGE_DIST`, diventano
  un'unica tasca `CORNER_POCKET` (unione delle due asole, a piena larghezza del canale, con
  `SLOT_LIP_CHAMFER` su entrambi i lati d'ingresso) e il filo fra i due spezzoni è 0 mm.
  Con `"warn"` lo spigolo resta un errore e lo spezzone non si taglia.

`I_DOT_MODE` vale per ogni anello chiuso di raggio equivalente sotto R_MIN:

- `"omit"`: l'anello non entra nella striscia e genera un avviso.
- `"dot"` (default): uno spezzone dritto lungo `CUT_PITCH`, centrato sul puntino e orientato come
  l'asta più vicina. Il canale è una pillola (la linea più le testate tonde). Al posto delle asole
  ci sono due fori passanti `DOT_WIRE_HOLE_D` sotto le piazzole, uno per estremità. I `WIRE_SLOT_L`
  non si sottraggono: la luce è tutto lo spezzone e i LED sono `round(CUT_PITCH · LED_PER_M / 1000)`.
  Nella BOM è uno spezzone a sé e non conta fra le asole. L'ingombro del puntino è il contorno
  dell'inchiostro (lo scheletro allargato di mezzo spessore del tratto), non la linea dello scheletro.
  Ci sta se il rettangolo lungo `CUT_PITCH` e largo `CHANNEL_W + 2·WALL` esce al più di
  `DOT_OVERHANG_MM` da quell'ingombro. Se non ci sta, rilievo senza striscia, con avviso e altezza
  minima: nessuno spezzone con luce sotto il passo di taglio.
- `"dash"`: come sopra, ma con le asole normali. Il trattino, parete compresa, deve stare nel puntino
  allargato al massimo di `WALL`. Se non ci sta, `"unlit"` con la posizione.
- `"unlit"`: sagoma piena in rilievo, senza canale e senza striscia, quindi senza LED.

### Copertura

Nessun tratto della lettera resta spento o sparisce senza un motivo. La lunghezza di riferimento,
per lettera, sono gli archi del grafo. Con `stripMode` `"walls"` ogni parete del tubo entra nel
riferimento, quindi la striscia è circa il doppio della linea mediana.

La parte illuminata è la luce dello spezzone dopo le asole, arrotondata al passo di taglio. Il resto
è spento e ha un motivo: asola, tasca d'angolo, gap d'incrocio, avanzo di taglio, spezzone troppo
corto. Il puntino della *i* segue `I_DOT_MODE` e non entra in questo
conto come tratto spento. Acceso più spento ricostruisce il
riferimento. Sotto `COVERAGE_MIN` (0,85) la lettera avvisa, con l'altezza che la porta sopra la
soglia quando il buco è fatto di asole, gap e avanzi fissi.

Nella pagina di debug i tratti spenti sono tratteggiati in grigio con l'etichetta del motivo, e una
tabella riporta riferimento, millimetri illuminati e percentuale per lettera. Gli avvisi sono
raggruppati per spezzone, in una lista comprimibile, con in cima
il riepilogo (curve, spigoli, incroci, altezza minima) e la tabella di copertura per lettera.
Un errore di validazione non spegne la striscia: il tratto resta illuminato e marcato. Sul disegno ogni piega ha un
marcatore numerato: cerchio per la curva, triangolo per lo spigolo. Un clic sull'avviso ingrandisce
la vista su quel punto.

### Fori

- **Ancoraggio**: sulla linea centrale, sotto la striscia, ciechi dal retro. Distribuiti ogni `ANCHOR_SPACING`, almeno `ANCHOR_MIN_PER_SEGMENT` per spezzone, lontani dall'asola, dalla tasca d'angolo, dagli incroci e dagli altri fori (≥ 10 mm). Se una stazione interseca uno di questi ostacoli, il foro si sposta lungo la linea centrale verso il punto valido più vicino: non si elimina. Se nello spezzone ne restano meno del minimo, c'è un avviso con la posizione.
- **Fili**: asola passante attraverso il fondo, a inizio e fine di ogni spezzone. Occupa gli ultimi `WIRE_SLOT_L` dello spezzone stesso, a filo della terminazione arrotondata: larga quanto il canale (`WIRE_SLOT_W` = `CHANNEL_W` per default) e con la stessa forma del fondo. Non c'è prolungamento oltre la sagoma. La parte illuminata finisce dove inizia l'asola (il labbro) e lì la striscia scende verso il retro. Sullo spigolo interno del labbro, lato spezzone, c'è uno smusso di `SLOT_LIP_CHAMFER` a 45°.
- **Tasca d'angolo**: quando due asole, l'uscita di uno spezzone e l'ingresso del successivo, si sovrappongono o distano meno di `CORNER_MERGE_DIST`, al loro posto c'è una sola tasca passante, intersezione con il canale (mai oltre), con lo smusso del labbro su entrambi i lati da cui entra la striscia.
- **Cavo**: all'inizio del primo spezzone.

### Verso degli spezzoni

La striscia è indirizzabile (WS2812B): il segnale entra da **DIN** ed esce da **DOUT**.
Ogni spezzone ha quindi un verso: l'inizio del percorso è il DIN, la fine è il DOUT, e la
striscia va montata in quel verso (freccia stampata sulla striscia). L'asola d'inizio porta i
fili d'ingresso, quella di fine i fili d'uscita. La BOM indica il verso di ogni spezzone.

### DXF

Visto **dal retro**, cioè specchiato in X, nello stesso sistema di riferimento dell'STL.
Layer: `ANCHOR_HOLES` (CIRCLE), `WIRE_SLOTS` (LWPOLYLINE chiusa del contorno reale dell'asola), `CORNER_POCKETS` (LWPOLYLINE chiusa della tasca d'angolo), `CABLE_HOLE` (CIRCLE), `OUTLINE` (LWPOLYLINE).

### BOM

```json
{ "segments": [{ "id": 1, "lengthMm": 0, "ledCount": 0, "cutLengthMm": 0,
                 "din": [0,0], "dout": [0,0], "dinDir": [1,0], "doutDir": [1,0] }],
  "totalLeds": 0, "anchorHoles": 0, "wireSlots": 0,
  "wireSlotW": 5.4, "wireSlotL": 6,
  "corners": [{ "x": 0, "y": 0, "segments": [1, 2], "wireMm": 0 }],
  "assembly": { "segments": 0, "solderJoints": 0, "wires": 0, "corners": 0,
                "wireM": 0, "totalLeds": 0, "maxCurrentA": 0, "supplyA": 0 },
  "warnings": [] }
```

`lengthMm` è la lunghezza della linea centrale. LED e `cutLengthMm` usano la parte illuminata:
lo spezzone meno `WIRE_SLOT_L` a ogni capo libero (un anello chiuso e un puntino `"dot"` non hanno
asole: la luce è tutta la lunghezza). `cutLengthMm` è
quella lunghezza arrotondata per difetto a multipli di `CUT_PITCH`.
`din` / `dout` = posizione (mm, vista frontale) del labbro, dove finisce la parte illuminata;
`dinDir` / `doutDir` = tangente unitaria del percorso in quei punti, nel verso DIN → DOUT.
`wireSlotW` / `wireSlotL` = dimensioni dell'asola. `wireSlots` = asole rimaste singole: due per spezzone,
meno le due assorbite da ogni tasca. Uno spigolo diviso (`CUSP_MODE` `"split"`), un trattino
(`"dash"`) o un puntino (`"dot"`) aggiunge uno spezzone. Il puntino `"dot"` non ha asole: ha due
fori `DOT_WIRE_HOLE_D`. Un puntino `"unlit"` non entra nella BOM.
`corners` = giunti d'angolo: posizione del labbro comune, spezzoni collegati, filo 0 mm.

`assembly` è il riepilogo di montaggio, in cima alla tabella BOM nella pagina di debug:

- `segments`: spezzoni
- `solderJoints`: collegamenti DIN/DOUT da saldare (i giunti d'angolo non contano); ogni collegamento porta 3 fili (`wires`)
- `corners`: giunti d'angolo
- `wireM`: metri di filo stimati, somma in linea d'aria fra ogni DOUT libero e il DIN libero più vicino, più 0,2 m per ogni capo non accoppiato (alimentazione). I giunti d'angolo valgono 0
- `totalLeds`
- `maxCurrentA`: `totalLeds · LED_MAX_MA / 1000` a 5 V, bianco pieno
- `supplyA`: alimentatore consigliato, il minimo intero di ampere che copre la corrente massima con il 25% di margine

## 5bis. Editor dei tracciati (`src/editor/`, lato cliente)

Il cliente può ritoccare le linee della striscia dopo la generazione, sia da testo sia da immagine.
L'editor è nella pagina cliente (`index.html`) e anche in `admin.html`. Usa **Paper.js**, caricato
con `import()` dinamico solo quando si apre l'editor: la pagina iniziale non lo scarica.

### Congelamento

- «Modifica tracciati» prende gli spezzoni dopo [D] (prima della levigatura) e li converte in
  curve di Bézier cubiche con `Path.simplify` di Paper.js (tolleranza `EDIT_FIT_TOL`, 0,3 mm).
  Da quel momento l'ordine contiene `paths` (§6) e la pipeline **riparte da [E]**: [A]–[D] non si
  rieseguono più.
- Con `paths`, [E] **non leviga** (niente Chaikin): appiattisce le Bézier in polilinee (tolleranza
  0,02 mm) e ricampiona. La curva disegnata dal cliente è quella prodotta.
- Cambiare `heightMm` scala tutte le curve in modo uniforme rispetto all'origine (fattore nuova /
  vecchia altezza). Cambiare testo, font o immagine **scarta** le modifiche, dopo una conferma.
- «Ripristina originale» toglie `paths` e torna alla generazione automatica.

### Formato delle curve

Ogni spezzone è un `path` con `id` stabile (`p1`, `p2`…, assegnati da sinistra a destra al
congelamento; i nuovi prendono il primo numero libero). Nodi nel formato dei segmenti di Paper.js:
punto e maniglie relative, in mm, arrotondati a 0,001 mm.

```json
{ "id": "p1", "closed": false,
  "nodes": [{ "p": [0, 0], "in": [0, 0], "out": [4.2, 1.1] }] }
```

Puntini (`I_DOT_MODE`): `{ "id": "d1", "type": "dot", "center": [x, y], "angle": 0 }`. Si spostano e
si ruotano, non si modificano come curve; si possono eliminare.

### Operazioni

- Selezionare un nodo, trascinarlo; le maniglie compaiono solo sul nodo selezionato.
- Aggiungere un nodo (doppio clic / doppio tocco sulla curva), eliminarlo (tasto Canc o pulsante).
- Spigolo ↔ curva su un nodo (maniglie azzerate o allineate).
- Tagliare uno spezzone in un punto (diventa due spezzoni); unire due estremi distanti ≤ 1 mm.
- Eliminare uno spezzone; disegnare uno spezzone nuovo (strumento penna).
- Spostare l'intero disegno o un solo spezzone.
- **Annulla / Ripeti** (Ctrl+Z / Ctrl+Shift+Z e pulsanti), almeno 50 passi.
- Zoom e pan (rotella, pinch); bersagli dei nodi ≥ 44 px su touch.
- Due nodi consecutivi non stanno più vicini di `EDIT_MIN_NODE_DIST` (0,5 mm): il trascinamento
  si ferma prima.

### Incroci

Senza grafo, un **incrocio** è un'intersezione fra due spezzoni (o di uno spezzone con sé stesso).
Uno dei due passa sotto e la sua striscia si interrompe di `CROSSING_GAP` per lato (§5 [D]).
Default: passa sopra lo spezzone con `id` minore. Un clic sull'incrocio scambia. Le scelte si
salvano in `crossings` (§6) con la posizione; alla rigenerazione ognuna si associa all'incrocio
più vicino entro 2 mm. Una scelta senza incrocio corrispondente si scarta con avviso; un incrocio
senza scelta usa il default.

### Validazione dal vivo

- Durante il trascinamento, nel main thread e solo sugli spezzoni toccati: catena [F] (cerniere
  oltre `HINGE_MAX_DEG`) e distanza dagli altri spezzoni (`CHANNEL_W + 2·WALL + MIN_GAP`, con il
  `WALL` scelto dal cliente e una griglia spaziale). I marcatori di curva, spigolo e fusione (§5) si aggiornano a ogni frame.
- Al rilascio, con 300 ms di attesa, il worker rigenera tutto ([E]–[J]) e aggiorna anteprima 3D,
  copertura e BOM.
- **Invio bloccato** finché ci sono errori: curve sotto R_MIN, fusioni, spezzoni sotto `CUT_PITCH`
  di luce. Gli avvisi non bloccano. Gli spigoli seguono `CUSP_MODE` come sempre.

### Verso

Il verso DIN → DOUT segue la regola di §5 («Verso degli spezzoni»). L'editor lo mostra con una
freccia su ogni spezzone.

## 6. Ordine (contratto cliente → admin)

```json
{ "schemaVersion": 2, "generatorVersion": "0.2.0",
  "source": { "kind": "text", "text": "Ciao", "fontId": "sacramento" },
  "heightMm": 120, "color": "#ff2fd6", "params": {},
  "paths": null, "crossings": [] }
```

`source` per un'immagine (§4bis):

```json
{ "kind": "image", "format": "svg", "name": "firma.svg", "trace": "centerline",
  "svg": { "elements": [{ "d": "M0 0 C10 5 20 5 30 0", "kind": "stroke" },
                        { "d": "M40 0 L60 0 L60 20 Z", "kind": "fill", "fillRule": "nonzero" }] } }

{ "kind": "image", "format": "raster", "name": "logo.png", "trace": "outline",
  "threshold": 128, "invert": false,
  "bitmap": { "width": 1200, "height": 400, "rle": "<base64>" } }
```

- `paths`: `null` finché il cliente non apre l'editor; poi l'elenco di §5bis. Con `paths` la
  generazione ignora `source` (che resta come riferimento) e parte da [E].
- `crossings`: `[{ "at": [x, y], "under": "p2" }]` (§5bis).
- Un ordine `schemaVersion: 1` si legge come v2: `text` e `fontId` vanno in `source`
  (`kind: "text"`), `paths: null`, `crossings: []`. Stessi file di prima.

Stesso JSON e stessa `generatorVersion` producono gli stessi file (determinismo, nessuna casualità).

## 7. Stack

- Vite + TypeScript (strict), nessun framework UI pesante (vanilla TS o Preact)
- `opentype.js`, `manifold-3d` (WASM), `three` (+ `UnrealBloomPass`), `comlink`, `d3-delaunay` (fallback)
- `paper` (Paper.js, build `paper-core`, senza PaperScript) per l'editor (§5bis), caricato con `import()` dinamico
- Export DXF scritto a mano (LWPOLYLINE, AC1015, come i layer in §5) o `dxf-writer`
- Test: `vitest` sui moduli geometrici puri
- Controllo di fine fase: `npm run check`. In sequenza esegue `tsc --noEmit`, `vitest run`,
  `vite build`, poi avvia `vite preview` e i test Playwright in `tests/smoke/` (solo Chromium,
  headless). Copre `index.html`, `admin.html`, `debug.html`, `bend-test.html` e `spec.html`
  (errore in console o richiesta di rete fallita, incluso il `.wasm`), il pulsante «Test manifold»
  (`vertici: 8, triangoli: 12`), la rasterizzazione di «Ciao Torino» con entrambi i font (scheletro
  e grafo visibili) e gli STL dei pezzi A e B, che non devono essere vuoti. Alla fine di ogni fase
  va eseguito, e gli errori vanno corretti finché passa, prima di considerare il lavoro finito.
  Una tantum, dopo l'installazione delle dipendenze: `npx playwright install chromium`.
- Deploy:
  - **Il build pubblico contiene solo `index.html`** (pagina cliente): `npm run build:public`
    (`vite build --mode public`), che è anche il passo prima di `npm run deploy`.
  - `admin.html`, `debug.html`, `bend-test.html` (e `spec.html`) si usano **solo in locale** con
    `npm run dev`; `npm run build` le compila tutte, per verifica.
  - **L'hosting si sceglie più avanti**: GitHub Pages, Cloudflare Pages o Netlify. Il `base` in
    `vite.config.ts` (`/sign-configurator/`) e lo script `deploy` (gh-pages) sono quelli di GitHub Pages
    e vanno adattati alla scelta.

## 8. Struttura cartelle

```
src/
  config.ts
  fonts/registry.ts, loadFont.ts
  geometry/rasterize.ts, distance.ts, tubes.ts, skeleton.ts, graph.ts, tubePairing.ts, segment.ts, smooth.ts,
           chain.ts, validate.ts, strip.ts, holes.ts, housing.ts, diffuser.ts, edgeProfile.ts, lights.ts
  export/stl.ts, dxf.ts, svg.ts, bom.ts
  worker/generator.worker.ts, api.ts
  viewer/scene.ts, neonMaterial.ts
  sources/svgImport.ts (main thread), svgPaths.ts, rasterImport.ts (main thread), bitmapCodec.ts, contours.ts
  editor/editor.ts (Paper.js, UI), paths.ts (formato, scala, appiattimento: puro), crossings.ts, liveCheck.ts
  order/schema.ts (tipi v2, migrazione da v1)
  ui/customer.ts, admin.ts, debug.ts
  tools/bendTest.ts (pagina), bendTestGeometry.ts (pezzi di prova A archi / B angoli, testabile in Node)
index.html   (cliente)
admin.html   (admin: incolla o carica JSON, scarica ZIP)
debug.html   (bitmap di [A], o le linee del font se è a tratto singolo; poi grafo, segmenti, cerniere)
bend-test.html
tests/smoke/          Playwright (Chromium headless), lanciato da `npm run check`
playwright.config.ts
```

## 9. Fuori scope v1

Suddivisione per il piatto di stampa, lastra di fondo CNC, pagamenti, account utente.

## 10. Domande aperte

Spessore reale della striscia, coincidenza intagli/piazzole di taglio, tensione 5 o 24 V, cosa entra nei fori Ø3 (perni, viti M3, inserti a caldo). Non bloccano lo sviluppo: restano i default
di `config.ts`, da aggiornare dopo le misure sul campione stampato.

Immagini caricate dal cliente: serve una dichiarazione che ne ha i diritti (casella prima dell'invio)?

## 11. Roadmap post-v1

- **Trasformazioni per lettera** nell'editor (§5bis): sposta, ruota, scala, spaziatura, con la
  lettera come gruppo di spezzoni.
