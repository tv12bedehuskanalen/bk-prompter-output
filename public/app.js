"use strict";
// Branding and main tuning values live in config.js; palette lives in theme.css.
const CONFIG = window.BK_CONFIG;
document.title = CONFIG.name;
document.querySelector("link[rel=icon]").href = CONFIG.favicon;
const $ = (s, r = document) => r.querySelector(s),
  $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const route =
  location.pathname.slice(1) ||
  (matchMedia("(max-width:700px)").matches &&
  !location.search.includes("editor")
    ? "controller"
    : "editor");
let state,
  clients = [],
  status = {},
  myId,
  ws,
  connected = false,
  clockOffset = 0,
  clockReady = false,
  bestRTT = Infinity,
  lastContact = 0,
  retry = 0,
  seq = 0;
let editorId = null,
  editorVersion = 0,
  dirty = false,
  saving = false,
  conflict = false,
  saveTimer,
  draftPromise = null,
  shellKey = "",
  layoutKey = "",
  lastLayoutSent = "",
  chapters = [],
  maxPosition = 0,
  freezeAt = 0,
  holdActive = false;
const pending = new Map();
let stage,
  content,
  viewport,
  guide,
  ruler,
  fontsReady = false;
const clientName =
  localStorage.getItem("bk-name") ||
  `${route === "output" ? "Prompter" : route === "controller" ? "Kontroll" : "Studio"} · ${/Android|iPhone|iPad/.test(navigator.userAgent) ? "Mobil" : "Skjerm"}`;
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("#toast").style.display = "none"), 6000);
}
function send(data) {
  if (!connected || ws.readyState !== 1)
    throw Error("Ingen forbindelse til serveren.");
  ws.send(JSON.stringify(data));
}
function request(data) {
  return new Promise((resolve, reject) => {
    const requestId = ++seq;
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(Error("Serveren svarte ikke."));
    }, 5000);
    pending.set(requestId, { resolve, reject, timeout });
    try {
      send({ ...data, requestId });
    } catch (e) {
      clearTimeout(timeout);
      pending.delete(requestId);
      reject(e);
    }
  });
}
function command(action, value) {
  return request({ type: "control", action, value }).catch((e) =>
    toast(e.message),
  );
}
function permitted() {
  return connected && (!state?.lock || state.lock.owner === myId);
}
function current() {
  const p = state?.projects.find((x) => x.id === state.selection.project),
    e = p?.episodes.find((x) => x.id === state.selection.episode),
    s = e?.scripts.find((x) => x.id === state.selection.script);
  return { p, e, s };
}
function position() {
  if (!state) return 0;
  if (!connected) return freezeAt;
  const t = state.transport;
  return Math.max(
    0,
    Math.min(
      maxPosition || 1e7,
      t.position +
        (t.playing && !t.holding
          ? ((performance.now() + clockOffset - t.at) * t.speed) / 1000
          : 0),
    ),
  );
}
function connect() {
  ws = new WebSocket(
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/live`,
  );
  ws.onopen = () => {
    connected = true;
    retry = 0;
    clockReady = false;
    bestRTT = Infinity;
    lastContact = performance.now();
    send({ type: "hello", name: clientName, role: route });
    ping();
    updateConnection();
  };
  ws.onmessage = (event) => {
    lastContact = performance.now();
    let msg = JSON.parse(event.data);
    if (msg.type === "welcome") myId = msg.id;
    if (msg.type === "pong") {
      const rtt = performance.now() - msg.sent;
      if (rtt < bestRTT + 3) {
        bestRTT = Math.min(bestRTT, rtt);
        const next = msg.server - (msg.sent + performance.now()) / 2;
        clockOffset = clockReady ? clockOffset * 0.8 + next * 0.2 : next;
        clockReady = true;
      }
      return;
    }
    if (msg.type === "transport") {
      if (state) {
        state.transport = msg.transport;
        for (const el of $$(".play"))
          el.textContent = state.transport.playing ? "Ⅱ Pause" : "▶ Start";
        $("#hold")?.classList.toggle("held", state.transport.holding);
      }
      return;
    }
    if (msg.type === "state") {
      if (!clockReady) clockOffset = msg.state.transport.at - performance.now();
      state = msg.state;
      clients = msg.clients;
      status = msg.status;
      render();
      return;
    }
    if (msg.type === "redirect") {
      const u = new URL(location.href);
      u.port = msg.port;
      setTimeout(() => (location.href = u.href), 700);
      return;
    }
    if (msg.type === "ack" || msg.type === "error") {
      const p = pending.get(msg.requestId);
      if (p) {
        clearTimeout(p.timeout);
        pending.delete(msg.requestId);
        msg.type === "ack" ? p.resolve() : p.reject(Error(msg.message));
      } else if (msg.type === "error") toast(msg.message);
    }
  };
  ws.onclose = () => {
    freezeAt = position();
    connected = false;
    clockReady = false;
    lastLayoutSent = "";
    holdActive = false;
    for (const p of pending.values()) {
      clearTimeout(p.timeout);
      p.reject(Error("Forbindelsen ble brutt."));
    }
    pending.clear();
    updateConnection();
    setTimeout(connect, Math.min(5000, 500 * 2 ** retry++));
  };
  ws.onerror = () => ws.close();
}
function ping() {
  if (connected) send({ type: "ping", sent: performance.now() });
}
setInterval(() => {
  ping();
  if (connected && performance.now() - lastContact > 4000) ws.close();
}, 1000);
function header() {
  return `<header><a class="brand" href="/?editor"><img class="brand-symbol" src="${esc(CONFIG.logoSymbol)}" alt="Bedehuskanalen">${esc(CONFIG.shortName)} <small>${esc(CONFIG.badge)}</small></a><nav>${[
    ["editor", "Manus", "/?editor"],
    ["controller", "Kontroll", "/controller"],
    ["display", "Visning", "/display"],
    ["settings", "Innstillinger", "/settings"],
  ]
    .map(
      ([id, label, url]) =>
        `<a href="${url}" class="${route === id ? "active" : ""}">${label}</a>`,
    )
    .join(
      "",
    )}</nav><div class="spacer"></div><span class="connection"><i class="dot"></i>TILKOBLET</span><div class="clients"><button class="flat avatars" id="clients-toggle" aria-label="Klienter og kontrollås"></button><div class="clients-panel" hidden></div></div></header>`;
}
function preview() {
  return '<div class="preview-box"><div class="stage-viewport"><div class="stage-transform"><div class="stage"><div class="prompt-content"></div></div><div class="guide"></div></div></div></div>';
}
function transport() {
  return `<div class="transport-row"><button data-control="reset" title="Til starten" aria-label="Til starten">↶</button><button class="primary play" data-control="toggle">▶ Start</button><button data-control="next" title="Neste manus" aria-label="Neste manus">↦</button></div><div class="speed-heading"><div><span class="eyebrow">Hastighet</span><div class="speed-value"><span data-speed>60</span><small>px / sek</small></div></div><div class="speed-step"><button data-step="-${CONFIG.speedStep}" aria-label="Saktere">−</button><button data-step="${CONFIG.speedStep}" aria-label="Raskere">+</button></div></div><input id="speed" aria-label="Hastighet" type="range" min="${CONFIG.speedMin}" max="${CONFIG.speedMax}" step="1"><div class="speed-hints"><span>Bakover</span><span>Fremover</span></div><div class="position-line"><span>Posisjon</span><span id="position-label">0 %</span></div><input id="position" aria-label="Posisjon i manus" type="range" min="0" max="1000" step="1"><button class="hold" id="hold">Hold for pause<small>Slipp for å fortsette</small></button>`;
}
function build() {
  if (route === "output") {
    document.body.classList.add("output");
    $("#app").innerHTML =
      `${preview()}<div class="output-warning" hidden>Frakoblet — avspilling fryst</div>`;
  } else {
    let body = "";
    if (route === "editor")
      body = `<main class="workspace"><aside class="library"><div class="section-title"><span class="eyebrow">Arbeidsområde</span><button data-create="Project" title="Nytt prosjekt">+</button></div><label class="eyebrow" for="project">Prosjekt</label><select id="project"></select><div class="section-title"><label class="eyebrow" for="episode">Episode / program</label><button data-create="Episode" title="Nytt program">+</button></div><select id="episode"></select><div class="library-divider"></div><div class="section-title"><span class="eyebrow">Manus <span id="script-count"></span></span><button data-create="Script" title="Nytt manus">+</button></div><div class="script-list"></div><button class="wide" id="import">↥ Importer manus</button><input type="file" id="file" accept=".docx,.txt,.rtf,.md,.html,.htm" hidden><div class="library-footer"><img class="brand-full" src="${esc(CONFIG.logoFull)}" alt="Bedehuskanalen"><br>${esc(CONFIG.tagline)}<br>Oppdatert manus deles med alle skjermer.<br><span class="version-label"></span></div></aside><section class="editor-pane"><div class="page-heading"><div><span class="eyebrow" id="breadcrumb">MANUSROM</span><h1>${esc(CONFIG.editorTitle)}</h1></div><div class="spacer"></div><span class="save-status">Lagret</span></div><div class="script-meta"><input id="script-name" aria-label="Manusnavn" placeholder="Manusnavn"><label for="osc-id">OSC-ID</label><input id="osc-id" placeholder="intro" aria-label="OSC-ID"><button id="save" title="Lagre manus">Oppdater manus</button></div><div class="toolbar"><select id="block-format" aria-label="Teksttype"><option value="p">Normal tekst</option><option value="h1">Tittel</option><option value="h2">Kapittel</option><option value="h3">Undertittel</option></select><span class="separator"></span><button data-format="bold" title="Fet"><b>B</b></button><button data-format="italic" title="Kursiv"><i>I</i></button><button data-format="underline" title="Understrek"><u>U</u></button><label title="Tekstfarge">A <input type="color" id="text-color" value="#32c6cb" aria-label="Tekstfarge"></label><label title="Uthevingsfarge">▰ <input type="color" id="highlight" value="#665529" aria-label="Uthevingsfarge"></label><button data-format="removeFormat" title="Fjern formatering">Tx</button><div class="spacer"></div><button data-move="-1" title="Flytt manus opp">↑</button><button data-move="1" title="Flytt manus ned">↓</button><button id="delete-script" title="Slett manus">⌫</button></div><div id="editor" contenteditable="true" role="textbox" aria-label="Manustekst" aria-multiline="true" spellcheck="true"></div><div class="editor-bottom"><span id="word-count"></span><button id="discard-draft" class="flat" style="font-size:11px;padding:0">Hent publisert tekst</button></div></section><aside class="control-pane"><h2>På prompteren <span class="live-badge" style="float:right;font-size:10px">● LIVE</span></h2>${preview()}<div class="preview-label"><span>FELLES UTGANG</span><a href="/output" target="_blank">Åpne prompter ↗</a></div>${transport()}<div class="control-divider"></div><div class="section-title"><span class="eyebrow">Kapitler</span><button data-control="chapter" title="Neste kapittel">↦</button></div><div class="chapter-list"></div><div class="keyboard-hint">Mellomrom: start / pause · ↑ ↓: hastighet</div></aside></main>`;
    else if (route === "controller")
      body = `<main class="mobile-control"><span class="eyebrow">Fjernkontroll</span><h1 id="controller-title">Prompter</h1><span class="muted" id="controller-program"></span>${preview()}${transport()}<div class="control-divider"></div><div class="transport-row"><button data-control="previous">← Forrige manus</button><button data-control="chapter">Neste kapittel →</button></div><div class="chapter-list" style="margin-top:20px"></div><a class="mobile-editor-link" href="/?editor">Åpne manusredigering →</a><a class="mobile-editor-link" href="/display">Visningsinnstillinger →</a></main>`;
    else if (route === "display")
      body = `<main class="settings-page"><span class="eyebrow">Prompteroppsett</span><h1>${esc(CONFIG.displayTitle)}</h1><p class="muted">Felles innstillinger for alle utganger. Forhåndsvisningen følger sendingen.</p><div class="settings-grid"><div><section class="settings-card"><h2>Typografi og leseflate</h2>${rangeField("fontSize", "Skriftstørrelse", 20, 120, 1)}${rangeField("lineHeight", "Linjeavstand", 1, 2.5, 0.1)}${rangeField("margin", "Sidemarger", 20, 400, 10)}<div class="field"><label for="align">Tekstjustering</label><select id="align" data-setting="align"><option value="left">Venstre</option><option value="center">Midtstilt</option><option value="right">Høyre</option></select></div><div class="field"><label for="color">Tekstfarge</label><input type="color" id="color" data-setting="color"></div><div class="field"><label for="background">Bakgrunn</label><input type="color" id="background" data-setting="background"></div></section><section class="settings-card"><h2>Skjerm og speil</h2>${checkField("mirror", "Speil horisontalt")}${checkField("flip", "Vend vertikalt")}${checkField("guide", "Vis lesemarkør")}${rangeField("guidePosition", "Lesepunkt (%)", 5, 80, 1)}</section></div><div class="settings-preview">${preview()}<div class="preview-label"><span>FORHÅNDSVISNING · DIREKTE</span><a href="/output" target="_blank">Åpne ren utgang ↗</a></div>${transport()}<p class="muted">Alle skjermer bruker samme tekstbredde og skrifttype. Utgangen skaleres til skjermen uten å endre linjebryting.<br>Dobbeltklikk på utgangen for fullskjerm. Ingen betjeningsfelt vises over teksten.</p></div></div></main>`;
    else
      body = `<main class="settings-page"><span class="eyebrow">System</span><h1>${esc(CONFIG.settingsTitle)}</h1><p class="muted">Lokal avspilling. Direkte kontroll. <span class="version-label"></span></p><div class="settings-grid"><div><section class="settings-card"><h2>OSC</h2><p class="muted">UDP på alle IPv4-nettverksgrensesnitt.</p><div class="field"><label for="osc-enabled">Aktiver OSC</label><input type="checkbox" id="osc-enabled"></div><div class="field"><label for="osc-port">Lytteport</label><input type="number" id="osc-port" min="1024" max="65535"></div><p id="osc-status" class="notice"></p><button id="save-network" class="primary">Lagre OSC-oppsett</button></section><section class="settings-card"><h2>Denne klienten</h2><label for="client-name" class="muted">Navn i klientlisten</label><input id="client-name" class="name-input" value="${esc(clientName)}"><button id="save-client">Lagre navn</button></section><section class="settings-card"><h2>Prosjektkopi</h2><p class="muted">Last ned prosjekter og manus som JSON.</p><a href="/api/export" download><button>Eksporter prosjekter ↧</button></a><button id="import-projects" style="margin-top:10px">Importer prosjekter ↥</button><input id="project-file" type="file" accept=".json" hidden></section></div><div><section class="settings-card"><h2>Automatisering</h2><p class="muted">OSC-ID slås opp i programmet som er innlastet. Samme ID kan brukes i ulike programmer.</p><table class="osc-table">${[
        ["load", '"intro"', "Last manus etter OSC-ID"],
        ["start", "—", "Start rulling"],
        ["pause", "—", "Pause"],
        ["toggle", "—", "Start / pause"],
        ["speed", "60.0", "Hastighet, logiske px/sek"],
        ["seek", "120.0", "Absolutt tekstposisjon"],
        ["reset", "—", "Pause og gå til start"],
        ["next", "—", "Neste manus"],
        ["previous", "—", "Forrige manus"],
        ["nextChapter", "—", "Neste overskrift"],
        ["hold", "—", "Pause mens hold fornyes"],
        ["release", "—", "Slipp hold"],
        ["state", "—", "Hent transportstatus"],
      ]
        .map(
          ([a, v, t]) =>
            `<tr><td><code>/prompter/${a}</code></td><td>${v}</td><td>${t}</td></tr>`,
        )
        .join(
          "",
        )}</table><p class="notice">Hold må fornyes minst hvert sekund. Automatisk frigjøring etter 2,5 sekunder. Kontrollåsen gjelder også OSC.</p></section><section class="settings-card"><h2>Nettverk</h2><div id="network-addresses"></div><p class="muted">Endre webport i servervinduet. Bruk et betrodd lokalnett; v0.1 har ikke innlogging.</p></section></div></div></main>`;
    $("#app").innerHTML = header() + body;
  }
  ruler = document.createElement("div");
  ruler.className = "ruler prompt-content";
  document.body.append(ruler);
  viewport = $(".stage-viewport");
  stage = $(".stage");
  content = $(".prompt-content", stage || document);
  guide = $(".guide");
  bind();
}
function rangeField(id, label, min, max, step) {
  return `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" data-setting="${id}"><output for="${id}"></output></div>`;
}
function checkField(id, label) {
  return `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="checkbox" data-setting="${id}"></div>`;
}
function updateConnection() {
  for (const el of $$(".connection")) {
    el.classList.toggle("offline", !connected);
    el.innerHTML = `<i class="dot"></i>${connected ? (state?.lock ? "KONTROLL LÅST" : "TILKOBLET") : "KOBLER TIL …"}`;
  }
  if ($(".output-warning")) $(".output-warning").hidden = connected;
  for (const el of $$(
    "[data-control],[data-step],#speed,#position,#hold,[data-setting],#save-network",
  ))
    el.disabled = !permitted();
  if ($("#editor"))
    $("#editor").contentEditable = String(permitted() && !!current().s);
}
function render() {
  if (!state) return;
  const { p, e, s } = current();
  const key = JSON.stringify([
    state.projects.map((p) => [
      p.id,
      p.name,
      p.episodes.map((e) => [
        e.id,
        e.name,
        e.scripts.map((s) => [s.id, s.name, s.oscId]),
      ]),
    ]),
    state.selection,
  ]);
  if (key !== shellKey) {
    shellKey = key;
    if (route === "editor") {
      const opts = (list, id, empty) =>
        list.length
          ? list
              .map(
                (x) =>
                  `<option value="${esc(x.id)}" ${x.id === id ? "selected" : ""}>${esc(x.name)}</option>`,
              )
              .join("")
          : `<option>${empty}</option>`;
      $("#project").innerHTML = opts(
        state.projects,
        p?.id,
        "Opprett et prosjekt",
      );
      $("#episode").innerHTML = opts(
        p?.episodes || [],
        e?.id,
        "Opprett et program",
      );
      $("#script-count").textContent = String(e?.scripts.length || 0).padStart(
        2,
        "0",
      );
      $(".script-list").innerHTML =
        e?.scripts
          .map(
            (x, i) =>
              `<button class="script-card ${s?.id === x.id ? "selected" : ""}" data-script="${x.id}"><span class="script-num">${String(i + 1).padStart(2, "0")}</span><span><strong>${esc(x.name)}</strong><small>${x.oscId ? "ID / " + esc(x.oscId) : "Ingen OSC-ID"}</small></span></button>`,
          )
          .join("") || '<p class="empty">Legg til ditt første manus.</p>';
      $("#breadcrumb").textContent = [p?.name, e?.name]
        .filter(Boolean)
        .join(" / ");
    }
  }
  if (route === "editor") {
    if (editorId !== s?.id) {
      editorId = s?.id;
      editorVersion = s?.version || 0;
      dirty = false;
      conflict = false;
      clearTimeout(saveTimer);
      $("#editor").innerHTML =
        s?.html || "<p>Opprett et prosjekt, program og manus for å starte.</p>";
      $("#script-name").value = s?.name || "";
      $("#osc-id").value = s?.oscId || "";
    } else if (s && s.version !== editorVersion && !saving) {
      if (!dirty) {
        editorVersion = s.version;
        $("#editor").innerHTML = s.html;
        $("#script-name").value = s.name;
        $("#osc-id").value = s.oscId;
      } else conflict = true;
    }
    $(".save-status").textContent = conflict
      ? "Konflikt · kopier utkast"
      : saving
        ? "Lagrer …"
        : dirty
          ? "Lokale endringer · ikke sendt"
          : "Lagret og synkronisert";
    $("#word-count").textContent =
      `${($("#editor").textContent.trim().match(/\S+/g) || []).length} ord`;
  }
  if (route === "controller") {
    $("#controller-title").textContent = s?.name || "Ingen manus valgt";
    $("#controller-program").textContent =
      e?.name || "Velg program i manusrommet";
  }
  if (route === "display")
    for (const el of $$("[data-setting]")) {
      if (document.activeElement !== el) {
        if (el.type === "checkbox")
          el.checked = state.settings[el.dataset.setting];
        else el.value = state.settings[el.dataset.setting];
      }
      let o = $(`output[for="${el.id}"]`);
      if (o) o.textContent = state.settings[el.dataset.setting];
    }
  if (route === "settings") {
    if (document.activeElement !== $("#osc-port"))
      $("#osc-port").value = state.network.oscPort;
    if (document.activeElement !== $("#osc-enabled"))
      $("#osc-enabled").checked = state.network.oscEnabled;
    $("#osc-status").textContent = status.oscStatus;
    $("#network-addresses").innerHTML = status.interfaces
      .map(
        (n) =>
          `<p><span class="muted">${esc(n.name)}</span><br><a href="${esc(n.url)}">${esc(n.url)}</a></p>`,
      )
      .join("");
  }
  for (let el of $$(".version-label"))
    el.textContent = `BK Prompter v${status.version}`;
  updateClients();
  updateConnection();
  updateLayout();
  reportLayout();
  for (const el of $$("[data-speed]")) el.textContent = state.transport.speed;
  for (const el of $$(".play"))
    el.textContent = state.transport.playing ? "Ⅱ Pause" : "▶ Start";
  if ($("#speed") && document.activeElement !== $("#speed"))
    $("#speed").value = state.transport.speed;
  $("#hold")?.classList.toggle("held", state.transport.holding);
}
function updateClients() {
  let toggle = $("#clients-toggle");
  if (!toggle) return;
  toggle.innerHTML =
    clients
      .slice(0, 4)
      .map(
        (c) =>
          `<span title="${esc(c.name)}" class="avatar">${esc(c.name.slice(0, 2).toUpperCase())}</span>`,
      )
      .join("") +
    `<span style="margin-left:7px;font-size:11px">${clients.length}${state.lock ? " 🔒" : ""}</span>`;
  const panel = $(".clients-panel");
  const key = JSON.stringify([clients, state.lock]);
  if (panel.dataset.key === key) return;
  panel.dataset.key = key;
  panel.innerHTML = `<div class="eyebrow">Tilkoblede klienter</div>${[...clients, { id: "osc", name: "OSC · Automatisering", role: "osc" }].map((c) => `<div class="client-row"><span>${esc(c.name)}${c.id === myId ? " (deg)" : ""}<br><small class="muted">${esc(c.role)}</small></span><button data-lock="${esc(c.id)}">${state.lock?.owner === c.id ? "🔒 Låst" : "Gi kontroll"}</button></div>`).join("")}<button data-lock="" style="width:100%">Frigi til alle</button>`;
}
function applyStyle(el) {
  const c = state.settings;
  Object.assign(el.style, {
    fontSize: c.fontSize + "px",
    lineHeight: c.lineHeight,
    padding: `0 ${c.margin}px`,
    color: c.color,
    textAlign: c.align,
  });
}
function updateLayout() {
  if (!fontsReady) return;
  const { s } = current(),
    key = JSON.stringify([s?.id, s?.version, state.settings]);
  if (key === layoutKey) return;
  layoutKey = key;
  ruler.style.width = CONFIG.logicalWidth + "px";
  ruler.innerHTML = s?.html || "";
  applyStyle(ruler);
  if (content) {
    stage.style.width = CONFIG.logicalWidth + "px";
    content.style.width = CONFIG.logicalWidth + "px";
    content.innerHTML = s?.html || "";
    applyStyle(content);
    viewport.style.background = state.settings.background;
    $(".stage-transform").style.transform =
      `scale(${state.settings.mirror ? -1 : 1},${state.settings.flip ? -1 : 1})`;
    guide.style.display = state.settings.guide ? "" : "none";
    guide.style.top = state.settings.guidePosition + "%";
  }
  maxPosition = Math.max(0, ruler.getBoundingClientRect().height);
  chapters = $$("h1,h2,h3", ruler).map((el) => ({
    name: el.textContent,
    position: Math.max(0, el.offsetTop),
  }));
  for (let list of $$(".chapter-list"))
    list.innerHTML =
      chapters
        .map(
          (c, i) =>
            `<button data-chapter="${i}"><span class="muted">${String(i + 1).padStart(2, "0")}　</span>${esc(c.name)}</button>`,
        )
        .join("") || '<span class="muted">Ingen kapitler ennå</span>';
  reportLayout();
}
function reportLayout() {
  const { s } = current();
  if (!s || !fontsReady || !connected || lastLayoutSent === layoutKey) return;
  lastLayoutSent = layoutKey;
  send({
    type: "layout",
    script: s.id,
    version: s.version,
    key: JSON.stringify(state.settings),
    max: maxPosition,
    chapters: chapters.map((c) => c.position),
  });
}
function animate() {
  if (state) {
    let p = position();
    if (stage && viewport) {
      const width = viewport.clientWidth,
        height = viewport.clientHeight;
      stage.style.transform = `translate3d(0,${(height * state.settings.guidePosition) / 100 - (p * width) / CONFIG.logicalWidth}px,0) scale(${width / CONFIG.logicalWidth})`;
    }
    if ($("#position") && document.activeElement !== $("#position"))
      $("#position").value = maxPosition ? (p / maxPosition) * 1000 : 0;
    if ($("#position-label"))
      $("#position-label").textContent =
        `${Math.round(maxPosition ? (p / maxPosition) * 100 : 0)} %`;
  }
  requestAnimationFrame(animate);
}
async function saveDraft() {
  if (draftPromise) await draftPromise;
  if (!dirty) return;
  draftPromise = persistDraft();
  try {
    await draftPromise;
  } finally {
    draftPromise = null;
  }
}
async function persistDraft() {
  if (!dirty || saving || !editorId) return;
  if (conflict)
    throw Error(
      "En annen klient har endret manuset. Kopier utkastet før du laster siden på nytt.",
    );
  saving = true;
  const id = editorId,
    version = editorVersion,
    html = $("#editor").innerHTML,
    name = $("#script-name").value,
    oscId = $("#osc-id").value;
  try {
    await request({
      type: "edit",
      action: "saveScript",
      id,
      version,
      html,
      name,
      oscId,
    });
    if (editorId === id) {
      editorVersion = version + 1;
      dirty =
        $("#editor").innerHTML !== html ||
        $("#script-name").value !== name ||
        $("#osc-id").value !== oscId;
    }
  } catch (e) {
    if (editorId === id && current().s?.version !== version) conflict = true;
    throw e;
  } finally {
    saving = false;
    render();
  }
}
function markDirty() {
  dirty = true;
  $(".save-status").textContent = "Lokale endringer · ikke sendt";
  clearTimeout(saveTimer);
}
async function edit(data) {
  try {
    await request({ type: "edit", ...data });
  } catch (e) {
    toast(e.message);
  }
}
function nameDialog(kind) {
  const labels = { Project: "prosjekt", Episode: "program", Script: "manus" };
  const dialog = document.createElement("dialog");
  dialog.innerHTML = `<form><h2>Nytt ${labels[kind]}</h2><label for="new-name">Navn</label><input id="new-name" required maxlength="120" autofocus placeholder="Gi ${labels[kind]}et et navn"><div class="dialog-actions"><button type="button" data-cancel>Avbryt</button><button class="primary">Opprett</button></div></form>`;
  document.body.append(dialog);
  dialog.showModal();
  $("[data-cancel]", dialog).onclick = () => dialog.close();
  $("form", dialog).onsubmit = (event) => {
    event.preventDefault();
    edit({ action: "create" + kind, name: $("input", dialog).value });
    dialog.close();
  };
  dialog.onclose = () => dialog.remove();
}
let savedRange;
function rememberRange() {
  const sel = getSelection();
  if (sel.rangeCount && $("#editor")?.contains(sel.anchorNode))
    savedRange = sel.getRangeAt(0).cloneRange();
}
function format(cmd, value) {
  $("#editor").focus();
  if (savedRange) {
    let sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
  document.execCommand("styleWithCSS", false, true);
  document.execCommand(cmd, false, value);
  rememberRange();
  markDirty();
}
function bind() {
  document.addEventListener("selectionchange", rememberRange);
  document.addEventListener("click", (event) => {
    const b = event.target.closest("button");
    if (!b) return;
    if (b.dataset.control) command(b.dataset.control);
    if (b.dataset.step)
      command(
        "speed",
        Math.max(
          -500,
          Math.min(500, state.transport.speed + Number(b.dataset.step)),
        ),
      );
    if (b.dataset.create) nameDialog(b.dataset.create);
    if (b.dataset.script)
      edit({ action: "selectScript", id: b.dataset.script });
    if (b.dataset.chapter)
      command("seek", chapters[Number(b.dataset.chapter)].position);
    if (b.dataset.lock !== undefined)
      request({ type: "lock", owner: b.dataset.lock || null }).catch((e) =>
        toast(e.message),
      );
    if (b.dataset.move)
      edit({
        action: "moveScript",
        id: editorId,
        direction: Number(b.dataset.move),
      });
    if (b.dataset.format) format(b.dataset.format);
  });
  $("#clients-toggle")?.addEventListener(
    "click",
    () => ($(".clients-panel").hidden = !$(".clients-panel").hidden),
  );
  $("#project")?.addEventListener("change", (event) =>
    edit({ action: "selectProject", id: event.target.value }),
  );
  $("#episode")?.addEventListener("change", (event) =>
    edit({ action: "selectEpisode", id: event.target.value }),
  );
  for (let selector of ["#editor", "#script-name", "#osc-id"])
    $(selector)?.addEventListener("input", markDirty);
  $("#editor")?.addEventListener("paste", (event) => {
    event.preventDefault();
    format("insertText", event.clipboardData.getData("text/plain"));
  });
  $("#discard-draft")?.addEventListener("click", () => {
    if (
      !confirm("Erstatte utkastet med teksten som er publisert til prompteren?")
    )
      return;
    dirty = false;
    editorId = null;
    render();
  });
  $("#save")?.addEventListener("click", async () => {
    try {
      await saveDraft();
      toast("Manuset er oppdatert på alle skjermer.");
    } catch (e) {
      toast(e.message);
    }
  });
  $("#delete-script")?.addEventListener("click", () => {
    if (editorId && confirm("Slette dette manuset? Dette kan ikke angres."))
      edit({ action: "deleteScript", id: editorId });
  });
  for (let el of $$("[data-format]"))
    el.addEventListener("pointerdown", (e) => e.preventDefault());
  $("#block-format")?.addEventListener("change", (event) =>
    format("formatBlock", event.target.value),
  );
  $("#text-color")?.addEventListener("input", (event) =>
    format("foreColor", event.target.value),
  );
  $("#highlight")?.addEventListener("input", (event) =>
    format("hiliteColor", event.target.value),
  );
  $("#speed")?.addEventListener("input", (event) =>
    command("speed", Number(event.target.value)),
  );
  $("#position")?.addEventListener("input", (event) =>
    command("seek", (Number(event.target.value) / 1000) * maxPosition),
  );
  const hold = $("#hold");
  if (hold) {
    hold.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (!permitted()) return;
      hold.setPointerCapture(event.pointerId);
      holdActive = true;
      command("hold");
    });
    for (let ev of ["pointerup", "pointercancel", "lostpointercapture"])
      hold.addEventListener(ev, releaseHold);
    hold.addEventListener("keydown", (event) => {
      if ([" ", "Enter"].includes(event.key)) {
        event.preventDefault();
        if (!holdActive) {
          holdActive = true;
          command("hold");
        }
      }
    });
    hold.addEventListener("keyup", releaseHold);
    hold.addEventListener("contextmenu", (event) => event.preventDefault());
  }
  window.addEventListener("blur", releaseHold);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseHold();
    else {
      ping();
      bestRTT = Infinity;
    }
  });
  setInterval(() => {
    if (holdActive && connected) command("hold");
  }, 650);
  for (let el of $$("[data-setting]"))
    el.addEventListener("input", () => {
      const value =
        el.type === "checkbox"
          ? el.checked
          : el.type === "range"
            ? Number(el.value)
            : el.value;
      request({
        type: "edit",
        action: "settings",
        value: { [el.dataset.setting]: value },
      }).catch((e) => toast(e.message));
    });
  $("#save-network")?.addEventListener("click", async () => {
    try {
      await request({
        type: "network",
        oscEnabled: $("#osc-enabled").checked,
        oscPort: Number($("#osc-port").value),
      });
      toast("OSC-oppsettet er lagret.");
    } catch (e) {
      toast(e.message);
    }
  });
  $("#import-projects")?.addEventListener("click", () =>
    $("#project-file").click(),
  );
  $("#project-file")?.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 15000000) throw Error("Maksimal filstørrelse er 15 MB.");
      const value = JSON.parse(await file.text());
      await request({ type: "edit", action: "importProjects", value });
      toast("Prosjektene er importert som nye kopier.");
    } catch (e) {
      toast(e.message);
    }
    event.target.value = "";
  });
  $("#save-client")?.addEventListener("click", () => {
    const name = $("#client-name").value.trim() || "Klient";
    localStorage.setItem("bk-name", name);
    send({ type: "hello", name, role: route });
    toast("Klientnavn lagret.");
  });
  $("#import")?.addEventListener("click", () => {
    if (!current().e) {
      toast("Opprett et program først.");
      return;
    }
    $("#file").click();
  });
  $("#file")?.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const data = new FormData();
    data.append("file", file);
    try {
      const res = await fetch("/api/import", { method: "POST", body: data });
      const result = await res.json();
      if (!res.ok) throw Error(result.error);
      await edit({
        action: "createScript",
        name: result.name,
        html: result.html,
      });
    } catch (e) {
      toast(e.message);
    }
    event.target.value = "";
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.target.closest("input,select,button,[contenteditable=true],dialog")
    )
      return;
    if (event.code === "Space") {
      event.preventDefault();
      command("toggle");
    }
    if (event.code === "ArrowUp") {
      event.preventDefault();
      command("speed", Math.min(500, state.transport.speed + CONFIG.speedStep));
    }
    if (event.code === "ArrowDown") {
      event.preventDefault();
      command(
        "speed",
        Math.max(-500, state.transport.speed - CONFIG.speedStep),
      );
    }
    if (event.code === "Home") command("reset");
  });
  if (route === "output") {
    document.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        if (permitted())
          command(
            "seek",
            position() +
              (event.deltaY * CONFIG.logicalWidth) / window.innerWidth,
          );
      },
      { passive: false },
    );
  }
  if (route === "output")
    document.addEventListener("dblclick", () => {
      if (!document.fullscreenElement)
        document.documentElement.requestFullscreen?.().catch(() => {});
      else document.exitFullscreen?.();
    });
}
function releaseHold() {
  if (holdActive) {
    holdActive = false;
    if (connected) command("release");
  }
}
build();
Promise.all(
  [500, 600, 750].map((weight) =>
    document.fonts.load(`${weight} 56px Prompter`),
  ),
).then(() => {
  fontsReady = true;
  layoutKey = "";
  if (state) updateLayout();
});
connect();
animate();
