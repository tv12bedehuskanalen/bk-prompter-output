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
    await editor.locator(".script-open").first().click();
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
    await editor.locator(".script-open").first().click();
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
    await editor.locator(".script-open").first().click();
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
    const waitFor = async (check) => {
      for (let i = 0; i < 100; i++) {
        if (check()) return;
        await editor.waitForTimeout(20);
      }
      assert.fail("Expected server state was not reached");
    };
    const setRange = async (page, selector, value) =>
      page.locator(selector).evaluate((input, value) => {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
    await setRange(settings, "#fontSize", 80);
    await waitFor(() => server.engine.data.settings.fontSize === 80);
    await settings.locator("#preset-name").fill("Studio · stor tekst");
    await settings.locator("#save-preset").click();
    await waitFor(() => server.engine.data.displayPresets.length === 1);
    const presetId = server.engine.data.displayPresets[0].id;
    await setRange(settings, "#fontSize", 56);
    await waitFor(() => server.engine.data.settings.fontSize === 56);
    const originalProgram = { ...server.engine.data.selection };
    const secondId = server.engine.current().e.scripts[1].id;
    await editor.locator(".script-open").nth(1).click();
    assert.equal(
      server.engine.current().s.id,
      originalProgram.script,
      "opening the editor must not load the script",
    );
    await editor
      .locator("#editor")
      .fill(
        "Neste innslag. Presentøren styrer hastigheten fra telefonen. ".repeat(
          20,
        ),
      );
    await editor.locator(".script-display-panel summary").click();
    await editor.locator("#script-display-mode").selectOption("preset");
    await editor.locator("#script-preset").selectOption(presetId);
    await editor.locator('[data-color="#e79755"]').click();
    await editor.locator("#save").click();
    await waitFor(
      () => server.engine.current().e.scripts[1].displayMode === "preset",
    );
    assert.equal(
      server.engine.data.settings.fontSize,
      56,
      "editing a script preset must not affect current output",
    );
    await editor.locator(".load-script").nth(1).click();
    await waitFor(() => server.engine.current().s.id === secondId);
    assert.equal(server.engine.data.transport.playing, false);
    assert.equal(server.engine.position(), 0);
    assert.equal(server.engine.data.settings.fontSize, 80);
    await mobile.waitForFunction(
      () =>
        document.querySelector("#controller-title").textContent ===
        "Neste innslag",
    );
    await mobile.locator('[data-control="toggle"]').click();
    await waitFor(() => server.engine.data.transport.playing);
    await setRange(mobile, "#speed", 77);
    await waitFor(() => server.engine.data.transport.speed === 77);
    await mobile.locator('[data-control="toggle"]').click();
    await editor.locator("#script-display-mode").selectOption("custom");
    await editor.locator('[data-custom-setting="fontSize"]').fill("44");
    await editor.locator("#save").click();
    await waitFor(() => server.engine.current().s.displayMode === "custom");
    assert.equal(server.engine.data.settings.fontSize, 80);
    await editor.locator(".load-script").nth(1).click();
    await waitFor(() => server.engine.data.settings.fontSize === 44);
    assert.equal(server.engine.data.displayPresets.length, 1);
    await editor.locator("#script-display-mode").selectOption("keep");
    await editor.locator("#save").click();
    await waitFor(() => server.engine.current().s.displayMode === "keep");
    await setRange(settings, "#fontSize", 68);
    await waitFor(() => server.engine.data.settings.fontSize === 68);
    await editor.locator(".load-script").nth(1).click();
    assert.equal(server.engine.data.settings.fontSize, 68);
    await editor.locator("#toggle-live").click();
    assert.equal(await editor.locator(".live-body").isVisible(), false);
    await editor.locator("#toggle-live").click();
    assert.equal(await editor.locator(".live-body").isVisible(), true);
    assert.equal(
      await editor.locator("#project,#episode").count(),
      0,
      "workspace has no project/program selectors",
    );
    const left = await editor.locator(".live-sidebar").boundingBox(),
      middle = await editor.locator(".rundown-pane").boundingBox(),
      right = await editor.locator(".editor-pane").boundingBox();
    assert.ok(left.x < middle.x && middle.x < right.x);
    const menu = await context.newPage();
    await menu.goto("http://localhost:17990/projects");
    await menu.locator("#menu-create").click();
    await menu.locator("#new-name").fill("Helgesending");
    await menu.locator("dialog button.primary").click();
    await menu.waitForFunction(
      () =>
        document.querySelector("#menu-title").textContent === "Helgesending",
    );
    assert.equal(
      server.engine.current().s.id,
      secondId,
      "project menu must not alter the live program while browsing",
    );
    await menu.locator("#menu-create").click();
    await menu.locator("#new-name").fill("Søndag");
    await menu.locator("dialog button.primary").click();
    await menu.waitForSelector("[data-program]");
    assert.equal(server.engine.current().s.id, secondId);
    await menu.screenshot({
      path: path.join(__dirname, "../docs/screenshots/program-menu.png"),
      fullPage: true,
    });
    await menu.locator("[data-program]").click();
    await menu.waitForURL("**/?editor");
    await waitFor(() => server.engine.current().e.name === "Søndag");
    await menu.goto("http://localhost:17990/projects");
    await menu.locator(`[data-project="${originalProgram.project}"]`).click();
    await menu.locator(`[data-program="${originalProgram.episode}"]`).click();
    await menu.waitForURL("**/?editor");
    await waitFor(
      () => server.engine.current().e.id === originalProgram.episode,
    );
    await editor.locator(".script-open").first().click();
    await editor.locator(".load-script").first().click();
    await setRange(settings, "#fontSize", 56);
    await waitFor(() => server.engine.data.settings.fontSize === 56);
    await editor
      .locator(".script-display-panel")
      .evaluate((el) => (el.open = false));
    // Restore attractive sample content for screenshots after validating publication.
    const sample = initial().projects[0].episodes[0].scripts[0];
    const active = server.engine.current().s;
    await editor.locator("#editor").evaluate((el, html) => {
      el.innerHTML = html;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, sample.html);
    await editor.locator("#save").click();
    await editor.waitForTimeout(500);
    await editor.locator("#editor").evaluate((el) => (el.scrollTop = 0));
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
