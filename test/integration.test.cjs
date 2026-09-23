const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  net = require("node:net");
const { WebSocket } = require("ws");
const osc = require("osc");
const { startServer } = require("../server/index.cjs");
const { initial } = require("../server/state.cjs");
const { importDocument } = require("../server/import.cjs");
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await delay(10);
  }
  assert.fail("State did not propagate within 1 second");
}
const delay = (n) => new Promise((r) => setTimeout(r, n));
async function freePort() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
async function client(port) {
  const ws = new WebSocket(`ws://localhost:${port}/live`);
  let state,
    id,
    error,
    acks = new Map(),
    counter = 0;
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.type === "state") state = m.state;
    if (m.type === "welcome") id = m.id;
    if (m.type === "error") error = m.message;
    if (acks.has(m.requestId)) {
      const { resolve, reject, timer } = acks.get(m.requestId);
      clearTimeout(timer);
      acks.delete(m.requestId);
      m.type === "error" ? reject(Error(m.message)) : resolve();
    }
  });
  await new Promise((r) => ws.once("open", r));
  await delay(20);
  return {
    ws,
    get state() {
      return state;
    },
    get id() {
      return id;
    },
    send(msg) {
      return new Promise((resolve, reject) => {
        const requestId = ++counter,
          timer = setTimeout(() => reject(Error("timeout")), 2000);
        acks.set(requestId, { resolve, reject, timer });
        ws.send(JSON.stringify({ ...msg, requestId }));
      });
    },
  };
}
test("two live clients, OSC, publication, lock, port migration, persistence", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-test-")),
    port = await freePort(),
    oscListen = await freePort();
  const seed = initial();
  seed.network.oscPort = oscListen;
  fs.writeFileSync(path.join(dir, "studio.json"), JSON.stringify(seed));
  let server = await startServer({ dataDir: dir, port });
  t.after(async () => {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const a = await client(port),
    b = await client(port);
  assert.equal(a.state.selection.script, b.state.selection.script);
  await a.send({ type: "control", action: "play" });
  await until(() => b.state.transport.playing);
  assert.equal(b.state.transport.playing, true);
  await delay(80);
  const before = server.engine.position();
  const s = server.engine.current().s;
  await b.send({
    type: "edit",
    action: "saveScript",
    id: s.id,
    version: s.version,
    name: s.name,
    oscId: s.oscId,
    html: "<h1>Live update</h1><p>Still rolling</p>",
  });
  assert.ok(server.engine.position() >= before);
  await until(() => a.state.projects[0].episodes[0].scripts[0].version === 2);
  assert.equal(a.state.transport.playing, true);
  assert.match(a.state.projects[0].episodes[0].scripts[0].html, /Live update/);
  await a.send({ type: "lock", owner: a.id });
  await assert.rejects(b.send({ type: "control", action: "pause" }), /låst/);
  await a.send({ type: "lock", owner: null });
  const remote = new osc.UDPPort({
    localAddress: "127.0.0.1",
    localPort: 0,
    metadata: true,
  });
  remote.open();
  await new Promise((r) => remote.once("ready", r));
  const reply = new Promise((r) => remote.once("message", r));
  remote.send(
    { address: "/prompter/speed", args: [{ type: "f", value: 88 }] },
    "127.0.0.1",
    oscListen,
  );
  assert.equal((await reply).address, "/prompter/ok");
  assert.equal(server.engine.data.transport.speed, 88);
  remote.close();
  const imported = await fetch(`http://localhost:${port}/api/status`).then(
    (r) => r.json(),
  );
  assert.equal(imported.port, port);
  let newPort = await freePort();
  await server.setPort(newPort);
  assert.equal(
    (
      await fetch(`http://localhost:${newPort}/api/status`).then((r) =>
        r.json(),
      )
    ).port,
    newPort,
  );
  await server.close();
  server = await startServer({ dataDir: dir, port: newPort });
  assert.match(server.engine.current().s.html, /Live update/);
  assert.equal(server.engine.data.transport.playing, false);
});
test("TXT, HTML and RTF imports preserve Norwegian and safe basic formatting", async () => {
  const file = (name, text) => ({
    originalname: name,
    buffer: Buffer.from(text),
  });
  assert.match(await importDocument(file("a.txt", "Hei æøå\nNeste")), /æøå/);
  assert.doesNotMatch(
    await importDocument(
      file("a.html", "<h1>Tittel</h1><script>bad()</script>"),
    ),
    /script/,
  );
  const result = await importDocument(
    file("a.rtf", String.raw`{\rtf1\ansi F\'f8rste\par \b Andre\b0\par}`),
  );
  assert.match(result, /Første/);
  assert.match(result, /<strong>Andre/);
  assert.match(result, /<p>/);
});
test("DOCX imports Norwegian text and bold formatting", async () => {
  const html = await importDocument({
    originalname: "sample.docx",
    buffer: fs.readFileSync(path.join(__dirname, "fixtures/sample.docx")),
  });
  assert.match(html, /<strong>Nyheter fra Bedehuskanalen<\/strong>/);
  assert.match(html, /æøå ÆØÅ/);
});
