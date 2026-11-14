## 4ter. Scritture non latine

Bozza, da incollare in `SPEC.md` dopo §4bis. Sostituisce, per queste quattro scritture, la voce
«alfabeti non latini» di §12.8 (preventivo su misura): cinese, giapponese, arabo ed ebraico entrano
nel configuratore.

**Stato**: cinese e giapponese sono **misurati e integrati** (14 novembre 2026). Arabo ed ebraico sono
ancora scelti sulla carta: per loro la fase 0 resta da fare, e serve prima il motore di composizione.

Fase 0, variazione della larghezza del tratto sullo scheletro (limite 25 %):

| Font | Variazione | Esito |
|---|---|---|
| M PLUS Rounded 1c Light | 7–10 % | adottato per il giapponese |
| Noto Sans SC Light | 6–9 % | adottato per il cinese |
| LXGW WenKai Light | 30–37 % | **scartato**: il pennello modula troppo il tratto |

I file sono sottoinsiemi (GB 2312 e Shift-JIS) di circa 2,5 MB l'uno, invece di 18 e 27 MB: vedi
`public/fonts/README.md`. Devono essere **istanze statiche**: opentype.js ignora gli assi dei font
variabili e leggerebbe il master sbagliato.

### Font

Un font per scrittura, tutti SIL OFL, tutti `kind: "outline"`, `stripMode: "centerline"`,
`hollowTubes: false`. Si usa il peso **Light**: tratto sottile e costante, lo scheletro [B] è pulito.

| Scrittura | `id` | Font | Perché | Ripiego |
|---|---|---|---|---|
| Cinese (semplificato) | `noto-sans-sc` | **Noto Sans SC** Light | tratto uniforme, copre tutto il cinese quotidiano, si abbina a M PLUS Rounded | — |
| Giapponese (kana + kanji) | `mplus-rounded` | **M PLUS Rounded 1c** Light | terminali tondi e tratto costante: è già la forma di un tubo | Klee One (a penna) |
| Arabo | `playpen-arabic` | **Playpen Sans Arabic** Light | scrittura a mano, monolinea, ha anche il latino | Lemonada |
| Ebraico | `playpen-hebrew` | **Playpen Sans Hebrew** Light | corsivo a mano, stessa famiglia dell'arabo | Varela Round |

- I TTF vanno in `public/fonts/` con il loro `OFL.txt`. Nomi riservati: si distribuisce il file
  originale, senza modifiche al disegno.
- Playpen Sans è un font variabile: si usa un'**istanza statica** Light (file a sé), non l'asse `wght`
  letto a runtime. Il suo rimescolatore di glifi alternativi resta **spento**: ogni lettera ha sempre
  la stessa forma (determinismo, §6).
- Per il cinese si era partiti da LXGW WenKai, che è scrittura a pennello e avrebbe seguito lo spirito
  dei corsivi latini. La misura l'ha scartato: la larghezza del tratto varia del 30–37 %, oltre il
  limite del 25 %. Il canale è comunque a larghezza fissa, quindi il sottile/grosso del pennello si
  sarebbe perso lo stesso.

### Registro (`src/fonts/registry.ts`)

Campi nuovi, con default che lasciano invariati i quattro font latini:

