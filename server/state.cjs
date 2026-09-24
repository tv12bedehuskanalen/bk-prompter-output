const { projectFields, episodeFields } = require("./organization.cjs");
const config = require("../config/app.cjs");
const { randomUUID } = require("node:crypto");
const sanitize = require("sanitize-html");
const clean = (html) =>
  sanitize(String(html), {
    allowedTags: [
      "p",
      "br",
      "h1",
      "h2",
      "h3",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "span",
      "mark",
      "div",
      "ul",
      "ol",
      "li",
      "blockquote",
    ],
    allowedAttributes: { "*": ["style"], h2: ["style", "data-chapter"] },
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb\([\d\s,]+\)$/, /^[a-z]+$/i],
        "background-color": [
          /^#[0-9a-f]{3,8}$/i,
          /^rgb\([\d\s,]+\)$/,
          /^[a-z]+$/i,
        ],
        "text-align": [/^(left|center|right)$/],
        "font-weight": [/^(normal|bold|[1-9]00)$/],
        "font-style": [/^(normal|italic)$/],
        "text-decoration": [
          /^(none|underline|line-through|underline line-through)$/,
        ],
      },
    },
    transformTags: {
      font: (tag, a) => ({
        tagName: "span",
        attribs: { style: `color:${a.color || "inherit"}` },
      }),
    },
  });
