import { mountWorkspaceIndex } from "./workspace-index.js";
import "./flashcard-workspace.js";
import { historyView, answerRow, decisionRow } from "./history-view.js";
historyView("answer", document.querySelector("#workspace-answers"), answerRow);
historyView(
  "decision",
  document.querySelector("#workspace-decisions"),
  decisionRow,
);

mountWorkspaceIndex(document.querySelector("[data-workspace-index]"));