| Campo | Default | Significato |
|---|---|---|
| `script` | `"latin"` | `"latin"` \| `"han"` \| `"japanese"` \| `"arabic"` \| `"hebrew"` |
| `direction` | `"ltr"` | `"ltr"` \| `"rtl"` |
| `shaper` | `"opentype"` | `"opentype"` (com'è oggi) \| `"harfbuzz"` |
| `heightGlyph` | `"H"` | glifo che definisce l'altezza chiesta dal cliente |
| `lazy` | `false` | `true`: il file si scarica solo quando il font viene scelto |

### Composizione del testo

- **Normalizzazione**: il testo dell'ordine è NFC, in **ordine logico** (come è stato digitato).
  L'ordine visivo lo calcola la pipeline, mai l'ordine salvato.
- **Arabo**: le lettere cambiano forma secondo la posizione (iniziale, mediana, finale, isolata) e si
  legano. `forEachGlyph` di opentype.js non basta. Con `shaper: "harfbuzz"` la riga passa da
  **harfbuzzjs** (WASM, caricato con `import()` dinamico solo per questi font): restituisce glifi,
  avanzamenti e spostamenti; i contorni si leggono poi dallo stesso TTF. Gira nel worker e in Node come
  il resto di [A].
- **Ebraico**: nessuna legatura, solo direzione da destra a sinistra e forme finali già nel testo.
  Stesso `shaper`, per avere un solo percorso RTL.
- **Bidi**: una riga può contenere numeri o parole latine dentro un testo RTL. L'ordine visivo segue
  l'algoritmo bidirezionale Unicode (livelli da harfbuzz o da `bidi-js`). La direzione di base è quella
  del font scelto.
- **Cinese e giapponese**: `shaper: "opentype"`, un glifo per carattere, orizzontale da sinistra a
  destra. Scrittura verticale: fuori scope.
- **Carattere assente**: resta la regola di §5 [A] (avviso con U+XXXX, carattere saltato). Nessun font
  di ripiego automatico: un'insegna con due font diversi non si genera in silenzio.

### Altezza

L'altezza chiesta dal cliente non può essere la sommità della «H». `heightGlyph` per scrittura:

| Scrittura | `heightGlyph` | L'altezza è |
|---|---|---|
| cinese, giapponese | 永 | l'altezza del riquadro del carattere (dal punto più basso al più alto) |
| arabo | ا (alef isolata) | dalla linea di base alla sommità dell'alef |
| ebraico | ה | dalla linea di base alla sommità della lettera |

`capHeightMeasured` contiene quella misura; `xHeightMeasured` può essere `null`. L'ingombro reale
(discendenti arabi, lamed ebraica che sale) resta quello del bbox, già mostrato al cliente.

### Geometria: cosa cambia

- **Cinese e giapponese**: un carattere è fatto di molti tratti separati, spesso dritti e con spigoli
  vivi. Ogni tratto è uno spezzone, con le sue due asole: 永 sono circa 5 spezzoni, un carattere denso
  ne ha 15–20. Conseguenze, tutte già previste dalla pipeline ma con numeri molto più alti:
  - l'altezza minima è dettata dalla distanza fra tratti (`CHANNEL_W + 2·WALL + MIN_GAP`), non dalle
    curve: ci si aspetta un minimo di 250–400 mm per i caratteri densi;
  - `COVERAGE_MIN` (0,85) si viola facilmente: asole e avanzi di taglio pesano su tratti corti;
  - saldature, spezzoni e prezzo (§12.5) crescono con il numero di tratti; i limiti del controller
    (§2) si raggiungono prima.
  Si aggiunge un vincolo comprensibile (§12.4): «This character needs at least N cm».
- **Punti arabi** (nuqta) e **punto della yod / puntini interni ebraici**: sono componenti sconnesse
  piccole, come il puntino della *i*. Seguono `I_DOT_MODE` senza un caso nuovo. In arabo però i punti
  distinguono le lettere (ب ت ث): `"omit"` è **vietato** per `script: "arabic"`; se un punto non si
  accende diventa `"unlit"` (rilievo), mai sparisce.
- **Vocali e segni** (harakat arabi, niqqud ebraico): in v1 si tolgono dal testo prima di [A], con un
  avviso al cliente. La shadda e la hamza restano: fanno parte della lettera.
- **Arabo legato**: la linea di base che unisce le lettere è un tratto continuo, come in Sacramento.
  Le lettere che non si legano a sinistra (ا د ذ ر ز و) spezzano la parola: sono spezzoni distinti.
- **Verso degli spezzoni** (DIN → DOUT): resta «x minore, poi y minore» anche per RTL. Il verso è un
  fatto di cablaggio, non di lettura.
- **DXF dal retro**: nessuna modifica; lo specchio in X vale come per il latino.

### Caricamento

I font CJK pesano alcuni MB l'uno (M PLUS Rounded 1c circa 3 MB per peso; LXGW WenKai di più: da
misurare). Con `lazy: true`:

- il file si scarica alla scelta del font, con indicatore di avanzamento; la pagina resta su «Ciao»
  finché non è pronto;
- non entra nel precaricamento né nelle miniature dello strumento Font (miniatura statica SVG, generata
  una volta e salvata in `public/fonts/thumbs/`);
- l'admin rigenera dallo stesso file: niente sottoinsiemi diversi fra cliente e admin. Se si fa un
  sottoinsieme per alleggerire, è **un solo file** per font, con la lista dei caratteri nel registro.

### Pagina cliente (§12)

- Lo strumento Font mostra i font raggruppati per scrittura, con il nome nella scrittura stessa
  (中文, 日本語, العربية, עברית).
- Se il testo digitato contiene caratteri di una scrittura che il font scelto non ha, la pagina
  **propone** il font giusto con un tocco; non lo cambia da sola.
- Il campo di testo ha `dir="auto"`. L'esempio iniziale cambia con il font: 你好, こんにちは, مرحبا, שלום.
- L'editor dei tracciati (§5bis) funziona senza modifiche: lavora sugli spezzoni, non sulle lettere.
- §12.8: restano a preventivo le scritture non in elenco, il testo verticale e le righe multiple.

### Ordine (§6)

Nessun campo nuovo: `fontId` basta, la scrittura e la direzione vengono dal registro. `generatorVersion`
sale; nessuna migrazione di schema.

### Fasi

0. **Prova sulla pipeline**: per ogni font, in `debug.html`, le quattro parole d'esempio a 200 e
   400 mm. Si guarda: larghezza del tratto (variazione), rami spuri, numero di spezzoni, altezza
   minima, copertura. Qui si conferma il font o si passa al ripiego.
1. Registro esteso + `heightGlyph` + caricamento `lazy`. Cinese e giapponese funzionano già qui.
2. `shaper: "harfbuzz"` + bidi. Ebraico, poi arabo.
3. Pagina cliente: gruppi per scrittura, proposta del font, vincoli e messaggi.

### Test

- Misure del registro uguali al TTF per `heightGlyph` (come oggi per «H»).
- Arabo: «مرحبا» produce le forme legate attese (numero di componenti connesse della bitmap = numero
  di gruppi legati + punti), e l'ordine visivo va da destra a sinistra.
- Ebraico: «שלום» ha la mem finale a sinistra; «שלום 2026» tiene il numero in ordine LTR.
- 永 a 300 mm: 5 spezzoni, nessun ramo più corto del tratto, topologia uguale a 8, 10 e 12 px/mm.
- Determinismo byte per byte di [A] per le quattro parole, in Node e nel worker.
- Punto arabo sotto R_MIN: mai `"omit"`.
- Smoke: scegliendo un font `lazy` la pagina non dà errori di rete e il 2D arriva.

### Domande aperte

- Peso di harfbuzzjs e dei font CJK sul primo caricamento da mobile: va misurato.
- Cinese: serve distinguere semplificato e tradizionale nel menu, o basta un font che li copre entrambi?
- Coreano, cirillico, greco, devanagari, thai: fuori da questa sezione. Playpen Sans copre già greco,
  cirillico, devanagari e thai con lo stesso disegno, se servissero.
