import { $, api, downloadText } from "./common.js";
import * as store from "./flashcard-store.js";
import {
  uiMsg,
  uiJoin,
  uiFrom,
  uiError,
  uiText,
  uiConfirm,
} from "../site/ui.js";

function draw() {
  const out = $("#workspace-decks");
  out.replaceChildren();
  for (const row of store.rows()) {
    const el = document.createElement("div");
    el.className = "saved-row";
    const a = document.createElement("a");
    a.className = "text-link";
    a.href = "/tools/flashcards/?deck=" + encodeURIComponent(row.id);
    uiText(
      a,
      uiJoin([
        row.data.name +
          " · " +
          row.data.cards.filter((c) => c.known).length +
          "/" +
          row.data.cards.length,
        uiMsg(" known"),
      ]),
    );
    const remove = document.createElement("button");
    remove.className = "text-link";
    uiText(remove, uiMsg("Delete"));
    remove.onclick = async () => {
      if (uiConfirm(uiMsg("Delete this card deck?")))
        try {
          await store.remove(row.id);
        } catch (e) {
          uiText($("#workspace-deck-state"), uiError(e));
        }
    };
    el.append(a, remove);
    out.append(el);
  }
  if (!store.rows().length)
    uiText(out, uiMsg("No learning card decks in this workspace."));
  uiText($("#workspace-deck-state"), uiFrom(store.saveState()));
  $("#workspace-deck-more").hidden = !store.hasMore();
}
store.subscribe(draw);
async function start() {
  try {
    await store.ready();
    draw();
    await store.flush();
    await store.load(true);
  } catch (e) {
    uiText($("#workspace-deck-state"), uiError(e));
  }
}
$("#workspace-deck-more").onclick = () => store.load();
$("#workspace-deck-clear").onclick = async () => {
  if (
    uiConfirm(
      uiMsg("Clear all card decks and review progress for this workspace?"),
    )
  )
    try {
      await store.clear();
    } catch (e) {
      uiText($("#workspace-deck-state"), uiError(e));
    }
};
$("#workspace-deck-export").onclick = async () => {
  try {
    const rows = await store.exportRows();
    downloadText(
      JSON.stringify({ version: 1, decks: rows.map((r) => r.data) }, null, 2),
      "kensei-card-decks.json",
      "application/json",
    );
  } catch (e) {
    uiText($("#workspace-deck-state"), uiError(e));
  }
};
window.addEventListener("workspace-ready", start);
start();
