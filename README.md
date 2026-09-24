# BK Prompter

An offline-first, Norwegian teleprompter for Bedehuskanalen. Version **0.5.0** adds individual screen layouts and live links to shared presets.

## Run

Open the packaged **BK Prompter** app on macOS or Windows. The small launcher lists local network addresses, web port, OSC status, an interface selector, and an exit button. All production work happens in web interfaces.

For development, use Node 22 or newer:

```sh
npm ci
npm run desktop
```

For quick editing, double-click **Start utvikling.command** (Mac) or **Start utvikling.bat** (Windows), or run `npm run dev`. Close the packaged app first. Open http://localhost:7890/projects and refresh the browser after editing web files; server code changes restart the development server automatically. No app compilation is needed. Development uses the same permanent projects/settings as the desktop app. Use `BK_DATA_DIR` to select separate test data if desired. `npm run desktop` also runs directly from source with the minimal launcher.

Run only the local server with `npm start` (this older headless entry point uses `~/.bk-prompter` unless `BK_DATA_DIR` is set). The packaged desktop app includes its runtime; operators do not need Node or npm. Installing development dependencies and building packages may require internet; running the installed application does not.

Default HTTP port: **7890**, listening on all IPv4 interfaces. Default OSC UDP port: **7891**. Connect devices to the same trusted local network. Permit the selected TCP and UDP ports in the host firewall.

| Interface | Local address |
| --- | --- |
| Prosjekter og programmer | http://localhost:7890/projects |
| Editor | http://localhost:7890/?editor |
| Ren prompterutgang | http://localhost:7890/output |
| Mobil / fjernkontroll | http://localhost:7890/controller |
| Skjermer | http://localhost:7890/display |
| System og OSC | http://localhost:7890/settings |

On a phone, the root address automatically opens the mobile controller. Use the server’s LAN address instead of localhost on other devices.

## Editing and saving

Projects contain programs/episodes, which contain ordered scripts. Project changes, settings, and shared state save automatically. There is no project-level Save operation.

Use the project menu to choose a project, then open a program. Browsing or creating projects/programs in the menu does not interrupt the loaded program. Opening a different program switches the shared context for all views. The editor has collapsible live controls on the left, colored script blocks in the middle, and script editing on the right.

Click a block to edit it without loading it. Slim insertion lines appear above/between/below blocks near the pointer; their **+** inserts a script at that position without shifting the list. Each block's **Last inn** button loads that script on all outputs, paused at the beginning. The same operation is available through OSC. The presenter can then start and adjust speed from the phone controller. Editing an off-air script does not alter the live script or its playback position.


Titles, OSC IDs, block colors and script loading settings save immediately and update other clients. Only text/formatting/chapter changes await **Oppdater manus**.

Unsubmitted script edits stay in that browser tab only. Leaving the page, refreshing, or switching projects/programs/scripts discards unsubmitted edits without publishing them. Returning always loads the current shared state. **Oppdater manus** submits only the script text to the shared state, updates every connected output, and automatically persists it. Publishing while rolling preserves the current logical position, speed, and running state. A shorter script can naturally reach its end sooner. Text above the reading point can change which word occupies that position; this version preserves position, not a semantic word anchor.

Concurrent edits use revision checking. A stale local draft cannot overwrite another editor’s submitted version. The user can copy the draft or use **Reset tekst** to discard it and load the shared version.

Use **+ Legg til kapittel** to insert a titled chapter at the cursor. Chapter markers and an outline make chapters visible in the editor; the outline lets you jump, rename or remove a chapter marker. Legacy H2 headings are also chapters. **Tøm tekst** clears only the local draft after an in-app confirmation; **Reset tekst** restores the shared text. The toolbar reflects the selected text’s colors and includes a dedicated remove-highlight button. Text color and highlight are manual editor controls. Paste inserts plain text; document import retains supported basic formatting. Supported script imports: DOCX, TXT, RTF, MD (plain text), HTML. Complex Word/RTF layouts, tables, and embedded graphics are not preserved. Projects can be exported/imported as JSON in Settings. Imported projects are added as new copies, with new internal IDs and preserved per-program OSC IDs.

