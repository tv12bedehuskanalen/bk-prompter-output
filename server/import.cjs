const mammoth = require("mammoth");
const parseRTF = require("rtf-parser");
const { clean } = require("./state.cjs");
const escape = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
function rtfHTML(node) {
  if (typeof node === "string") return escape(node);
  if (!node) return "";
  let children = (node.content || []).map(rtfHTML).join("");
  if (node.value !== undefined) children = escape(node.value);
  if (node.style?.bold) children = `<strong>${children}</strong>`;
  if (node.style?.italic) children = `<em>${children}</em>`;
  if (node.style?.underline) children = `<u>${children}</u>`;
  const styles = [];
  for (const [key, css] of [
    ["foreground", "color"],
    ["background", "background-color"],
  ]) {
    const c = node.style?.[key];
    if (c) styles.push(`${css}:rgb(${c.red},${c.green},${c.blue})`);
  }
  if (styles.length)
    children = `<span style="${styles.join(";")}">${children}</span>`;
  return node.constructor.name === "RTFParagraph"
    ? `<p>${children}</p>`
    : children;
}
function normalizeRTF(buffer) {
  let text = buffer.toString("latin1");
  if (!/\\ansicpg\d+/.test(text))
    text = text.replace(/\\ansi\b/, "\\ansi\\ansicpg1252");
  return text.replace(
    /[^\x00-\x7f]/g,
    (c) => "\\'" + c.charCodeAt(0).toString(16).padStart(2, "0"),
  );
}
async function importDocument(file) {
  let ext = file.originalname.split(".").pop().toLowerCase();
  if (ext === "docx")
    return clean((await mammoth.convertToHtml({ buffer: file.buffer })).value);
  if (ext === "rtf") {
    let doc = await new Promise((resolve, reject) =>
      parseRTF.string(normalizeRTF(file.buffer), (err, doc) =>
        err ? reject(err) : resolve(doc),
      ),
    );
    return clean(rtfHTML(doc));
  }
  if (["txt", "md"].includes(ext))
    return file.buffer
      .toString("utf8")
      .split(/\r?\n/)
      .map((line) => `<p>${escape(line) || "<br>"}</p>`)
      .join("");
  if (["html", "htm"].includes(ext)) return clean(file.buffer.toString("utf8"));
  throw Error("Støtter DOCX, TXT, RTF, MD og HTML.");
}
module.exports = { importDocument };
