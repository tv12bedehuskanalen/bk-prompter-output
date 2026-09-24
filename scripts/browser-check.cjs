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
    await editor.locator('[data-control="blackout"]').click();
    await output.locator(".blacked-out .blackout-cover").waitFor({ state: "visible" });
    await other.locator(".blacked-out .blackout-cover").waitFor({ state: "visible" });
    await editor.locator('[data-control="blackout"]').click();
    await output.locator(".blackout-cover").waitFor({ state: "hidden" });
    await editor.evaluate(() => request({
      type: "edit", action: "loadProgram",
      projectId: state.selection.project, episodeId: state.selection.episode
    }));
    await output.locator(".standby-card").waitFor({ state: "visible" });
    assert.ok((await output.locator(".standby-card").textContent()).includes("Dagens sending"));
    assert.equal(server.engine.data.selection.script, null);
    await editor.evaluate(() => command("load", "intro"));
    await output.locator(".standby-card").waitFor({ state: "hidden" });
    await editor.evaluate(() => request({ type: "edit", action: "screenSettings", screenId: "1", value: { guideThickness: 100, guideSize: 30, guideColor: "#ff0000", lineHeight: 0.5 } }));
    await output.waitForFunction(() => getComputedStyle(document.querySelector(".guide")).borderTopWidth === "100px");
    const arrow = await output.locator(".guide").evaluate(el => {
      const style = getComputedStyle(el, "::before");
      return { top: parseFloat(style.top), half: parseFloat(style.borderTopWidth), color: style.borderLeftColor };
    });
    assert.equal(arrow.top + arrow.half, -50);
    assert.equal(arrow.color, "rgb(255, 0, 0)");
    await editor.evaluate(() => request({ type: "edit", action: "screenSettings", screenId: "1", value: { guideThickness: 1, guideSize: 10, guideColor: "#32c6cb", lineHeight: 1.5 } }));
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
    await mobile.locator("#hold").scrollIntoViewIfNeeded();
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
    await settings.locator("#guide").uncheck();
    await settings.waitForFunction(() => document.querySelector("#guideThickness").disabled);
    assert.equal(await settings.locator('output[for="guideThickness"]').getAttribute("contenteditable"), "false");
    await settings.locator("#guide").check();
    await settings.waitForFunction(() => !document.querySelector("#guideThickness").disabled);
    await settings.locator("#guideLineColor").fill("#ffaa00");
    await output.waitForFunction(() => getComputedStyle(document.querySelector(".guide")).borderTopColor === "rgba(255, 170, 0, 0.2)");
    await settings.locator('output[for="guideThickness"]').fill("75");
    await settings.locator('output[for="guideThickness"]').press("Enter");
    await settings.waitForFunction(() => document.querySelector("#guideThickness").value === "75");
    await settings.locator('output[for="lineHeight"]').fill("0,75");
    await settings.locator('output[for="lineHeight"]').press("Enter");
    await settings.waitForFunction(() => document.querySelector("#lineHeight").value === "0.75");
    await settings.locator('output[for="lineHeight"]').fill("1.5");
    await settings.locator('output[for="lineHeight"]').press("Enter");
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
    await settings.locator("#screen-rename button").click();
    assert.notEqual(
      server.engine.data.screens[0].name,
      "Kamera hoved",
      "rename requires confirmation",
    );
    await settings.locator("dialog button.primary").click();
    await settings.waitForFunction(() =>
      document
        .querySelector('[data-select-screen="1"]')
        .textContent.includes("Kamera hoved"),
    );
    assert.equal(await settings.locator("#screen-select").count(), 0);
    assert.equal(
      await settings.locator(".screen-choice.selected a").getAttribute("href"),
      "/output?screen=1",
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
    await waitFor(() => server.engine.screenSettings("1").fontSize === 80);
    await settings.locator("#preset-name").fill("Studio · stor tekst");
    await settings.locator("#save-preset").click();
    await waitFor(() => server.engine.data.displayPresets.length === 1);
    const presetId = server.engine.data.displayPresets[0].id;
    await setRange(settings, "#fontSize", 56);
    await waitFor(() => server.engine.screenSettings("1").fontSize === 56);
    await settings.locator("[data-edit-preset]").first().click();
    await setRange(settings, "#fontSize", 92);
    await waitFor(
      () => server.engine.data.displayPresets[0].settings.fontSize === 92,
    );
    assert.equal(
      server.engine.screenSettings("1").fontSize,
      56,
      "preset edits must not change live layout",
    );
    await setRange(settings, "#fontSize", 80);
    await waitFor(
      () => server.engine.data.displayPresets[0].settings.fontSize === 80,
    );
    await settings.locator("[data-apply-preset]").first().click();
    await waitFor(() => server.engine.screenSettings("1").fontSize === 80);
    await settings.locator("#preset-edit-actions").waitFor({ state: "hidden" });
    await settings.waitForFunction(
      () => document.querySelector("#fontSize").disabled,
    );
    await settings.locator('[data-select-screen="2"]').click();
    await settings.locator("[data-apply-preset]").first().click();
    await waitFor(() =>
      server.engine.data.screens.every((s) => s.presetId === presetId),
    );
    await settings.locator("[data-edit-preset]").first().click();
    await setRange(settings, "#fontSize", 88);
    await waitFor(
      () =>
        server.engine.screenSettings("1").fontSize === 88 &&
        server.engine.screenSettings("2").fontSize === 88,
    );
    await settings.locator('[data-select-screen="1"]').click();
    await settings.locator("#edit-live-layout").click();
    await waitFor(() => !server.engine.data.screens[0].presetId);
    assert.equal(
      server.engine.screenSettings("1").fontSize,
      88,
      "unlink retains loaded appearance",
    );
    await settings.locator("[data-edit-preset]").first().click();
    await setRange(settings, "#fontSize", 96);
    await waitFor(() => server.engine.screenSettings("2").fontSize === 96);
    assert.equal(
      server.engine.screenSettings("1").fontSize,
      88,
      "unlinked screen no longer follows edits",
    );
    // A reference line starts at the same reading point on differently formatted screens.
    const anchor = await output.evaluate(() => {
      const root = document.querySelector(".ruler"),
        node = document.createTreeWalker(root, NodeFilter.SHOW_TEXT).nextNode(),
        range = document.createRange(),
        base = root.getBoundingClientRect().top;
      let previous = -1;
      for (let i = 0; i < node.length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const y = range.getBoundingClientRect().top - base;
        if (y > 150 && y > previous + 0.5) return { index: i, position: y };
        previous = y;
      }
      throw Error("No reference line found");
    });
    await editor.evaluate(
      (position) =>
        request({ type: "control", action: "seek", value: position }),
      anchor.position,
    );
    for (const page of [output, other])
      await page.waitForFunction((index) => {
        const root = document.querySelector(".stage .prompt-content"),
          node = document
            .createTreeWalker(root, NodeFilter.SHOW_TEXT)
            .nextNode(),
          range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const view = document
          .querySelector(".stage-viewport")
          .getBoundingClientRect();
        return (
          Math.abs(
            range.getBoundingClientRect().top - (view.top + view.height * 0.3),
          ) < 2
        );
      }, anchor.index);
    await editor.locator('[data-control="reset"]').click();
    await setRange(settings, "#fontSize", 80);
    await waitFor(() => server.engine.screenSettings("2").fontSize === 80);
    await settings.locator("#edit-live-layout").click();
    await settings.waitForFunction(
      () =>
        !document.querySelector("#fontSize").disabled &&
        document.querySelector("#preset-edit-actions").hidden,
    );
    await setRange(settings, "#fontSize", 56);
    await waitFor(() => server.engine.screenSettings("1").fontSize === 56);
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
      server.engine.screenSettings("1").fontSize,
      56,
      "editing a script preset must not affect current output",
    );
    await editor.locator(".load-script").nth(1).click();
    await waitFor(() => server.engine.current().s.id === secondId);
    assert.equal(server.engine.data.transport.playing, false);
    assert.equal(server.engine.position(), 0);
    assert.equal(server.engine.screenSettings("1").fontSize, 80);
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
    assert.equal(server.engine.screenSettings("1").fontSize, 80);
    await editor.locator(".load-script").nth(1).click();
    await waitFor(() => server.engine.screenSettings("1").fontSize === 44);
    assert.equal(server.engine.data.displayPresets.length, 1);
    await editor.locator("#script-display-mode").selectOption("keep");
    await editor.locator("#save").click();
    await waitFor(() => server.engine.current().s.displayMode === "keep");
    await setRange(settings, "#fontSize", 68);
    await waitFor(() => server.engine.screenSettings("1").fontSize === 68);
    await editor.locator(".load-script").nth(1).click();
    assert.equal(server.engine.screenSettings("1").fontSize, 68);
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
    await waitFor(() => server.engine.screenSettings("1").fontSize === 56);
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
