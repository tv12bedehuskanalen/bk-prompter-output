// Project appearance and program metadata are stored alongside local projects.
const DEFAULT_PROJECT_COLOR = "#32c6cb";
function projectFields(value = {}) {
  const color = value.color || DEFAULT_PROJECT_COLOR;
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw Error("Ugyldig prosjektfarge.");
  const logo = value.logo || "";
  if (
    typeof logo !== "string" ||
    logo.length > 2000000 ||
    (logo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo))
  )
    throw Error("Bruk en PNG-, JPEG- eller WebP-logo under 1,5 MB.");
  const folders = value.folders || [];
  if (!Array.isArray(folders) || folders.length > 100)
    throw Error("Maksimalt 100 mapper.");
  const ids = new Set();
  return {
    color,
    logo,
    folders: folders.map((f) => {
      if (
        !f ||
        typeof f.id !== "string" ||
        !/^[\w-]{1,64}$/.test(f.id) ||
        ids.has(f.id) ||
        typeof f.name !== "string" ||
        !f.name.trim()
      )
        throw Error("Ugyldig mappe.");
      ids.add(f.id);
      return { id: f.id, name: f.name.trim().slice(0, 120) };
    }),
  };
}
function episodeFields(value = {}, project) {
  const date = value.date || "";
  if (
    date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date)
  )
    throw Error("Ugyldig programdato.");
  const folderId = value.folderId || null;
  if (folderId && !project.folders?.some((f) => f.id === folderId))
    throw Error("Ukjent mappe.");
  return { date, folderId };
}
module.exports = { projectFields, episodeFields };
