const config = require("../config/app.cjs");
const express = require("express");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");
const multer = require("multer");
const osc = require("osc");
const { Engine } = require("./state.cjs");
const { LocalRepository } = require("./storage.cjs");
const { importDocument } = require("./import.cjs");
const version = require("../package.json").version;
const portValid = (p) => Number.isInteger(p) && p >= 1024 && p <= 65535;
function interfaces(port) {
  return [
    {
      name: "Denne maskinen",
      address: "127.0.0.1",
      url: `http://localhost:${port}`,
    },
    ...Object.entries(os.networkInterfaces()).flatMap(([name, items]) =>
      items
        .filter((x) => !x.internal && x.family === "IPv4")
        .map((x) => ({
          name,
          address: x.address,
          url: `http://${x.address}:${port}`,
        })),
    ),
  ];
}
async function startServer(options = {}) {
  const events = new EventEmitter(),
    repository = new LocalRepository(
      options.dataDir ||
        process.env.BK_DATA_DIR ||
        path.join(os.homedir(), config.dataFolder),
    );
  const engine = new Engine(repository.read() || undefined),
    app = express(),
    server = http.createServer(app),
    wss = new WebSocketServer({ noServer: true, maxPayload: 16000000 });
  const clients = new Map();
  let oscPort = null,
    oscStatus = "Av",
    saveTimer,
    closed = false;
  let desiredPort = Number(
    options.port ?? process.env.PORT ?? engine.data.network.port,
  );
  if (!portValid(desiredPort))
    throw Error("Port må være mellom 1024 og 65535.");
  let webPort = desiredPort;
  const status = () => ({
    version,
    port: webPort,
    interfaces: interfaces(webPort),
    oscStatus,
    oscPort: engine.data.network.oscPort,
  });
  function persist() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        repository.save({
          ...engine.data,
          transport: {
            ...engine.data.transport,
            position: engine.position(),
            at: engine.now(),
          },
        });
      } catch (e) {
        broadcast({ type: "error", message: "Kunne ikke lagre: " + e.message });
        events.emit("storage-error", e);
      }
    }, 200);
  }
  function send(ws, data) {
    if (ws.readyState !== WebSocket.OPEN) return;
    // Rejoin from an authoritative snapshot instead of silently losing an update.
    if (ws.bufferedAmount >= 2000000) {
      ws.terminate();
      return;
    }
    ws.send(JSON.stringify(data));
  }
  function broadcast(data) {
    for (let ws of clients.keys()) send(ws, data);
  }
  function snapshot() {
    broadcast({
      type: "state",
      state: engine.snapshot(),
      clients: [...clients.values()].map(({ id, name, role }) => ({
        id,
        name,
        role,
      })),
      status: status(),
    });
  }
  function changed() {
    persist();
    snapshot();
    events.emit("status", status());
  }
  function openOSC(config) {
    return new Promise((resolve, reject) => {
      if (!config.oscEnabled) return resolve(null);
      const next = new osc.UDPPort({
        localAddress: "0.0.0.0",
        localPort: config.oscPort,
        metadata: true,
      });
      next.once("ready", () => resolve(next));
      next.once("error", (err) => {
        try {
          next.close();
        } catch {}
        reject(err);
      });
      next.open();
    });
  }
  function attachOSC(next) {
    oscPort = next;
    oscStatus = next ? "Lytter" : "Av";
    if (!next) return;
    next.on("error", (err) => {
      oscStatus = err.message;
      events.emit("status", status());
      snapshot();
    });
    next.on("message", (msg, tag, info) => {
      try {
        const action = msg.address.replace(/^\/prompter\//, "");
        if (msg.address !== `/prompter/${action}`)
          throw Error("Ukjent OSC-adresse.");
        let value = msg.args?.[0]?.value;
        const aliases = {
          start: "play",
          stop: "pause",
          nextChapter: "chapter",
          previous: "previous",
        };
        if (action === "state") {
          next.send(
            {
              address: "/prompter/state",
              args: [
                {
                  type: "s",
                  value: JSON.stringify(engine.snapshot().transport),
                },
              ],
            },
            info.address,
            info.port,
          );
          return;
        }
        engine.control("osc", aliases[action] || action, value);
        changed();
        next.send(
          { address: "/prompter/ok", args: [{ type: "s", value: action }] },
          info.address,
          info.port,
        );
      } catch (e) {
        next.send(
          {
            address: "/prompter/error",
            args: [{ type: "s", value: e.message }],
          },
          info.address,
          info.port,
        );
      }
    });
  }
  app.use((req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'self'",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use(express.json({ limit: "2mb" }));
  // Only same-origin browser writes. The LAN itself is the trust boundary in v1.
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host)
          return res.status(403).json({ error: "Ugyldig opprinnelse." });
      } catch {
        return res.sendStatus(403);
      }
    }
    next();
  });
  app.get("/api/status", (req, res) => res.json(status()));
  app.get("/api/export", (req, res) =>
    res
      .attachment("bk-prompter-prosjekter.json")
      .json(repository.exportProjects(engine.data)),
  );
  app.post(
    "/api/import",
    multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    }).single("file"),
    async (req, res, next) => {
      try {
        if (!req.file) throw Error("Velg en fil.");
        res.json({
          html: await importDocument(req.file),
          name: req.file.originalname.replace(/\.[^.]+$/, ""),
        });
      } catch (e) {
        next(e);
      }
    },
  );
  app.use(express.static(path.join(__dirname, "../public")));
  app.get(
    ["/", "/output", "/controller", "/display", "/settings"],
    (req, res) => res.sendFile(path.join(__dirname, "../public/index.html")),
  );
  app.use((err, req, res, next) =>
    res.status(400).json({ error: err.message }),
  );
  server.on("upgrade", (req, socket, head) => {
    try {
      if (
        req.url !== "/live" ||
        (req.headers.origin &&
          new URL(req.headers.origin).host !== req.headers.host)
      ) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
    } catch {
      socket.destroy();
    }
  });
  wss.on("connection", (ws) => {
    const id = randomUUID();
    clients.set(ws, { id, name: "Ny klient", role: "editor", alive: true });
    send(ws, { type: "welcome", id });
    snapshot();
    ws.on("pong", () => {
      if (clients.has(ws)) clients.get(ws).alive = true;
    });
    ws.on("message", async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
        const client = clients.get(ws);
        if (!client) return;
        if (msg.type === "ping") {
          send(ws, { type: "pong", sent: msg.sent, server: engine.now() });
          return;
        }
        if (msg.type === "hello") {
          client.name = String(msg.name || "Klient").slice(0, 48);
          client.role = [
            "editor",
            "output",
            "controller",
            "display",
            "settings",
          ].includes(msg.role)
            ? msg.role
            : "editor";
          snapshot();
          return;
        }
        if (msg.type === "layout") {
          const { s } = engine.current();
          if (
            msg.script === s?.id &&
            msg.version === s.version &&
            msg.key === JSON.stringify(engine.data.settings) &&
            Number.isFinite(msg.max) &&
            msg.max >= 0 &&
            msg.max < 1e7 &&
            Array.isArray(msg.chapters) &&
            msg.chapters.length < 10000 &&
            msg.chapters.every(
              (n) => Number.isFinite(n) && n >= 0 && n <= msg.max,
            )
          ) {
            engine.anchor();
            engine.layout = { max: msg.max, chapters: msg.chapters };
            snapshot();
          }
          return;
        }
        if (msg.type === "control") engine.control(id, msg.action, msg.value);
        else if (msg.type === "edit") engine.edit(id, msg);
        else if (msg.type === "lock") {
          if (
            engine.data.lock &&
            engine.data.lock.owner !== id &&
            engine.data.lock.by !== id
          )
            throw Error("Bare låseeieren kan frigjøre kontrollen.");
          if (
            msg.owner &&
            msg.owner !== "osc" &&
            ![...clients.values()].some((c) => c.id === msg.owner)
          )
            throw Error("Klienten er frakoblet.");
          engine.anchor();
          engine.holds.clear();
          engine.data.lock = msg.owner ? { owner: msg.owner, by: id } : null;
        } else if (msg.type === "network") {
          if (!engine.allowed(id)) throw Error("Kontrollen er låst.");
          let config = {
            oscPort: Number(msg.oscPort),
            oscEnabled: !!msg.oscEnabled,
          };
          if (!portValid(config.oscPort))
            throw Error("OSC-port må være mellom 1024 og 65535.");
          if (
            config.oscPort !== engine.data.network.oscPort ||
            config.oscEnabled !== engine.data.network.oscEnabled
          ) {
            let next = await openOSC(config);
            if (oscPort) oscPort.close();
            Object.assign(engine.data.network, config);
            attachOSC(next);
          }
        } else throw Error("Ukjent melding.");
        changed();
        send(ws, { type: "ack", requestId: msg.requestId });
      } catch (e) {
        send(ws, {
          type: "error",
          requestId: msg?.requestId,
          message: e.message,
        });
      }
    });
    ws.on("close", () => {
      engine.disconnect(id);
      clients.delete(ws);
      changed();
    });
    ws.on("error", () => ws.close());
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(webPort, "0.0.0.0", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  engine.data.network.port = webPort;
  try {
    attachOSC(await openOSC(engine.data.network));
  } catch (e) {
    oscStatus = "Feil: " + e.message;
  }
  persist();
  const timer = setInterval(() => {
    engine.expireHolds();
    if (engine.layout && engine.data.transport.playing && !engine.holds.size) {
      const p = engine.position();
      if (
        (engine.data.transport.speed >= 0 && p >= engine.layout.max) ||
        (engine.data.transport.speed < 0 && p <= 0)
      ) {
        engine.anchor();
        engine.data.transport.playing = false;
        persist();
      }
    }
    if (engine.data.transport.playing) persist();
    broadcast({ type: "transport", transport: engine.snapshot().transport });
  }, 1000);
  const heartbeat = setInterval(() => {
    for (const [ws, c] of clients) {
      if (!c.alive) {
        ws.terminate();
        continue;
      }
      c.alive = false;
      ws.ping();
    }
  }, 5000);
  return {
    engine,
    events,
    status,
    async setPort(port) {
      port = Number(port);
      if (!portValid(port)) throw Error("Port må være mellom 1024 og 65535.");
      if (port === webPort) return; // Probe before interrupting the current listener.
      const probe = http.createServer();
      await new Promise((resolve, reject) => {
        probe.once("error", reject);
        probe.listen(port, "0.0.0.0", () => probe.close(resolve));
      });
      broadcast({ type: "redirect", port });
      for (const ws of clients.keys()) ws.close();
      await new Promise((resolve) => server.close(resolve));
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "0.0.0.0", () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
      webPort = port;
      engine.data.network.port = port;
      changed();
    },
    async close() {
      if (closed) return;
      closed = true;
      clearTimeout(saveTimer);
      clearInterval(timer);
      clearInterval(heartbeat);
      engine.anchor();
      engine.data.transport.playing = false;
      repository.save(engine.data);
      for (const ws of clients.keys()) ws.terminate();
      wss.close();
      if (oscPort) oscPort.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
if (require.main === module)
  startServer()
    .then((app) => {
      console.log(
        `BK Prompter ${version}: http://localhost:${app.status().port}`,
      );
      for (let signal of ["SIGINT", "SIGTERM"])
        process.on(signal, () => app.close().then(() => process.exit()));
    })
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
module.exports = { startServer, interfaces };
