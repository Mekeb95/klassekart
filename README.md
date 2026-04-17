# Klassekart

Et interaktivt klassekart-verktøy for lærere. Lag, tilpass og skriv ut klassekart på sekunder — helt i nettleseren, ingen installasjon nødvendig.

🔗 **[Åpne Klassekart](https://mekeb95.github.io/klassekart/)**

---

## Funksjoner

### Elever og oppsett
- Skriv inn elevnavn (ett per linje) og velg antall pulter
- Velg gruppestørrelse: enkeltpulter, 2 og 2, 3 og 3 eller 4 og 4
- Juster antall kolonner og rader i klasserommet
- Velg plassering av tavlen: øverst, nederst, venstre eller høyre side

### Randomisering
- Klikk **Randomiser** for å fordele elevene tilfeldig på pultene
- Sett opp **utelukk naboskap**-regler for elever som ikke bør sitte ved siden av hverandre — randomiseringsalgoritmen respekterer disse
- **Låste pulter** hoppes over ved randomisering, slik at enkeltelevers faste plass bevares

### Interaktiv redigering
- **Dra og slipp** pulter fritt rundt i klasserommet for å gjøre manuelle justeringer
- **Dobbeltklikk** direkte på en pult for å redigere elevnavnet
- **Høyreklikk** på en pult for hurtigmeny med flere valg:
  - Lås/lås opp pult
  - Rediger navn
  - Gjør pult bred (dobbel bredde)
  - Fjern elev fra pult
- **Angre**-knapp for å gå tilbake til forrige tilstand (inntil 20 steg)

### Lærerpult
- Legg til en egen lærerpult som kan dras fritt i klasserommet

### Lagring
- **Lagre flere kart** med navn direkte i nettleseren (localStorage)
- **Elevlister** kan lagres og lastes inn separat, uavhengig av selve kartet
- **Eksporter/importer** som JSON-fil for deling mellom enheter

### Eksport og utskrift
- **Ctrl+P** skriver ut klassekartet i A4 liggende format — kun klasserommet vises, med klassenavn og dato øverst
- **Eksporter som PNG** for å lagre klassekartet som bilde

---

## Teknisk

- Ren HTML, CSS og JavaScript — ingen rammeverk, ingen byggsteg
- Fungerer direkte i nettleseren, også uten internettilgang (etter første lasting)
- Data lagres lokalt i nettleseren, ingenting sendes til server

---

