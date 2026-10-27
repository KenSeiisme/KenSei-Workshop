import {
  el,
  field,
  row,
  button as baseButton,
  select,
  renderTable,
  csvText,
} from "./advanced-ui.js";
import { recipeControls, workspaceTabs } from "./studio-recipes.js";
import { downloadText } from "./common.js";
import { sendControl } from "./handoff.js";
import { visualSQL, validateAnalysisRecipe } from "./data-analysis-core.js";
import { uiMsg, uiText, uiConfirm } from "../site/ui.js";
export async function init() {
  const action = (label, fn, primary = false) =>
    baseButton(
      label,
      async () => {
        try {
          await fn();
        } catch (e) {
          uiText(status, uiMsg(e.message));
        }
      },
      primary,
    );
  const root = document.querySelector("[data-tool]"),
    normal = el("div", "", { id: "data-convert-workspace" }),
    pane = el("section", "", {
      class: "panel tool-form",
      id: "data-analyze-workspace",
    });
  const old = [...root.children].filter((n) =>
    n.matches(".studio-grid,.advanced-panel,.daily-history,.job-status"),
  );
  if (!old.length) return;
  old[0].before(normal);
  old.forEach((n) => normal.append(n));
  root.append(pane);
  workspaceTabs(root, [
    ["JSON / CSV", normal],
    ["Analyze", pane],
  ]);
  let files = [],
    tables = [],
    worker = null,
    sequence = 0,
    generation = 0,
    pending = new Map(),
    custom = false,
    result = null,
    resultPage = 0,
    dirty = true,
    mapped = true,
    recipeSlots = null,
    filters = [],
    mappings = [];
  const input = el("input", "", {
      type: "file",
      multiple: true,
      accept: ".csv,.json",
      id: "analyze-files",
    }),
    status = el(
      "p",
      "Choose up to five CSV or flat JSON tables. The SQL engine loads only in Analyze.",
      { role: "status", id: "analyze-status" },
    ),
    tableList = el("div"),
    source = select([]),
    second = select([]),
    join = select([
      ["none", "No join"],
      ["inner", "Inner join"],
      ["left", "Left join"],
    ]),
    leftKey = select([]),
    rightKey = select([]),
    columns = el("select", "", {
      multiple: true,
      size: 5,
      "aria-label": "Result columns",
    }),
    groups = el("select", "", {
      multiple: true,
      size: 4,
      "aria-label": "Group columns",
    }),
    aggregate = select([
      ["none", "No aggregation"],
      ["count", "Count"],
      ["sum", "Sum"],
      ["avg", "Average"],
      ["min", "Minimum"],
      ["max", "Maximum"],
    ]),
    measure = select([]),
    numeric = el("input", "", { type: "checkbox" }),
    pivot = el("input", "", { type: "checkbox" }),
    pivotColumn = select([]),
    pivotValues = el("input", "", { placeholder: "A,B,C", maxLength: 5000 }),
    sort = select([["", "Original order"]]),
    sortNumeric = el("input", "", { type: "checkbox" }),
    desc = el("input", "", { type: "checkbox" }),
    filterColumn = select([]),
    filterOp = select([
      ["=", "Equals"],
      ["!=", "Not equal"],
      ["contains", "Contains"],
      [">", "Greater than"],
      ["<", "Less than"],
      [">=", "At least"],
      ["<=", "At most"],
      ["is null", "Is null"],
    ]),
    filterValue = el("input", "", { maxLength: 5000 }),
    filterNumeric = el("input", "", { type: "checkbox" }),
    filterList = el("div"),
    sql = el("textarea", "", {
      rows: 9,
      maxLength: 100000,
      spellcheck: false,
      id: "analyze-sql",
    }),
    sqlMode = el("p", "Visual SQL", { class: "muted small" }),
    mappingBox = el("details"),
    output = el("div"),
    pager = el("span"),
    exports = el("div");
  mappingBox.append(el("summary", "Source slot mapping"));
  const choose = (s, items, keep = true) => {
    const value = s.value;
    s.replaceChildren(
      ...items.map(([v, t]) => {
        const o = el("option", "", { value: v });
        o.textContent = t;
        return o;
      }),
    );
    if (keep && items.some((x) => x[0] === value)) s.value = value;
  };
  const selected = (s) => [...s.selectedOptions].map((x) => x.value),
    setSelected = (s, v) =>
      [...s.options].forEach((o) => (o.selected = (v || []).includes(o.value)));
  function config() {
    return {
      source: source.value,
      second: second.value,
      join: join.value,
      leftKey: leftKey.value,
      rightKey: rightKey.value,
      columns: selected(columns),
      groups: selected(groups),
      aggregate: aggregate.value,
      measure: measure.value,
      numeric: numeric.checked,
      pivot: pivot.checked,
      pivotColumn: pivotColumn.value,
      pivotValues: pivotValues.value,
      sort: sort.value,
      sortNumeric: sortNumeric.checked,
      desc: desc.checked,
      filters: structuredClone(filters),
    };
  }
  function stale() {
    dirty = true;
    exports.dataset.stale = "true";
    uiText(
      status,
      uiMsg(
        result
          ? "Settings changed. Run the query again before exporting."
          : "Ready. Review the SQL, then run.",
      ),
    );
  }
  function populate() {
    const slots = recipeSlots || tables;
    choose(
      source,
      slots.map((t) => [t.name, t.name]),
    );
    choose(
      second,
      slots.map((t) => [t.name, t.name]),
    );
    if (second.value === source.value && slots.length > 1)
      second.value = slots.find((t) => t.name !== source.value).name;
    const first = slots.find((t) => t.name === source.value),
      next = slots.find((t) => t.name === second.value);
    choose(
      leftKey,
      (first?.headers || []).map((h) => [h, h]),
    );
    choose(
      rightKey,
      (next?.headers || []).map((h) => [h, h]),
    );
    const values = [
      ...(first?.headers || []).map((h) => ["a." + h, "a · " + h]),
      ...(join.value !== "none"
        ? (next?.headers || []).map((h) => ["b." + h, "b · " + h])
        : []),
    ];
    for (const s of [columns, groups, measure, pivotColumn, filterColumn])
      choose(s, values);
    choose(sort, [["", "Original order"], ...values, ["metric", "metric"]]);
  }
  function build(force = false) {
    if (custom && !force) return;
    if (!tables.length) return;
    sql.value = visualSQL(config());
    custom = false;
    uiText(sqlMode, uiMsg("Visual SQL"));
  }
  source.onchange =
    second.onchange =
    join.onchange =
      () => {
        populate();
        build();
        stale();
      };
  const builder = el("div", "", { class: "analysis-builder" });
  builder.append(
    row(
      field("Source table", source),
      field("Table join", join),
      field("Second table", second),
    ),
    row(field("Left join key", leftKey), field("Right join key", rightKey)),
    row(
      field("Result columns · empty selects all", columns),
      field("Group columns", groups),
    ),
    row(
      field("Aggregate", aggregate),
      field("Measure column", measure),
      field("Convert measure to number", numeric),
    ),
    row(
      field("Pivot", pivot),
      field("Pivot column", pivotColumn),
      field("Pivot values · comma separated", pivotValues),
    ),
    row(
      field("Filter column", filterColumn),
      field("Operator", filterOp),
      field("Filter value", filterValue),
      field("Numeric filter", filterNumeric),
    ),
    action("Add filter", () => {
      filters.push({
        column: filterColumn.value,
        op: filterOp.value,
        value: filterValue.value,
        numeric: filterNumeric.checked,
      });
      drawFilters();
      build();
      stale();
    }),
    filterList,
    row(
      field("Sort", sort),
      field("Numeric sort", sortNumeric),
      field("Descending", desc),
    ),
    action("Generate SQL from builder", () => {
      if (
        custom &&
        !uiConfirm(
          uiMsg("Replace the custom SQL with the visual configuration?"),
        )
      )
        return;
      build(true);
      stale();
    }),
  );
  builder.addEventListener("change", (e) => {
    if (![source, second, join].includes(e.target)) {
      build();
      stale();
    }
  });
  function drawFilters() {
    filterList.replaceChildren(
      ...filters.map((f, i) => {
        const line = el("div");
        line.textContent = f.column + " " + f.op + " " + f.value;
        line.append(
          action("Remove filter", () => {
            filters.splice(i, 1);
            drawFilters();
            build();
            stale();
          }),
        );
        return line;
      }),
    );
  }
  sql.oninput = () => {
    custom = true;
    uiText(
      sqlMode,
      uiMsg("Custom SQL · visual settings will not overwrite it"),
    );
    stale();
  };
  const run = action("Run query", () => execute(), true),
    cancel = action("Cancel query", () =>
      cancelQuery(
        "Query cancelled. Sources and the previous result are retained.",
      ),
    );
  cancel.hidden = true;
  const preview = el("section", "", { class: "analysis-result" });
  preview.append(
    el("h3", "Query result"),
    row(
      action("Previous", () => {
        resultPage = Math.max(0, resultPage - 1);
        drawResult();
      }),
      pager,
      action("Next", () => {
        if (result)
          resultPage = Math.max(
            0,
            Math.min(Math.ceil(result.rows.length / 50) - 1, resultPage + 1),
          );
        drawResult();
      }),
    ),
    output,
    exports,
  );
  const queryPane = el("section");
  queryPane.append(
    builder,
    field("SQL · SELECT or WITH SELECT only", sql),
    sqlMode,
    row(run, cancel),
  );
  pane.append(
    el("h2", "Analyze locally"),
    field("Tables · 25 MB combined", input),
    status,
    tableList,
    mappingBox,
    queryPane,
    preview,
  );
  workspaceTabs(
    pane,
    [
      ["Build & SQL", queryPane],
      ["Results", preview],
    ],
    { mobile: true },
  );
  exports.append(
    row(
      action("Download result CSV", () =>
        downloadText(
          csvText([fresh().headers, ...fresh().rows]),
          "analysis.csv",
          "text/csv;charset=utf-8",
        ),
      ),
      action("Download result JSON", () =>
        downloadText(
          JSON.stringify(
            fresh().rows.map((r) =>
              Object.fromEntries(fresh().headers.map((h, i) => [h, r[i]])),
            ),
            null,
            2,
          ),
          "analysis.json",
          "application/json",
        ),
      ),
    ),
  );
  sendControl(
    exports,
    () => ({
      kind: "files",
      files: [
        new File(
          [csvText([fresh().headers, ...fresh().rows])],
          "analysis.csv",
          { type: "text/csv" },
        ),
      ],
    }),
    ["flashcards"],
  );
  function fresh() {
    if (!result || dirty)
      throw Error("Run the current query before exporting.");
    return result;
  }
  function drawResult() {
    output.replaceChildren();
    if (!result) {
      output.append(el("p", "No query result yet."));
      return;
    }
    output.append(
      renderTable(
        result.headers,
        result.rows.slice(resultPage * 50, resultPage * 50 + 50),
      ),
    );
    pager.textContent = `${result.rows.length} × ${result.headers.length} · ${resultPage + 1}/${Math.max(1, Math.ceil(result.rows.length / 50))}`;
  }
  function stopWorker(reason) {
    const message =
      typeof reason === "string"
        ? reason
        : "Query cancelled. Sources and the previous result are retained.";
    const old = worker;
    worker = null;
    generation++;
    if (old) {
      old.postMessage({ kind: "dispose" });
      setTimeout(() => old.terminate(), 100);
    }
    for (const promise of pending.values()) {
      clearTimeout(promise.timer);
      promise.reject(Error(message));
    }
    pending.clear();
  }
  function cancelQuery(message) {
    stopWorker(message);
    run.disabled = false;
    cancel.hidden = true;
    uiText(status, uiMsg(message));
  }
  function request(kind, data = {}, timeout = 30000) {
    if (pending.size)
      return Promise.reject(
        Error("Wait for the current operation or cancel it first."),
      );
    if (!worker) {
      worker = new Worker("/tool-scripts/data-analysis-worker.js");
      const epoch = generation;
      worker.onmessage = (e) => {
        if (epoch !== generation) return;
        const job = pending.get(e.data.id);
        if (!job) return;
        pending.delete(e.data.id);
        clearTimeout(job.timer);
        e.data.ok
          ? job.resolve(e.data.result)
          : job.reject(Error(e.data.error));
      };
      worker.onerror = (e) => {
        e.preventDefault();
        stopWorker("The analysis engine could not load. Retry.");
        uiText(status, uiMsg("The analysis engine could not load. Retry."));
      };
    }
    return new Promise((resolve, reject) => {
      const id = ++sequence,
        timer = setTimeout(
          () =>
            cancelQuery(
              "The query exceeded 30 seconds. Narrow the query and retry.",
            ),
          timeout,
        );
      pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, kind, ...data });
    });
  }
  let acceptedFiles = [],
    importSequence = 0;
  async function load() {
    if (!files.length) throw Error("Choose source files first.");
    stopWorker();
    const epoch = generation;
    run.disabled = true;
    cancel.hidden = false;
    uiText(status, uiMsg("Loading the local SQL engine and source tables…"));
    try {
      const loaded = await request("load", { files }, 90000);
      if (epoch !== generation) return;
      tables = loaded;
      acceptedFiles = [...files];
      tableList.replaceChildren(
        ...tables.map((t, i) => {
          const n = el("p");
          n.textContent = `${t.name}: ${files[i].name} · ${t.count} × ${t.headers.length}`;
          return n;
        }),
      );
      populate();
      if (recipeSlots) {
        mapped = false;
        drawMapping();
      } else {
        mapped = true;
        build();
      }
      stale();
    } catch (e) {
      if (epoch === generation) stopWorker(e.message);
      throw e;
    } finally {
      if (epoch === generation || (!worker && !pending.size)) {
        run.disabled = false;
        cancel.hidden = true;
      }
    }
  }
  input.onchange = async () => {
    const next = [...input.files];
    if (!next.length) return;
    const token = ++importSequence;
    try {
      if (
        next.length > 5 ||
        next.reduce((n, f) => n + f.size, 0) > 25 * 1048576
      )
        throw Error("Choose up to five tables, totaling 25 MB.");
      files = next;
      stale();
      await load();
    } catch (e) {
      if (token === importSequence) {
        files = acceptedFiles;
        input.value = "";
        uiText(status, uiMsg(e.message));
      }
    }
  };
  function drawMapping() {
    mappingBox.replaceChildren(el("summary", "Source slot mapping"));
    const selections = [];
    for (const slot of recipeSlots || []) {
      const group = el("div"),
        fileSelect = select(
          tables.map((t, i) => [String(i), files[i].name]),
          String(
            Math.max(
              0,
              tables.findIndex((t) => t.name === slot.name),
            ),
          ),
        ),
        columnsBox = el("div"),
        entry = { slot, fileSelect, columns: [] };
      group.append(field(slot.name, fileSelect), columnsBox);
      const draw = () => {
        columnsBox.replaceChildren();
        entry.columns = slot.headers.map((h) => {
          const options = tables[+fileSelect.value]?.headers || [],
            s = select(
              [["", "Choose a source column"], ...options.map((x) => [x, x])],
              options.includes(h) ? h : "",
            );
          const label = el("label");
          label.textContent = h;
          s.onchange = () => {
            mapped = false;
            stale();
          };
          label.append(s);
          columnsBox.append(label);
          return { to: h, input: s };
        });
      };
      fileSelect.onchange = () => {
        mapped = false;
        draw();
        stale();
      };
      draw();
      selections.push(entry);
      mappingBox.append(group);
    }
    mappingBox.append(
      action("Confirm source mapping", async () => {
        mappings = selections.map((e) => ({
          name: e.slot.name,
          fileIndex: +e.fileSelect.value,
          columns: e.columns.map((c) => {
            if (!c.input.value)
              throw Error("Map every recipe column before running.");
            return { from: c.input.value, to: c.to };
          }),
        }));
        await request("map", { mappings });
        mapped = true;
        stale();
        mappingBox.open = false;
        uiText(
          status,
          uiMsg("Source mapping confirmed. Review the query, then run."),
        );
      }),
    );
    mappingBox.open = true;
  }
  async function execute() {
    let epoch = generation;
    run.disabled = true;
    cancel.hidden = false;
    try {
      if (!worker) {
        await load();
        if (recipeSlots) {
          mapped = false;
          throw Error("Confirm source mapping after reloading the engine.");
        }
      }
      if (!mapped) throw Error("Confirm source mapping before running.");
      epoch = generation;
      run.disabled = true;
      cancel.hidden = false;
      uiText(status, uiMsg("Running in a read-only local database…"));
      const statement = sql.value;
      const value = await request("query", { sql: statement });
      if (generation !== epoch) return;
      result = value;
      resultPage = 0;
      if (statement !== sql.value) {
        dirty = true;
        drawResult();
        uiText(
          status,
          uiMsg("Settings changed. Run the query again before exporting."),
        );
        return;
      }
      dirty = false;
      delete exports.dataset.stale;
      drawResult();
      uiText(status, uiMsg("Query complete. No source data was changed."));
    } catch (e) {
      uiText(status, uiMsg(e.message));
    } finally {
      if (epoch === generation) {
        run.disabled = false;
        cancel.hidden = true;
      }
    }
  }
  recipeControls(
    pane,
    "data-studio",
    () =>
      validateAnalysisRecipe({
        slots: (recipeSlots || tables).map((t) => ({
          name: t.name,
          headers: t.headers,
        })),
        sql: sql.value,
        custom,
        config: config(),
      }),
    (s) => {
      recipeSlots = s.slots;
      sql.value = s.sql;
      custom = s.custom;
      populate();
      source.value = s.config.source;
      second.value = s.config.second;
      join.value = s.config.join;
      populate();
      for (const [k, n] of Object.entries({
        source,
        second,
        join,
        leftKey,
        rightKey,
        aggregate,
        measure,
        pivotColumn,
        pivotValues,
        sort,
      })) {
        n.value = s.config[k] ?? n.value;
      }
      setSelected(columns, s.config.columns);
      setSelected(groups, s.config.groups);
      for (const [k, n] of Object.entries({
        numeric,
        pivot,
        sortNumeric,
        desc,
      }))
        n.checked = !!s.config[k];
      filters = s.config.filters || [];
      drawFilters();
      mapped = false;
      drawMapping();
      stale();
    },
    validateAnalysisRecipe,
  );
  window.addEventListener("pagehide", stopWorker);
  drawResult();
}
