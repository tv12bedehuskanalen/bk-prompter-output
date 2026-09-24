# Changelog

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