## Script display settings

Under **Prompter ved innlasting** in each script's editor, choose:

- **Behold gjeldende innstillinger**: loading the script leaves the current display settings unchanged. This is the default for existing scripts.
- **Bruk forhåndsinnstilling**: choose a named preset from the shared preset library.
- **Egne innstillinger for dette manuset**: specify font size, spacing, margins, colors, alignment and reading-guide options without creating a reusable preset.

The choice saves automatically with the script. These choices apply when the script is loaded by its button, OSC, next/previous navigation, or when opening a different program. Updating a script while it is live does not automatically reapply its loading settings or reset playback.

The **Skjermer** sidebar lists each output screen with its fixed ID and **Åpne skjerm** link. The selected screen is highlighted. Renaming requires **Lagre navn** and an in-app confirmation; the screen ID and URL remain unchanged.

Click a preset name to link the selected screen to it. The screen's own settings are then greyed out, and its loaded preset is shown. The pencil opens the preset editor. Changes apply immediately to every screen linked to that preset, including active outputs. The preview always remains readable.

**Rediger gjeldende leseflate** disconnects the selected screen from its preset and copies all current settings to its own layout. Nothing resets to defaults; subsequent preset edits no longer affect that screen. Mirror/flip remain independent equipment settings for each screen.

Create a new preset by entering a name and pressing **+**; it copies the currently edited layout. Presets are included in project/program export and import. A preset used by a screen or script cannot be deleted until those references are removed.

Script loading policies remain available: **keep** retains each screen's layout/link, **preset** links all screens to the script's preset, and **custom** copies the script's custom settings to all screens and removes their links.

## Projects, programs and screens

The project menu opens inside the currently loaded project. Use **Alle prosjekter** to return to project tiles. The pencil on a project tile opens its name, color, local logo upload and folders (for example seasons); these fields are also available when creating a project. Removing a folder moves its programs to **Uten mappe** without deleting them.

Programs appear in a list with optional program date and automatic last-modified time. Click the column headings to sort; click again to reverse direction. The folder sidebar narrows the list. The project logo appears above the project title, and the loaded program has a red border and LIVE badge. **Nytt program** sits inside the list. The duplicate button creates a separate program with new internal IDs, retaining scripts, OSC IDs, date, folder and preset choices without loading the copy. The pencil on a program edits its name, date and folder. Browsing does not load a program; opening a program switches the shared context. The loaded project/program appears in the top-right of all control/settings GUIs. The clean output keeps its canvas clear and identifies the context in its browser title.

In **Skjermer → Utgangsskjermer**, create additional named screens with unique IDs. Default screen **1** is available at `/output` or `/output?screen=1`. Other screens use `/output?screen=ID`. Each screen has an editable display name with a permanent ID and URL. Renaming does not change orientation or break screen links. Each screen has independent horizontal mirroring and vertical flipping. All previews remain readable. Each screen can have its own typography while outputs follow the shared playback timeline and script position. Screen orientation is local equipment configuration and is not changed by script presets. Existing global orientation migrates to screen 1 on upgrade.

## System settings

The Settings sidebar has separate OSC, Import/export, Network and Server sections. OSC command documentation is expandable inside the OSC view. Export a single project or program from the transfer view. A program import requires selecting a destination project and creates fresh program/script IDs while retaining OSC IDs and preset references. Project imports create separate projects. Neither import interrupts the current program.

**Start serveren på nytt** and **Avslutt serveren** require an in-app confirmation. These actions affect the BK Prompter server/app, not the host operating system. Data is saved before exit. Restart reconnects browsers and leaves playback paused. The desktop launcher and headless/development server support these actions.

## Live playback

The local server owns playback time, speed, position, selected script, settings and control lock. Browsers estimate the server’s monotonic clock using timestamped round trips and render transforms on animation frames. Every output uses the bundled font and a logical layout independent of physical screen resolution. Transport coordinates use a common reference layout. Screens with different typography map reference line starts to the corresponding text in their own layout; scrolling interpolates between those points. Line measurements are rebuilt on content/layout changes, not each animation frame. Transport corrections are sent continuously, and commands/edits broadcast immediately. A late or reconnecting client joins the current live state.

