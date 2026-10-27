// Dedicated coordinator; terminating it also asks the owned engine worker to stop.
importScripts("/vendor/papaparse.js");
let engine,
  db,
  connection,
  active = false;
const quote = (s) => '"' + String(s).replaceAll('"', '""') + '"';
async function init() {
  engine = await import("/vendor/data-analysis/engine.js");
  const worker = new Worker(
    "/vendor/data-analysis/duckdb-browser-eh.worker.js",
  );
  db = new engine.AsyncDuckDB(new engine.VoidLogger(), worker);
  await db.instantiate("/vendor/data-analysis/duckdb-eh.wasm");
  await db.open({
    path: ":memory:",
    maximumThreads: 1,
    query: { queryPollingInterval: 10 },
  });
  connection = await db.connect();
  for (const command of [
    "SET autoinstall_known_extensions=false",
    "SET autoload_known_extensions=false",
    "SET enable_external_access=false",
    "SET memory_limit='256MB'",
    "SET threads=1",
    "SET lock_configuration=true",
  ])
    await connection.query(command);
}
function parsed(text, json) {
  let headers,
    rows = [];
  if (json) {
    const data = JSON.parse(text);
    if (!Array.isArray(data) || data.length > 50000)
      throw Error("Use at most 50,000 rows with consistent columns.");
    const names = new Set();
    for (const item of data) {
      if (
        !item ||
        Array.isArray(item) ||
        typeof item !== "object" ||
        Object.values(item).some((v) => v !== null && typeof v === "object")
      )
        throw Error("Use a JSON array of flat objects.");
      for (const name of Object.keys(item)) {
        names.add(name);
        if (names.size > 200)
          throw Error("Use 1–200 unique non-empty columns.");
      }
    }
    headers = [...names];
    rows = data.map((item) => headers.map((h) => item[h] ?? null));
  } else {
    let failure = null;
    Papa.parse(text, {
      skipEmptyLines: "greedy",
      dynamicTyping: false,
      step(result, parser) {
        if (result.errors.some((x) => x.code !== "UndetectableDelimiter")) {
          failure = Error("The CSV is malformed.");
          parser.abort();
          return;
        }
        if (!headers) {
          headers = result.data;
          if (
            !headers.length ||
            headers.length > 200 ||
            headers.some((h) => !String(h).trim()) ||
            new Set(headers).size !== headers.length
          ) {
            failure = Error("Use 1–200 unique non-empty columns.");
            parser.abort();
          }
          return;
        }
        if (rows.length >= 50000 || result.data.length !== headers.length) {
          failure = Error("Use at most 50,000 rows with consistent columns.");
          parser.abort();
          return;
        }
        rows.push(result.data);
      },
    });
    if (failure) throw failure;
  }
  if (
    !headers?.length ||
    headers.length > 200 ||
    headers.some((x) => typeof x !== "string" || !x.trim()) ||
    new Set(headers).size !== headers.length
  )
    throw Error("Use 1–200 unique non-empty columns.");
  return { headers, rows };
}
async function importTables(files) {
  if (
    !files.length ||
    files.length > 5 ||
    files.reduce((n, f) => n + f.size, 0) > 25 * 1048576
  )
    throw Error("Choose up to five tables, totaling 25 MB.");
  const tables = [];
  for (const [i, file] of files.entries()) {
    const json = /\.json$/i.test(file.name),
      cap = json ? 5000000 : 10000000;
    if (file.size > cap)
      throw Error(json ? "JSON exceeds 5 MB." : "CSV exceeds 10 MB.");
    const t = parsed(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await file.arrayBuffer(),
        ),
        json,
      ),
      name = "input_" + (i + 1);
    const table = new engine.Table(
      Object.fromEntries(
        t.headers.map((h, c) => [
          h,
          engine.vectorFromArray(
            t.rows.map((r) => (r[c] == null ? null : String(r[c]))),
            new engine.Utf8(),
          ),
        ]),
      ),
    );
    await connection.insertArrowTable(table, { name, create: true });
    await connection.query(
      `CREATE VIEW table_${i + 1} AS SELECT * FROM ${name}`,
    );
    tables.push({
      name: "table_" + (i + 1),
      headers: t.headers,
      count: t.rows.length,
      fileIndex: i,
    });
  }
  return tables;
}
async function mapTables(mappings) {
  for (const map of mappings) {
    if (
      !/^table_[1-5]$/.test(map.name) ||
      !Number.isInteger(map.fileIndex) ||
      map.fileIndex < 0 ||
      map.fileIndex > 4 ||
      !map.columns.length ||
      map.columns.length > 200
    )
      throw Error("Invalid source mapping.");
    await connection.query(
      `CREATE OR REPLACE VIEW ${map.name} AS SELECT ${map.columns.map((c) => `${quote(c.from)} AS ${quote(c.to)}`).join(",")} FROM input_${map.fileIndex + 1}`,
    );
  }
}
async function query(sql) {
  if (sql.length > 100000)
    throw Error("SQL must be shorter than 100,000 characters.");
  const bytes = new TextEncoder().encode(sql),
    decode = new TextDecoder(),
    { offsets, types } = await db.tokenize(sql);
  const tokens = offsets
    .map((o, i) => ({
      offset: o,
      type: types[i],
      text: decode.decode(bytes.subarray(o, offsets[i + 1] ?? bytes.length)),
    }))
    .filter((x) => x.type !== engine.TokenType.COMMENT);
  if (
    !tokens[0] ||
    tokens[0].type !== engine.TokenType.KEYWORD ||
    !/^(SELECT|WITH)\b/i.test(tokens[0].text)
  )
    throw Error("Use one SELECT or WITH SELECT query.");
  const separators = tokens.filter(
    (t) => t.type === engine.TokenType.OPERATOR && t.text.startsWith(";"),
  );
  if (
    separators.length > 1 ||
    (separators.length === 1 && separators[0] !== tokens.at(-1))
  )
    throw Error("Use one SQL statement.");
  const source = separators.length
      ? decode.decode(bytes.subarray(0, separators[0].offset))
      : sql,
    wrapped = `SELECT * FROM (\n${source}\n) AS workshop_result LIMIT 50001`;
  await connection.query("BEGIN TRANSACTION READ ONLY");
  try {
    const check = await connection.prepare(wrapped);
    await check.close();
    const reader = await connection.send(wrapped, true);
    await reader.open();
    const headers = reader.schema.fields.map((f) => f.name),
      rows = [];
    if (headers.length > 200)
      throw Error("The result exceeds 200 columns. Select fewer columns.");
    let size = 0;
    for await (const batch of reader) {
      for (let r = 0; r < batch.numRows; r++) {
        if (rows.length >= 50000)
          throw Error("The result exceeds 50,000 rows. Narrow the query.");
        const row = headers.map((_, c) => {
          const v = batch.getChildAt(c).get(r);
          return typeof v === "bigint"
            ? v.toString()
            : v && typeof v === "object"
              ? String(v)
              : v;
        });
        size += new TextEncoder().encode(JSON.stringify(row)).length;
        if (size > 25 * 1048576)
          throw Error("The result exceeds 25 MB. Narrow the query.");
        rows.push(row);
      }
    }
    return { headers, rows };
  } finally {
    await connection.cancelSent().catch(() => {});
    await connection.query("ROLLBACK");
  }
}
onmessage = async ({ data }) => {
  if (data.kind === "cancel") {
    await connection?.cancelSent().catch(() => {});
    return;
  }
  if (data.kind === "dispose") {
    await db?.terminate();
    close();
    return;
  }
  if (active) return;
  active = true;
  try {
    let result;
    if (data.kind === "load") {
      await init();
      result = await importTables(data.files);
    } else if (data.kind === "map") {
      await mapTables(data.mappings);
      result = true;
    } else result = await query(data.sql);
    postMessage({ id: data.id, ok: true, result });
  } catch (e) {
    postMessage({ id: data.id, ok: false, error: e.message });
  } finally {
    active = false;
  }
};
