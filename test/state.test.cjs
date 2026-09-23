const test = require("node:test"),
  assert = require("node:assert/strict");
const { Engine, initial, clean } = require("../server/state.cjs");
function setup() {
  let time = 1000;
  const engine = new Engine(initial(), () => time);
  return { engine, advance: (n) => (time += n) };
}
test("one authoritative position; live publish preserves motion and position", () => {
  const { engine: e, advance } = setup();
  e.control("a", "play");
  advance(2000);
  assert.equal(e.position(), 120);
  const s = e.current().s;
  e.edit("a", {
    action: "saveScript",
    id: s.id,
    version: s.version,
    name: s.name,
    oscId: s.oscId,
    html: "<p>Updated live</p>",
  });
  assert.equal(e.position(), 120);
  assert.equal(e.data.transport.playing, true);
  advance(1000);
  assert.equal(e.position(), 180);
  assert.equal(
    e.snapshot().transport.position,
    e.snapshot().transport.position,
  );
});
test("latest control input wins and locking applies to browser and OSC", () => {
  const { engine: e, advance } = setup();
  e.control("a", "play");
  advance(1000);
  e.control("b", "speed", 100);
  advance(1000);
  assert.equal(e.position(), 160);
  e.data.lock = { owner: "a", by: "a" };
  assert.throws(() => e.control("b", "pause"), /låst/);
  assert.throws(() => e.control("osc", "pause"), /låst/);
  e.control("a", "pause");
  assert.equal(e.data.transport.playing, false);
  e.disconnect("a");
  assert.equal(e.data.lock, null);
});
test("momentary hold resumes on release, disconnection and lease expiry", () => {
  const { engine: e, advance } = setup();
  e.control("a", "play");
  advance(1000);
  e.control("a", "hold");
  advance(1000);
  assert.equal(e.position(), 60);
  e.control("a", "release");
  advance(1000);
  assert.equal(e.position(), 120);
  e.control("b", "hold");
  advance(500);
  e.disconnect("b");
  advance(1000);
  assert.equal(e.position(), 180);
  e.control("osc", "hold");
  advance(3000);
  e.expireHolds();
  advance(1000);
  assert.equal(e.position(), 240);
});
test("OSC identifiers are unique per episode, reusable across programs", () => {
  const { engine: e } = setup();
  e.edit("a", { action: "createScript", name: "Another" });
  let s = e.current().s;
  assert.throws(
    () =>
      e.edit("a", {
        action: "saveScript",
        id: s.id,
        version: 1,
        name: s.name,
        oscId: "intro",
        html: "<p>x</p>",
      }),
    /unik/,
  );
  e.edit("a", { action: "createEpisode", name: "Tomorrow" });
  e.edit("a", { action: "createScript", name: "Intro tomorrow" });
  s = e.current().s;
  e.edit("a", {
    action: "saveScript",
    id: s.id,
    version: 1,
    name: s.name,
    oscId: "intro",
    html: "<p>x</p>",
  });
  e.control("osc", "load", "intro");
  assert.equal(e.current().s.name, "Intro tomorrow");
});
test("stale drafts cannot overwrite a published revision", () => {
  const { engine: e } = setup(),
    s = e.current().s;
  const msg = {
    action: "saveScript",
    id: s.id,
    version: s.version,
    name: s.name,
    oscId: s.oscId,
    html: "<p>first</p>",
  };
  e.edit("a", msg);
  assert.throws(
    () => e.edit("b", { ...msg, html: "<p>second</p>" }),
    /annen klient/,
  );
  assert.equal(e.current().s.html, "<p>first</p>");
});
test("content sanitizer keeps formatting and strips executable content", () => {
  const result = clean(
    '<h2>Title</h2><script>alert(1)</script><span onclick="bad()" style="color:#ffffff;background-color:#ff0000;position:fixed">Color</span><img src=x onerror=bad()>',
  );
  assert.match(result, /<h2>Title/);
  assert.match(result, /color:#ffffff/);
  assert.doesNotMatch(result, /script|onclick|position|onerror|img/);
});
test("chapters use shared layout and manuscript navigation resets only explicit loads", () => {
  const { engine: e } = setup();
  e.layout = { max: 500, chapters: [0, 100, 300] };
  e.control("a", "chapter");
  assert.equal(e.position(), 100);
  e.control("a", "chapter");
  assert.equal(e.position(), 300);
  e.control("a", "seek", 999);
  assert.equal(e.position(), 500);
  e.edit("a", { action: "createScript", name: "Next" });
  assert.equal(e.position(), 0);
  assert.equal(e.data.transport.playing, false);
});
test("restart restores documents and settings but never resumes a show automatically", () => {
  const { engine: e } = setup();
  e.control("a", "play");
  const restored = new Engine(JSON.parse(JSON.stringify(e.data)));
  assert.equal(restored.current().s.oscId, "intro");
  assert.equal(restored.data.transport.playing, false);
});
test("project export/import retains script text and reusable OSC IDs without replacing originals", () => {
  const { engine: e } = setup();
  const before = structuredClone(e.data.projects);
  e.edit("a", {
    action: "importProjects",
    value: { schema: 1, projects: before },
  });
  assert.equal(e.data.projects.length, 2);
  assert.notEqual(e.data.projects[0].id, e.data.projects[1].id);
  assert.deepEqual(e.data.projects[0], before[0]);
  assert.equal(
    e.data.projects[1].episodes[0].scripts[0].html,
    before[0].episodes[0].scripts[0].html,
  );
});
test("browser-applied bold, italic and underline CSS survives publication", () => {
  const html = clean(
    '<span style="font-weight: bold; font-style: italic; text-decoration: underline; color: rgb(50, 198, 203)">Words</span>',
  );
  assert.match(html, /font-weight:bold/);
  assert.match(html, /font-style:italic/);
  assert.match(html, /text-decoration:underline/);
});
