import { api, esc } from "./common.js";
import * as personal from "./personal-store.js";
import * as decks from "./flashcard-store.js";
import { workspaceStores } from "./record-workspace.js";
import { uiDate, uiFrom, uiHtml, uiMsg, uiText } from "../site/ui.js";

const kinds = {
  draft: ["Draft", "draft"],
  preset: ["Preset or recipe", "preset"],
  decision: ["Decision scheme", "scheme", "decision-studio"],
  deck: ["Card deck", "deck", "flashcards"],
  planner: ["Study plan", "id", "study-planner"],
  whiteboard: ["Personal whiteboard", "id", "whiteboard"],
};
const pageSize = 20;
const tools = window.KENSEI_TOOLS;
const key = ({ kind, id }) => kind + ":" + id;
const compare = (a, b) =>
  Date.parse(b.updated_at) - Date.parse(a.updated_at) ||
  b.kind.localeCompare(a.kind) ||
  b.id.localeCompare(a.id);

function localRecords() {
  const personalState = personal.exportPersonal();
  const sets = [
    ["draft", { records: api.items("draft"), queue: [] }],
    ["preset", { records: api.items("preset"), queue: [] }],
    [
      "decision",
      {
        records: personalState.records.decision,
        queue: personalState.queue.filter((job) => job.kind === "decision"),
      },
    ],
    ["deck", decks.workspaceState()],
    ...[...workspaceStores].map(([kind, store]) => [
      kind,
      store.workspaceState(),
    ]),
  ];
  const cleared = new Set();
  const rows = sets.flatMap(([kind, set]) => {
    if (!set) return [];
    const queuedIds = new Set(set.queue.map((job) => job.id));
    const clearQueued = set.queue.some((job) => job.clear);
    if (clearQueued) cleared.add(kind);
    return Object.values(set.records).map((row) => ({
      id: row.id,
      kind,
      tool:
        kinds[kind][2] ||
        row.data?.tool ||
        (kind === "draft" ? "text-toolkit" : "image-studio"),
      name: row.data?.name,
      updated_at: row.updated_at,
      deleted: row.deleted,
      pending: clearQueued || queuedIds.has(row.id) || !!row.data?.pending,
      save_status:
        workspaceStores.get(kind)?.recordSaveStatus(row.id) ||
        (api.user
          ? clearQueued || queuedIds.has(row.id) || row.data?.pending
            ? "pending"
            : "synced"
          : "device"),
    }));
  });
  return { rows, cleared };
}

