# Klassekart

Et interaktivt klassekart-verktøy for lærere. Lag, tilpass og skriv ut klassekart på sekunder — helt i nettleseren, ingen installasjon nødvendig.

🔗 **[Åpne Klassekart](https://mekeb95.github.io/klassekart/)**

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
- Sett opp regler for **Skal ikke sitte sammen** — randomiseringsalgoritmen respekterer disse
- **Låste pulter** hoppes over ved randomisering, slik at enkeltelevers faste plass bevares

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
- **Skjul tomme pulter** ved utskrift/eksport via avkrysningsboks
- **Ctrl+P** skriver ut klassekartet med klassenavn og dato øverst
- **Eksporter som PNG** for å lagre klassekartet som bilde

---

## Teknisk

- Ren HTML, CSS og JavaScript — ingen rammeverk, ingen byggsteg
- Fungerer direkte i nettleseren, også uten internettilgang (etter første lasting)
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
| `randomize.js` | Stokking og plassering som minimerer brudd på «skal ikke sitte sammen» |
| `render.js` | All DOM-tegning |
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

`layout.js`, `randomize.js` og valideringen i `state.js` er rene funksjoner
uten DOM-avhengigheter, og kan testes direkte.

---
