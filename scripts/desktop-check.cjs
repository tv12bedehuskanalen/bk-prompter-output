const { _electron: electron } = require("@playwright/test");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-desktop-"));
  let app;
  try {
    const executablePath = process.argv[2];
    app = await electron.launch({
      ...(executablePath
        ? { executablePath }
        : { args: [path.join(__dirname, "../desktop/main.cjs")] }),
      env: { ...process.env, BK_DATA_DIR: dir, PORT: "17992" },
    });
    const page = await app.firstWindow();
    await page.waitForFunction(() =>
      document.querySelector("#version")?.textContent.includes("0.1.0"),
    );
    const status = await page.evaluate(() => launcher.status());
    assert.equal(status.port, 17992);
    assert.ok(status.interfaces.length);
    await page.locator("#port").fill("17993");
    await page.locator("#port-form button").click();
    await page.waitForFunction(() =>
      document.querySelector("#message").textContent.includes("oppdatert"),
    );
    assert.equal(
      (await fetch("http://localhost:17993/api/status").then((r) => r.json()))
        .version,
      "0.1.0",
    );
    await page.screenshot({
      path: path.join(__dirname, "../docs/screenshots/launcher.png"),
    });
    await app.close();
    app = null;
    assert.ok(fs.existsSync(path.join(dir, "studio.json")));
    console.log(
      "Desktop launcher passed: starts server, shows addresses/version, changes port, persists and exits.",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
