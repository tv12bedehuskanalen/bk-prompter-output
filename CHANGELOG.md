# 0.6.0

- Blackout i editor og mobilkontroll, med OSC /prompter/blackout (1/0). Avspilling fortsetter bak svart utgang.
- Åpning av program viser prosjektlogo og titler til et manus lastes.
- Direkte tallinntasting i eksisterende tallvisninger ved skyveknappene.
- Sentrert pil, linjetykkelse opptil 100 px, egen linjefarge og alpha.
- Av/på-bryter for lesemarkør, med deaktiverte innstillinger når av.
- Tykkere rød ramme rundt LIVE-manus.
- Justerbar linjetykkelse, pilfarge og pilstørrelse. Linjeavstand ned til 0,5.

# Changelog

## 0.5.0

- Renamed Prompteroppsett to **Skjermer**. Screens appear in a selectable list with a clear active indicator, fixed IDs and individual output links.
- Screen name changes require an explicit save and in-app confirmation.
- Loading a preset links the selected screen to it. Editing the preset updates every linked screen in realtime; independent screens remain unchanged.
- Linked screen settings are read-only and show the loaded preset. **Rediger gjeldende leseflate** removes the link while retaining every current appearance setting.
- Individual screen layouts use the shared playback reference; reference text lines map into each screen's typography without per-frame text measurement. Position and running state are preserved during layout updates.
- Existing screens inherit their saved appearance on upgrade and start unlinked. Projects, settings, presets, IDs and URLs are retained.

## 0.4.0

- Project program lists now show the project logo, folder sidebar, clear back button, in-list creation, duplication and a red LIVE row. Removed redundant headings and status copy.
- Script blocks have softer red live borders, clearer load icons, no empty OSC labels and slim insertion controls between blocks. The live pane has one centered indicator.
- Rebuilt Prompteroppsett with a screen/preset sidebar and one editor for either live layout or a saved preset. Clicking a preset name applies it immediately; its pencil opens the editor. Preset edits and preview remain separate from live output until explicitly applied. Corrected preview paragraph typography.
- Browser windows sharing local identity appear as one client. Your avatar is separated on the right; renaming moved from system settings into the avatar panel. Control locks span windows, with separate momentary hold leases per window.
- Added a Settings sidebar for OSC, separate project/program import and export, network and confirmed server restart/shutdown. Program imports select a destination project.
- Screen names are editable independently of permanent IDs and URLs. Removed promotional copy and separated text and reading-point controls.
- Identity persists within the same browser profile and server origin. Existing projects, settings, presets and script content are retained.

## 0.3.0

- Script title, OSC ID, block color and loading policy now save immediately. Only text, formatting and chapters wait for **Oppdater manus**; text publication preserves live playback and concurrent metadata changes.
- Added explicit chapter insertion, a chapter outline, rename/remove controls, selection-aware colors and remove-highlight. Default text is white and highlight red.
- Added **Reset tekst**, **Tøm tekst**, trash icons and in-app confirmations. Red LIVE labels and update button; full-height script color rails.
- Project branding editor with local logos, colors and folders; programs now use a sortable list with dates and last-modified times. Returning to the menu opens the loaded project.
- Shared loaded project/program in GUI headers. Renamed navigation to **Editor**, **Prompteroppsett**, **Oppover** and **Nedover**.
- Multiple output screens with IDs, URLs and independent mirror/flip settings. All previews remain readable. Existing orientation migrates to screen 1; script presets no longer alter physical screen orientation.
- Added double-click development launchers and `npm run dev`, using the installed app's persistent data without rebuilding. All runtime assets remain offline.
- Existing projects/settings are retained; upgrades create a backup. Data schema remains compatible at version 1.

## 0.2.0

- New three-panel rundown: collapsible live sidebar, colored script blocks, and a separate script editor.
- Separate project/program menu; browsing does not disturb the loaded program.
- Each script has an explicit load button; opening/editing another script leaves playback untouched.
- Per-script settings: retain current display, load a named preset, or apply custom settings without a preset.
- Local preset library with project export/import and reference protection.
- Button, OSC, and next/previous loading share the same behavior; presenters retain phone start/speed controls.
- Existing 0.1.0 projects remain compatible and default to keeping current display settings.
- 19 automated tests plus expanded browser workflow checks.

## 0.1.0 — 2026-09-24

First local beta.

- macOS/Windows desktop launcher, configurable HTTP port and separate OSC listener.
- Norwegian project/program/script editor, document imports and project JSON export/import.
- Local unsent edits with explicit live submission; shared state persists automatically.
- Server-owned synchronized playback, clean output, preview/settings and mobile controller.
- Client ownership lock, momentary hold with disconnect recovery, script and chapter navigation.
- Offline Proxima Nova and Bedehuskanalen branding with teal/red dark theme.
- Stable user-data location, safe replacement updates, pre-upgrade backups and schema guards.
- Automated engine, network, import, persistence, upgrade and browser tests.

Known validation gaps: physical Raspberry Pi performance and real Windows operation still require hardware testing. Distributed browsers are synchronized to a shared timeline, not hardware-genlocked.
