import { historyView, answerRow, decisionRow } from "./history-view.js";
historyView("answer", document.querySelector("#workspace-answers"), answerRow);
historyView(
  "decision",
  document.querySelector("#workspace-decisions"),
  decisionRow,
);
