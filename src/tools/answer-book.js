import { $, copy } from "./common.js";
import { answers } from "./answers.js";
import { randomIndex } from "./sprint-core.js";
import * as store from "./personal-store.js";
import { historyView, answerRow } from "./history-view.js";
let current = null,
  busy = false;
historyView("answer", $("#answer-history"), answerRow);
store.ready.then(() => ($("#answer-draw").disabled = false));
function show() {
  if (!current) return;
  const lang = $("#answer-language").value;
  $("#answer-en").hidden = lang === "zh";
  $("#answer-zh").hidden = lang === "en";
  $("#answer-en").textContent = current.en;
  $("#answer-zh").textContent = current.zh;
}
$("#answer-language").addEventListener("change", show);
$("#answer-draw").addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  $("#answer-draw").disabled = true;
  const page = $("#answer-page");
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const animation = page.animate(
      [
        { opacity: 1, transform: "rotateY(0)" },
        { opacity: 0, transform: "rotateY(-75deg)" },
        { opacity: 1, transform: "rotateY(0)" },
      ],
      { duration: 450 },
    );
    await animation.finished.catch(() => {});
  }
  const pair = answers[randomIndex(answers.length)];
  current = { en: pair[0], zh: pair[1], drawnAt: new Date().toISOString() };
  show();
  store.put("answer", current);
  $("#answer-status").textContent = store.saveState();
  $("#answer-draw").textContent = "Turn another page →";
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
store.subscribe(() => ($("#answer-status").textContent = store.saveState()));
