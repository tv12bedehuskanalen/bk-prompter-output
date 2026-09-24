// The reading layout remains shared so all output devices retain identical line breaks.
// Screen orientation is local equipment configuration; preset edits never change live layout.
let displayPresetId = null,
  selectedScreenId = "1",
  displaySidebarKey = "";
function visualSettings() {
  return route === "display" && displayPresetId
    ? state.displayPresets.find((p) => p.id === displayPresetId)?.settings ||
        state.settings
    : state.settings;
}
function loadIcon() {
  return '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8M12 16v5"/><path d="m10 6 5 4-5 4Z" fill="currentColor" stroke="none"/></svg>';
}
function insertionSlot(beforeId, index) {
  return `<div class="insert-slot"><button data-insert-before="${beforeId}" aria-label="Sett inn manus på plass ${index + 1}"><span></span><b>+</b><span></span></button></div>`;
}
function displayWorkspace() {
  return `<main class="display-workspace"><aside class="display-sidebar"><h1>${esc(CONFIG.displayTitle)}</h1><label for="screen-select">Utgangsskjerm</label><select id="screen-select"></select><button id="add-screen" class="flat">+ Ny skjerm</button><div id="screen-list"></div><hr><button id="edit-live-layout" class="layout-choice">${loadIcon()} Gjeldende leseflate</button><h2>Forhåndsinnstillinger</h2><div id="preset-list"></div><div class="preset-save"><input id="preset-name" placeholder="Nytt oppsett" aria-label="Navn på forhåndsinnstilling"><button id="save-preset" title="Lagre som ny forhåndsinnstilling">+</button></div></aside><section class="display-editor"><div class="display-editor-heading"><h2 id="layout-title">Gjeldende leseflate</h2></div><div id="preset-edit-actions" hidden><label for="preset-edit-name">Navn</label><input id="preset-edit-name"><button id="apply-preset" class="primary">Bruk på prompteren</button><button id="delete-preset" class="flat trash" aria-label="Slett forhåndsinnstilling">${trashIcon()}</button></div><div class="display-fields"><section><h3>Tekstinnstillinger</h3>${rangeField("fontSize", "Skriftstørrelse", 20, 120, 1)}${rangeField("lineHeight", "Linjeavstand", 1, 2.5, 0.1)}${rangeField("margin", "Sidemarger", 20, 400, 10)}<div class="field"><label for="align">Tekstjustering</label><select id="align" data-setting="align"><option value="left">Venstre</option><option value="center">Midtstilt</option><option value="right">Høyre</option></select></div><div class="field"><label for="color">Tekstfarge</label><input type="color" id="color" data-setting="color"></div><div class="field"><label for="background">Bakgrunn</label><input type="color" id="background" data-setting="background"></div><h3 class="reading-heading">Lesepunkt</h3>${checkField("guide", "Vis lesemarkør")}${rangeField("guidePosition", "Lesepunkt (%)", 5, 80, 1)}</section><div class="settings-preview">${preview()}<div class="preview-label"><span id="preview-scope">LIVE</span><a id="selected-output-link" target="_blank">Åpne utgang ↗</a></div></div></div></section></main>`;
}
function renderDisplayWorkspace() {
  if (
    displayPresetId &&
    !state.displayPresets.some((p) => p.id === displayPresetId)
  )
    displayPresetId = null;
  if (!state.screens.some((s) => s.id === selectedScreenId))
    selectedScreenId = "1";
  const screen = state.screens.find((s) => s.id === selectedScreenId),
    preset = state.displayPresets.find((p) => p.id === displayPresetId);
  const key = JSON.stringify([
    state.screens,
    state.displayPresets,
    selectedScreenId,
    displayPresetId,
  ]);
  if (key !== displaySidebarKey) {
    displaySidebarKey = key;
    $("#screen-select").innerHTML = state.screens
      .map(
        (s) =>
          `<option value="${esc(s.id)}">${esc(s.name)} · ${esc(s.id)}</option>`,
      )
      .join("");
    $("#screen-select").value = selectedScreenId;
    $("#screen-list").innerHTML =
      `<div class="screen-row"><label for="screen-name-edit">Navn</label><input id="screen-name-edit" data-screen-name="${esc(screen.id)}" value="${esc(screen.name)}" maxlength="120"><small>Skjerm-ID: ${esc(screen.id)}</small><label><input type="checkbox" data-screen="${esc(screen.id)}" data-axis="mirror" ${screen.mirror ? "checked" : ""}> Speil horisontalt</label><label><input type="checkbox" data-screen="${esc(screen.id)}" data-axis="flip" ${screen.flip ? "checked" : ""}> Vend vertikalt</label>${screen.id !== "1" ? `<button class="flat trash" data-delete-screen="${esc(screen.id)}" aria-label="Slett skjerm">${trashIcon()}</button>` : ""}</div>`;
    $("#preset-list").innerHTML = state.displayPresets
      .map(
        (p) =>
          `<div class="preset-item ${p.id === displayPresetId ? "active" : ""}"><button class="preset-load" data-apply-preset="${p.id}" title="Bruk ${esc(p.name)}">${esc(p.name)}</button><button class="flat" data-edit-preset="${p.id}" title="Rediger ${esc(p.name)}" aria-label="Rediger ${esc(p.name)}">${penIcon()}</button></div>`,
      )
      .join("");
  }
  $("#edit-live-layout").classList.toggle("active", !preset);
  $("#layout-title").textContent = preset ? preset.name : "Gjeldende leseflate";
  $("#preset-edit-actions").hidden = !preset;
  if (preset && document.activeElement !== $("#preset-edit-name"))
    $("#preset-edit-name").value = preset.name;
  $("#preview-scope").textContent = preset
    ? "FORHÅNDSVISNING AV OPPSETT"
    : "LIVE";
  $("#selected-output-link").href =
    "/output?screen=" + encodeURIComponent(selectedScreenId);
}
