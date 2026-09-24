# BK Prompter

An offline-first, Norwegian teleprompter for Bedehuskanalen. Version **0.2.0** adds the rundown editor and per-script display presets.

## Run

Open the packaged **BK Prompter** app on macOS or Windows. The small launcher lists local network addresses, web port, OSC status, an interface selector, and an exit button. All production work happens in web interfaces.

For development, use Node 22 or newer:

```sh
npm ci
npm run desktop
```

Run only the local server with `npm start`. The packaged desktop app includes its runtime; operators do not need Node or npm. Installing development dependencies and building packages may require internet; running the installed application does not.

Default HTTP port: **7890**, listening on all IPv4 interfaces. Default OSC UDP port: **7891**. Connect devices to the same trusted local network. Permit the selected TCP and UDP ports in the host firewall.

| Interface | Local address |
| --- | --- |
| Prosjekter og programmer | http://localhost:7890/projects |
| Manusrom | http://localhost:7890/?editor |
| Ren prompterutgang | http://localhost:7890/output |
| Mobil / fjernkontroll | http://localhost:7890/controller |
| Visningsinnstillinger | http://localhost:7890/display |
| System og OSC | http://localhost:7890/settings |

On a phone, the root address automatically opens the mobile controller. Use the server’s LAN address instead of localhost on other devices.

## Editing and saving

Projects contain programs/episodes, which contain ordered scripts. Project changes, settings, and shared state save automatically. There is no project-level Save operation.

Use the project menu to choose a project, then open a program. Browsing or creating projects/programs in the menu does not interrupt the loaded program. Opening a different program switches the shared context for all views. The editor has collapsible live controls on the left, colored script blocks in the middle, and script editing on the right.

Click a block to edit it without loading it. Each block's **Last inn** button loads that script on all outputs, paused at the beginning. The same operation is available through OSC. The presenter can then start and adjust speed from the phone controller. Editing an off-air script does not alter the live script or its playback position.


Unsubmitted script edits stay in that browser tab only. Leaving the page, refreshing, or switching projects/programs/scripts discards unsubmitted edits without publishing them. Returning always loads the current shared state. **Oppdater manus** submits the text, script title, and OSC ID to the shared state, updates every connected output, and automatically persists it. Publishing while rolling preserves the current logical position, speed, and running state. A shorter script can naturally reach its end sooner. Text above the reading point can change which word occupies that position; this version preserves position, not a semantic word anchor.

Concurrent edits use revision checking. A stale local draft cannot overwrite another editor’s submitted version. The user can copy the draft or use **Hent publisert tekst** to discard it and load the shared version.

Heading formatting defines chapter jump points. Text color and highlight are manual editor controls. Paste inserts plain text; document import retains supported basic formatting. Supported script imports: DOCX, TXT, RTF, MD (plain text), HTML. Complex Word/RTF layouts, tables, and embedded graphics are not preserved. Projects can be exported/imported as JSON in Settings. Imported projects are added as new copies, with new internal IDs and preserved per-program OSC IDs.

## Script display settings

Under **Prompter ved innlasting** in each script's editor, choose:

- **Behold gjeldende innstillinger**: loading the script leaves the current display settings unchanged. This is the default for existing scripts.
- **Bruk forhåndsinnstilling**: choose a named preset from the shared preset library.
- **Egne innstillinger for dette manuset**: specify font size, spacing, margins, colors, alignment, mirroring, flipping and reading-guide options without creating a reusable preset.

Click **Oppdater manus** to save the choice with the script. These choices apply when the script is loaded by its button, OSC, next/previous navigation, or when opening a different program. Updating a script while it is live does not automatically reapply its loading settings or reset playback.

Create presets on the **Visning** page by naming and saving the current display settings. Presets persist locally and are included in project export/import. Imported references receive new IDs so they do not overwrite existing presets. Presets referenced by scripts cannot be deleted until those scripts use a different setting choice.

## Live playback

The local server owns playback time, speed, position, selected script, settings and control lock. Browsers estimate the server’s monotonic clock using timestamped round trips and render transforms on animation frames. Every output uses the same bundled font and logical text width, independent of screen dimensions. Transport corrections are sent continuously, and commands/edits broadcast immediately. A late or reconnecting client joins the current live state.

Browser/network scheduling means mathematical zero-delay frame lock is not possible. Normal LAN clients follow the same timeline; the automated browser test measures observed drift. Hardware and loaded-network testing remain necessary before broadcast use.

The latest accepted control wins. Use the top-bar client list to give one browser (or OSC) exclusive control. Its owner or the person who assigned the lock can release it. Disconnecting the owner/assigner releases the lock. Momentary hold pauses while held, resumes on release, and has a safety lease so a disconnected controller cannot leave the show stuck. A disconnected output freezes, indicates disconnection, then rejoins on reconnect.

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
