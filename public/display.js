// Each screen owns its layout or follows a shared preset. Screen IDs never change on rename.
let displayPresetId = null,
  selectedScreenId = "1",
  displaySidebarKey = "",
  screenControlsId = null;
function selectedScreen() {
  return state?.screens.find((s) => s.id === selectedScreenId);
}
function settingsForScreen(screen) {
  return (
    state.displayPresets.find((p) => p.id === screen?.presetId)?.settings ||
    screen?.settings ||
    state.settings
  );
}
function visualSettings() {
  if (route === "display")
    return displayPresetId
      ? state.displayPresets.find((p) => p.id === displayPresetId)?.settings ||
          settingsForScreen(selectedScreen())
      : settingsForScreen(selectedScreen());
  return settingsForScreen(
    route === "output"
      ? outputScreen()
      : state.screens.find((s) => s.id === "1"),
  );
}
function displayFieldsLocked() {
  return (
    route === "display" && !displayPresetId && !!selectedScreen()?.presetId
  );
}
function loadIcon() {
  return '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8M12 16v5"/><path d="m10 6 5 4-5 4Z" fill="currentColor" stroke="none"/></svg>';
}
function insertionSlot(beforeId, index) {
  return `<div class="insert-slot"><button data-insert-before="${beforeId}" aria-label="Sett inn manus på plass ${index + 1}"><span></span><b>+</b><span></span></button></div>`;
}
function displayWorkspace() {
  return `<main class="display-workspace"><aside class="display-sidebar"><h1>${esc(CONFIG.displayTitle)}</h1><h2>Utgangsskjermer</h2><div id="screen-choices"></div><button id="add-screen" class="flat">+ Ny skjerm</button><div id="screen-list"><form id="screen-rename"><label for="screen-name-edit">Skjermnavn</label><div class="screen-name-row"><input id="screen-name-edit" maxlength="120" required><button type="submit">Lagre navn</button></div></form><small id="screen-identity"></small><label class="screen-check"><input type="checkbox" data-axis="mirror"> Speil horisontalt</label><label class="screen-check"><input type="checkbox" data-axis="flip"> Vend vertikalt</label><button id="delete-selected-screen" class="flat trash" aria-label="Slett skjerm">${trashIcon()}</button></div><hr><button id="edit-live-layout" class="layout-choice">${penIcon()} Rediger gjeldende leseflate</button><div id="screen-preset-status"></div><h2>Forhåndsinnstillinger</h2><div id="preset-list"></div><div class="preset-save"><input id="preset-name" placeholder="Nytt oppsett" aria-label="Navn på forhåndsinnstilling"><button id="save-preset" title="Lagre som ny forhåndsinnstilling">+</button></div></aside><section class="display-editor"><div class="display-editor-heading"><span id="editing-screen-name" class="eyebrow"></span><h2 id="layout-title">Gjeldende leseflate</h2><div id="layout-link-banner" hidden></div></div><div id="preset-edit-actions" hidden><label for="preset-edit-name">Navn</label><input id="preset-edit-name"><button id="apply-preset" class="primary">Bruk på prompteren</button><button id="delete-preset" class="flat trash" aria-label="Slett forhåndsinnstilling">${trashIcon()}</button></div><div class="display-fields"><section id="screen-layout-fields"><h3>Tekstinnstillinger</h3>${rangeField("fontSize", "Skriftstørrelse", 20, 120, 1)}${rangeField("lineHeight", "Linjeavstand", 1, 2.5, 0.1)}${rangeField("margin", "Sidemarger", 20, 400, 10)}<div class="field"><label for="align">Tekstjustering</label><select id="align" data-setting="align"><option value="left">Venstre</option><option value="center">Midtstilt</option><option value="right">Høyre</option></select></div><div class="field"><label for="color">Tekstfarge</label><input type="color" id="color" data-setting="color"></div><div class="field"><label for="background">Bakgrunn</label><input type="color" id="background" data-setting="background"></div><h3 class="reading-heading">Lesepunkt</h3>${checkField("guide", "Vis lesemarkør")}${rangeField("guidePosition", "Lesepunkt (%)", 5, 80, 1)}</section><div class="settings-preview">${preview()}<div class="preview-label"><span id="preview-scope">LIVE</span><a id="selected-output-link" target="_blank">Åpne utgang ↗</a></div></div></div></section></main>`;
}
function renderDisplayWorkspace() {
  if (
    displayPresetId &&
    !state.displayPresets.some((p) => p.id === displayPresetId)
  )
    displayPresetId = null;
  if (!selectedScreen()) selectedScreenId = "1";
  const screen = selectedScreen(),
    preset = state.displayPresets.find((p) => p.id === displayPresetId),
    linked = state.displayPresets.find((p) => p.id === screen.presetId);
  const key = JSON.stringify([
    state.screens.map((s) => [s.id, s.name, s.presetId]),
    state.displayPresets.map((p) => [p.id, p.name]),
    selectedScreenId,
    displayPresetId,
  ]);
  if (key !== displaySidebarKey) {
    displaySidebarKey = key;
    $("#screen-choices").innerHTML = state.screens
      .map(
        (s) =>
          `<div class="screen-choice ${s.id === selectedScreenId ? "selected" : ""}"><button data-select-screen="${esc(s.id)}" aria-current="${s.id === selectedScreenId ? "true" : "false"}"><strong>${esc(s.name)}</strong><small>ID ${esc(s.id)}</small><span class="screen-selection-dot" aria-hidden="true"></span></button><a href="/output?screen=${encodeURIComponent(s.id)}" target="_blank" aria-label="Åpne skjerm ${esc(s.name)}">Åpne skjerm ↗</a></div>`,
      )
      .join("");
    $("#preset-list").innerHTML = state.displayPresets
      .map(
        (p) =>
          `<div class="preset-item ${p.id === displayPresetId ? "active" : ""} ${p.id === screen.presetId ? "loaded-preset" : ""}"><button class="preset-load" data-apply-preset="${p.id}" title="Koble ${esc(screen.name)} til ${esc(p.name)}">${esc(p.name)}${p.id === screen.presetId ? "<small>LASTET</small>" : ""}</button><button class="flat" data-edit-preset="${p.id}" title="Rediger ${esc(p.name)}" aria-label="Rediger ${esc(p.name)}">${penIcon()}</button></div>`,
      )
      .join("");
  }
  const nameInput = $("#screen-name-edit");
  if (
    screenControlsId !== screen.id ||
    nameInput.value === nameInput.dataset.original
  ) {
    nameInput.value = screen.name;
    nameInput.dataset.original = screen.name;
  }
  screenControlsId = screen.id;
  $("#screen-identity").textContent = "Skjerm-ID: " + screen.id;
  for (const el of $$("#screen-list [data-axis]")) {
    el.dataset.screen = screen.id;
    el.checked = !!screen[el.dataset.axis];
  }
  $("#delete-selected-screen").hidden = screen.id === "1";
  $("#delete-selected-screen").dataset.deleteScreen = screen.id;
  $("#edit-live-layout").classList.toggle("active", !preset && !linked);
  $("#edit-live-layout").classList.toggle("linked-layout", !!linked);
  $("#screen-preset-status").textContent = linked
    ? "Bruker " + linked.name
    : "Egne innstillinger";
  $("#editing-screen-name").textContent = screen.name + " · ID " + screen.id;
  $("#layout-title").textContent = preset
    ? "Forhåndsinnstilling: " + preset.name
    : "Gjeldende leseflate";
  const banner = $("#layout-link-banner");
  banner.hidden = !linked || !!preset;
  banner.innerHTML = linked
    ? `<span>Lastet oppsett: <strong>${esc(linked.name)}</strong></span><button data-edit-preset="${linked.id}" class="flat">${penIcon()} Rediger oppsett</button>`
    : "";
  $("#screen-layout-fields").classList.toggle(
    "linked-readonly",
    !preset && !!linked,
  );
  $("#preset-edit-actions").hidden = !preset;
  if (preset && document.activeElement !== $("#preset-edit-name"))
    $("#preset-edit-name").value = preset.name;
  $("#preview-scope").textContent = preset
    ? "OPPSETT · " +
      state.screens.filter((s) => s.presetId === preset.id).length +
      " TILKOBLEDE SKJERMER"
    : "FORHÅNDSVISNING · " + screen.name;
  $("#selected-output-link").href =
    "/output?screen=" + encodeURIComponent(screen.id);
}
