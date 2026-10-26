import { $, api, esc, toast } from "./common.js";
import { randomIndex, shuffle } from "./sprint-core.js";
import { wheelTarget, weightedIndex } from "./decision-motion.js";
import * as store from "./personal-store.js";
import { historyView, decisionRow } from "./history-view.js";
import { uiMsg, uiJoin, uiFrom, uiError, uiText, uiHtml } from "../site/ui.js";

let id = null,
  owner = null,
  saveTimer,
  wheel = null,
  Wheel = null,
  busy = false,
  dirty = false,
  drawn = new Set(),
  generation = 0;
let weightMap = new Map();
const weights = () => options().map((label) => weightMap.get(label) ?? 1);
let finishSpin = null;
function cancelSpin() {
  generation++;
  wheel?.stop();
  finishSpin?.(false);
  busy = false;
}
const fields = [
  "#decision-name",
  "#decision-options",
  "#decision-mode",
  "#decision-no-repeat",
  "#decision-group-count",
];
const actor = () => api.user?.id || "guest";
const options = () =>
  $("#decision-options")
    .value.split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
function data() {
  const list = options(),
    name = $("#decision-name").value.trim();
  if (!name || name.length > 100)
    throw new Error("Give this scheme a name (up to 100 characters).");
  if (
    !list.length ||
    list.length > 200 ||
    list.some((x) => Array.from(x).length > 200)
  )
    throw new Error("Use 1–200 options, up to 200 characters each.");
  if (new Set(list).size !== list.length)
    throw new Error("Use unique option names.");
  const count = +$("#decision-group-count").value;
  if (
    $("#decision-mode").value === "groups" &&
    (!Number.isInteger(count) || count < 1 || count > list.length)
  )
    throw new Error("Choose between 1 and " + list.length + " groups.");
  if (weights().some((w) => !Number.isInteger(w) || w < 1 || w > 100))
    throw Error("Weights must be whole numbers from 1 to 100.");
  return {
    name,
    options: list,
    weights: weights(),
    mode: $("#decision-mode").value,
    noRepeat: $("#decision-no-repeat").checked,
    groupCount: count,
  };
}
function save() {
  clearTimeout(saveTimer);
  if (!dirty || owner !== actor()) return;
  try {
    const value = data();
    id = store.put("decision", value, id || crypto.randomUUID()).id;
    history.replaceState(null, "", "?scheme=" + id);
    dirty = false;
    uiText($("#decision-save-state"), uiFrom(store.saveState()));
  } catch (e) {
    uiText(
      $("#decision-save-state"),
      uiJoin([uiMsg("Not saved · "), uiError(e)]),
    );
  }
}
function mode() {
  const v = $("#decision-mode").value;
  $("#no-repeat-row").hidden = v !== "draw";
  $("#group-count-row").hidden = v !== "groups";
  $("#decision-wheel-shell").hidden = v !== "wheel";
  $("#decision-reset").hidden = v !== "draw";
}
function redraw() {
  wheel?.remove();
  wheel = null;
  try {
    if (!Wheel) return;
    const list = options();
    if (!list.length || list.length > 200) return;
    const canvas = document.createElement("canvas");
    if (!canvas.getContext("2d")) throw new Error();
    wheel = new Wheel($("#decision-wheel"), {
      items: list.map((label, i) => ({ label, weight: weights()[i] })),
      isInteractive: false,
      itemBackgroundColors: ["#d6b6ec", "#a88cc3", "#efc6db", "#b9bce8"],
      itemLabelColors: ["#21152d"],
      lineColor: "#21152d",
      lineWidth: 1,
      itemLabelFontSizeMax: 22,
      pointerAngle: 0,
    });
  } catch {
    wheel?.remove();
    wheel = null;
    uiText(
      $("#decision-note"),
      uiMsg(
        "Wheel drawing is unavailable. Your random choice still works as text.",
      ),
    );
  }
}
function edit() {
  dirty = true;
  uiText($("#decision-save-state"), uiMsg("Saving on this device…"));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 500);
  drawn.clear();
  cancelSpin();
  $("#decision-run").disabled = false;
  mode();
  redraw();
  window.dispatchEvent(new Event("decision-opened"));
}
fields.forEach((s) => $(s).addEventListener("input", edit));
function reopen(record) {
  clearTimeout(saveTimer);
  id = record?.id || null;
  const d = record?.data || {
    name: "A new choice",
    options: ["Tea", "Coffee", "Water"],
    mode: "wheel",
    noRepeat: false,
    groupCount: 2,
  };
  weightMap = new Map(
    d.options.map((label, i) => [label, d.weights?.[i] ?? 1]),
  );
  $("#decision-name").value = d.name;
  $("#decision-options").value = d.options.join("\n");
  $("#decision-mode").value = d.mode;
  $("#decision-no-repeat").checked = d.noRepeat;
  $("#decision-group-count").value = d.groupCount;
  dirty = false;
  drawn.clear();
  cancelSpin();
  $("#decision-run").disabled = false;
  uiText($("#decision-result"), uiMsg("Your next possibility starts here."));
  mode();
  redraw();
  window.dispatchEvent(new Event("decision-opened"));
}
historyView("decision", $("#decision-history"), decisionRow);
$("#decision-history").addEventListener("click", (e) => {
  const a = e.target.closest("a");
  if (!a) return;
  e.preventDefault();
  save();
  const row = store
    .records("decision")
    .find((x) => x.id === new URL(a.href).searchParams.get("scheme"));
  if (row) {
    reopen(row);
    history.replaceState(null, "", "?scheme=" + row.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
});
$("#decision-new").addEventListener("click", () => {
  save();
  reopen(null);
  history.replaceState(null, "", location.pathname);
  dirty = true;
  save();
});
$("#decision-reset").addEventListener("click", () => {
  drawn.clear();
  uiText($("#decision-note"), uiMsg("Draw pool reset."));
});
$("#decision-run").addEventListener("click", async () => {
  if (busy) return;
  let d;
  try {
    d = data();
  } catch (e) {
    toast(uiError(e));
    return;
  }
  if (!id) dirty = true;
  save();
  const result = $("#decision-result");
  uiText($("#decision-note"), "");
  if (d.mode === "groups") {
    const list = shuffle(d.options),
      groups = Array.from({ length: d.groupCount }, () => []);
    list.forEach((v, i) => groups[i % groups.length].push(v));
    result.innerHTML = groups
      .map(
        (g, i) =>
          uiHtml`<div class="decision-group"><h3>Group ${i + 1}</h3><ul>${g.map((x) => uiHtml`<li>${esc(x)}</li>`).join("")}</ul></div>`,
      )
      .join("");
    return;
  }
  const candidates = d.options
    .map((label, index) => ({ label, index }))
    .filter((x) => d.mode !== "draw" || !d.noRepeat || !drawn.has(x.index));
  if (!candidates.length) {
    uiText(
      result,
      uiMsg("Every option has been drawn. Reset the pool to draw again."),
    );
    return;
  }
  const winner =
    candidates[weightedIndex(candidates.map((c) => d.weights[c.index]))];
  if (d.mode === "draw") {
    if (d.noRepeat) drawn.add(winner.index);
    uiText(result, winner.label);
    uiText(
      $("#decision-note"),
      d.noRepeat
        ? uiMsg("{0} options remain.", [d.options.length - drawn.size])
        : uiMsg("Options were drawn using their configured weights."),
    );
    return;
  }
  const token = ++generation;
  busy = true;
  $("#decision-run").disabled = true;
  uiText(result, uiMsg("Turning possibilities…"));
  if (wheel) {
    const currentWheel = wheel;
    const target = wheelTarget(d.weights, winner.index, wheel.rotation);
    try {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        currentWheel.stop();
        currentWheel.rotation = target.rotation;
      } else {
        await new Promise((resolve) => {
          let timer,
            settled = false;
          const complete = (settle = true) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            currentWheel.onRest = null;
            if (finishSpin === complete) finishSpin = null;
            if (settle && token === generation) {
              currentWheel.stop();
              currentWheel.rotation = target.rotation;
            }
            resolve();
          };
          finishSpin = complete;
          currentWheel.onRest = () => complete();
          currentWheel.spinTo(
            target.rotation,
            target.duration,
            (t) => 1 - (1 - t) ** 4,
          );
          timer = setTimeout(() => complete(), target.duration + 400);
        });
      }
    } catch {
      finishSpin?.();
      if (token === generation) currentWheel.rotation = target.rotation;
    }
  }
  if (token !== generation) return;
  uiText(result, winner.label);
  busy = false;
  $("#decision-run").disabled = false;
});
window.addEventListener("personal-conflict", (e) => {
  if (id === e.detail.from) {
    id = e.detail.to;
    history.replaceState(null, "", "?scheme=" + id);
  }
});
window.addEventListener("pagehide", () => {
  save();
  cancelSpin();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) save();
});
store.subscribe(() => {
  if (!dirty) uiText($("#decision-save-state"), uiFrom(store.saveState()));
});
await store.ready;
owner = actor();
try {
  ({ Wheel } = await import("/vendor/spin-wheel.js"));
} catch {
  uiText(
    $("#decision-note"),
    uiMsg("Wheel artwork could not load. Text choices remain available."),
  );
}
await store.loadPage("decision", true);
const requested = new URLSearchParams(location.search).get("scheme");
let found = store.records("decision").find((x) => x.id === requested);
while (requested && !found && store.hasMore("decision")) {
  if (!(await store.loadPage("decision"))) break;
  found = store.records("decision").find((x) => x.id === requested);
}
reopen(found);
fields.forEach((s) => ($(s).disabled = false));
$("#decision-new").disabled = false;
uiText($("#decision-save-state"), uiFrom(store.saveState()));
if (requested && !found)
  uiText(
    $("#decision-note"),
    uiMsg("That scheme is not available in this workspace."),
  );

window.KenseiAdvancedContexts ||= {};
window.KenseiAdvancedContexts["decision-studio"] = {
  options,
  weights,
  setWeight(label, value) {
    weightMap.set(label, value);
    edit();
  },
  importOptions(list, values) {
    list = list.map((s) => s.trim());
    if (
      !list.length ||
      list.length > 200 ||
      new Set(list).size !== list.length ||
      list.some((s) => !s || s.length > 200 || /[\r\n]/.test(s)) ||
      values.some((w) => !Number.isInteger(w) || w < 1 || w > 100)
    )
      throw Error("Use unique options and integer weights from 1 to 100.");
    weightMap = new Map(list.map((s, i) => [s, values[i]]));
    $("#decision-options").value = list.join("\n");
    edit();
  },
};
