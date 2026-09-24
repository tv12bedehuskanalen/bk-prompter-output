# Validation for 0.2.0

Completed on the development Mac:

- JavaScript syntax checks.
- 19 automated engine, OSC/HTTP/WebSocket, import, persistence and upgrade tests.
- Chromium browser checks with an editor, two outputs, a mobile controller and display settings connected at once.
- Unsubmitted text stays out of server state and output; switching scripts and refreshing discard it.
- Explicit submission changes the running output without resetting position or stopping playback.
- Normalized output-position difference was below one logical pixel in the local two-output browser check (latest measured run: 0.31 pixels). This is a local test, not a guarantee for arbitrary networks or hardware.
- Three-panel layout, sidebar collapse, separate editor/load actions, and project/program menu without changing the live program until explicitly opened.
- Preset, custom and keep-current policies, including phone start/speed control after loading, persistence, and preset-reference remapping on import.
- Mobile layout selection, pointer-held pause/resume, shared mirroring and no browser errors.
- No external page requests in the browser test; fonts, icons and assets load from the local server.
- Packaged Apple Silicon desktop launcher starts HTTP/OSC, shows version and network interfaces, changes the HTTP port, writes data and exits cleanly.
- Upgrade tests preserve IDs, settings and ports, create a pre-upgrade backup, and refuse corrupt/future-schema data without overwriting it.
- Production dependency audit reported zero known vulnerabilities during 0.1.0 validation; dependency versions are unchanged in this release.

The Windows binaries and Intel Mac build can be produced from this project, but native operation has not been tested on those machines. Physical Raspberry Pi Chromium performance, touch-device differences, real studio OSC automation and loaded-network behavior require acceptance testing. The initial installers are unsigned and are not a notarized public release.

Reproduce with `npm test`, `npm run test:browser`, and `npm run test:desktop`. To test a packaged Mac app, pass its executable path to `node scripts/desktop-check.cjs`. Browser and desktop tests use temporary data folders and do not alter operator projects.
