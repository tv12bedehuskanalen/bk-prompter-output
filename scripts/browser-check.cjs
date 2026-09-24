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
    const peer = await context.newPage();
    await peer.goto("http://localhost:17990/?editor");
    await peer.locator(".script-open").first().click();
    await peer.locator("#editor").fill("Privat tekst i det andre vinduet");
    await editor.locator("#editor").evaluate((el) => {
      el.innerHTML =
        '<p><span style="color:rgb(51, 170, 85);background-color:rgb(170, 34, 51)">Farget tekst</span></p>';
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el.querySelector("span"));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    await editor.waitForFunction(
      () => document.querySelector("#text-color").value === "#33aa55",
    );
    assert.equal(await editor.locator("#highlight").inputValue(), "#aa2233");
    await editor.locator("#remove-highlight").click();
    const highlight = await editor.locator("#editor").evaluate((el) => {
      const node = getSelection().anchorNode;
      return getComputedStyle(node.nodeType === 1 ? node : node.parentElement)
        .backgroundColor;
    });
    assert.ok(
      ["rgba(0, 0, 0, 0)", "transparent"].includes(highlight),
      highlight,
    );
    await editor.locator("#discard-draft").click();
    await editor.locator("#script-name").fill("Velkommen oppdatert");
    await editor.locator("#osc-id").fill("opening");
    await editor.waitForTimeout(100);
    assert.equal(server.engine.current().s.name, "Velkommen oppdatert");
    assert.equal(server.engine.current().s.oscId, "opening");
    assert.equal(server.engine.current().s.version, 1);
    await peer.waitForFunction(
      () =>
        document.querySelector("#script-name").value === "Velkommen oppdatert",
    );
    assert.equal(
      await peer.locator("#editor").innerText(),
      "Privat tekst i det andre vinduet",
    );
    assert.equal(await editor.locator(".self-avatar").count(), 1);
    await editor.locator("#clients-toggle").click();
    assert.equal(
      await editor.locator(".client-row").count(),
      2,
      "one grouped browser plus OSC",
    );
    await editor.locator("#client-name").fill("Regi");
    await editor.locator("#client-name-form button").click();
    await peer.waitForFunction(
      () => document.querySelector(".self-avatar")?.title === "Regi",
    );
    await editor.locator(".client-row [data-lock]").first().click();
    await peer.close();
    await editor.waitForTimeout(100);
    assert.ok(
      server.engine.data.lock,
      "another window closing must retain client lock",
    );
    await editor.locator('[data-lock=""]').click();
    await editor.locator("#clients-toggle").click();
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
    await settings.waitForSelector('[data-screen="1"][data-axis="mirror"]');
    await settings.locator('[data-screen="1"][data-axis="mirror"]').check();
    await output.waitForFunction(() =>
      getComputedStyle(
        document.querySelector(".stage-transform"),
      ).transform.includes("-1"),
    );
    assert.equal(server.engine.data.screens[0].mirror, true);
    assert.ok(
      !(
        await settings
          .locator(".stage-transform")
          .evaluate((el) => getComputedStyle(el).transform)
      ).includes("-1"),
    );
    assert.ok(
      !(
        await editor
          .locator(".stage-transform")
          .evaluate((el) => getComputedStyle(el).transform)
      ).includes("-1"),
    );
    await settings.locator("#screen-name-edit").fill("Kamera hoved");
    await settings.locator("#screen-name-edit").press("Tab");
    await settings.waitForFunction(() =>
      document
        .querySelector("#screen-select")
        .selectedOptions[0].textContent.includes("Kamera hoved"),
    );
    assert.equal(server.engine.data.screens[0].id, "1");
    assert.equal(server.engine.data.screens[0].mirror, true);
    await settings.locator("#add-screen").click();
    await settings.locator("#screen-id").fill("2");
    await settings.locator("#screen-name").fill("Kamera 2");
    await settings.locator("dialog button.primary").click();
    await other.goto("http://localhost:17990/output?screen=2");
    await other.waitForSelector(".stage-transform");
    assert.ok(
      !(
        await other
          .locator(".stage-transform")
          .evaluate((el) => getComputedStyle(el).transform)
      ).includes("-1"),
    );

    await settings.locator('[data-screen="1"][data-axis="mirror"]').uncheck();
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
    await settings.locator("[data-edit-preset]").first().click();
    await setRange(settings, "#fontSize", 92);
    await waitFor(
      () => server.engine.data.displayPresets[0].settings.fontSize === 92,
    );
    assert.equal(
      server.engine.data.settings.fontSize,
      56,
      "preset edits must not change live layout",
    );
    await setRange(settings, "#fontSize", 80);
    await waitFor(
      () => server.engine.data.displayPresets[0].settings.fontSize === 80,
    );
    await settings.locator("[data-apply-preset]").first().click();
    await waitFor(() => server.engine.data.settings.fontSize === 80);
    await settings.locator("#preset-edit-actions").waitFor({ state: "hidden" });
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
    await editor.locator("#editor").click();
    await editor.locator("#add-chapter").click();
    await editor.locator("#chapter-title").fill("Andre del");
    await editor.locator("dialog button.primary").click();
    await editor.waitForSelector("#editor h2[data-chapter]");
    assert.ok(!server.engine.current().s.html.includes("Andre del"));
    await editor.locator("#save").click();
    await waitFor(() => server.engine.current().s.html.includes("Andre del"));
    await editor.locator("#clear-text").click();
    assert.equal(await editor.locator("dialog").count(), 1);
    await editor.locator("dialog button.primary").click();
    assert.ok(server.engine.current().s.html.includes("Andre del"));
    await editor.locator("#discard-draft").click();
    assert.ok(
      (await editor.locator("#editor").innerText()).includes("Andre del"),
    );
    await editor.locator("[data-delete]").first().click();
    await editor.locator("dialog [data-cancel]").click();
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
    await menu.locator("#menu-back").click();
    await menu.locator("#menu-create").click();
    await menu.locator("#new-name").fill("Helgesending");
    await menu
      .locator("#project-logo")
      .setInputFiles(path.join(__dirname, "../public/branding/icon.png"));
    await menu.locator("#logo-preview").waitFor({ state: "visible" });
    await menu.locator("#add-folder").click();
    await menu.locator("[data-folder-name]").fill("Sesong 1");
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
    await menu.locator(".add-program-row").click();
    await menu.locator("#new-name").fill("Søndag");
    await menu.locator("#program-date").fill("2026-10-11");
    await menu.locator("#program-folder").selectOption({ label: "Sesong 1" });
    await menu.locator("dialog button.primary").click();
    await menu.waitForSelector("[data-program]");
    assert.equal(await menu.locator(".program-table").count(), 1);
    assert.equal(server.engine.current().s.id, secondId);
    await menu.screenshot({
      path: path.join(__dirname, "../docs/screenshots/program-menu.png"),
      fullPage: true,
    });
    await menu.locator("[data-duplicate-program]").first().click();
    await menu.locator("#copy-name").fill("Søndag kopi");
    await menu.locator("dialog button.primary").click();
    await menu.waitForFunction(
      () => document.querySelectorAll("[data-program]").length === 2,
    );
    await menu.locator("[data-program]").first().click();
    await menu.waitForURL("**/?editor");
    await waitFor(() => server.engine.current().e.name === "Søndag");
    await menu.goto("http://localhost:17990/projects");
    assert.equal(await menu.locator("#menu-logo").isVisible(), true);
    assert.equal(
      await menu.locator(".program-row.loaded .program-live").innerText(),
      "● LIVE",
    );
    await menu.screenshot({
      path: path.join(__dirname, "../docs/screenshots/program-menu.png"),
      fullPage: true,
    });
    await menu.locator("#menu-back").click();
    await menu.locator(`[data-project="${originalProgram.project}"]`).click();
    await menu.locator(`[data-program="${originalProgram.episode}"]`).click();
    await menu.waitForURL("**/?editor");
    await waitFor(
      () => server.engine.current().e.id === originalProgram.episode,
    );
    await editor.locator(".insert-slot button").nth(1).focus();
    await editor.locator(".insert-slot button").nth(1).click();
    await editor.locator("#new-name").fill("Inn mellom");
    await editor.locator("dialog button.primary").click();
    await waitFor(
      () => server.engine.current().e.scripts[1]?.name === "Inn mellom",
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
    const previewFont = await settings
      .locator(".prompt-content p")
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize);
    const outputFont = await output
      .locator(".prompt-content p")
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize);
    assert.equal(
      previewFont,
      outputFont,
      "preview must render the same text metrics as output",
    );
    const system = await context.newPage();
    await system.goto("http://localhost:17990/settings");
    await system.locator('[data-settings-view="transfer"]').click();
    assert.equal(
      await system.locator('[data-settings-panel="osc"]').isVisible(),
      false,
    );
    const exportedProject = await context.request.get(
      "http://localhost:17990" +
        (await system.locator("#export-project-link").getAttribute("href")),
    );
    assert.equal((await exportedProject.json()).projects.length, 1);
    const exportedProgram = await context.request.get(
      "http://localhost:17990" +
        (await system.locator("#export-program-link").getAttribute("href")),
    );
    const programFile = await exportedProgram.json();
    assert.equal(programFile.kind, "program");
    const targetProject = server.engine.data.projects.find(
      (p) => p.name === "Helgesending",
    );
    const countBefore = targetProject.episodes.length;
    await system
      .locator("#program-import-project")
      .selectOption(targetProject.id);
    await system.locator("#program-import-file").setInputFiles({
      name: "program.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(programFile)),
    });
    await waitFor(() => targetProject.episodes.length === countBefore + 1);
    await system.locator('[data-settings-view="power"]').click();
    await system.locator('[data-lifecycle="shutdown"]').click();
    await system.locator("dialog [data-cancel]").click();
    assert.equal(
      (await context.request.get("http://localhost:17990/api/status")).ok(),
      true,
    );
    await system.locator('[data-settings-view="transfer"]').click();
    await system.screenshot({
      path: path.join(__dirname, "../docs/screenshots/settings.png"),
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
