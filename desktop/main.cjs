// Launcher defaults and branding: ../config/app.cjs
const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("node:path");
const config = require("../config/app.cjs");
const { startServer } = require("../server/index.cjs");
// A stable location across development, new versions, and replacement installers.
app.setPath(
  "userData",
  process.env.BK_DATA_DIR ||
    path.join(app.getPath("appData"), config.storageName),
);
let window,
  localServer,
  quitting = false;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    window?.show();
    window?.focus();
  });
  app.whenReady().then(async () => {
    try {
      localServer = await startServer({
        dataDir: process.env.BK_DATA_DIR || app.getPath("userData"),
      });
      localServer.events.on("lifecycle", (action) => {
        if (quitting) return;
        if (action === "restart") app.relaunch();
        app.quit();
      });
      window = new BrowserWindow({
        width: config.startupSettings.width,
        height: config.startupSettings.height,
        minWidth: 450,
        minHeight: 560,
        resizable: true,
        title: config.appName,
        backgroundColor: config.startupSettings.backgroundColor,
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      window.setMenuBarVisibility(false);
      await window.loadFile(path.join(__dirname, "launcher.html"));
      localServer.events.on("status", (status) =>
        window?.webContents.send("status", status),
      );
    } catch (e) {
      dialog.showErrorBox("Serveren kunne ikke starte", e.message);
      app.quit();
    }
  });
  ipcMain.handle("status", () => ({
    ...localServer.status(),
    name: config.appName,
  }));
  ipcMain.handle("port", async (event, port) => {
    try {
      await localServer.setPort(port);
      return { ok: true, status: localServer.status() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("open", async (event, route) => {
    if (
      ![
        "/",
        "/?editor",
        "/projects",
        "/controller",
        "/output",
        "/display",
        "/settings",
      ].includes(route)
    )
      return;
    await shell.openExternal(
      `http://localhost:${localServer.status().port}${route}`,
    );
  });
  ipcMain.handle("quit", () => app.quit());
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (localServer && !quitting) {
      event.preventDefault();
      quitting = true;
      localServer
        .close()
        .then(() => app.quit())
        .catch((e) => {
          dialog.showErrorBox("Lagringsfeil", e.message);
          app.exit(1);
        });
    }
  });
}
