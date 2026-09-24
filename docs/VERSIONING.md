# Versions and releases

The application version lives in `package.json`. The launcher and all web interfaces read this same version. The data schema has its own independent version in `server/storage.cjs`.

We use `MAJOR.MINOR.PATCH`, beginning at **0.1.0**.

- **PATCH** (`0.1.0 → 0.1.1`): fixes, performance corrections, small visual/copy changes. No incompatible OSC, storage, or workflow changes.
- **MINOR** (`0.1.1 → 0.2.0`): a new compatible feature, GUI, importer, or OSC command. During the pre-1.0 development period, incompatible changes also advance the minor number and must be clearly listed in the changelog.
- **MAJOR** (`1.x.x → 2.0.0`): incompatible changes to an established public protocol, supported data format, or workflow. A large new feature alone does not require a major bump. A compatible cloud project adapter can therefore be a minor release; the product may still call that milestone “v2”.

**1.0.0** means the first stable release after real studio and Raspberry Pi testing. Do not call an untested build production-ready.

## Release procedure

1. Finish and commit the changes. Update `CHANGELOG.md` with user-visible changes, compatibility notes, and migration information.
2. Run `npm run check`, `npm test`, and `npm run test:browser`.
3. On a clean Git checkout run `npm run version:patch` (or `version:minor` / `version:major`). npm updates the manifest and lockfile, commits them, and creates a `vX.Y.Z` tag. Tests run before versioning.
4. Build installers from the tagged revision using `npm ci`, `npm run dist:mac` and/or `npm run dist:win`. The GitHub workflow builds on the matching native operating systems when a version tag is pushed. Pushing and publishing are separate, deliberate actions.
5. Install the release over a previous installation and verify projects, settings, ports and script IDs. Verify OSC and connected output devices before use in a show.
6. Share installers through a file share, USB drive, or a release page. The app never contacts an update server.

## Safe installation and rollback

Application files are separate from data. Keep `appId`, `storageName`, and the installer identity stable. Windows installers explicitly retain user data on uninstall. macOS updates replace the app bundle only.

- macOS app data: `~/Library/Application Support/BK Prompter/studio.json`
- Windows app data: `%APPDATA%/BK Prompter/studio.json`
- `npm run dev` and development launchers use the same data location as the desktop app.
- Headless Node server data: `~/.bk-prompter/studio.json` (override with `BK_DATA_DIR`)

On the first start of a different version, the app validates the data, creates an exact backup in the adjacent `backups` directory, then applies supported schema migrations. Writes use a temporary file, a disk flush, and an atomic rename. An unreadable file or a future schema stops startup rather than overwriting it.

Backups are not automatically deleted. For rollback after a schema-changing release: stop the app, keep an extra copy of the current data, install the old app, and restore the corresponding pre-upgrade backup as `studio.json`. An older app refuses a newer schema. Export/import is for copying projects; the full data file also includes settings.
