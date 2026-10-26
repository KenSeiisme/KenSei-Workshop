import { uiText, uiMsg, uiJoin } from "../site/ui.js";
import { $, downloadText } from "./common.js";
import {
  el,
  panel,
  row,
  button,
  field,
  select,
  csvText,
  fileInput,
} from "./advanced-ui.js";
import { receiveHandoff } from "./handoff.js";
export function init() {
  const ctx = window.KenseiAdvancedContexts["file-renamer"],
    p = panel("Ordered rename rules", $("#rename-preview").closest("section")),
    type = select([
      ["prefix", "Prefix"],
      ["suffix", "Suffix"],
      ["replace", "Replace"],
      ["lower", "Lowercase"],
      ["upper", "Uppercase"],
      ["template", "Name template"],
    ]),
    find = el("input", "", { placeholder: "Find" }),
    value = el("input", "", {
      placeholder: "Value or {original}_{n:03}_{date}",
    }),
    list = el("div"),
    rules = (window.KenseiRenameRules = []);
  p.append(
    row(field("Rule", type), field("Find", find), field("Value", value)),
    button("Add rule", () => {
      if (rules.length >= 20) throw Error("Use at most 20 rename rules.");
      rules.push({ type: type.value, find: find.value, value: value.value });
      render();
      ctx.changed();
    }),
    el(
      "p",
      "Templates: {name}, {original}, {n:03}, {date}. Dates use file modification time in this device timezone.",
    ),
    list,
    button("Download name mapping CSV", () =>
      downloadText(
        csvText([
          ["Before", "After"],
          ...ctx.preview.map((r) => [r.original, r.name]),
        ]),
        "kensei-name-map.csv",
        "text/csv",
      ),
    ),
  );
  function render() {
    list.replaceChildren();
    rules.forEach((r, i) => {
      const n = el("div");
      uiText(
        n,
        uiJoin([
          i + 1,
          ". ",
          uiMsg(
            {
              prefix: "Prefix",
              suffix: "Suffix",
              replace: "Replace",
              lower: "Lowercase",
              upper: "Uppercase",
              template: "Name template",
            }[r.type],
          ),
          " ",
          r.value,
        ]),
      );
      n.append(
        ...[-1, 1].map((d) =>
          button(d < 0 ? "↑" : "↓", () => {
            const j = i + d;
            if (j < 0 || j >= rules.length) return;
            [rules[i], rules[j]] = [rules[j], rules[i]];
            render();
            ctx.changed();
          }),
        ),
        button("Remove", () => {
          rules.splice(i, 1);
          render();
          ctx.changed();
        }),
      );
      list.append(n);
    });
  }
  receiveHandoff(
    "file-renamer",
    (p) => {
      const n = $("#rename-files");
      n.files = fileInput(p.files);
      n.dispatchEvent(new Event("change"));
    },
    () => ctx.files.length > 0,
  );
}
