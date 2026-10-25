import { feedback, stateFor } from "./tool-state.js";
import { uiMsg, uiFrom, uiText } from "../site/ui.js";

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const api = window.KenseiWorkspace;
export const esc = api.escape;
export const toast = api.toast;
export const size = (n) =>
  n < 1048576
    ? `${(n / 1024).toFixed(1)} KB`
    : `${(n / 1048576).toFixed(2)} MB`;
export const filename = (s) =>
  (s || "kensei").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").slice(0, 120);
export function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename(name);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export const downloadText = (text, name, type = "text/plain;charset=utf-8") =>
  download(new Blob([text], { type }), name);
const scripts = new Map();
export function library(path, global) {
  if (window[global]) return Promise.resolve(window[global]);
  if (!scripts.has(path))
    scripts.set(
      path,
      new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "/vendor/" + path;
        s.onload = () => resolve(window[global]);
        s.onerror = () => {
          s.remove();
          scripts.delete(path);
          reject(
            new Error(
              "Tool files could not load. Check your connection and retry.",
            ),
          );
        };
        document.head.append(s);
      }),
    );
  return scripts.get(path);
}
export async function zip(files, name, isCurrent = () => true) {
  const { zip: compress } = await library("fflate.js", "fflate");
  const entries = {};
  for (const [key, blob] of files)
    entries[key] = new Uint8Array(await blob.arrayBuffer());
  const data = await new Promise((resolve, reject) =>
    compress(entries, { level: 0 }, (e, out) => (e ? reject(e) : resolve(out))),
  );
  if (isCurrent())
    download(new Blob([data], { type: "application/zip" }), name);
}
export async function image(file) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("Choose JPG, PNG or WebP images.");
  if (file.size > 20 * 1048576)
    throw new Error("Choose an image smaller than 20 MB.");
  const url = URL.createObjectURL(file),
    img = new Image();
  try {
    img.src = url;
    await img.decode();
    if (img.width * img.height > 40000000)
      throw new Error("Please use an image under 40 megapixels.");
    return img;
  } catch (e) {
    throw new Error(
      e.message.includes("megapixels")
        ? e.message
        : "This image could not be opened. Try another file.",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function canvasBlob(canvas, type = "image/png", quality = 0.9) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(
              new Error("Could not create the output. Try smaller dimensions."),
            ),
      type,
      quality,
    ),
  );
}
export function status(text, error = false) {
  feedback(stateFor(text, error), text);
  const n = $("#tool-status");
  if (n) {
    uiText(n, uiFrom(text));
    n.classList.toggle("error-text", error);
  }
}
export function busy(value) {
  document
    .querySelector("[data-tool]")
    ?.setAttribute("aria-busy", String(value));
  if (value) feedback("working", uiMsg("Processing on this device…"));
  $$("[data-lock]").forEach((n) => {
    if (value) {
      if (!n.hasAttribute("data-was-disabled"))
        n.dataset.wasDisabled = String(n.disabled);
      n.disabled = true;
    } else if (n.hasAttribute("data-was-disabled")) {
      n.disabled = n.dataset.wasDisabled === "true";
      delete n.dataset.wasDisabled;
    }
  });
  const cancel = $("#cancel-job");
  if (cancel) cancel.hidden = !value;
}
export async function copy(input) {
  try {
    await navigator.clipboard.writeText(input.value);
    toast(uiMsg("Copied to clipboard."));
  } catch {
    input.focus();
    input.select();
    toast(
      input.type === "password"
        ? uiMsg(
            "Clipboard unavailable. Choose Show password, then select and copy it manually.",
          )
        : uiMsg("Text selected. Press Ctrl+C to copy."),
    );
  }
}
// 旧草稿没有 tool 字段，继续由 Text Toolkit 读取。
export function draftEditor(tool, input, render = () => {}) {
  let id = null,
    savedAt = null,
    dirty = false;
  const name = $("#draft-name"),
    state = $("#draft-state");
  const changed = () => {
    window.dispatchEvent(new Event("tool-content-changed"));
    dirty = true;
    uiText(state, uiMsg("Unsaved changes · save when you are ready."));
    render();
  };
  input.addEventListener("input", changed);
  name.addEventListener("input", changed);
  const load = () => {
    if (dirty) return;
    const requested = new URLSearchParams(location.search).get("draft");
    const item = api
      .items("draft")
      .find(
        (x) => x.id === requested && (x.data.tool || "text-toolkit") === tool,
      );
    if (item) {
      id = item.id;
      savedAt = item.updated_at;
      name.value = item.data.name;
      input.value = item.data.text;
      uiText(state, uiMsg("Saved draft loaded."));
      render();
    }
  };
  $("#save-draft").addEventListener("click", async (e) => {
    if (!name.value.trim() || !input.value.trim())
      return toast(uiMsg("Add text and give your draft a name first."));
    if (
      new TextEncoder().encode(JSON.stringify({ text: input.value })).length >
      450000
    )
      return toast(
        uiMsg("This draft is too large to save. Download it instead."),
      );
    e.target.disabled = true;
    try {
      const item = await api.saveItem(
        "draft",
        { tool, name: name.value.trim().slice(0, 100), text: input.value },
        id || crypto.randomUUID(),
        savedAt,
      );
      id = item.id;
      savedAt = item.updated_at;
      dirty = false;
      uiText(
        state,
        api.user
          ? uiMsg("Saved and synced to your workspace.")
          : uiMsg("Saved to your workspace on this device."),
      );
      toast(uiMsg("Draft saved."));
    } catch {
      uiText(
        state,
        uiMsg("Save failed. Your text is still here; retry or download it."),
      );
    } finally {
      e.target.disabled = false;
    }
  });
  window.addEventListener("tool-recovery-restored", () => {
    id = null;
    savedAt = null;
    changed();
  });
  load();
  window.addEventListener("workspace-ready", load);
  window.addEventListener("beforeunload", (e) => {
    if (dirty && input.value) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  return changed;
}
