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

test("editing and deleting an off-air script does not interrupt live playback", () => {
  const { engine: e, advance } = setup();
  const live = e.current().s;
  e.edit("a", { action: "createScript", name: "Second", background: true });
  const second = e.current().e.scripts[1];
  assert.equal(e.current().s.id, live.id);
  e.control("a", "play");
  advance(1200);
  e.layout = { max: 1000, chapters: [0, 300] };
  e.edit("b", {
    action: "saveScript",
    id: second.id,
    version: second.version,
    name: "Second updated",
    oscId: "part2",
    html: "<p>Second text</p>",
    color: "#e79755",
  });
  assert.equal(e.current().s.id, live.id);
  assert.equal(e.data.transport.playing, true);
  assert.equal(e.position(), 72);
  assert.equal(e.layout.max, 1000);
  e.edit("b", { action: "deleteScript", id: second.id });
  assert.equal(e.current().s.id, live.id);
  assert.equal(e.data.transport.playing, true);
});
test("project menu creation leaves loaded program untouched; loading a program is atomic", () => {
  const { engine: e } = setup();
  const selection = { ...e.data.selection };
  e.control("a", "play");
  e.edit("a", { action: "createProject", name: "Other", background: true });
  const project = e.data.projects[1];
  e.edit("a", {
    action: "createEpisode",
    projectId: project.id,
    name: "Episode",
    background: true,
  });
  assert.deepEqual(e.data.selection, selection);
  assert.equal(e.data.transport.playing, true);
  assert.throws(() =>
    e.edit("a", {
      action: "loadProgram",
      projectId: project.id,
      episodeId: "missing",
    }),
  );
  assert.deepEqual(e.data.selection, selection);
  e.edit("a", {
    action: "loadProgram",
    projectId: project.id,
    episodeId: project.episodes[0].id,
  });
  assert.equal(e.data.selection.project, project.id);
  assert.equal(e.data.transport.playing, false);
});
test("keep, preset and custom display policies apply consistently when loading through OSC or next", () => {
  const { engine: e } = setup();
  const first = e.current().s;
  e.edit("a", {
    action: "savePreset",
    name: "Presenter",
    value: { fontSize: 82, mirror: true, margin: 80 },
  });
  const preset = e.data.displayPresets[0];
  e.edit("a", {
    action: "createScript",
    name: "Preset script",
    background: true,
  });
  const second = e.current().e.scripts[1];
  e.edit("a", {
    action: "saveScript",
    id: second.id,
    version: 1,
    name: second.name,
    oscId: "part2",
    html: "<p>Preset</p>",
    displayMode: "preset",
    presetId: preset.id,
  });
  assert.equal(
    e.data.settings.fontSize,
    56,
    "editing policy must not apply it to live output",
  );
  e.control("osc", "load", "part2");
  assert.equal(e.data.settings.fontSize, 82);
  assert.equal(e.data.settings.mirror, true);
  assert.equal(e.data.transport.playing, false);
  assert.equal(e.position(), 0);
  e.control("phone", "play");
  e.control("phone", "speed", 95);
  assert.equal(e.data.transport.playing, true);
  assert.equal(e.data.transport.speed, 95);
  e.control("osc", "load", first.id);
  assert.equal(
    e.data.settings.fontSize,
    82,
    "keep retains settings of preceding script",
  );
  e.edit("a", {
    action: "saveScript",
    id: second.id,
    version: second.version,
    name: second.name,
    oscId: "part2",
    html: "<p>Custom</p>",
    displayMode: "custom",
    customSettings: { fontSize: 44, mirror: false, background: "#123456" },
  });
  assert.equal(e.data.settings.fontSize, 82);
  e.control("phone", "next");
  assert.equal(e.data.settings.fontSize, 44);
  assert.equal(e.data.settings.mirror, false);
  assert.equal(e.data.settings.background, "#123456");
  assert.equal(
    preset.settings.fontSize,
    82,
    "custom settings never overwrite presets",
  );
  e.edit("a", {
    action: "saveScript",
    id: second.id,
    version: second.version,
    name: second.name,
    oscId: "part2",
    html: "<p>Keep</p>",
    displayMode: "keep",
  });
  e.edit("a", { action: "settings", value: { fontSize: 71 } });
  e.control("osc", "load", "part2");
  assert.equal(e.data.settings.fontSize, 71);
});
test("presets round-trip with project export/import and cannot be deleted while referenced", () => {
  const { engine: e } = setup();
  e.edit("a", {
    action: "savePreset",
    name: "Studio",
    value: { fontSize: 77 },
  });
  const preset = e.data.displayPresets[0],
    script = e.current().s;
  e.edit("a", {
    action: "saveScript",
    id: script.id,
    version: script.version,
    name: script.name,
    oscId: script.oscId,
    html: script.html,
    displayMode: "preset",
    presetId: preset.id,
  });
  assert.throws(
    () => e.edit("a", { action: "deletePreset", id: preset.id }),
    /brukes/,
  );
  e.edit("a", {
    action: "importProjects",
    value: {
      schema: 1,
      projects: structuredClone(e.data.projects),
      displayPresets: structuredClone(e.data.displayPresets),
    },
  });
  const imported = e.data.projects[1].episodes[0].scripts[0];
  assert.notEqual(imported.presetId, preset.id);
  assert.equal(
    e.data.displayPresets.find((p) => p.id === imported.presetId).settings
      .fontSize,
    77,
  );
  const restored = new Engine(JSON.parse(JSON.stringify(e.data)));
  assert.equal(restored.data.displayPresets.length, 2);
});
