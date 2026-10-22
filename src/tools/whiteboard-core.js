export const WHITEBOARD_LIMIT = 2000000;
const TYPES = new Set([
  "rectangle",
  "diamond",
  "ellipse",
  "arrow",
  "line",
  "freedraw",
  "text",
  "frame",
]);
export function assertVectorScene(elements, files = {}) {
  if (!Array.isArray(elements) || elements.length > 10000)
    throw Error("Use a vector whiteboard with up to 10,000 elements.");
  if (files && Object.keys(files).length)
    throw Error(
      "Images and attached files are not supported. Import a vector-only whiteboard.",
    );
  const ids = new Set();
  for (const el of elements) {
    if (
      !el ||
      !TYPES.has(el.type) ||
      typeof el.id !== "string" ||
      !el.id ||
      ids.has(el.id)
    )
      throw Error(
        "This whiteboard contains unsupported elements. Images, embedded pages and attached files are not supported.",
      );
    if (el.link || el.fileId || el.customData)
      throw Error(
        "Linked elements, images and embedded content are not supported. Remove them before importing.",
      );
    for (const key of ["x", "y", "width", "height", "angle"])
      if (!Number.isFinite(el[key]))
        throw Error("The whiteboard contains invalid geometry.");
    ids.add(el.id);
  }
  return elements;
}
export function sceneSettings(state = {}) {
  return {
    viewBackgroundColor: /^#[0-9a-f]{3,8}$/i.test(
      state.viewBackgroundColor || "",
    )
      ? state.viewBackgroundColor
      : "#ffffff",
    gridSize:
      Number.isFinite(state.gridSize) &&
      state.gridSize > 0 &&
      state.gridSize <= 100
        ? state.gridSize
        : null,
  };
}
export function whiteboardData(name, elements, appState, files = {}) {
  assertVectorScene(elements, files);
  return {
    version: 1,
    name,
    elements: structuredClone(elements),
    appState: sceneSettings(appState),
  };
}
export function validateWhiteboard(data) {
  if (
    !data ||
    data.version !== 1 ||
    typeof data.name !== "string" ||
    !data.name.trim() ||
    [...data.name.trim()].length > 100
  )
    throw Error("Give your whiteboard a name of 1–100 characters.");
  const result = whiteboardData(
    data.name.trim(),
    data.elements,
    data.appState,
    data.files,
  );
  // jsonb 输出会在逗号和冒号后增加空格，预留同样的空间。
  const text = JSON.stringify(result);
  let extra = 0,
    quoted = false,
    escaped = false;
  for (const ch of text) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "," || ch === ":")) extra++;
  }
  if (new TextEncoder().encode(text).length + extra > WHITEBOARD_LIMIT)
    throw Error(
      "This whiteboard exceeds 2 MB. Your edits remain here; export a backup before simplifying the drawing.",
    );
  return result;
}
export function importWhiteboard(value, fallback = "Imported whiteboard") {
  if (!value || typeof value !== "object")
    throw Error("Choose a valid .excalidraw or JSON whiteboard.");
  if (value.type && value.type !== "excalidraw")
    throw Error("Choose a .excalidraw scene, not a library.");
  return validateWhiteboard({
    version: 1,
    name: value.name || fallback,
    elements: value.elements,
    appState: value.appState,
    files: value.files,
  });
}
export function editableScene(data) {
  return {
    type: "excalidraw",
    version: 2,
    source: "https://kensei-workshop.vercel.app",
    name: data.name,
    elements: data.elements,
    appState: sceneSettings(data.appState),
    files: {},
  };
}