export function mountWorkspaceIndex(root) {
  if (!root) return;
  const $ = (selector) => root.querySelector(selector);
  const query = $("[data-workspace-query]");
  const kind = $("[data-workspace-kind]");
  const list = $("[data-workspace-index-list]");
  const recent = $("[data-workspace-recent]");
  const recentList = $("[data-workspace-recent-list]");
  const status = $("[data-workspace-index-status]");
  const moreButton = $("[data-workspace-index-more]");
  const retry = $("[data-workspace-index-retry]");
  const names = new Map();
  let owner,
    remote = [],
    request,
    timer,
    failed = false,
    more = false,
    limit = pageSize;
  const toolMatches = () =>
    Object.keys(tools).filter((id) => {
      const label = tools[id].name;
      const term = query.value.trim().toLowerCase();
      return [label, names.get(id), String(uiFrom(label))].some((name) =>
        name?.toLowerCase().includes(term),
      );
    });

  function recordRow(row, isRecent = false) {
    const [label, param] = kinds[row.kind];
    const path = window.KenseiI18n.localePath("/tools/" + row.tool + "/");
    const timestamp = new Date(row.updated_at);
    const saveLabels = {
      device: uiMsg("Saved locally"),
      synced: uiMsg("Synced"),
      pending: uiMsg("Pending sync"),
      syncing: uiMsg("Syncing"),
      failed: uiMsg("Sync failed"),
    };
    const saveLabel =
      saveLabels[row.save_status || (owner ? "synced" : "device")];
    return uiHtml`<div class="saved-row"><span class="workspace-record-icon" data-tool-category="${esc(tools[row.tool].category)}">${tools[row.tool].icon || ""}</span><div>
      <strong>${row.name ? esc(row.name) : uiMsg("Untitled record")}</strong>
      <p>${uiFrom(label)} · ${uiFrom(tools[row.tool].name)}
      ${Number.isFinite(+timestamp) ? uiDate(timestamp, { dateStyle: "medium", timeStyle: "short" }) : ""}
      <span class="workspace-save-state">${saveLabel}</span></p></div>
      <a class="text-link" data-record="${esc(key(row))}" href="${path}?${param}=${encodeURIComponent(row.id)}">${isRecent ? uiMsg("Continue editing") : uiMsg("Open")}</a>
    </div>`;
  }

  function paint() {
    const online = owner && !failed && navigator.onLine;
    const term = query.value.trim().toLowerCase();
    const matches = new Set(toolMatches());
    const cached = owner
      ? remote.filter(
          (row) =>
            (!kind.value || row.kind === kind.value) &&
            (!term ||
              matches.has(row.tool) ||
              row.name?.toLowerCase().includes(term)),
        )
      : [];
    const rows = new Map(cached.map((row) => [key(row), row]));
    const { rows: local, cleared } = localRecords();
    for (const [id, row] of rows) if (cleared.has(row.kind)) rows.delete(id);
    for (const row of local) {
      if (online && !row.pending) continue;
      rows.delete(key(row));
      if (
        !row.deleted &&
        (!kind.value || kind.value === row.kind) &&
        (!term ||
          matches.has(row.tool) ||
          row.name?.toLowerCase().includes(term))
      )
        rows.set(key(row), row);
    }
    const visible = [...rows.values()]
      .filter(
        (row) =>
          Object.hasOwn(kinds, row.kind) && Object.hasOwn(tools, row.tool),
      )
      .sort(compare);
    const showRecent = !term && !kind.value && visible.length > 0;
    recent.hidden = !showRecent;
    if (showRecent) {
      const focus = recentList.contains(document.activeElement)
        ? document.activeElement.dataset.record
        : null;
      const next = visible
        .slice(0, 4)
        .map((row) => recordRow(row, true))
        .join("");
      if (recentList.innerHTML !== next) recentList.innerHTML = next;
      if (focus)
        [...recentList.querySelectorAll("a")]
          .find((node) => node.dataset.record === focus)
          ?.focus();
    } else if (recentList.childElementCount) recentList.replaceChildren();
    const focusKey = list.contains(document.activeElement)
      ? document.activeElement.dataset.record
      : null;
    list.innerHTML = visible
      .slice(showRecent ? 4 : 0, limit)
      .map((row) => recordRow(row))
      .join("");
    if (focusKey)
      [...list.querySelectorAll("a")]
        .find((node) => node.dataset.record === focusKey)
        ?.focus();
    moreButton.hidden = !(visible.length > limit || (online && more));
    moreButton.disabled = !!request;
    retry.hidden = !failed;
    uiText(
      status,
      request
        ? uiMsg("Loading saved work…")
        : owner && !online
          ? uiMsg("Showing saved work on this device. Retry when connected.")
          : visible.length
            ? ""
            : uiMsg("No matching saved work."),
    );
  }

  async function refresh(append = false) {
    const nextOwner = api.user?.id;
    if (owner !== nextOwner) {
      owner = nextOwner;
      request = null;
      remote = [];
      failed = more = false;
      limit = pageSize;
    } else if (!append) {
      request = null;
      limit = pageSize;
    }
    if (!owner || !navigator.onLine || !api.client || (append && !more)) {
      paint();
      return;
    }
    const ticket = {};
    request = ticket;
    const last = append ? remote.at(-1) : null;
    paint();
    try {
      const rpc = api.client.rpc("get_workspace_index", {
        search_text: query.value.trim(),
        tool_ids: toolMatches(),
        record_kind: kind.value || null,
        before_time: last?.updated_at ?? null,
        before_kind: last?.kind ?? null,
        before_id: last?.id ?? null,
      });
      const { data, error } = await (rpc.abortSignal?.(
        AbortSignal.timeout(9000),
      ) ?? rpc);
      if (request !== ticket || owner !== api.user?.id) return;
      if (error || !Array.isArray(data))
        throw error || Error("Invalid workspace index");
      more = data.length > pageSize;
      remote = append
        ? [...remote, ...data.slice(0, pageSize)]
        : data.slice(0, pageSize);
      failed = false;
    } catch {
      if (request === ticket) failed = true;
    } finally {
      if (request === ticket) {
        request = null;
        paint();
      }
    }
  }

  function schedule() {
    request = null;
    clearTimeout(timer);
    timer = setTimeout(() => refresh(), 180);
  }
  query.oninput = (event) => {
    if (!event.isComposing) schedule();
  };
  query.addEventListener("compositionend", schedule);
  kind.onchange = () => refresh();
  retry.onclick = () => refresh();
  moreButton.onclick = () => {
    limit += pageSize;
    if (more) refresh(true);
    else paint();
  };
  for (const evt of ["online", "offline", "workspace-ready"])
    window.addEventListener(evt, () => refresh());
  window.addEventListener("workspace-items-change", schedule);
  window.addEventListener("locale-change", paint);
  personal.subscribe(schedule);
  decks.subscribe(schedule);
  for (const store of workspaceStores.values()) store.subscribe(schedule);

  fetch("/assets/search-index.json")
    .then((response) => {
      if (!response.ok) throw Error("Search index unavailable");
      return response.json();
    })
    .then((index) => {
      for (const item of index)
        if (item.type === "tools")
          names.set(item.route.split("/")[2], item.name["zh-Hant"]);
      if (query.value.trim()) schedule();
    })
    .catch(() => {});
  refresh();
}
