export const quoteName = (s) => '"' + String(s).replaceAll('"', '""') + '"';
export const quoteValue = (s) => "'" + String(s).replaceAll("'", "''") + "'";
export function visualSQL(c) {
  const a = "a",
    b = "b",
    col = (value) => {
      const [alias, ...rest] = value.split(".");
      if (!["a", "b"].includes(alias) || !rest.length)
        throw Error("Choose a column.");
      return alias + "." + quoteName(rest.join("."));
    };
  if (!/^table_[1-5]$/.test(c.source)) throw Error("Choose a source table.");
  let from = `${c.source} ${a}`;
  if (c.join !== "none") {
    if (
      !["inner", "left"].includes(c.join) ||
      !/^table_[1-5]$/.test(c.second) ||
      c.source === c.second
    )
      throw Error("Choose two different tables for a join.");
    from += ` ${c.join.toUpperCase()} JOIN ${c.second} ${b} ON a.${quoteName(c.leftKey)} = b.${quoteName(c.rightKey)}`;
  }
  const grouping = c.groups.map(col),
    conditions = c.filters.map((f) => {
      const x = col(f.column);
      if (f.op === "is null") return x + " IS NULL";
      if (f.op === "contains")
        return `${x} LIKE ${quoteValue("%" + f.value + "%")}`;
      if (!["=", "!=", ">", "<", ">=", "<="].includes(f.op))
        throw Error("Invalid filter operator.");
      return `${f.numeric ? `CAST(${x} AS DOUBLE)` : x} ${f.op} ${f.numeric ? numeric(f.value) : quoteValue(f.value)}`;
    });
  const aggregate = (condition = "") => {
    if (!["count", "sum", "avg", "min", "max"].includes(c.aggregate))
      throw Error("Choose an aggregate.");
    const value =
      c.aggregate === "count"
        ? "1"
        : c.numeric
          ? `CAST(${col(c.measure)} AS DOUBLE)`
          : col(c.measure);
    return condition
      ? c.aggregate === "count"
        ? `SUM(CASE WHEN ${condition} THEN 1 ELSE 0 END)`
        : `${c.aggregate.toUpperCase()}(CASE WHEN ${condition} THEN ${value} ELSE NULL END)`
      : c.aggregate === "count"
        ? "COUNT(*)"
        : `${c.aggregate.toUpperCase()}(${value})`;
  };
  let columns;
  if (c.pivot) {
    const values = [
      ...new Set(
        c.pivotValues
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    if (!values.length || values.length > 50)
      throw Error("Enter 1–50 pivot values.");
    columns = [
      ...grouping,
      ...values.map(
        (v) =>
          `${aggregate(`${col(c.pivotColumn)} = ${quoteValue(v)}`)} AS ${quoteName(v)}`,
      ),
    ];
  } else if (c.aggregate !== "none")
    columns = [...grouping, `${aggregate()} AS metric`];
  else
    columns = c.columns.length
      ? c.columns.map(col)
      : ["a.*", ...(c.join !== "none" ? ["b.*"] : [])];
  let sql = "SELECT " + columns.join(", ") + "\nFROM " + from;
  if (conditions.length) sql += "\nWHERE " + conditions.join(" AND ");
  if ((c.aggregate !== "none" || c.pivot) && grouping.length)
    sql += "\nGROUP BY " + grouping.join(", ");
  if (c.sort)
    sql +=
      "\nORDER BY " +
      (c.sort === "metric"
        ? "metric"
        : c.sortNumeric
          ? `CAST(${col(c.sort)} AS DOUBLE)`
          : col(c.sort)) +
      (c.desc ? " DESC" : " ASC");
  return sql;
}
function numeric(s) {
  const n = Number(s);
  if (!String(s).trim() || !Number.isFinite(n))
    throw Error("Enter a valid number.");
  return String(n);
}
export function validateAnalysisRecipe(s) {
  if (
    !s ||
    typeof s !== "object" ||
    !Array.isArray(s.slots) ||
    s.slots.length > 5 ||
    JSON.stringify(s).length > 95000
  )
    throw Error("Invalid analysis recipe.");
  const slots = s.slots.map((x, i) => ({
    name: "table_" + (i + 1),
    headers: Array.isArray(x.headers) ? x.headers.map(String) : [],
  }));
  if (
    slots.some(
      (x) =>
        !x.headers.length ||
        x.headers.length > 200 ||
        new Set(x.headers).size !== x.headers.length,
    )
  )
    throw Error("Invalid recipe column slots.");
  if (
    typeof s.sql !== "string" ||
    s.sql.length > 80000 ||
    !s.config ||
    typeof s.config !== "object"
  )
    throw Error("Invalid SQL recipe.");
  const config = s.config;
  for (const key of ["columns", "groups"])
    if (
      Array.isArray(config[key]) &&
      (config[key].length > 200 ||
        config[key].some((x) => String(x).length > 5000))
    )
      throw Error("Recipe column configuration is too large.");
  if (
    Array.isArray(config.filters) &&
    (config.filters.length > 100 ||
      config.filters.some((f) =>
        [f.column, f.value].some((x) => String(x || "").length > 5000),
      ))
  )
    throw Error("Recipe filters are too large.");
  for (const key of [
    "leftKey",
    "rightKey",
    "measure",
    "pivotColumn",
    "pivotValues",
    "sort",
  ])
    if (String(config[key] || "").length > 5000)
      throw Error("Recipe settings are too large.");
  return {
    slots,
    sql: s.sql,
    custom: !!s.custom,
    config: {
      source: /^table_[1-5]$/.test(s.config.source)
        ? s.config.source
        : "table_1",
      second: /^table_[1-5]$/.test(s.config.second)
        ? s.config.second
        : "table_2",
      join: ["none", "inner", "left"].includes(s.config.join)
        ? s.config.join
        : "none",
      leftKey: String(s.config.leftKey || "").slice(0, 5000),
      rightKey: String(s.config.rightKey || "").slice(0, 5000),
      columns: (Array.isArray(s.config.columns) ? s.config.columns : [])
        .slice(0, 200)
        .map((x) => String(x).slice(0, 5000)),
      groups: (Array.isArray(s.config.groups) ? s.config.groups : [])
        .slice(0, 200)
        .map((x) => String(x).slice(0, 5000)),
      aggregate: ["none", "count", "sum", "avg", "min", "max"].includes(
        s.config.aggregate,
      )
        ? s.config.aggregate
        : "none",
      measure: String(s.config.measure || "").slice(0, 5000),
      numeric: !!s.config.numeric,
      pivot: !!s.config.pivot,
      pivotColumn: String(s.config.pivotColumn || "").slice(0, 5000),
      pivotValues: String(s.config.pivotValues || "").slice(0, 5000),
      sort: String(s.config.sort || "").slice(0, 5000),
      sortNumeric: !!s.config.sortNumeric,
      desc: !!s.config.desc,
      filters: (Array.isArray(s.config.filters) ? s.config.filters : [])
        .slice(0, 100)
        .map((f) => ({
          column: String(f.column || "").slice(0, 5000),
          op: ["=", "!=", "contains", ">", "<", ">=", "<=", "is null"].includes(
            f.op,
          )
            ? f.op
            : "=",
          value: String(f.value || "").slice(0, 5000),
          numeric: !!f.numeric,
        })),
    },
  };
}
