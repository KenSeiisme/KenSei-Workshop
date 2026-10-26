import { textReceiver } from "./handoff.js";
import {
  el,
  button,
  field,
  panel,
  row,
  select,
  setValue,
} from "./advanced-ui.js";
export function transformLines(text, mode, pairs = []) {
  const lines = text.split("\n");
  if (mode === "unique") return [...new Set(lines)].join("\n");
  if (mode === "sort")
    return lines.sort((a, b) => a.localeCompare(b)).join("\n");
  if (mode === "reverse-sort")
    return lines.sort((a, b) => b.localeCompare(a)).join("\n");
  let out = text;
  for (const [find, replace] of pairs)
    if (find) out = out.split(find).join(replace);
  return out;
}
export function init() {
  const input = document.querySelector("#text-input");
  textReceiver("text-toolkit", "#text-input");
  const p = panel("Preview text changes", input.closest(".panel"));
  const mode = select([
    ["unique", "Remove duplicate lines"],
    ["sort", "Sort lines A–Z"],
    ["reverse-sort", "Sort lines Z–A"],
    ["replace", "Batch find and replace"],
  ]);
  const find = el("textarea", "", {
    rows: 3,
    placeholder: "Find: one literal string per line",
  });
  const replace = el("textarea", "", {
    rows: 3,
    placeholder: "Replacement: matching line; empty means remove",
  });
  const preview = el("textarea", "", {
    rows: 7,
    readOnly: true,
    "aria-label": "Preview",
  });
  let proposed = null,
    base = "",
    history = [],
    last = input.value;
  input.addEventListener("input", () => {
    if (last !== input.value) {
      history.push(last);
      if (history.length > 30) history.shift();
      last = input.value;
    }
    proposed = null;
    apply.disabled = true;
    undo.disabled = !history.length;
  });
  const apply = button("Apply changes", () => {
    if (proposed === null || input.value !== base) return;
    setValue(input, proposed);
  });
  const undo = button("Undo last edit", () => {
    if (!history.length) return;
    const value = history.pop();
    last = value;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  apply.disabled = undo.disabled = true;
  document.querySelectorAll("[data-transform]").forEach((b) =>
    b.addEventListener(
      "click",
      (e) => {
        e.stopImmediatePropagation();
        e.preventDefault();
        base = input.value;
        const kind = b.dataset.transform;
        proposed =
          kind === "upper"
            ? base.toUpperCase()
            : kind === "lower"
              ? base.toLowerCase()
              : kind === "title"
                ? base
                    .toLowerCase()
                    .replace(/(^|[^\p{L}\p{N}])\p{L}/gu, (c) => c.toUpperCase())
                : base
                    .split("\n")
                    .map((l) => l.replace(/[\t ]+/g, " ").trim())
                    .join("\n")
                    .replace(/\n{3,}/g, "\n\n")
                    .trim();
        preview.value = proposed;
        apply.disabled = false;
      },
      true,
    ),
  );
  window.addEventListener("workspace-ready", () => {
    history = [];
    last = input.value;
    undo.disabled = true;
  });

  p.append(
    field("Operation", mode),
    row(field("Find", find), field("Replace with", replace)),
    button("Preview changes", () => {
      base = input.value;
      proposed = transformLines(
        base,
        mode.value,
        find.value
          .split("\n")
          .map((v, i) => [v, replace.value.split("\n")[i] || ""]),
      );
      if (proposed.length > 100000)
        throw Error("Use at most 100,000 characters.");
      preview.value = proposed;
      apply.disabled = false;
    }),
    preview,
    row(apply, undo),
  );
  [mode, find, replace].forEach((n) =>
    n.addEventListener("input", () => {
      proposed = null;
      apply.disabled = true;
    }),
  );
}
