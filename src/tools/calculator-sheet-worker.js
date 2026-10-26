import { create, all } from "/vendor/math.js";
import { calculateSheet } from "./calculator-sheet-core.js";
const math = create(all, { number: "BigNumber", precision: 64 });
postMessage({ type: "ready" });
onmessage = ({ data }) => {
  try {
    postMessage({
      ok: true,
      ...calculateSheet(math, data.source, data.mode, data.variables),
    });
  } catch (e) {
    postMessage({ ok: false, error: e.message });
  }
};
