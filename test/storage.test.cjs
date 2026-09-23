const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { LocalRepository } = require("../server/storage.cjs");
const { initial } = require("../server/state.cjs");
test("upgrade backs up existing data and retains project IDs, ports and custom settings", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-upgrade-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const before = initial();
  before.appVersion = "0.0.9";
  before.network.port = 9876;
  before.settings.fontSize = 91;
  const repo = new LocalRepository(dir);
  const raw = JSON.stringify(before);
  fs.writeFileSync(repo.file, raw);
  const after = repo.read();
  assert.deepEqual(after.projects, before.projects);
  assert.equal(after.settings.fontSize, 91);
  assert.equal(after.network.port, 9876);
  const backups = fs.readdirSync(path.join(dir, "backups"));
  assert.equal(backups.length, 1);
  assert.equal(
    fs.readFileSync(path.join(dir, "backups", backups[0]), "utf8"),
    raw,
  );
  repo.save(after);
  repo.read();
  assert.equal(fs.readdirSync(path.join(dir, "backups")).length, 1);
});
test("newer schemas and corrupt files are never overwritten by an old app", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-upgrade-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = new LocalRepository(dir);
  let raw = JSON.stringify({ ...initial(), schema: 99 });
  fs.writeFileSync(repo.file, raw);
  assert.throws(() => repo.read(), /nyere appversjon/);
  assert.equal(fs.readFileSync(repo.file, "utf8"), raw);
  fs.writeFileSync(repo.file, "broken");
  assert.throws(() => repo.read(), /Originalfilen er bevart/);
  assert.equal(fs.readFileSync(repo.file, "utf8"), "broken");
});