Browser/network scheduling means mathematical zero-delay frame lock is not possible. Normal LAN clients follow the same timeline; the automated browser test measures observed drift. Hardware and loaded-network testing remain necessary before broadcast use.

Browser identity is retained locally across tabs, windows and reconnects on the same server address and browser profile. Your avatar appears at the far right marked **DEG**, with other clients grouped to its left. Click the avatars to rename your client and manage control. The list shows each client once, with its window count and open views. Names update across the client's windows. Different browsers, private profiles, devices, or server addresses can appear as separate clients; there is no device fingerprinting.

The latest accepted control wins. Use the top-bar client list to give one browser (or OSC) exclusive control. Its owner or the person who assigned the lock can release it. Closing one window preserves that client’s lock while other windows remain connected. Disconnecting the owner/assigner’s last window releases the lock. Momentary holds belong to individual windows, so releasing or closing one does not clear a hold in another. Momentary hold pauses while held, resumes on release, and has a safety lease so a disconnected controller cannot leave the show stuck. A disconnected output freezes, indicates disconnection, then rejoins on reconnect.

Space starts/pauses, arrow keys change speed, Home resets. On the clean output, the mouse wheel scrubs the shared position. Double-click enters fullscreen. Output has no toolbar; the optional reading guide can be disabled in display settings.

## Raspberry Pi output

Open `/output` in Chromium kiosk mode on a Pi connected to the local network. For example, after installing Chromium using Raspberry Pi OS’s package tools:

```sh
chromium --kiosk --no-first-run http://SERVER_IP:7890/output
```

Keep the screen awake and use hardware acceleration when available. No remote assets or internet are needed. The output animates only a CSS transform; DOM/layout updates happen when content or settings change. Performance has not yet been measured on physical Raspberry Pi hardware.

## OSC

See [OSC reference](docs/OSC.md). Commands use `/prompter/...`; these are this app’s own addresses, inspired by timer-style automation, not an assertion of wire compatibility with OnTime. IDs are unique within a program and reusable in other programs and projects.

## Customize

The editable values are grouped at the top of dedicated files:

- `public/config.js`: web branding, titles, logo paths, speed controls, logical text width.
- `public/theme.css`: shared color palette, including the desktop launcher.
- `config/app.cjs`: app identity, stable data-folder identity, default ports and launcher size.
- `public/style.css`: local font declarations first, then interface styling.
- `public/branding/`: supplied original logo, full logo wrapper, symbol, app icon.
- `public/favicon.svg`: compact logo icon.
- `package.json`: the single application version, build identity and packaging settings.

Proxima Nova is bundled from the source repository supplied by the user: https://github.com/dashaudio/dash-styles/tree/master/fonts/proxima-nova . Brand assets are supplied by Bedehuskanalen. Preserve applicable font and brand rights when redistributing the app.

## Updates, development and checks

Read [version and update policy](docs/VERSIONING.md). Install updates over the existing application; data lives outside it. There are no analytics, CDN assets, cloud calls, login services or automatic update checks. A same-origin content policy also restricts browser requests.

```sh
npm test
npm run test:browser
npm run check
npm run format
npm run dist:mac
npm run dist:win
```

The app is for a trusted LAN and has no user authentication. Control locks coordinate operators; they are not an access-control/security boundary. Do not expose the server to the public internet.

Future online project editing belongs in a remote project repository adapter. The launcher, project cache, playback engine, OSC and client synchronization stay local and continue operating without that service. No cloud integration is implemented in this version.

### Blackout og startvisning

Åpning av et program viser prosjektlogo, prosjektnavn og programnavn til et manus lastes via Last inn eller OSC. Blackout i editoren og mobilkontrollen gjør alle utganger svarte; avspillingen fortsetter med samme posisjon og hastighet. OSC: `/prompter/blackout` med 1 for på, 0 for av, eller uten verdi for å veksle.

Lesepunkt under Skjermer har linjetykkelse (0 skjuler linjen), pilfarge og pilstørrelse. Linjeavstand kan settes fra 0,5 til 2,5; under 1 gir tettere tekst og kan gi overlapp.
