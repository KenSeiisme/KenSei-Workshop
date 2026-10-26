import "./calculator-sheet-core.js";
import { $, status } from "./common.js";
import {
  el,
  panel,
  row,
  button,
  field,
  copyText,
  renderTable,
} from "./advanced-ui.js";
import { uiMsg, uiText, uiError } from "../site/ui.js";
export function init() {
  const p = panel(
      "Calculation sheet",
      $("#calc-expression").closest("section"),
    ),
    source = el("textarea", "", {
      rows: 8,
      maxLength: 20000,
      placeholder: "price = 12.50\nquantity = 3\nprice * quantity",
    }),
    out = el("div"),
    vars = el("p");
  let variables = {},
    worker,
    timer,
    epoch = 0,
    result = "";
  function stop() {
    epoch++;
    worker?.terminate();
    worker = null;
    clearTimeout(timer);
    run.disabled = false;
  }
  const run = button(
    "Calculate lines",
    () => {
      stop();
      const token = epoch;
      run.disabled = true;
      worker = new Worker("/tool-scripts/calculator-sheet-worker.js", {
        type: "module",
      });
      timer = setTimeout(() => {
        stop();
        status(
          uiMsg("Calculation stopped. Simplify the sheet and retry."),
          true,
        );
      }, 10000);
      worker.onmessage = ({ data }) => {
        if (token !== epoch) return;
        if (data.type === "ready") {
          clearTimeout(timer);
          timer = setTimeout(() => {
            stop();
            status(
              uiMsg("Calculation stopped. Simplify the sheet and retry."),
              true,
            );
          }, 2000);
          worker.postMessage({
            source: source.value,
            mode: $("#calc-angle").value,
            variables,
          });
          return;
        }
        stop();
        if (!data.ok) {
          status(uiError(data.error), true);
          return;
        }
        variables = data.variables;
        out.replaceChildren(
          renderTable(
            ["Line", "Expression", "Result"],
            data.rows.map((r) => [
              r.line,
              r.expression,
              r.error
                ? window.KenseiI18n.render(uiError(r.error))
                : (r.approx ? "≈ " : "") + r.result,
            ]),
          ),
        );
        vars.textContent = Object.entries(variables)
          .map(([k, v]) => k + " = " + v)
          .join(" · ");
        result = data.rows
          .map(
            (r) =>
              r.line +
              ". " +
              r.expression +
              " = " +
              (r.error ? window.KenseiI18n.render(uiError(r.error)) : r.result),
          )
          .join("\n");
      };
      worker.onerror = () => {
        stop();
        status(
          uiMsg("Calculator files could not load. Retry when connected."),
          true,
        );
      };
    },
    true,
  );
  p.append(
    field("Expressions and page-only variables", source),
    row(
      run,
      button("Cancel", stop),
      button("Clear page variables", () => {
        stop();
        variables = {};
        vars.textContent = "";
      }),
      button("Copy expressions and results", () => copyText(result, p)),
    ),
    vars,
    out,
  );
  source.oninput = () => {
    stop();
    result = "";
    out.replaceChildren(el("p", "Inputs changed. Calculate again."));
  };
  window.addEventListener("pagehide", stop);
}