function displaySettings(v = {}, base = config.defaultDisplay) {
  const out = {};
  for (let k of ["fontSize", "lineHeight", "margin", "guidePosition"])
    if (k in v) {
      let limits = {
        fontSize: [20, 120],
        lineHeight: [1, 2.5],
        margin: [20, 400],
        guidePosition: [5, 80],
      }[k];
      if (!Number.isFinite(v[k]) || v[k] < limits[0] || v[k] > limits[1])
        throw Error("Ugyldig innstilling.");
      out[k] = v[k];
    }
  for (let k of ["mirror", "flip", "guide"]) if (k in v) out[k] = !!v[k];
  for (let k of ["background", "color"])
    if (k in v) {
      if (!/^#[0-9a-f]{6}$/i.test(v[k])) throw Error("Ugyldig farge.");
      out[k] = v[k];
    }
  if ("align" in v) {
    if (!["left", "center", "right"].includes(v.align))
      throw Error("Ugyldig tekstjustering.");
    out.align = v.align;
  }
  return { ...base, ...out };
}
function scriptDisplay(value, presets) {
  const displayMode = value.displayMode || "keep";
  if (!["keep", "preset", "custom"].includes(displayMode))
    throw Error("Ugyldig visningsvalg.");
  const presetId =
    displayMode === "preset" ? String(value.presetId || "") : null;
  if (presetId && !presets.some((x) => x.id === presetId))
    throw Error("Forhåndsinnstillingen finnes ikke.");
  if (displayMode === "preset" && !presetId)
    throw Error("Velg en forhåndsinnstilling.");
  return {
    displayMode,
    presetId,
    customSettings:
      displayMode === "custom" ? displaySettings(value.customSettings) : null,
  };
}

const uid = () => randomUUID();
function initial() {
  const project = uid(),
    episode = uid(),
    script = uid();
  return {
    schema: 1,
    revision: 0,
    projects: [
      {
        id: project,
        name: "Studio",
        episodes: [
          {
            id: episode,
            name: "Dagens sending",
            scripts: [
              {
                id: script,
                name: "Velkommen",
                oscId: "intro",
                version: 1,
                html: "<h1>Velkommen til sending</h1><p>Dette er BK Prompter. Et rolig sted for ordene dine.</p><p>Åpne kontrollen på mobilen, eller trykk på start for å sette teksten i bevegelse.</p><h2>Alt i samme takt</h2><p>Alle skjermer følger samme manus, samme posisjon og samme hastighet. Du kan redigere teksten, markere viktige ord og legge til overskrifter underveis.</p><p>Ta et pust. Se i kameraet. Du er klar.</p>",
              },
            ],
          },
        ],
      },
    ],
    selection: { project, episode, script },
    displayPresets: [],
    settings: { ...config.defaultDisplay },
    network: {
      port: config.defaultWebPort,
      oscPort: config.defaultOscPort,
      oscEnabled: true,
    },
    transport: { position: 0, speed: 60, playing: false, at: 0 },
    lock: null,
  };
}
class Engine {
  constructor(data = initial(), now = () => performance.now()) {
    this.data = data;
    this.data.displayPresets ??= [];
    this.data.screens ??= [
      {
        id: "1",
        name: "Skjerm 1",
        mirror: !!data.settings.mirror,
        flip: !!data.settings.flip,
      },
    ];
    for (const p of data.projects) {
      p.folders ??= [];
      p.color ??= "#32c6cb";
      p.logo ??= "";
      for (const e of p.episodes) {
        e.date ??= "";
        e.folderId ??= null;
        e.updatedAt ??= null;
      }
    }
    this.now = now;
    this.holds = new Map();
    this.layout = null;
    this.data.transport = { ...data.transport, playing: false, at: now() };
    this.data.lock = null;
  }
  current() {
    let p = this.data.projects.find(
      (p) => p.id === this.data.selection.project,
    );
    let e = p?.episodes.find((e) => e.id === this.data.selection.episode);
    let s = e?.scripts.find((s) => s.id === this.data.selection.script);
    return { p, e, s };
  }
  position() {
    let t = this.data.transport;
    return Math.max(
      0,
      Math.min(
        this.layout?.max ?? 1e7,
        t.position +
          (t.playing && !this.holds.size
            ? ((this.now() - t.at) * t.speed) / 1000
            : 0),
      ),
    );
  }
  anchor() {
    this.data.transport.position = this.position();
    this.data.transport.at = this.now();
  }
  snapshot() {
    return {
      ...this.data,
      transport: {
        ...this.data.transport,
        position: this.position(),
        at: this.now(),
        holding: this.holds.size > 0,
      },
      layout: this.layout,
    };
  }
  allowed(client) {
    return !this.data.lock || this.data.lock.owner === client;
  }
  control(client, action, value) {
    if (!this.allowed(client) && action !== "release")
      throw Error("Kontrollen er låst til en annen klient.");
    this.anchor();
    let t = this.data.transport;
    switch (action) {
      case "play":
        t.playing = true;
        break;
      case "pause":
        t.playing = false;
        break;
      case "toggle":
        t.playing = !t.playing;
        break;
      case "speed":
        if (!Number.isFinite(value) || Math.abs(value) > 500)
          throw Error("Ugyldig hastighet.");
        t.speed = value;
        break;
      case "seek":
        if (!Number.isFinite(value)) throw Error("Ugyldig posisjon.");
        t.position = Math.max(0, Math.min(this.layout?.max ?? 1e7, value));
        break;
      case "reset":
        t.position = 0;
        t.playing = false;
        break;
      case "hold":
        this.holds.set(client, this.now());
        break;
      case "release":
        this.holds.delete(client);
        break;
      case "next":
      case "previous": {
        let { e, s } = this.current(),
          i = e?.scripts.findIndex((x) => x.id === s?.id);
        let next = e?.scripts[i + (action === "next" ? 1 : -1)];
        if (!next) throw Error("Ingen flere manus i denne retningen.");
        this.load(next.id);
        break;
      }
      case "load": {
        let script = this.current().e?.scripts.find(
          (s) => s.id === value || s.oscId === value,
        );
        if (!script) throw Error("Fant ikke manus i innlastet program.");
        this.load(script.id);
        break;
      }
      case "chapter": {
        if (!this.layout)
          throw Error("Åpne en prompter eller forhåndsvisning først.");
        let target = this.layout.chapters.find((p) => p > t.position + 2);
        if (target !== undefined) t.position = target;
        break;
      }
      default:
        throw Error("Ukjent kontroll.");
    }
  }
  load(id) {
    const script = this.current().e?.scripts.find((x) => x.id === id);
    if (script?.displayMode === "preset") {
      const preset = this.data.displayPresets.find(
        (x) => x.id === script.presetId,
      );
      if (!preset) throw Error("Forhåndsinnstillingen til manuset mangler.");
      this.data.settings = displaySettings(preset.settings);
    } else if (script?.displayMode === "custom")
      this.data.settings = displaySettings(script.customSettings);
    this.data.selection.script = id;
    this.data.transport.position = 0;
    this.data.transport.playing = false;
    this.layout = null;
    this.holds.clear();
  }
  disconnect(id) {
    this.anchor();
    this.holds.delete(id);
    if (this.data.lock?.owner === id || this.data.lock?.by === id)
      this.data.lock = null;
  }
  expireHolds() {
    for (let [id, time] of this.holds)
      if (this.now() - time > 2500) {
        this.anchor();
        this.holds.delete(id);
      }
  }
  edit(client, msg) {
    if (!this.allowed(client))
      throw Error("Kontrollen er låst til en annen klient.");
    let { p, e, s } = this.current();
    let name = String(msg.name || "")
      .trim()
      .slice(0, 120);
    switch (msg.action) {
      case "loadProgram": {
        const project = this.data.projects.find((x) => x.id === msg.projectId);
        const episode = project?.episodes.find((x) => x.id === msg.episodeId);
        if (!episode) throw Error("Ukjent program.");
        if (
          this.data.selection.project === project.id &&
          this.data.selection.episode === episode.id
        )
          break;
        this.data.selection = {
          project: project.id,
          episode: episode.id,
          script: null,
        };
        this.load(episode.scripts[0]?.id || null);
        break;
      }
      case "selectProject": {
        let project = this.data.projects.find((p) => p.id === msg.id);
        if (!project) throw Error("Ukjent prosjekt.");
        this.data.selection = {
          project: project.id,
          episode: project.episodes[0]?.id || null,
          script: null,
        };
        this.load(project.episodes[0]?.scripts[0]?.id || null);
        break;
      }
      case "selectEpisode": {
        let episode = p?.episodes.find((e) => e.id === msg.id);
        if (!episode) throw Error("Ukjent program.");
        this.data.selection.episode = episode.id;
        this.load(episode.scripts[0]?.id || null);
        break;
      }
      case "selectScript":
        if (!e?.scripts.some((s) => s.id === msg.id))
          throw Error("Ukjent manus.");
        this.load(msg.id);
        break;
      case "createProject":
        if (!name) throw Error("Skriv et navn.");
        p = { id: uid(), name, ...projectFields(msg), episodes: [] };
        this.data.projects.push(p);
        if (!msg.background) {
          this.data.selection = { project: p.id, episode: null, script: null };
          this.load(null);
        }
        break;
      case "createEpisode":
        if (msg.projectId)
          p = this.data.projects.find((x) => x.id === msg.projectId);
        if (!p || !name) throw Error("Velg prosjekt og skriv et navn.");
        e = { id: uid(), name, ...episodeFields(msg, p), scripts: [] };
        p.episodes.push(e);
        if (!msg.background) {
          this.data.selection.project = p.id;
          this.data.selection.episode = e.id;
          this.load(null);
        }
        break;
      case "createScript":
        if (!e || !name) throw Error("Velg program og skriv et navn.");
        s = {
          id: uid(),
          name,
          oscId: "",
          version: 1,
          html: clean(msg.html || "<p>Skriv manuset ditt her …</p>"),
        };
        e.scripts.push(s);
        if (!msg.background) this.load(s.id);
        break;
      case "updateProject": {
        p = this.data.projects.find((x) => x.id === msg.id);
        if (!p || !name) throw Error("Velg prosjekt og skriv et navn.");
        const fields = projectFields({ ...p, ...msg });
        Object.assign(p, fields, { name });
        for (const program of p.episodes)
          if (
            program.folderId &&
            !p.folders.some((f) => f.id === program.folderId)
          ) {
            program.folderId = null;
            program.updatedAt = new Date().toISOString();
          }
        break;
      }
      case "updateEpisode": {
        p = this.data.projects.find((x) => x.id === msg.projectId);
        e = p?.episodes.find((x) => x.id === msg.id);
        if (!e || !name) throw Error("Velg program og skriv et navn.");
        Object.assign(e, episodeFields({ ...e, ...msg }, p), { name });
        break;
      }
      case "saveScreen": {
        const id = String(msg.id || "");
        if (!/^[A-Za-z0-9_-]{1,32}$/.test(id) || !name)
          throw Error(
            "Skriv navn og skjerm-ID (bokstaver, tall eller bindestrek).",
          );
        const screen = this.data.screens.find((x) => x.id === id);
        if (msg.create && screen) throw Error("Skjerm-ID finnes allerede.");
        const value = { id, name, mirror: !!msg.mirror, flip: !!msg.flip };
        if (screen) Object.assign(screen, value);
        else this.data.screens.push(value);
        break;
      }
      case "deleteScreen":
        if (msg.id === "1") throw Error("Standardskjermen kan ikke slettes.");
        this.data.screens = this.data.screens.filter((x) => x.id !== msg.id);
        break;
      case "saveMetadata": {
        s = e?.scripts.find((x) => x.id === msg.id);
        if (!s) throw Error("Manuset finnes ikke i innlastet program.");
        const patch = {};
        if ("name" in msg) {
          if (!name) throw Error("Skriv en tittel.");
          patch.name = name;
        }
        if ("oscId" in msg) {
          const oscId = String(msg.oscId).trim();
          if (oscId && !/^[\w-]{1,64}$/.test(oscId))
            throw Error("Ugyldig OSC-ID.");
          if (
            oscId &&
            e.scripts.some((x) => x.id !== s.id && x.oscId === oscId)
          )
            throw Error("OSC-ID må være unik i dette programmet.");
          patch.oscId = oscId;
        }
        if ("color" in msg) {
          if (!/^#[0-9a-f]{6}$/i.test(msg.color)) throw Error("Ugyldig farge.");
          patch.color = msg.color;
        }
        if (
          "displayMode" in msg ||
          "presetId" in msg ||
          "customSettings" in msg
        )
          Object.assign(
            patch,
            scriptDisplay({ ...s, ...msg }, this.data.displayPresets),
          );
        Object.assign(s, patch);
        break;
      }
      case "saveText": {
        s = e?.scripts.find((x) => x.id === msg.id);
        if (!s || s.version !== msg.version)
          throw Error(
            "Teksten er endret av en annen klient. Kopier utkastet eller velg Reset tekst.",
          );
        if (typeof msg.html !== "string" || msg.html.length > 1000000)
          throw Error("Ugyldig eller for stort manus.");
        const html = clean(msg.html);
        if (s.id === this.data.selection.script) {
          this.anchor();
          this.layout = null;
        }
        s.html = html;
        s.version++;
        break;
      }
      case "saveScript": {
        s = e?.scripts.find((x) => x.id === msg.id);
        if (!s)
          throw Error("Manuset er byttet. Kopier utkastet før du fortsetter.");
        if (msg.version !== s.version)
          throw Error(
            "Manuset er endret av en annen klient. Kopier utkastet ditt og last inn nyeste versjon.",
          );
        const oscId = String(msg.oscId || "").trim();
        if (oscId && !/^[\w-]{1,64}$/.test(oscId))
          throw Error(
            "OSC-ID kan inneholde bokstaver A–Z, tall, bindestrek og understrek.",
          );
        if (oscId && e.scripts.some((x) => x.id !== s.id && x.oscId === oscId))
          throw Error("OSC-ID må være unik i dette programmet.");
        if (!name) throw Error("Skriv et manusnavn.");
        if (typeof msg.html !== "string" || msg.html.length > 1000000)
          throw Error("Manuset er for stort.");
        const color = msg.color ?? s.color ?? "#32c6cb";
        if (!/^#[0-9a-f]{6}$/i.test(color)) throw Error("Ugyldig manusfarge.");
        const display = scriptDisplay(
          { ...s, ...msg },
          this.data.displayPresets,
        );
        const isLive = s.id === this.data.selection.script;
        if (isLive) this.anchor();
        Object.assign(s, {
          ...display,
          color,
          name,
          oscId,
          html: clean(msg.html),
          version: s.version + 1,
        });
        if (isLive) this.layout = null;
        break;
      }
      case "savePreset": {
        if (!name) throw Error("Skriv et navn på forhåndsinnstillingen.");
        if (
          this.data.displayPresets.some(
            (x) => x.name.toLowerCase() === name.toLowerCase(),
          )
        )
          throw Error("Navnet er allerede i bruk.");
        this.data.displayPresets.push({
          id: uid(),
          name,
          settings: displaySettings(msg.value || this.data.settings),
        });
        break;
      }
      case "applyPreset": {
        const preset = this.data.displayPresets.find((x) => x.id === msg.id);
        if (!preset) throw Error("Ukjent forhåndsinnstilling.");
        this.anchor();
        this.data.settings = displaySettings(preset.settings);
        this.layout = null;
        break;
      }
      case "deletePreset": {
        if (
          this.data.projects.some((p) =>
            p.episodes.some((e) =>
              e.scripts.some(
                (s) => s.displayMode === "preset" && s.presetId === msg.id,
              ),
            ),
          )
        )
          throw Error(
            "Forhåndsinnstillingen brukes av et manus og kan ikke slettes.",
          );
        this.data.displayPresets = this.data.displayPresets.filter(
          (x) => x.id !== msg.id,
        );
        break;
      }
      case "importProjects": {
        const input = msg.value;
        if (
          !input ||
          input.schema !== 1 ||
          !Array.isArray(input.projects) ||
          input.projects.length > 100
        )
          throw Error("Ugyldig prosjektfil.");
        const importedPresets = input.displayPresets || [];
        if (!Array.isArray(importedPresets) || importedPresets.length > 500)
          throw Error("Ugyldige forhåndsinnstillinger.");
        const presetMap = new Map();
        const newPresets = importedPresets.map((p) => {
          if (
            typeof p.id !== "string" ||
            typeof p.name !== "string" ||
            presetMap.has(p.id)
          )
            throw Error("Ugyldig forhåndsinnstilling.");
          const id = uid();
          presetMap.set(p.id, id);
          return {
            id,
            name: p.name.slice(0, 100) + " (importert)",
            settings: displaySettings(p.settings),
          };
        });
        let total = 0,
          count = 0;
        const projects = input.projects.map((p) => {
          if (
            typeof p.name !== "string" ||
            !Array.isArray(p.episodes) ||
            p.episodes.length > 500
          )
            throw Error("Ugyldig prosjekt.");
          return {
            id: uid(),
            name: p.name.slice(0, 120),
            ...projectFields(p),
            episodes: p.episodes.map((e) => {
              if (typeof e.name !== "string" || !Array.isArray(e.scripts))
                throw Error("Ugyldig program.");
              const ids = new Set();
              return {
                id: uid(),
                name: e.name.slice(0, 120),
                ...episodeFields(e, p),
                updatedAt: new Date().toISOString(),
                scripts: e.scripts.map((s) => {
                  if (
                    ++count > 5000 ||
                    typeof s.name !== "string" ||
                    typeof s.html !== "string" ||
                    s.html.length > 1000000
                  )
                    throw Error("Ugyldig eller for stort manus.");
                  total += s.html.length;
                  if (total > 10000000)
                    throw Error("Prosjektfilen er for stor.");
                  let oscId = String(s.oscId || "");
                  if (oscId && (!/^[\w-]{1,64}$/.test(oscId) || ids.has(oscId)))
                    throw Error("Ugyldig eller gjentatt OSC-ID.");
                  ids.add(oscId);
                  return {
                    id: uid(),
                    ...scriptDisplay(
                      { ...s, presetId: presetMap.get(s.presetId) },
                      newPresets,
                    ),
                    name: s.name.slice(0, 120),
                    oscId,
                    version: 1,
                    html: clean(s.html),
                    color: /^#[0-9a-f]{6}$/i.test(s.color)
                      ? s.color
                      : "#32c6cb",
                  };
                }),
              };
            }),
          };
        });
        this.data.projects.push(...projects);
        this.data.displayPresets.push(...newPresets);
        break;
      }
      case "deleteScript":
        s = e?.scripts.find((x) => x.id === msg.id);
        if (!s) throw Error("Velg manus først.");
        e.scripts = e.scripts.filter((x) => x.id !== s.id);
        if (s.id === this.data.selection.script)
          this.load(e.scripts[0]?.id || null);
        break;
      case "moveScript": {
        let i = e?.scripts.findIndex((x) => x.id === msg.id),
          j = i + Number(msg.direction);
        if (i < 0 || j < 0 || j >= e.scripts.length)
          throw Error("Kan ikke flytte manuset.");
        [e.scripts[i], e.scripts[j]] = [e.scripts[j], e.scripts[i]];
        break;
      }
      case "settings": {
        const out = displaySettings(msg.value, this.data.settings);
        this.anchor();
        Object.assign(this.data.settings, out);
        this.layout = null;
        break;
      }
      default:
        throw Error("Ukjent handling.");
    }
    if (
      e &&
      [
        "createEpisode",
        "updateEpisode",
        "createScript",
        "saveScript",
        "saveText",
        "saveMetadata",
        "deleteScript",
        "moveScript",
      ].includes(msg.action)
    )
      e.updatedAt = new Date().toISOString();
    this.data.revision++;
  }
}
module.exports = { Engine, initial, clean, displaySettings };
