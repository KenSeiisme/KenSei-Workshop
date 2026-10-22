import { $, api, downloadText } from "./common.js";
import { createRecordStore } from "./record-store.js";
import { validatePlanner } from "./planner-core.js";
import { validateWhiteboard } from "./whiteboard-core.js";
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
      a.textContent = row.data.name;
      const actions = document.createElement("div");
      actions.className = "action-row";
      for (const [label, action] of [
        [
          "Rename",
          async () => {
            const expected = owner(),
              name = prompt("Name", row.data.name);
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
            if (confirm(`Delete ${row.data.name}?`))
              await store.remove(row.id, expected, row.revision);
          },
        ],
      ]) {
        const button = document.createElement("button");
        button.className = "text-link";
        button.textContent = label;
        button.onclick = () =>
          action().catch((e) => (state.textContent = e.message));
        actions.append(button);
      }
      el.append(a, actions);
      out.append(el);
    }
    if (!store.rows().length)
      out.textContent = "Nothing saved in this workspace yet.";
    state.textContent = store.saveState();
    $(`#${kind}-workspace-more`).hidden = !store.hasMore();
  }
  async function start() {
    try {
      await store.ready();
      draw();
      await store.flush();
      await store.load(true);
    } catch (e) {
      state.textContent = e.message;
    }
  }
  store.subscribe(draw);
  $(`#${kind}-workspace-more`).onclick = () => store.load();
  $(`#${kind}-workspace-retry`).onclick = start;
  $(`#${kind}-workspace-clear`).onclick = async () => {
    const expected = owner();
    if (confirm(`Clear every saved ${kind} in this workspace?`)) {
      try {
        await store.clear(expected);
      } catch (e) {
        state.textContent = e.message;
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
      state.textContent = e.message;
    }
  };
  window.addEventListener("workspace-ready", start);
  start();
}
