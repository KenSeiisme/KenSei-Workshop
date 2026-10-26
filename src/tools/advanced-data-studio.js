import { $, downloadText, copy, status } from "./common.js";
import {
  el,
  panel,
  row,
  button,
  field,
  select,
  csvText,
  copyText,
} from "./advanced-ui.js";
import { sendControl } from "./handoff.js";
import { uiMsg, uiText, uiConfirm } from "../site/ui.js";
const rawCSV = (t) =>
  [t.headers, ...t.rows]
    .map((r) =>
      r.map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(","),
    )
    .join("\r\n");
export function init() {
  const ctx = window.KenseiAdvancedContexts["data-studio"],
    p = panel("Table editing and export", $("#data-table").closest("section")),
    query = el("input", "", { type: "search", placeholder: "Filter rows" }),
    column = el("select"),
    mode = select([
      ["original", "Original order"],
      ["text", "Text A–Z"],
      ["number", "Numeric ascending"],
    ]),
    columns = el("div", "", { class: "advanced-columns" }),
    summary = el("p"),
    jsonPanel = panel("JSON tree", $("#data-json").closest("section")),
    tree = el("div", "", { class: "advanced-list" });
  $("#data-json").closest("section").append(jsonPanel);
  jsonPanel.classList.remove("panel");
  jsonPanel.style.padding = "0";
  let known = null,
    visible = [],
    rows = [];
  p.append(
    row(
      field("Filter all columns", query),
      field("Sort column", column),
      field("Order", mode),
    ),
    columns,
    summary,
    row(
      button("Remove exact duplicate rows", () => {
        if (!ctx.table) return;
        if (!uiConfirm(uiMsg("Remove duplicate rows from the full table?")))
          return;
        const seen = new Set();
        ctx.table.rows = ctx.table.rows.filter((r) => {
          const key = JSON.stringify(r);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        sync();
        render();
      }),
      button("Download current view CSV", () => {
        if (!ctx.table) throw Error("Preview a CSV table first.");
        if (!visible.length) throw Error("Select table columns first.");
        downloadText(
          csvText([selectedHeaders(), ...selectedRows()]),
          "kensei-table-view.csv",
          "text/csv",
        );
      }),
    ),
  );
  function selectedHeaders() {
    return visible.map((i) => ctx.table.headers[i]);
  }
  function selectedRows() {
    return rows.map((r) => visible.map((i) => r.values[i]));
  }
  function sync() {
    const text = rawCSV(ctx.table);
    if (new TextEncoder().encode(text).length > 10000000)
      throw Error("CSV exceeds 10 MB.");
    $("#data-csv").value = text;
    $("#data-csv").dispatchEvent(new Event("input", { bubbles: true }));
    window.dispatchEvent(new Event("tool-content-changed"));
  }
  function render() {
    const t = ctx.table,
      target = $("#data-table");
    if (!t) {
      target.replaceChildren();
      return;
    }
    if (t !== known) {
      known = t;
      visible = t.headers.map((_, i) => i);
      query.value = "";
      mode.value = "original";
      column.replaceChildren(
        ...t.headers.map((name, i) =>
          el("option", "", { value: i, textContent: name }),
        ),
      );
      columns.replaceChildren();
      t.headers.forEach((name, i) => {
        const check = el("input", "", { type: "checkbox", checked: true });
        check.onchange = () => {
          visible = [...columns.querySelectorAll("input")].flatMap((n, j) =>
            n.checked ? [j] : [],
          );
          ctx.page = 0;
          render();
        };
        const caption = el("label");
        caption.textContent = name;
        caption.append(check);
        columns.append(caption);
      });
    }
    rows = t.rows
      .map((values, index) => ({ values, index }))
      .filter(
        (r) =>
          !query.value ||
          r.values.some((v) =>
            String(v).toLowerCase().includes(query.value.toLowerCase()),
          ),
      );
    if (mode.value !== "original") {
      const c = +column.value;
      rows.sort((a, b) => {
        if (mode.value === "number") {
          const x = a.values[c].trim() === "" ? NaN : Number(a.values[c]),
            y = b.values[c].trim() === "" ? NaN : Number(b.values[c]);
          return (
            (Number.isFinite(x) && Number.isFinite(y)
              ? x - y
              : Number.isFinite(x)
                ? -1
                : Number.isFinite(y)
                  ? 1
                  : 0) || a.index - b.index
          );
        }
        return (
          a.values[c].localeCompare(b.values[c], "en", { numeric: false }) ||
          a.index - b.index
        );
      });
    }
    ctx.page = Math.max(0, Math.min(ctx.page, Math.ceil(rows.length / 50) - 1));
    uiText(
      $("#data-page"),
      uiMsg("{0} / {1} · {2} rows", [
        ctx.page + 1,
        Math.max(1, Math.ceil(rows.length / 50)),
        rows.length,
      ]),
    );
    $("#data-prev").disabled = ctx.page === 0;
    $("#data-next").disabled = (ctx.page + 1) * 50 >= rows.length;
    uiText(
      summary,
      uiMsg(
        "Export preview: {0} rows × {1} columns. Original values remain strings.",
        [rows.length, visible.length],
      ),
    );
    const table = el("table", "", { class: "data-table" }),
      tr = el("tr"),
      head = el("thead"),
      body = el("tbody");
    visible.forEach((c) => {
      const th = el("th");
      th.textContent = t.headers[c];
      tr.append(th);
    });
    head.append(tr);
    for (const r of rows.slice(ctx.page * 50, ctx.page * 50 + 50)) {
      const tr = el("tr");
      visible.forEach((c) => {
        const td = el("td"),
          n = el("input", "", { value: r.values[c], type: "text" });
        n.setAttribute("aria-label", t.headers[c] + " " + (r.index + 1));
        n.onchange = () => {
          const old = r.values[c];
          try {
            r.values[c] = n.value;
            sync();
            render();
          } catch (e) {
            r.values[c] = old;
            n.value = old;
            status(e.message, true);
          }
        };
        td.append(n);
        tr.append(td);
      });
      body.append(tr);
    }
    table.append(head, body);
    target.replaceChildren(table);
  }
  for (const n of [query, column, mode])
    n.oninput = () => {
      ctx.page = 0;
      render();
    };
  ctx.useRenderer(render);
  render();
  jsonPanel.append(
    button("Build JSON tree", () => {
      const text = $("#data-json").value;
      if (new TextEncoder().encode(text).length > 5000000)
        throw Error("JSON exceeds 5 MB.");
      const value = JSON.parse(text);
      tree.replaceChildren();
      branch(value, "", tree, 0);
    }),
    tree,
  );
  function branch(value, path, parent, depth) {
    if (depth > 100) throw Error("JSON nesting exceeds 100 levels.");
    const object = value !== null && typeof value === "object",
      node = el(object ? "details" : "div");
    const title = el(object ? "summary" : "span");
    title.textContent =
      (path || "/") +
      " · " +
      (object
        ? Array.isArray(value)
          ? "[" + value.length + "]"
          : "{" + Object.keys(value).length + "}"
        : JSON.stringify(value));
    node.append(
      title,
      button("Copy path", () => copyText(path, node)),
    );
    if (object) {
      let built = false;
      node.ontoggle = () => {
        if (!node.open || built) return;
        built = true;
        const keys = Object.keys(value);
        let at = 0;
        const children = el("div");
        children.style.paddingInlineStart = "16px";
        const more = button("Load more", () => append());
        function append() {
          more.remove();
          const end = Math.min(keys.length, at + 100);
          for (; at < end; at++) {
            const k = keys[at];
            branch(
              value[k],
              path + "/" + k.replaceAll("~", "~0").replaceAll("/", "~1"),
              children,
              depth + 1,
            );
          }
          if (at < keys.length) children.append(more);
        }
        append();
        node.append(children);
      };
    }
    parent.append(node);
  }
  sendControl(
    p,
    () =>
      ctx.table
        ? {
            kind: "files",
            files: [
              new File(
                [rawCSV({ headers: selectedHeaders(), rows: selectedRows() })],
                "data.csv",
                { type: "text/csv" },
              ),
            ],
          }
        : null,
    ["flashcards"],
  );
  window.KenseiDataView = () =>
    ctx.table ? { headers: selectedHeaders(), rows: selectedRows() } : null;
}
