import { $, esc, downloadText } from "./common.js";
import * as store from "./personal-store.js";
export function historyView(kind, root, renderRow) {
  let limit = 20;
  const draw = () => {
    const rows = store.records(kind),
      status = root.querySelector("[data-save-state]");
    if (status) status.textContent = store.saveState();
    root.querySelector("[data-history-list]").innerHTML =
      rows.slice(0, limit).map(renderRow).join("") ||
      '<p class="muted small">Nothing saved yet.</p>';
    root.querySelector("[data-history-more]").hidden =
      rows.length <= limit && !store.hasMore(kind);
  };
  root.addEventListener("click", async (e) => {
    const action = e.target.closest("button");
    if (!action) return;
    if (action.dataset.remove) store.remove(kind, action.dataset.remove);
    if (action.hasAttribute("data-history-clear")) {
      if (
        confirm(
          "Clear all " +
            (kind === "answer" ? "answer history" : "saved schemes") +
            " for this workspace?",
        )
      )
        store.clear(kind);
    }
    if (action.hasAttribute("data-history-more")) {
      limit += 20;
      if (store.hasMore(kind)) await store.loadPage(kind);
      draw();
    }
    if (action.hasAttribute("data-history-retry")) {
      await store.flush();
      await store.loadPage(kind, true);
    }
    if (action.hasAttribute("data-history-export"))
      downloadText(
        JSON.stringify(store.exportPersonal().records[kind], null, 2),
        "kensei-" + kind + "-history.json",
        "application/json",
      );
  });
  store.subscribe(draw);
  store.ready.then(() => {
    draw();
    store.loadPage(kind, true);
  });
  draw();
  return draw;
}
export const answerRow = (row) =>
  `<div class="saved-row"><div><strong>${esc(row.data.en)}</strong><p lang="zh">${esc(row.data.zh)}</p><small>${esc(new Date(row.data.drawnAt || row.created_at).toLocaleString())}</small></div><button class="text-link" data-remove="${esc(row.id)}">Delete</button></div>`;
export const decisionRow = (row) =>
  `<div class="saved-row"><div><strong>${esc(row.data.name)}</strong><p>${row.data.options.length} options · ${esc(row.data.mode)}</p></div><div class="saved-actions"><a class="text-link" href="/tools/decision-studio/?scheme=${encodeURIComponent(row.id)}">Open</a><button class="text-link" data-remove="${esc(row.id)}">Delete</button></div></div>`;
