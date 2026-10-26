import { $, copy, api } from "./common.js";
import { answers } from "./answers.js";
import { randomIndex } from "./sprint-core.js";
import * as store from "./personal-store.js";
import { historyView, answerRow } from "./history-view.js";
import { uiMsg, uiFrom, uiText } from "../site/ui.js";

let current = null,
  busy = false,
  generation = 0,
  animation = null;
const actor = () => api.user?.id || "guest";
let owner = actor();
function cancelTurn() {
  generation++;
  animation?.cancel();
  animation = null;
  busy = false;
  $(".answer-book").dataset.turning = "false";
  $("#answer-draw").disabled = false;
  $("#answer-copy").disabled = !current;
}
async function transition(frames, duration) {
  if (!$("#answer-page").animate) return;
  animation = $("#answer-page").animate(frames, {
    duration,
    easing: "cubic-bezier(.22,.75,.2,1)",
    fill: "none",
  });
  await animation.finished.catch(() => {});
}
historyView("answer", $("#answer-history"), answerRow);
store.ready.then(() => ($("#answer-draw").disabled = false));
function show() {
  if (!current) return;
  const lang = $("#answer-language").value;
  $("#answer-en").hidden = lang === "zh";
  $("#answer-zh").hidden = lang === "en";
  uiText($("#answer-en"), current.en);
  uiText($("#answer-zh"), current.zh);
}
$("#answer-language").addEventListener("change", show);
$("#answer-draw").addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  const token = ++generation,
    expected = actor();
  const pair = answers[randomIndex(answers.length)];
  const next = { en: pair[0], zh: pair[1], drawnAt: new Date().toISOString() };
  $("#answer-draw").disabled = true;
  $("#answer-copy").disabled = true;
  $(".answer-book").dataset.turning = "true";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduced)
    await transition(
      [
        { opacity: 1, transform: "rotateY(0deg)" },
        { opacity: 0, transform: "rotateY(-65deg)" },
      ],
      180,
    );
  if (token !== generation || expected !== actor()) return;
  current = next;
  show();
  let saved = true;
  try {
    store.put("answer", current);
  } catch {
    saved = false;
  }
  if (!reduced) {
    await transition(
      [
        { opacity: 0, transform: "rotateY(25deg) translateX(8px)" },
        { opacity: 1, transform: "rotateY(0deg) translateX(0)" },
      ],
      370,
    );
  } else await transition([{ opacity: 0 }, { opacity: 1 }], 80);
  if (token !== generation || expected !== actor()) return;
  $(".answer-book").dataset.turning = "false";
  uiText(
    $("#answer-status"),
    saved
      ? uiFrom(store.saveState())
      : uiMsg(
          "Answer revealed, but saving failed. Copy your answer before leaving.",
        ),
  );
  uiText($("#answer-draw"), uiMsg("Turn another page →"));
  $("#answer-copy").disabled = false;
  $("#answer-draw").disabled = false;
  busy = false;
});
$("#answer-copy").addEventListener("click", () => {
  if (current)
    copy(
      $("#answer-language").value === "en"
        ? current.en
        : $("#answer-language").value === "zh"
          ? current.zh
          : current.en + "\n" + current.zh,
    );
});
store.subscribe(() => uiText($("#answer-status"), uiFrom(store.saveState())));
window.addEventListener("pagehide", cancelTurn);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) cancelTurn();
});
window.addEventListener("workspace-ready", () => {
  if (owner === actor()) return;
  owner = actor();
  cancelTurn();
  current = null;
  uiText($("#answer-en"), uiMsg("A new page is waiting."));
  uiText($("#answer-zh"), "新的一页正在等你。");
  $("#answer-copy").disabled = true;
});
