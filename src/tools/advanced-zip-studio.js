import { $, zip, status } from "./common.js";
import { el, field, row, button, panel } from "./advanced-ui.js";
import { sendControl } from "./handoff.js";
import { uiMsg } from "../site/ui.js";
export function init() {
  const ctx = window.KenseiAdvancedContexts["zip-studio"],
    folder = el("input", "", { type: "file", multiple: true });
  folder.setAttribute("webkitdirectory", "");
  $("#zip-files").after(field("Choose a folder", folder));
  folder.onchange = () => {
    $("#zip-files").files = folder.files;
    $("#zip-files").dispatchEvent(new Event("change"));
  };
  const p = panel("Archive selection", $("#zip-entries").closest("section")),
    query = el("input", "", { type: "search", placeholder: "Search paths" }),
    tree = el("div", "", { class: "advanced-list" }),
    result = el("div");
  $("#zip-entries").closest("section").append(p);
  p.classList.remove("panel");
  p.style.padding = "0";
  const chosen = new Set();
  let mode = "transfer";
  p.append(
    field("Search archive", query),
    row(
      button("Select visible files", () => {
        ctx.entries
          .filter(
            (e) =>
              !e.name.endsWith("/") &&
              e.name.toLowerCase().includes(query.value.toLowerCase()),
          )
          .forEach((e) => chosen.add(e.index));
        render();
      }),
      button("Clear selection", () => {
        chosen.clear();
        render();
      }),
    ),
    tree,
    row(
      button("Prepare selected files", () => {
        mode = "transfer";
        ctx.extract([...chosen]);
      }),
      button("Repack selected files", () => {
        mode = "pack";
        ctx.extract([...chosen]);
      }),
    ),
    result,
  );
  function render() {
    tree.replaceChildren();
    const folders = new Map();
    for (const e of ctx.entries) {
      if (!e.name.toLowerCase().includes(query.value.toLowerCase())) continue;
      const parts = e.name.split("/"),
        isDirectory = e.name.endsWith("/");
      if (isDirectory) parts.pop();
      let parent = tree,
        path = "";
      for (const name of parts.slice(0, isDirectory ? parts.length : -1)) {
        path += name + "/";
        if (!folders.has(path)) {
          const d = el("details", "", { open: true }),
            title = el("summary");
          title.textContent = name;
          d.append(title);
          parent.append(d);
          folders.set(path, d);
        }
        parent = folders.get(path);
      }
      if (isDirectory) continue;
      const label = el("label"),
        check = el("input", "", {
          type: "checkbox",
          checked: chosen.has(e.index),
        });
      label.textContent = parts.at(-1);
      label.title = e.name;
      check.onchange = () =>
        check.checked ? chosen.add(e.index) : chosen.delete(e.index);
      label.prepend(check);
      parent.append(label);
    }
  }
  query.oninput = render;
  window.addEventListener("zip-closed", () => {
    chosen.clear();
    result.replaceChildren();
    render();
  });
  window.addEventListener("zip-opened", () => {
    chosen.clear();
    result.replaceChildren();
    render();
  });
  window.addEventListener("zip-selection-ready", async ({ detail }) => {
    try {
      const types = {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          webp: "image/webp",
          pdf: "application/pdf",
        },
        files = detail.map(
          (e) =>
            new File([e.blob], e.name, {
              type:
                types[e.name.split(".").pop().toLowerCase()] ||
                "application/octet-stream",
            }),
        );
      result.replaceChildren(el("p", "Selected files are ready."));
      if (mode === "pack")
        await zip(
          files.map((f) => [f.name, f]),
          "kensei-selected.zip",
        );
      else {
        const targets = [];
        if (files.every((f) => f.type.startsWith("image/")))
          targets.push("image-studio", "pdf-toolkit", "image-to-text");
        if (files.every((f) => f.type === "application/pdf"))
          targets.push("pdf-toolkit");
        if (files.length === 1 && files[0].type === "application/pdf")
          targets.push("image-to-text");
        targets.push("file-renamer");
        sendControl(result, () => ({ kind: "files", files }), targets);
      }
    } catch (e) {
      status(e.message, true);
    }
  });
}
