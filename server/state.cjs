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
    allowedAttributes: { "*": ["style"] },
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
        p = { id: uid(), name, episodes: [] };
        this.data.projects.push(p);
        this.data.selection = { project: p.id, episode: null, script: null };
        this.load(null);
        break;
      case "createEpisode":
        if (!p || !name) throw Error("Velg prosjekt og skriv et navn.");
        e = { id: uid(), name, scripts: [] };
        p.episodes.push(e);
        this.data.selection.episode = e.id;
        this.load(null);
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
        this.load(s.id);
        break;
      case "saveScript": {
        if (!s || s.id !== msg.id)
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
        this.anchor();
        Object.assign(s, {
          name,
          oscId,
          html: clean(msg.html),
          version: s.version + 1,
        });
        this.layout = null;
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
            episodes: p.episodes.map((e) => {
              if (typeof e.name !== "string" || !Array.isArray(e.scripts))
                throw Error("Ugyldig program.");
              const ids = new Set();
              return {
                id: uid(),
                name: e.name.slice(0, 120),
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
                    name: s.name.slice(0, 120),
                    oscId,
                    version: 1,
                    html: clean(s.html),
                  };
                }),
              };
            }),
          };
        });
        this.data.projects.push(...projects);
        break;
      }
      case "deleteScript":
        if (!s || msg.id !== s.id) throw Error("Velg manus først.");
        e.scripts = e.scripts.filter((x) => x.id !== s.id);
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
        const v = msg.value || {},
          out = {};
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
        this.anchor();
        Object.assign(this.data.settings, out);
        this.layout = null;
        break;
      }
      default:
        throw Error("Ukjent handling.");
    }
    this.data.revision++;
  }
}
module.exports = { Engine, initial, clean };
