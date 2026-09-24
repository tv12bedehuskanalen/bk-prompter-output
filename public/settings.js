// Settings sections are kept separate; server actions affect BK Prompter only.
const SETTINGS_VIEWS = [
  ["osc", "OSC"],
  ["transfer", "Import / eksport"],
  ["network", "Nettverk"],
  ["power", "Avslutt / start på nytt"],
];
let settingsView = "osc";
function settingsWorkspace() {
  return `<main class="system-workspace"><aside class="system-sidebar"><h1>Innstillinger</h1>${SETTINGS_VIEWS.map(([id, name]) => `<button data-settings-view="${id}" class="${id === settingsView ? "active" : ""}">${name}</button>`).join("")}<span class="version-label"></span></aside><section class="system-content"><div data-settings-panel="osc"><h2>OSC</h2><div class="field"><label for="osc-enabled">Aktiver OSC</label><input type="checkbox" id="osc-enabled"></div><div class="field"><label for="osc-port">Lytteport</label><input type="number" id="osc-port" min="1024" max="65535"></div><p id="osc-status" class="notice"></p><button id="save-network" class="primary">Lagre OSC-oppsett</button><details class="osc-reference"><summary>OSC-kommandoer</summary><p class="muted">OSC-ID gjelder innlastet program. Samme ID kan brukes i ulike programmer.</p><table class="osc-table">${[
    ["load", '"intro"', "Last manus etter OSC-ID"],
    ["start", "—", "Start"],
    ["pause", "—", "Pause"],
    ["toggle", "—", "Start / pause"],
    ["speed", "60.0", "Hastighet, px/sek"],
    ["seek", "120.0", "Tekstposisjon"],
    ["reset", "—", "Gå til start"],
    ["next", "—", "Neste manus"],
    ["previous", "—", "Forrige manus"],
    ["nextChapter", "—", "Neste kapittel"],
    ["blackout", "1 / 0", "Svart utgang på / av (uten verdi: veksle)"],
    ["hold", "—", "Hold pause"],
    ["release", "—", "Slipp pause"],
    ["state", "—", "Transportstatus"],
  ]
    .map(
      ([a, v, t]) =>
        `<tr><td><code>/prompter/${a}</code></td><td>${v}</td><td>${t}</td></tr>`,
    )
    .join(
      "",
    )}</table><p class="muted">Hold fornyes minst hvert sekund og frigjøres etter 2,5 sekunder uten fornyelse.</p></details></div><div data-settings-panel="transfer" hidden><h2>Import / eksport</h2><section class="transfer-section"><h3>Prosjekt</h3><label for="export-project">Prosjekt som skal eksporteres</label><select id="export-project"></select><div class="transfer-actions"><a id="export-project-link" class="button-link" download>Eksporter prosjekt ↓</a><button id="import-projects">Importer prosjekt ↑</button></div><input id="project-file" type="file" accept=".json" hidden></section><section class="transfer-section"><h3>Program</h3><label for="export-program">Program som skal eksporteres</label><select id="export-program"></select><a id="export-program-link" class="button-link" download>Eksporter program ↓</a><label for="program-import-project">Legg importert program i prosjekt</label><select id="program-import-project"></select><button id="import-program">Importer program ↑</button><input id="program-import-file" type="file" accept=".json" hidden></section><p class="muted">Importer oppretter nye kopier. Innlastet program fortsetter uendret.</p></div><div data-settings-panel="network" hidden><h2>Nettverk</h2><p id="network-port"></p><div id="network-addresses"></div><p class="muted">Serveren lytter på alle nettverksgrensesnitt. Webport endres i servervinduet.</p></div><div data-settings-panel="power" hidden><h2>BK Prompter-server</h2><p class="muted">Prosjekter og innstillinger lagres før serveren avsluttes. Ved omstart kobles nettleserne til igjen, med avspilling på pause.</p><div class="transfer-actions"><button data-lifecycle="restart">Start serveren på nytt</button><button data-lifecycle="shutdown" class="publish">Avslutt serveren</button></div></div></section></main>`;
}
function renderSystemSettings() {
  for (const el of $$("[data-settings-panel]"))
    el.hidden = el.dataset.settingsPanel !== settingsView;
  for (const el of $$("[data-settings-view]"))
    el.classList.toggle("active", el.dataset.settingsView === settingsView);
  const projectOptions = state.projects.map((p) => ({
    id: p.id,
    name: p.name,
  }));
  const programs = state.projects.flatMap((p) =>
    p.episodes.map((e) => ({ id: e.id, name: p.name + " / " + e.name })),
  );
  for (const [id, options, fallback] of [
    ["export-project", projectOptions, state.selection.project],
    ["program-import-project", projectOptions, state.selection.project],
    ["export-program", programs, state.selection.episode],
  ]) {
    const select = $("#" + id),
      key = JSON.stringify(options);
    if (select.dataset.key === key) continue;
    const selected = select.value || fallback;
    select.dataset.key = key;
    select.innerHTML = options
      .map((o) => `<option value="${o.id}">${esc(o.name)}</option>`)
      .join("");
    if (options.some((o) => o.id === selected)) select.value = selected;
  }
  updateExportLinks();
  $("#network-port").textContent = "Webport: " + state.network.port;
}
function updateExportLinks() {
  for (const kind of ["project", "program"]) {
    const id = $("#export-" + kind).value;
    const link = $("#export-" + kind + "-link");
    if (id) link.href = "/api/export/" + kind + "/" + encodeURIComponent(id);
    else link.removeAttribute("href");
  }
}
function bindSystemSettings() {
  if (route !== "settings") return;
  for (const el of $$("[data-settings-view]"))
    el.onclick = () => {
      settingsView = el.dataset.settingsView;
      renderSystemSettings();
    };
  for (const kind of ["project", "program"])
    $("#export-" + kind).onchange = updateExportLinks;
  $("#import-program").onclick = () => {
    if (!$("#program-import-project").value)
      return toast("Opprett et prosjekt først.");
    $("#program-import-file").click();
  };
  $("#program-import-file").onchange = async (event) => {
    const file = event.target.files[0],
      projectId = $("#program-import-project").value;
    if (!file) return;
    try {
      if (file.size > 15000000) throw Error("Maksimal filstørrelse er 15 MB.");
      const value = JSON.parse(await file.text());
      await request({
        type: "edit",
        action: "importProgram",
        projectId,
        value,
      });
      toast("Programmet er importert.");
    } catch (e) {
      toast(e.message);
    }
    event.target.value = "";
  };
  for (const b of $$("[data-lifecycle]"))
    b.onclick = () => {
      const restart = b.dataset.lifecycle === "restart";
      confirmGUI(
        restart ? "Starte serveren på nytt?" : "Avslutte serveren?",
        restart
          ? "Rullingen stoppes. Alle nettlesere kobles til igjen når serveren er klar."
          : "Alle klienter mister forbindelsen. Start appen igjen for å fortsette.",
        async () => {
          await request({ type: "lifecycle", action: b.dataset.lifecycle });
          toast(
            restart ? "Serveren starter på nytt …" : "Serveren avsluttes …",
          );
        },
      );
    };
}
