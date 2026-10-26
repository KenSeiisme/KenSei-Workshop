import { uiMsg, uiRender } from "../site/ui.js";
import { $, status } from "./common.js";
import {
  el,
  panel,
  row,
  button,
  field,
  select,
  renderTable,
} from "./advanced-ui.js";
import { validateCue, serialize } from "./subtitle-core.js";
import { receiveHandoff } from "./handoff.js";
import { fileInput } from "./advanced-ui.js";
export function retimeCues(cues, a, b, c, d) {
  if (![a, b, c, d].every(Number.isFinite) || c <= a || d <= b)
    throw Error("Use two increasing source and target anchors.");
  const ratio = (d - b) / (c - a);
  return cues.map((cue) =>
    validateCue({
      ...cue,
      start: Math.round(b + (cue.start - a) * ratio),
      end: Math.round(b + (cue.end - a) * ratio),
    }),
  );
}
export function init() {
  const ctx = window.KenseiAdvancedContexts["subtitle-studio"],
    p = panel("Batch subtitle editing", $("#sub-list").closest("section")),
    pick = el("select", "", {
      multiple: true,
      size: 8,
      "aria-label": "Selected cues",
    }),
    preview = el("div"),
    sa = el("input", "", { type: "number", value: 0, min: 0 }),
    ta = el("input", "", { type: "number", value: 0, min: 0 }),
    sb = el("input", "", { type: "number", value: 60000, min: 0 }),
    tb = el("input", "", { type: "number", value: 60000, min: 0 }),
    split = el("input", "", { type: "number", min: 1, value: 1000 });
  let proposed = null,
    signature = "";
  function refresh() {
    const selected = new Set([...pick.selectedOptions].map((o) => o.value));
    pick.replaceChildren();
    for (const c of ctx.cues) {
      const option = new Option(
        c.start + "–" + c.end + " · " + c.text.slice(0, 60),
        c.id,
      );
      option.selected = selected.has(c.id);
      pick.add(option);
    }
    const rows = ctx.cues.map((c, i) => [
      i + 1,
      ([...c.text].length / ((c.end - c.start) / 1000)).toFixed(1),
      c.end <= c.start || c.start < 0
        ? "Invalid"
        : ctx.cues.some((d, j) => j !== i && c.start < d.end && c.end > d.start)
          ? "Overlap"
          : [...c.text].length / ((c.end - c.start) / 1000) > 20
            ? "Fast reading"
            : "OK",
    ]);
    preview.replaceChildren(
      renderTable(
        ["Cue", "Characters / second", "Check"],
        rows.map((r) => [r[0], r[1], uiRender(uiMsg(r[2]))]),
      ),
    );
    proposed = null;
  }
  function chosen() {
    return ctx.cues.filter((c) =>
      [...pick.selectedOptions].some((o) => o.value === c.id),
    );
  }
  p.append(
    pick,
    row(
      button("Merge selected", () => {
        const list = chosen().sort((a, b) => a.start - b.start);
        if (list.length < 2) throw Error("Select at least two cues.");
        const merged = validateCue({
          id: list[0].id,
          start: list[0].start,
          end: Math.max(...list.map((c) => c.end)),
          text: list.map((c) => c.text).join("\n"),
        });
        ctx.replace([...ctx.cues.filter((c) => !list.includes(c)), merged]);
      }),
      field("Split at milliseconds", split),
      button("Split selected cue", () => {
        const list = chosen();
        if (list.length !== 1) throw Error("Select one cue to split.");
        const c = list[0],
          at = Number(split.value);
        if (at <= c.start || at >= c.end)
          throw Error("Split time must be inside the cue.");
        const chars = [...c.text],
          pos = Math.max(
            1,
            Math.min(
              chars.length - 1,
              Math.round((chars.length * (at - c.start)) / (c.end - c.start)),
            ),
          );
        if (chars.length < 2)
          throw Error("Use at least two text characters to split.");
        const parts = [
          validateCue({
            ...c,
            end: at,
            text: chars.slice(0, pos).join("").trim(),
          }),
          validateCue({
            ...c,
            id: crypto.randomUUID(),
            start: at,
            text: chars.slice(pos).join("").trim(),
          }),
        ];
        ctx.replace([...ctx.cues.filter((x) => x.id !== c.id), ...parts]);
      }),
    ),
    el("h3", "Two-anchor timing correction"),
    row(
      field("Source anchor 1 (ms)", sa),
      field("Target anchor 1 (ms)", ta),
      field("Source anchor 2 (ms)", sb),
      field("Target anchor 2 (ms)", tb),
    ),
    button("Preview corrected times", () => {
      proposed = retimeCues(
        ctx.cues,
        ...[sa, ta, sb, tb].map((n) => Number(n.value)),
      );
      serialize(proposed, "vtt");
      signature = JSON.stringify(ctx.cues);
      preview.replaceChildren(
        renderTable(
          ["Cue", "Before", "After"],
          ctx.cues.map((c, i) => [
            i + 1,
            c.start + "–" + c.end,
            proposed[i].start + "–" + proposed[i].end,
          ]),
        ),
      );
    }),
    button("Apply corrected times", () => {
      if (!proposed || signature !== JSON.stringify(ctx.cues))
        throw Error("Preview the current correction first.");
      ctx.replace(proposed);
    }),
    preview,
  );
  for (const input of [sa, ta, sb, tb]) input.oninput = () => (proposed = null);
  new MutationObserver(refresh).observe($("#sub-list"), { childList: true });
  refresh();
  receiveHandoff(
    "subtitle-studio",
    (payload) => {
      const input = $("#sub-video-file");
      input.files = fileInput(payload.files);
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    () => !!$("#sub-video").getAttribute("src"),
  );
}
