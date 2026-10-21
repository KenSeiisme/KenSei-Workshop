import { create, all } from "/vendor/math.js";
import { calculate } from "./calculator-core.js";
const math = create(all, { number: "BigNumber", precision: 64 });
postMessage({ type: "ready" });
onmessage = ({ data }) => {
  try {
    postMessage({
      ok: true,
      ...calculate(math, data.expression, data.mode, data.ans),
    });
  } catch (e) {
    postMessage({
      ok: false,
      error: e.message || "This expression could not be calculated.",
    });
  }
};
