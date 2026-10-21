importScripts("/vendor/papaparse.js");
const bytes = (s) => new TextEncoder().encode(s).length;
function json(text) {
  if (bytes(text) > 5000000) throw Error("JSON exceeds 5 MB.");
  const data = JSON.parse(text);
  let nodes = 0,
    stack = [[data, 0]];
  while (stack.length) {
    const [value, depth] = stack.pop();
    if (depth > 100 || ++nodes > 500000)
      throw Error("This JSON is too deeply nested or complex.");
    if (value && typeof value === "object")
      for (const v of Object.values(value)) stack.push([v, depth + 1]);
  }
  return data;
}
function csv(text) {
  if (bytes(text) > 10000000) throw Error("CSV exceeds 10 MB.");
  let headers = null,
    rows = [],
    failure = null;
  const parsed = Papa.parse(text, {
    skipEmptyLines: "greedy",
    dynamicTyping: false,
    step(result, parser) {
      const errors = result.errors.filter(
        (e) => e.code !== "UndetectableDelimiter",
      );
      if (errors.length) {
        failure = Error("CSV is malformed: " + errors[0].message);
        parser.abort();
        return;
      }
      const row = result.data;
      if (!headers) {
        headers = row.map(String);
        if (
          headers.length > 200 ||
          headers.some((x) => !x.trim()) ||
          new Set(headers).size !== headers.length
        ) {
          failure = Error("Use at most 200 unique, non-empty column names.");
          parser.abort();
        }
        return;
      }
      if (row.length !== headers.length) {
        failure = Error(
          "A CSV row has a different number of fields from the header.",
        );
        parser.abort();
        return;
      }
      rows.push(row);
      if (rows.length > 50000) {
        failure = Error("CSV exceeds 50,000 data rows.");
        parser.abort();
      }
    },
  });
  if (failure) throw failure;
  if (!headers) throw Error("CSV needs a header row.");
  return { headers, rows };
}
const safeCsv = ({ headers, rows }) => ({
  text: Papa.unparse({ fields: headers, data: rows }, { escapeFormulae: true }),
  escaped: rows.reduce(
    (n, row) => n + row.filter((v) => /^[=+\-@\t\r]/.test(String(v))).length,
    0,
  ),
});
onmessage = async ({ data: job }) => {
  try {
    let text = job.text || "";
    if (job.file) {
      const cap = job.kind === "json" ? 5000000 : 10000000;
      if (job.file.size > cap)
        throw Error("File exceeds the " + cap / 1e6 + " MB limit.");
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        await job.file.arrayBuffer(),
      );
    }
    text = text.replace(/^\uFEFF/, "");
    let result = { action: job.action, source: text, kind: job.kind };
    if (job.kind === "json") {
      const data = json(text);
      if (job.action === "to-csv") {
        if (
          !Array.isArray(data) ||
          data.length > 50000 ||
          data.some(
            (row) =>
              !row ||
              Array.isArray(row) ||
              typeof row !== "object" ||
              Object.values(row).some(
                (v) => v !== null && typeof v === "object",
              ),
          )
        )
          throw Error(
            "JSON → CSV needs up to 50,000 flat objects, without nested values.",
          );
        const headers = [...new Set(data.flatMap((row) => Object.keys(row)))];
        if (
          !headers.length ||
          headers.length > 200 ||
          headers.some((x) => !x.trim())
        )
          throw Error("Use 1–200 non-empty column names.");
        const rows = data.map((row) =>
            headers.map((k) =>
              !Object.hasOwn(row, k) || row[k] === null ? "" : String(row[k]),
            ),
          ),
          output = safeCsv({ headers, rows });
        result = {
          ...result,
          text: output.text,
          escaped: output.escaped,
          table: { headers, rows },
        };
      } else
        result.text = JSON.stringify(
          data,
          null,
          job.action === "minify" ? 0 : 2,
        );
    } else {
      const table = csv(text);
      result.table = table;
      if (job.action === "to-json")
        result.text = JSON.stringify(
          table.rows.map((row) =>
            Object.fromEntries(table.headers.map((key, i) => [key, row[i]])),
          ),
          null,
          2,
        );
      else {
        const safe = safeCsv(table);
        result.text = safe.text;
        result.escaped = safe.escaped;
      }
    }
    if (result.text && bytes(result.text) > 30000000)
      throw Error("The output exceeds 30 MB. Use a smaller input.");
    postMessage({ ok: true, ...result });
  } catch (e) {
    postMessage({
      ok: false,
      error:
        e instanceof TypeError
          ? "Use a valid UTF-8 text file."
          : e.message || "This input could not be processed.",
    });
  }
};
