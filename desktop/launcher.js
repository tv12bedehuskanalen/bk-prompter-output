const $ = (id) => document.getElementById(id);
function render(s) {
  $("name").textContent = s.name || "BK Prompter";
  $("version").textContent = `Versjon ${s.version} · Lokal server`;
  $("port").value = s.port;
  $("osc").textContent = `OSC ${s.oscPort} · ${s.oscStatus}`;
  $("addresses").replaceChildren(
    ...s.interfaces.map((n) => {
      const div = document.createElement("div");
      div.className = "network";
      const name = document.createElement("span"),
        address = document.createElement("strong");
      name.textContent = n.name;
      address.textContent = n.url;
      div.append(name, address);
      return div;
    }),
  );
}
launcher.status().then(render);
launcher.onStatus(render);
$("port-form").onsubmit = async (event) => {
  event.preventDefault();
  const result = await launcher.setPort(Number($("port").value));
  $("message").textContent = result.ok
    ? "Porten er oppdatert. Tilkoblede klienter flyttes automatisk."
    : result.error;
  if (result.ok) render(result.status);
};
$("open").onclick = () => launcher.open($("gui").value);
$("quit").onclick = () => launcher.quit();
