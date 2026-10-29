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
export const PAPER_TYPES = ["plain", "ruled", "grid", "dots", "graph"];
export function paperSettings(value) {
  if (value === undefined) return { version: 1, type: "plain", spacing: 20 };
  if (
    !value ||
    value.version !== 1 ||
    !PAPER_TYPES.includes(value.type) ||
    Object.keys(value).some(
      (key) => !["version", "type", "spacing"].includes(key),
    ) ||
    ![10, 20, 40].includes(value.spacing)
  )
    throw Error("Invalid paper settings.");
  return { version: 1, type: value.type, spacing: value.spacing };
}
export function portSettings(element) {
  if (element.customData == null) return null;
  const keys = Object.keys(element.customData),
    p = element.customData.kenseiPorts;
  if (
    element.type !== "arrow" ||
    keys.length !== 1 ||
    keys[0] !== "kenseiPorts" ||
    !p ||
    p.version !== 1 ||
    Object.keys(p).some((k) => !["version", "start", "end"].includes(k)) ||
    ![p.start, p.end].every(
      (n) => n === null || (Number.isInteger(n) && n >= 0 && n < 12),
    )
  )
    throw Error("Invalid connector metadata.");
  return { version: 1, start: p.start, end: p.end };
}
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
    if (el.link || el.fileId)
      throw Error(
        "Linked elements, images and embedded content are not supported. Remove them before importing.",
      );
    portSettings(el);
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
    paper: paperSettings(state.paper),
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
