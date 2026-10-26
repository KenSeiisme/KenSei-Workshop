import { uiError } from "../site/ui.js";
import { $, library, downloadText } from "./common.js";
import { el, panel, row, button, field, csvText } from "./advanced-ui.js";
export function init() {
  const ctx = window.KenseiAdvancedContexts["decision-studio"],
    p = panel(
      "Choice weights and CSV",
      $("#decision-options").closest("section"),
    ),
    weights = el("div"),
    file = el("input", "", { type: "file", accept: ".csv" });
  let cache = new Map();
  function render() {
    const list = ctx.options(),
      active = ctx.weights();
    weights.replaceChildren();
    list.forEach((label, i) => {
      const input = el("input", "", {
          type: "number",
          min: 1,
          max: 100,
          step: 1,
          value: active[i] || 1,
        }),
        l = el("label");
      l.textContent = label;
      l.append(input);
      input.oninput = () => {
        const value = Number(input.value);
        ctx.setWeight(label, value);
      };
      weights.append(l);
    });
  }
  p.append(
    el("p", "Weights apply to wheel and random draw. Groups remain balanced."),
    weights,
    field("Import option / weight CSV", file),
    button("Export choice CSV", () =>
      downloadText(
        csvText([
          ["option", "weight"],
          ...ctx.options().map((label, i) => [label, ctx.weights()[i]]),
        ]),
        "choices.csv",
        "text/csv",
      ),
    ),
  );
  file.onchange = async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      if (f.size > 1000000) throw Error("Import files up to 1 MB.");
      const Papa = await library("papaparse.js", "Papa"),
        data = Papa.parse(await f.text(), {
          header: true,
          skipEmptyLines: "greedy",
          dynamicTyping: false,
        });
      if (
        data.errors.some((e) => e.code !== "UndetectableDelimiter") ||
        !data.meta.fields?.includes("option")
      )
        throw Error("CSV needs an option column and optional weight column.");
      ctx.importOptions(
        data.data.map((r) => r.option),
        data.data.map((r) =>
          r.weight === "" || r.weight === undefined ? 1 : Number(r.weight),
        ),
      );
      render();
    } catch (e) {
      window.KenseiWorkspace.toast(uiError(e));
    }
  };
  window.addEventListener("decision-opened", render);
  $("#decision-options").addEventListener("input", render);
  render();
}
