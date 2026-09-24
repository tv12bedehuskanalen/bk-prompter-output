// Uses the installed app's permanent data directory. BK_DATA_DIR can select test data.
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const config = require("../config/app.cjs");
const appData =
  process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support")
    : process.platform === "win32"
      ? process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
      : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
console.log(
  "BK Prompter · utvikling\nÅpne http://localhost:" +
    (process.env.PORT || 7890) +
    "/projects\nLukk den pakkede appen først. Oppdater nettleseren etter endringer i GUI-et.\nCtrl+C avslutter serveren.",
);
const child = spawn(
  process.execPath,
  ["--watch", path.join(__dirname, "../server/index.cjs")],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      BK_DATA_DIR:
        process.env.BK_DATA_DIR || path.join(appData, config.storageName),
    },
  },
);
child.on("exit", (code) => (process.exitCode = code || 0));
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
