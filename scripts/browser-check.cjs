const { chromium } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { startServer } = require("../server/index.cjs");
const { initial } = require("../server/state.cjs");
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-browser-"));
  const data = initial();
  data.network.oscEnabled = false;
  fs.writeFileSync(path.join(dir, "studio.json"), JSON.stringify(data));
  const server = await startServer({ dataDir: dir, port: 17990 });
  const browser = await chromium.launch();
  const errors = [],
    external = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    context.on("page", (p) => {
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("request", (r) => {
        if (
          !r.url().startsWith("http://localhost:17990") &&
          !r.url().startsWith("data:")
        )
          external.push(r.url());
      });
    });
    const editor = await context.newPage(),
      output = await context.newPage(),
      other = await context.newPage();
    await editor.goto("http://localhost:17990/?editor");
    await output.goto("http://localhost:17990/output");
    await other.goto("http://localhost:17990/output");
    await editor.waitForFunction(() =>
      document.querySelector("#editor")?.textContent.includes("Velkommen"),
    );
    await output.waitForFunction(
      () =>
        document.fonts.check("56px Prompter") &&
        document
          .querySelector(".prompt-content")
          ?.textContent.includes("Velkommen"),
    );
    await editor
      .locator("#editor")
      .fill(
        "Dette er et lokalt utkast.\n" +
          "Vi fortsetter sendingen med oppdaterte ord. ".repeat(70),
      );
    await editor.waitForTimeout(1100);
    assert.ok(
      !server.engine.current().s.html.includes("lokalt utkast"),
      "local edits must not enter shared state",
    );
    assert.ok(
      !(await output.locator(".stage .prompt-content").innerText()).includes(
        "lokalt utkast",
      ),
      "draft must not publish automatically",
    );
    // Switching scripts discards unsubmitted edits; returning shows shared state.
    await editor.locator('[data-create="Script"]').click();
    await editor.locator("#new-name").fill("Neste innslag");
    await editor.locator("dialog button.primary").click();
    await editor.waitForFunction(
      () => document.querySelector("#script-name").value === "Neste innslag",
    );
    await editor.locator(".script-card").first().click();
    await editor.waitForFunction(() =>
      document.querySelector("#editor").textContent.includes("Velkommen"),
    );
    assert.ok(
      !server.engine.current().s.html.includes("lokalt utkast"),
      "switching must not publish the draft",
    );
    // Reload and navigation also discard edits, with no hidden draft persistence.
    await editor.locator("#editor").fill("Discard on reload");
    await editor.reload();
    await editor.waitForFunction(() =>
      document.querySelector("#editor").textContent.includes("Velkommen"),
    );
    await editor
      .locator("#editor")
      .fill(
        "Dette er et lokalt utkast. " +
          "Vi fortsetter sendingen med oppdaterte ord. ".repeat(70),
      );
    await editor.locator('[data-control="toggle"]').click();
    await editor.waitForTimeout(200);
    const old = server.engine.position();
    await editor.locator("#save").click();
    await output.waitForFunction(() =>
      document
        .querySelector(".prompt-content")
        .textContent.includes("lokalt utkast"),
    );
    assert.ok(
      server.engine.position() >= old,
      "publish must preserve position",
    );
    assert.equal(server.engine.data.transport.playing, true);
    await editor.waitForTimeout(500);
    // Each output exposes the same content layout; estimate normalized positions at a shared wall time.
    const read = (p) =>
      p.evaluate(() => {
        const view = document.querySelector(".stage-viewport"),
          m = new DOMMatrix(
            getComputedStyle(document.querySelector(".stage")).transform,
          );
        return {
          position:
            (view.clientHeight * 0.3 - m.m42) / (view.clientWidth / 1200),
          at: Date.now(),
          width: document.querySelector(".prompt-content").offsetWidth,
          font: getComputedStyle(document.querySelector(".prompt-content"))
            .fontFamily,
        };
      });
    const a = await read(output),
      b = await read(other);
    const drift = Math.abs(b.position - a.position - (b.at - a.at) * 0.06);
    assert.ok(drift < 8, `synchronized outputs drift ${drift}px`);
    assert.equal(a.width, b.width);
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const mobile = await mobileContext.newPage();
    mobile.on("pageerror", (e) => errors.push(e.message));
    await mobile.goto("http://localhost:17990/");
    await mobile.waitForSelector("#hold");
    assert.equal(await mobile.locator(".mobile-control").count(), 1);
    assert.equal(await mobile.locator("#editor").count(), 0);
    const holdBox = await mobile.locator("#hold").boundingBox();
    await mobile.mouse.move(
      holdBox.x + holdBox.width / 2,
      holdBox.y + holdBox.height / 2,
    );
    await mobile.mouse.down();
    await mobile.waitForTimeout(120);
    const held = server.engine.position();
    await mobile.waitForTimeout(250);
    assert.ok(Math.abs(server.engine.position() - held) < 1);
    await mobile.mouse.up();
    await mobile.waitForTimeout(150);
    assert.ok(server.engine.position() > held);
    const settings = await context.newPage();
    await settings.goto("http://localhost:17990/display");
    await settings.waitForSelector("#mirror");
    await settings.locator("#mirror").check();
    await output.waitForFunction(() =>
      getComputedStyle(
        document.querySelector(".stage-transform"),
      ).transform.includes("-1"),
    );
    assert.equal(server.engine.data.settings.mirror, true);
    await settings.locator("#mirror").uncheck();
    await editor.locator('[data-control="reset"]').click();
    // Restore attractive sample content for screenshots after validating publication.
    const sample = initial().projects[0].episodes[0].scripts[0];
    const active = server.engine.current().s;
    await editor.locator("#editor").evaluate((el, html) => {
      el.innerHTML = html;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, sample.html);
    await editor.locator("#save").click();
    await editor.waitForTimeout(500);
    await editor
      .locator("#toast")
      .evaluate((el) => (el.style.display = "none"));
    fs.mkdirSync(path.join(__dirname, "../docs/screenshots"), {
      recursive: true,
    });
    await editor.screenshot({
      path: path.join(__dirname, "../docs/screenshots/studio.png"),
      fullPage: true,
    });
    await mobile.screenshot({
      path: path.join(__dirname, "../docs/screenshots/mobile.png"),
      fullPage: true,
    });
    await settings.screenshot({
      path: path.join(__dirname, "../docs/screenshots/display.png"),
      fullPage: true,
    });
    const iconPage = await context.newPage();
    await iconPage.setViewportSize({ width: 1024, height: 1024 });
    await iconPage.goto("http://localhost:17990/favicon.svg");
    await iconPage.screenshot({
      path: path.join(__dirname, "../public/branding/icon.png"),
      omitBackground: true,
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(
      JSON.stringify(
        {
          passed: true,
          outputDriftLogicalPx: drift,
          externalRequests: external.length,
          browserErrors: errors.length,
        },
        null,
        2,
      ),
    );
    await mobileContext.close();
  } finally {
    await browser.close();
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
