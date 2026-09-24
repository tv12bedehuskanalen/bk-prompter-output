"use strict";
// User-facing defaults. Change branding and palette in config.js and theme.css.
const EDITOR_TEXT_COLOR = "#ffffff";
const EDITOR_HIGHLIGHT_COLOR = "#e34f54";
const DEFAULT_SCREEN_ID = "1";
let menuInitialized = false,
  folderFilter = "",
  programSort = "date",
  programDirection = -1;
let metadataPending = new Map(),
  metadataSettingsKey = "",
  screensKey = "";
function trashIcon() {
  return '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';
}
function penIcon() {
  return '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z"/></svg>';
}
function dialogForm(title, body, submit, label = "Lagre") {
  const d = document.createElement("dialog");
  d.innerHTML = `<form><h2>${esc(title)}</h2>${body}<p class="dialog-error" role="alert"></p><div class="dialog-actions"><button type="button" data-cancel>Avbryt</button><button class="primary" type="submit">${esc(label)}</button></div></form>`;
  document.body.append(d);
  d.showModal();
  $("[data-cancel]", d).onclick = () => d.close();
  d.onclose = () => d.remove();
  $("form", d).onsubmit = async (event) => {
    event.preventDefault();
    const b = $("[type=submit]", d);
    b.disabled = true;
    try {
      await submit(d);
      d.close();
    } catch (e) {
      $(".dialog-error", d).textContent = e.message;
    } finally {
      b.disabled = false;
    }
  };
  return d;
}
function confirmGUI(title, description, action, anchor) {
  const d = dialogForm(title, `<p>${esc(description)}</p>`, action, "Bekreft");
  d.classList.add("confirmation");
  if (anchor) {
    d.classList.add("context-confirmation");
    const r = anchor.getBoundingClientRect();
    d.style.margin = "0";
    d.style.left =
      Math.max(12, Math.min(r.right - 330, innerWidth - 350)) + "px";
    d.style.top =
      Math.max(12, Math.min(r.bottom + 8, innerHeight - 240)) + "px";
  }
  $("[type=submit]", d).classList.add("publish");
  return d;
}
async function saveMetadata(patch) {
  const id = editorId;
  if (!id) return;
  // Each request contains only the edited field, never a stale copy of other fields.
  const keys = Object.keys(patch),
    token = Symbol();
  for (const key of keys) metadataPending.set(id + key, token);
  try {
    await request({ type: "edit", action: "saveMetadata", id, ...patch });
  } catch (e) {
    toast(e.message);
  } finally {
    for (const key of keys)
      if (metadataPending.get(id + key) === token)
        metadataPending.delete(id + key);
  }
}
function saveDisplayMetadata() {
  const value = readScriptSettings();
  if (value.displayMode === "preset" && !value.presetId) return;
  saveMetadata(value);
}
function syncMetadata(s) {
  if (!s) return;
  for (const [id, key] of [
    ["script-name", "name"],
    ["osc-id", "oscId"],
    ["script-color", "color"],
  ]) {
    const el = $("#" + id);
    if (document.activeElement !== el && !metadataPending.has(s.id + key))
      el.value = s[key] || (key === "color" ? CONFIG.scriptColors[0] : "");
  }
  const key = JSON.stringify([
    s.id,
    s.displayMode,
    s.presetId,
    s.customSettings,
  ]);
  if (
    key !== metadataSettingsKey &&
    !metadataPending.has(s.id + "displayMode")
  ) {
    metadataSettingsKey = key;
    setScriptSettings(s);
  }
}
function outputScreen() {
  const id =
    new URLSearchParams(location.search).get("screen") || DEFAULT_SCREEN_ID;
  return state.screens?.find((x) => x.id === id);
}
function renderScreens() {
  const list = $("#screen-list");
  if (!list) return;
  const key = JSON.stringify(state.screens);
  if (key === screensKey) return;
  screensKey = key;
  list.innerHTML = (state.screens || [])
    .map(
      (s) =>
        `<div class="screen-row"><div><strong>${esc(s.name)}</strong><small>ID ${esc(s.id)}</small><a target="_blank" href="/output?screen=${encodeURIComponent(s.id)}">Åpne skjerm ↗</a><code>${esc(location.origin)}/output?screen=${esc(s.id)}</code></div><label><input type="checkbox" data-screen="${esc(s.id)}" data-axis="mirror" ${s.mirror ? "checked" : ""}> Speil horisontalt</label><label><input type="checkbox" data-screen="${esc(s.id)}" data-axis="flip" ${s.flip ? "checked" : ""}> Vend vertikalt</label>${s.id !== "1" ? `<button class="flat trash" data-delete-screen="${esc(s.id)}" aria-label="Slett skjerm ${esc(s.name)}">${trashIcon()}</button>` : ""}</div>`,
    )
    .join("");
}
function organizationDialog(kind, id) {
  const isProject = kind === "Project",
    project = isProject
      ? state.projects.find((p) => p.id === id)
      : state.projects.find((p) => p.id === menuProjectId),
    item = isProject ? project : project?.episodes.find((e) => e.id === id);
  let folders = (project?.folders || []).map((f) => ({ ...f })),
    logo = project?.logo || "";
  const d = dialogForm(
    `${id ? "Rediger" : "Nytt"} ${isProject ? "prosjekt" : "program"}`,
    `<label for="new-name">Navn</label><input id="new-name" required maxlength="120" autofocus value="${esc(item?.name || "")}">${isProject ? `<div class="project-appearance"><label>Prosjektfarge<input id="project-color" type="color" value="${esc(project?.color || "#32c6cb")}"></label><label>Logo (PNG, JPEG eller WebP)<input id="project-logo" type="file" accept="image/png,image/jpeg,image/webp"></label><img id="logo-preview" alt="Prosjektlogo" ${logo ? `src="${esc(logo)}"` : "hidden"}><button type="button" id="remove-logo" class="flat">Fjern logo</button></div><h3>Mapper / sesonger</h3><p class="muted">Programmer kan samles i mapper. Slettede mapper flytter programmene til Uten mappe.</p><div id="folder-editor"></div><button type="button" id="add-folder">+ Ny mappe</button>` : `<label for="program-date">Programdato</label><input type="date" id="program-date" value="${esc(item?.date || "")}"><label for="program-folder">Mappe</label><select id="program-folder"><option value="">Uten mappe</option>${folders.map((f) => `<option value="${f.id}" ${item?.folderId === f.id ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select>`}`,
    async (d) => {
      const value = {
        type: "edit",
        action:
          (id ? "update" : "create") + (isProject ? "Project" : "Episode"),
        id,
        name: $("#new-name", d).value,
        background: true,
      };
      if (isProject)
        Object.assign(value, {
          color: $("#project-color", d).value,
          logo,
          folders,
        });
      else
        Object.assign(value, {
          projectId: project.id,
          date: $("#program-date", d).value,
          folderId: $("#program-folder", d).value || null,
        });
      const before = state.projects.map((p) => p.id);
      await request(value);
      if (isProject && !id)
        menuProjectId = state.projects.find((p) => !before.includes(p.id))?.id;
      menuKey = "";
      renderMenu();
    },
    id ? "Lagre" : "Opprett",
  );
  if (!isProject) return;
  function drawFolders() {
    $("#folder-editor", d).innerHTML = folders
      .map(
        (f) =>
          `<div class="folder-edit"><input aria-label="Mappenavn" data-folder-name="${f.id}" value="${esc(f.name)}" required maxlength="120"><button type="button" class="flat trash" data-remove-folder="${f.id}" aria-label="Fjern mappe">${trashIcon()}</button></div>`,
      )
      .join("");
  }
  drawFolders();
  $("#add-folder", d).onclick = () => {
    folders.push({
      id: crypto.randomUUID?.() || "folder-" + Date.now(),
      name: "",
    });
    drawFolders();
    $$("[data-folder-name]", d).at(-1)?.focus();
  };
  d.addEventListener("input", (e) => {
    if (e.target.dataset.folderName)
      folders.find((f) => f.id === e.target.dataset.folderName).name =
        e.target.value;
  });
  d.addEventListener("click", (e) => {
    const b = e.target.closest("[data-remove-folder]");
    if (b) {
      folders = folders.filter((f) => f.id !== b.dataset.removeFolder);
      drawFolders();
    }
  });
  $("#remove-logo", d).onclick = () => {
    logo = "";
    $("#logo-preview", d).hidden = true;
    $("#project-logo", d).value = "";
  };
  $("#project-logo", d).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 1500000) {
      $(".dialog-error", d).textContent = "Logoen må være under 1,5 MB.";
      return;
    }
    logo = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(f);
    });
    $("#logo-preview", d).src = logo;
    $("#logo-preview", d).hidden = false;
  };
}
function renderMenu() {
  if (route !== "projects" || !state) return;
  if (!menuInitialized) {
    menuProjectId = current().p?.id || null;
    menuInitialized = true;
  }
  const project = state.projects.find((p) => p.id === menuProjectId),
    { p, e } = current();
  const key = JSON.stringify([
    state.projects,
    menuProjectId,
    state.selection,
    folderFilter,
    programSort,
    programDirection,
  ]);
  if (key === menuKey) return;
  menuKey = key;
  $("#menu-title").textContent = project?.name || "Dine prosjekter";
  $("#menu-description").textContent = project
    ? "Velg programmet som skal være innlastet på alle skjermer."
    : "Velg prosjekt, deretter program.";
  $("#menu-back").hidden = !project;
  $("#menu-create").dataset.create = project ? "Episode" : "Project";
  $("#menu-create").textContent = project
    ? "+ Nytt program"
    : "+ Nytt prosjekt";
  $("#loaded-program").textContent = e
    ? `Innlastet: ${p.name} / ${e.name}`
    : "Ingen program innlastet.";
  $("#resume-program").hidden = !e;
  const grid = $(".project-grid");
  grid.classList.toggle("program-list", !!project);
  if (!project) {
    grid.innerHTML = state.projects
      .map(
        (p) =>
          `<article class="project-tile project-card" style="--project-color:${esc(p.color || "#32c6cb")}"><button class="project-select" data-project="${p.id}">${p.logo ? `<img class="project-logo" src="${esc(p.logo)}" alt="">` : '<span class="tile-icon">▱</span>'}<h2>${esc(p.name)}</h2><p>${p.episodes.length} programmer</p><span class="tile-action">Velg prosjekt →</span></button><button class="flat project-pen" data-edit-project="${p.id}" aria-label="Rediger prosjekt ${esc(p.name)}">${penIcon()}</button></article>`,
      )
      .join("");
    return;
  }
  if (
    folderFilter &&
    !project.folders.some((f) => f.id === folderFilter) &&
    folderFilter !== "none"
  )
    folderFilter = "";
  const programs = project.episodes
    .filter(
      (e) =>
        !folderFilter ||
        (folderFilter === "none" ? !e.folderId : e.folderId === folderFilter),
    )
    .sort((a, b) => {
      const av = a[programSort] || "",
        bv = b[programSort] || "";
      return av === bv
        ? a.name.localeCompare(b.name, "nb")
        : !av
          ? 1
          : !bv
            ? -1
            : av.localeCompare(bv, "nb") * programDirection;
    });
  grid.innerHTML = `<div class="program-list-tools"><label>Mappe <select id="folder-filter"><option value="">Alle programmer</option><option value="none" ${folderFilter === "none" ? "selected" : ""}>Uten mappe</option>${project.folders.map((f) => `<option value="${f.id}" ${folderFilter === f.id ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select></label><button class="flat" data-edit-project="${project.id}">${penIcon()} Prosjektinnstillinger</button></div><div class="program-table"><div class="program-row program-table-head">${[
    ["name", "Program"],
    ["date", "Programdato"],
    ["updatedAt", "Sist endret"],
  ]
    .map(
      ([key, label]) =>
        `<button class="flat" data-sort="${key}">${label} ${programSort === key ? (programDirection === 1 ? "↑" : "↓") : ""}</button>`,
    )
    .join(
      "",
    )}<span></span></div>${programs.map((item) => `<div class="program-row ${item.id === e?.id ? "loaded" : ""}"><button class="program-open" data-program="${item.id}"><strong>${esc(item.name)}</strong><small>${item.scripts.length} manus · ${esc(project.folders.find((f) => f.id === item.folderId)?.name || "Uten mappe")}${item.id === e?.id ? " · INNLASTET" : ""}</small></button><span>${item.date ? esc(new Date(item.date + "T12:00:00").toLocaleDateString("nb-NO")) : "—"}</span><span>${item.updatedAt ? esc(new Date(item.updatedAt).toLocaleString("nb-NO", { dateStyle: "short", timeStyle: "short" })) : "—"}</span><button class="flat" data-edit-program="${item.id}" aria-label="Rediger program ${esc(item.name)}">${penIcon()}</button></div>`).join("") || '<p class="empty">Ingen programmer i denne mappen.</p>'}</div>`;
  $("#folder-filter").onchange = (e) => {
    folderFilter = e.target.value;
    menuKey = "";
    renderMenu();
  };
}
function syncSelectionColors(sel) {
  let node =
    sel.anchorNode?.nodeType === 1
      ? sel.anchorNode
      : sel.anchorNode?.parentElement;
  if (!node || !$("#editor")?.contains(node)) return;
  function hex(css, fallback) {
    const m = css.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    return m
      ? "#" +
          m
            .slice(1)
            .map((v) => Number(v).toString(16).padStart(2, "0"))
            .join("")
      : fallback;
  }
  $("#text-color").value = hex(getComputedStyle(node).color, EDITOR_TEXT_COLOR);
  let bg = "";
  while (node && node !== $("#editor")) {
    const color = getComputedStyle(node).backgroundColor;
    if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
      bg = color;
      break;
    }
    node = node.parentElement;
  }
  $("#highlight").value = hex(bg, EDITOR_HIGHLIGHT_COLOR);
}
function renderEditorChapters() {
  const list = $("#editor-chapters"),
    editor = $("#editor");
  if (!list || !editor) return;
  const headings = $$("h2", editor),
    key = headings.map((h) => h.textContent).join("\0");
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  list.innerHTML = headings
    .map(
      (h, i) =>
        `<div class="editor-chapter"><button data-edit-chapter="${i}"><small>KAPITTEL ${i + 1}</small> ${esc(h.textContent || "Uten tittel")}</button><button class="flat" data-rename-chapter="${i}" aria-label="Endre kapitteltittel">${penIcon()}</button><button class="flat trash" data-remove-chapter="${i}" aria-label="Fjern kapittelmarkør">${trashIcon()}</button></div>`,
    )
    .join("");
}
function bindWorkspace() {
  $("#clear-text")?.addEventListener("click", () => {
    const id = editorId;
    confirmGUI(
      "Tømme teksten?",
      "Dette tømmer bare det lokale utkastet. Trykk Oppdater manus for å publisere den tomme teksten.",
      () => {
        if (editorId !== id) throw Error("Et annet manus er valgt.");
        $("#editor").innerHTML = "<p><br></p>";
        savedRange = null;
        markDirty();
      },
    );
  });
  $("#remove-highlight")?.addEventListener("pointerdown", (e) =>
    e.preventDefault(),
  );
  $("#remove-highlight")?.addEventListener("click", () =>
    format("hiliteColor", "transparent"),
  );
  $("#add-chapter")?.addEventListener("click", () => {
    const id = editorId;
    const range = savedRange?.cloneRange();
    dialogForm(
      "Legg til kapittel",
      '<label for="chapter-title">Kapitteltittel</label><input id="chapter-title" required autofocus maxlength="160">',
      (d) => {
        if (editorId !== id) throw Error("Et annet manus er valgt.");
        d.close();
        savedRange = range;
        if (!savedRange) {
          savedRange = document.createRange();
          savedRange.selectNodeContents($("#editor"));
          savedRange.collapse(false);
        }
        format(
          "insertHTML",
          `<h2 data-chapter="chapter-${Date.now()}">${esc($("#chapter-title", d).value)}</h2><p><br></p>`,
        );
      },
      "Legg til",
    );
  });
  $("#add-screen")?.addEventListener("click", () =>
    dialogForm(
      "Ny utgangsskjerm",
      '<label>Skjerm-ID<input id="screen-id" required pattern="[A-Za-z0-9_-]{1,32}" placeholder="2"></label><label>Navn<input id="screen-name" required placeholder="Prompter kamera 2"></label>',
      (d) =>
        request({
          type: "edit",
          action: "saveScreen",
          create: true,
          id: $("#screen-id", d).value,
          name: $("#screen-name", d).value,
        }),
    ),
  );
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.screen) {
      const screen = state.screens.find((s) => s.id === el.dataset.screen);
      request({
        type: "edit",
        action: "saveScreen",
        ...screen,
        [el.dataset.axis]: el.checked,
      }).catch((e) => toast(e.message));
    }
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.editProject)
      organizationDialog("Project", b.dataset.editProject);
    if (b.dataset.editProgram)
      organizationDialog("Episode", b.dataset.editProgram);
    if (b.dataset.sort) {
      if (programSort === b.dataset.sort) programDirection *= -1;
      else {
        programSort = b.dataset.sort;
        programDirection = programSort === "name" ? 1 : -1;
      }
      menuKey = "";
      renderMenu();
    }
    if (b.dataset.deleteScreen)
      confirmGUI(
        "Slette skjermen?",
        "Skjermadressen tas ut av bruk.",
        () =>
          request({
            type: "edit",
            action: "deleteScreen",
            id: b.dataset.deleteScreen,
          }),
        b,
      );
    for (const action of ["editChapter", "renameChapter", "removeChapter"])
      if (b.dataset[action] !== undefined) {
        const h = $$("h2", $("#editor"))[Number(b.dataset[action])];
        if (!h) return;
        if (action === "editChapter") {
          h.scrollIntoView({ block: "center", behavior: "smooth" });
          $("#editor").focus();
          const r = document.createRange();
          r.selectNodeContents(h);
          getSelection().removeAllRanges();
          getSelection().addRange(r);
        } else if (action === "removeChapter") {
          const p = document.createElement("p");
          p.innerHTML = h.innerHTML;
          h.replaceWith(p);
          markDirty();
        } else
          dialogForm(
            "Endre kapitteltittel",
            `<input id="chapter-title" required autofocus value="${esc(h.textContent)}">`,
            (d) => {
              if (!h.isConnected) throw Error("Manuset er byttet.");
              h.textContent = $("#chapter-title", d).value;
              markDirty();
            },
          );
      }
  });
}
