import { $, api, downloadText } from "./common.js";
import { createRecordStore } from "./record-store.js";
import { validatePlanner } from "./planner-core.js";
import { validateWhiteboard } from "./whiteboard-core.js";
import {
  uiMsg,
  uiFrom,
  uiError,
  uiText,
  uiConfirm,
  uiPrompt,
} from "../site/ui.js";

for (const [kind, slug, validate] of [
  ["planner", "study-planner", validatePlanner],
  ["whiteboard", "whiteboard", validateWhiteboard],
]) {
  const store = createRecordStore(kind, validate),
    owner = () => api.user?.id || "guest",
    state = $(`#${kind}-workspace-state`),
    out = $(`#${kind}-workspace-list`);
  if (!out) continue;
  function draw() {
    out.replaceChildren();
    for (const row of store.rows()) {
      const el = document.createElement("div");
      el.className = "saved-row";
      const a = document.createElement("a");
      a.className = "text-link";
      a.href = `/tools/${slug}/?id=${encodeURIComponent(row.id)}`;
      uiText(a, row.data.name);
      const actions = document.createElement("div");
      actions.className = "action-row";
      for (const [label, action] of [
        [
          "Rename",
          async () => {
            const expected = owner(),
              name = uiPrompt(uiMsg("Name"), row.data.name);
            if (name !== null)
              await store.put(
                { ...row.data, name },
                row.id,
                expected,
                row.revision,
              );
          },
        ],
        [
          "Delete",
          async () => {
            const expected = owner();
            if (uiConfirm(uiMsg("Delete {0}?", [row.data.name])))
              await store.remove(row.id, expected, row.revision);
          },
        ],
      ]) {
        const button = document.createElement("button");
        button.className = "text-link";
        uiText(button, uiFrom(label));
        button.onclick = () => action().catch((e) => uiText(state, uiError(e)));
        actions.append(button);
      }
      el.append(a, actions);
      out.append(el);
    }
    if (!store.rows().length)
      uiText(out, uiMsg("Nothing saved in this workspace yet."));
    uiText(state, uiFrom(store.saveState()));
    $(`#${kind}-workspace-more`).hidden = !store.hasMore();
  }
  async function start() {
    try {
      await store.ready();
      draw();
      await store.flush();
      await store.load(true);
    } catch (e) {
      uiText(state, uiError(e));
    }
  }
  store.subscribe(draw);
  $(`#${kind}-workspace-more`).onclick = () => store.load();
  $(`#${kind}-workspace-retry`).onclick = start;
  $(`#${kind}-workspace-clear`).onclick = async () => {
    const expected = owner();
    if (uiConfirm(uiMsg("Clear every saved {0} in this workspace?", [kind]))) {
      try {
        await store.clear(expected);
      } catch (e) {
        uiText(state, uiError(e));
      }
    }
  };
  $(`#${kind}-workspace-export`).onclick = async () => {
    try {
      const rows = await store.exportRows();
      downloadText(
        JSON.stringify(
          { version: 1, kind, records: rows.map((r) => r.data) },
          null,
          2,
        ),
        `kensei-${kind}-backup.json`,
        "application/json",
      );
    } catch (e) {
      uiText(state, uiError(e));
    }
  };
  window.addEventListener("workspace-ready", start);
  start();
}
