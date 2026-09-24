// Persistent files are outside the application bundle and are never installer payloads.
const fs = require("node:fs");
const path = require("node:path");
const { version: appVersion } = require("../package.json");
const { initial } = require("./state.cjs");
const DATA_SCHEMA_VERSION = 1;

// Future schema migrations go here, keyed by the schema they migrate FROM.
// Each migration must preserve IDs, projects, settings, and selection.
const migrations = {};

function migrate(data) {
  if (!data || !Number.isInteger(data.schema) || data.schema < 1)
    throw Error("Ukjent eller skadet dataformat.");
  if (data.schema > DATA_SCHEMA_VERSION)
    throw Error(
      "Prosjektdataene krever en nyere appversjon. Ingen filer er endret.",
    );
  while (data.schema < DATA_SCHEMA_VERSION) {
    if (!migrations[data.schema])
      throw Error(`Mangler migrering fra dataformat ${data.schema}.`);
    data = migrations[data.schema](data);
  }
  const defaults = initial();
  if (!Array.isArray(data.projects) || !data.selection || !data.transport)
    throw Error("Prosjektfilen er ufullstendig.");
  return {
    ...data,
    settings: { ...defaults.settings, ...data.settings },
    network: { ...defaults.network, ...data.network },
    appVersion,
  };
}

// A future remote repository can exchange project documents through this boundary.
// Playback, OSC, control leases, and output configuration always remain local.
class LocalRepository {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, "studio.json");
  }
  read() {
    if (!fs.existsSync(this.file)) return null;
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      const data = JSON.parse(raw);
      // Validate compatibility BEFORE creating any rewritten project file.
      const upgraded = migrate(structuredClone(data));
      if (
        data.appVersion !== appVersion ||
        data.schema !== DATA_SCHEMA_VERSION
      ) {
        const backupDir = path.join(this.dir, "backups");
        fs.mkdirSync(backupDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        fs.writeFileSync(
          path.join(backupDir, `studio-before-${appVersion}-${stamp}.json`),
          raw,
          { flag: "wx" },
        );
      }
      return upgraded;
    } catch (error) {
      throw Error(
        `Kan ikke lese ${this.file}. Originalfilen er bevart. ${error.message}`,
      );
    }
  }
  save(data) {
    const temp = this.file + ".tmp";
    fs.writeFileSync(
      temp,
      JSON.stringify(
        { ...data, appVersion, schema: DATA_SCHEMA_VERSION },
        null,
        2,
      ),
    );
    const fd = fs.openSync(temp, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, this.file);
  }
  exportProjects(data) {
    return {
      schema: DATA_SCHEMA_VERSION,
      appVersion,
      exportedAt: new Date().toISOString(),
      projects: data.projects,
      displayPresets: data.displayPresets || [],
    };
  }
}
module.exports = { LocalRepository, migrate, DATA_SCHEMA_VERSION };
