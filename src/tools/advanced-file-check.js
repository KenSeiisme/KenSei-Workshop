import { uiRender, uiMsg } from "../site/ui.js";
import { $, downloadText, status } from "./common.js";
import {
  el,
  panel,
  row,
  button,
  field,
  renderTable,
  csvText,
} from "./advanced-ui.js";
import { parseManifest, compareManifest } from "./check-manifest.js";
export function init() {
  const ctx = window.KenseiAdvancedContexts["file-check"],
    p = panel("Batch verification", $("#check-results")),
    input = el("input", "", {
      type: "file",
      accept: ".json,.txt,.sha256,.sha512",
    }),
    duplicates = el("input", "", { type: "checkbox" }),
    out = el("div");
  let expected = [],
    report = [];
  p.append(
    field("Import checksum manifest", input),
    field("Show duplicate groups only", duplicates),
    button("Download verification CSV", () =>
      downloadText(
        csvText([
          ["File", "Verification"],
          ...report.map((r) => [r.name, uiRender(uiMsg(r.state))]),
        ]),
        "kensei-verification.csv",
        "text/csv",
      ),
    ),
    out,
  );
  input.onchange = async () => {
    try {
      if (input.files[0].size > 1000000)
        throw Error("Use a checksum manifest up to 1 MB.");
      expected = parseManifest(await input.files[0].text());
      render();
    } catch (e) {
      status(e.message, true);
    }
  };
  function render() {
    report = compareManifest(expected, ctx.results);
    out.replaceChildren(
      renderTable(
        ["File", "Verification"],
        report.map((r) => [r.name, uiRender(uiMsg(r.state))]),
      ),
    );
    const groups = new Map();
    ctx.results.forEach((r) => {
      const k = r.size + ":" + r.sha256;
      groups.set(k, (groups.get(k) || 0) + 1);
    });
    [...$("#check-results").children].forEach((n, i) => {
      const r = ctx.results[i];
      n.hidden =
        duplicates.checked && (!r || groups.get(r.size + ":" + r.sha256) < 2);
    });
  }
  window.addEventListener("locale-change", render);
  duplicates.onchange = render;
  new MutationObserver(render).observe($("#check-results"), {
    childList: true,
  });
}
