const routes = new Set([
  "pdf-toolkit",
  "zip-studio",
  "file-renamer",
  "file-check",
  "data-studio",
  "text-compare",
  "text-toolkit",
  "markdown-studio",
]);
export async function initAdvanced(slug) {
  if (routes.has(slug)) {
    const m = await import("./advanced-" + slug + ".js");
    await m.init();
  }
}
