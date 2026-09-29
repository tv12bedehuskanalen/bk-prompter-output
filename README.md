# BK Prompter Output

Raspberry Pi-kiosk for BK Prompter Output.

De installerbare filene ligger i `raspberry-pi/`. Gjeldende versjon står i `raspberry-pi/VERSION`.

## Installer på Raspberry Pi OS

Installer Raspberry Pi OS Desktop (64-bit) med Raspberry Pi Imager. Sett opp bruker, vertsnavn, nettverk og SSH før første oppstart.

På selve Pi-en kan du installere siste publiserte versjon med én kommando:

```bash
curl -fsSL https://raw.githubusercontent.com/tv12bedehuskanalen/bk-prompter-output/main/raspberry-pi/install-latest.sh | bash -s -- --user bkadmin --url http://10.144.144.162:7890/output --resolution 1920x1080@60Hz
```

Kommandoen laster ned siste GitHub-utgivelse direkte til Pi-en og starter installasjonen med nødvendige administratorrettigheter. Den ber om Pi-brukerens passord når det trengs. Du trenger ikke kopiere filer med `scp` eller kjøre en separat installasjonskommando over SSH. Utelat `--user bkadmin` dersom den innloggede brukeren er kontoen som skal konfigureres.

Parametere:

- `--user BRUKER` – Raspberry Pi-brukeren som skal kjøre kiosken.
- `--url URL` – URL-en som skal vises ved oppstart.
- `--resolution MODUS` – valgfri oppløsning, for eksempel `1920x1080@60Hz`.

Installereren installerer Chromium, Flask, `inotify-tools`, `unclutter` og kiosk-tjenestene. Start Pi-en på nytt når installasjonen er ferdig. Kontrollsiden er da tilgjengelig på `http://PI-ADRESSE/`.

Ved grafisk innlogging starter kiosk-vakten den lokale Flask-kontrollsiden, åpner Chromium på den lagrede URL-en og laster Chromium på nytt når URL-en endres. URL-en lagres i `prompter_url.txt` i brukerens hjemmemappe.

Kontrollsiden lager først visningsnavnet fra de to første delene av vertsnavnet (`BK-AES-PROMPTER` blir **BK AES**). Tittelen kan deretter endres og lagres. Gjeldende programversjon vises i oppdateringsfeltet.

Det er trygt å kjøre installereren på nytt. Den oppdaterer kioskfilene og beholder eksisterende output-URL.
