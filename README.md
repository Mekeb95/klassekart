# Klassetavla

Klassekart og gruppeinndeling for lærere. Lag, tilpass og skriv ut klassekart og grupper på sekunder — helt i nettleseren, ingen installasjon nødvendig.

🔗 **[Åpne Klassetavla](https://www.klassetavla.no)**

---

## Funksjoner

### Elever og oppsett
- Skriv inn elevnavn (ett per linje) og velg antall pulter
- **Lim inn fra Excel/Sheets** via knapp — importerer automatisk fra utklippstavlen
- Velg gruppestørrelse: enkeltpulter, 2 og 2, 3 og 3 eller 4 og 4
- Juster antall kolonner og rader med **+/−-knapper**
- Velg plassering av tavlen: øverst, nederst, venstre eller høyre side
- Juster tekststørrelse på pultene med skyveknapp

### Randomisering og angring
- Klikk **Randomiser** for å fordele elevene tilfeldig på pultene
- **Ctrl+Z** (eller **↩ Angre**-knapp) angrer siste endring — opp til 20 steg bakover
- **Låste pulter** hoppes over ved randomisering, slik at enkeltelevers faste plass bevares

### Regler
- Sett opp **🚫 Ikke sammen** og **🤝 Sammen** for par av elever — én felles regelliste
  for klassekart og grupper
- Regelpanelet er lukket som standard, så skjermen kan vises for klassen. Lukket
  viser det verken navn eller antall, og kart og gruppekort sier aldri noe om
  reglene — brutte regler markeres bare inne i panelet. **(?)** forklarer hva
  regler er uten å åpne panelet
- I klassekartet betyr «sammen» nabopulter (også på skrå); i grupper betyr det samme gruppe
- Reglene kan slås av per verktøy («Bruk reglene …») uten å slette dem
- Klarer ikke trekningen å oppfylle alle reglene, sier den fra om hvilke som brytes

### Grupper
Fanen **👥 Grupper** gjenbruker elevlisten og reglene fra klassekartet.
- Del inn etter **elever per gruppe** eller **antall grupper** — gruppene blir alltid
  jevne (maks én elevs forskjell), og du ser inndelingen før du trekker
- **Dra elever** mellom gruppene for å justere for hånd
- **Kopier** gruppene som tekst (til Teams, Classroom e.l.) eller **skriv ut**
- **📺 Tavlemodus**: fullskjerm med store gruppekort for smartboardet, der navnene
  deles ut fra en kortstokk. «✨ Del ut igjen» viser trekningen på nytt uten å trekke om

Tillegg som er av til du slår dem på:
- **Noen er borte i dag** — klikk bort fraværende; nullstilles av seg selv neste dag
- **Unngå forrige grupper** — setter helst sammen elever som ikke har vært på gruppe
  sammen nylig (siste trekning per dag, opptil 5 dager). Reglene går alltid foran
- **Tildel roller** — legg inn egne roller (med forslag), som deles ut tilfeldig i
  hver gruppe; «🎭 Nye roller» deler ut på nytt uten å endre gruppene

### Interaktiv redigering
- **Dra og slipp** pulter fritt rundt i klasserommet for å gjøre manuelle justeringer
- **Dobbeltklikk** direkte på en pult for å redigere elevnavnet
- **Høyreklikk** på en pult for hurtigmeny med flere valg:
  - Lås/lås opp pult
  - Rediger navn
  - Gjør pult bred (dobbel bredde)
  - Fjern elev fra pult
  - Fjern lærerpult

### Lærerpult
- Legg til en egen lærerpult som kan dras fritt i klasserommet

### Statistikkbanner
- Viser løpende oversikt over antall låste, plasserte og tomme pulter

### Duplikatoppdagelse
- Advarer automatisk dersom samme elevnavn er skrevet inn mer enn én gang

### Lagring
- **Lagre flere kart** med navn direkte i nettleseren (localStorage)
- **Elevlister** kan lagres og lastes inn separat under «Lagrede lister»
- **Eksporter/importer** som JSON-fil for deling mellom enheter

### Eksport og utskrift
- Velg papirformat (**A4/A3**) og retning (**Liggende/Stående**) før utskrift
- Klassekartet **midtstilles på arket** — vannrett og loddrett
- **Tilpass til arket** (på som standard) krymper kartet så det får plass på én
  side. Fjern haken hvis du heller vil ha full størrelse og la kartet gå over
  flere sider
- **Skjul tomme pulter** ved utskrift/eksport via avkrysningsboks
- **🖨️ Skriv ut** (eller **Ctrl+P**) skriver ut klassekartet med klassenavn og dato øverst
- **Eksporter som PNG** for å lagre klassekartet som bilde

---

## Teknisk

- Ren HTML, CSS og JavaScript — ingen rammeverk, ingen byggsteg
- Data lagres lokalt i nettleseren, ingenting sendes til server

### Kodestruktur

JavaScript-en ligger i `src/` som ES-moduler, lastet via
`<script type="module" src="src/main.js">`. Ingen bundler eller byggsteg —
filene serveres som de er.

| Fil | Ansvar |
|-----|--------|
| `constants.js` | Rutenett-geometri, grenser, lagringsnøkler, tillatte verdier |
| `state.js` | Tilstandsobjektet, angrelager, og validering av alt som lastes inn |
| `layout.js` | Ren geometri: cellekoordinater, autolayout, naboskap |
| `randomize.js` | Stokking, og plassering som minimerer regelbrudd (bytte-søk) |
| `groups.js` | Ren gruppelogikk: størrelser, trekning, roller, historikk, tekst |
| `groups-view.js` | Gruppefanen: innstillinger, gruppekort, dra-og-slipp, tavlemodus |
| `rules-view.js` | Regellisten, med live markering av brutte regler i begge faner |
| `render.js` | DOM-tegning for klassekartet, regellisten og fanebytte |
| `desks.js` | Operasjoner på pulter, rader/kolonner og lærerpult |
| `dnd.js` | Dra-og-slipp og tavlehåndtak |
| `storage.js` | localStorage, JSON-import/eksport, PNG |
| `ui.js` | Kontekstmeny, navneredigering, sidepaneler |
| `main.js` | Kobler opp hendelser og starter appen |

**Kjøring lokalt:** ES-moduler krever HTTP — å åpne `index.html` rett fra
filsystemet (`file://`) blokkeres av nettleseren. Start en lokal server:

```bash
python3 -m http.server 8000     # åpne http://localhost:8000
```

GitHub Pages serverer allerede over HTTP, så den publiserte versjonen
er upåvirket.

`layout.js`, `randomize.js`, `groups.js` og valideringen i `state.js` er rene
funksjoner uten DOM-avhengigheter, og kan testes direkte.

---
