import { calculate } from "./calculator-core.js";
export function calculateSheet(math, source, mode = "deg", previous = {}) {
  if (source.length > 20000 || source.split("\n").length > 100)
    throw Error("Use up to 100 lines and 20,000 characters.");
  const scope = Object.assign(Object.create(null), previous),
    rows = [];
  let ans = "0";
  for (const [index, line] of source.split("\n").entries()) {
    if (!line.trim()) continue;
    let name = null;
    try {
      const match = line.match(
        /^\s*([A-Za-z][A-Za-z0-9_]{0,31})\s*=\s*([^=]+)$/,
      );
      name = match?.[1] || null;
      if (
        name &&
        (["pi", "e", "ans", "constructor", "prototype"].includes(name) ||
          typeof math[name] === "function")
      )
        throw Error("This variable name is reserved.");
      if (name) delete scope[name];
      const result = calculate(math, match ? match[2] : line, mode, ans, scope);
      if (name) scope[name] = result.exact;
      ans = result.exact;
      rows.push({
        line: index + 1,
        expression: line,
        result: result.text,
        approx: result.approx,
      });
    } catch (e) {
      rows.push({ line: index + 1, expression: line, error: e.message });
    }
  }
  return { rows, variables: scope };
}
