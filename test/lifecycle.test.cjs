const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  net = require("node:net");
const { spawn } = require("node:child_process");
const WebSocket = require("ws");
const { initial } = require("../server/state.cjs");
test(
  "headless server restart and shutdown persist projects and reconnect with playback paused",
  { timeout: 20000 },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-lifecycle-"));
    const data = initial();
    data.network.oscEnabled = false;
    fs.writeFileSync(path.join(dir, "studio.json"), JSON.stringify(data));
    const probe = net.createServer();
    await new Promise((r) => probe.listen(0, "127.0.0.1", r));
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));
    const child = spawn(
      process.execPath,
      [path.join(__dirname, "../server/index.cjs")],
      {
        env: { ...process.env, BK_DATA_DIR: dir, PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let logs = "";
    child.stdout.on("data", (b) => (logs += b));
    child.stderr.on("data", (b) => (logs += b));
    let exitCode;
    child.on("exit", (code) => (exitCode = code));
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    async function wait(check) {
      for (let i = 0; i < 150; i++) {
        if (await check()) return;
        await pause(30);
      }
      throw Error("Lifecycle timeout: " + logs);
    }
    let ws;
    async function connect() {
      ws = new WebSocket(`ws://localhost:${port}/live`);
      let state;
      ws.on("message", (raw) => {
        const m = JSON.parse(raw);
        if (m.type === "state") state = m.state;
      });
      await new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      await wait(() => state);
      return () => state;
    }
    let requestId = 0;
    function request(message) {
      return new Promise((resolve, reject) => {
        const id = ++requestId;
        const listen = (raw) => {
          const m = JSON.parse(raw);
          if (m.requestId !== id) return;
          ws.off("message", listen);
          m.type === "error" ? reject(Error(m.message)) : resolve(m);
        };
        ws.on("message", listen);
        ws.send(JSON.stringify({ ...message, requestId: id }));
      });
    }
    try {
      await wait(() => logs.includes("http://localhost:"));
      let state = await connect();
      await request({
        type: "edit",
        action: "saveMetadata",
        id: state().selection.script,
        name: "Retained after restart",
      });
      await request({ type: "control", action: "play" });
      const closed = new Promise((r) => ws.once("close", r));
      await request({ type: "lifecycle", action: "restart" });
      await closed;
      await wait(() => logs.split("http://localhost:").length >= 3);
      state = await connect();
      assert.equal(
        state().projects[0].episodes[0].scripts[0].name,
        "Retained after restart",
      );
      assert.equal(state().transport.playing, false);
      await request({ type: "lifecycle", action: "shutdown" });
      await wait(() => exitCode !== undefined);
      assert.equal(exitCode, 0);
      const saved = JSON.parse(
        fs.readFileSync(path.join(dir, "studio.json"), "utf8"),
      );
      assert.equal(
        saved.projects[0].episodes[0].scripts[0].name,
        "Retained after restart",
      );
    } finally {
      ws?.terminate();
      if (exitCode === undefined) {
        child.kill("SIGTERM");
        await new Promise((r) => child.once("exit", r));
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
