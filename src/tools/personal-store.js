import { api } from "./common.js";
import { uiMsg } from "../site/ui.js";

const prefix = "kensei-workshop:personal:v1:",
  listeners = new Set();
let scope = null,
  state,
  syncing = false,
  failure = "",
  retryTimer,
  cursors = {},
  more = { answer: false, decision: false };
const blank = () => ({ records: { answer: [], decision: [] }, queue: [] });
const storageKey = () => prefix + scope;
function read() {
  try {
    const x = JSON.parse(localStorage.getItem(storageKey()));
    return x?.records && Array.isArray(x.queue) ? x : blank();
  } catch {
    return blank();
  }
}
function emit() {
  for (const fn of listeners) fn();
}
function persist() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(state));
    return true;
  } catch {
    failure = "Local save failed. Export your data before leaving.";
    return false;
  }
}
function activate() {
  const next = api.user?.id || "guest";
  if (next === scope) return;
  scope = next;
  state = read();
  failure = "";
  cursors = {};
  more = { answer: false, decision: false };
  emit();
}
export const ready = api.ready
  ? Promise.resolve()
  : new Promise((resolve) =>
      window.addEventListener("workspace-ready", resolve, { once: true }),
    );
ready.then(() => {
  activate();
  flush();
});
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function records(kind) {
  activate();
  return state.records[kind]
    .filter((x) => !x.deleted)
    .sort(
      (a, b) =>
        b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
    );
}
export function saveState() {
  activate();
  return (
    failure ||
    (scope !== "guest" && state.queue.length
      ? "Saved on this device · Pending sync"
      : scope === "guest"
        ? "Saved on this device"
        : "Saved · Synced")
  );
}
export function put(kind, data, id = crypto.randomUUID()) {
  activate();
  const old = state.records[kind].find((x) => x.id === id),
    now = new Date().toISOString();
  const row = {
    id,
    data,
    revision: old?.revision || 0,
    created_at: old?.created_at || now,
    updated_at: now,
    deleted: false,
  };
  state.records[kind] = state.records[kind]
    .filter((x) => x.id !== id)
    .concat(row);
  if (scope !== "guest")
    state.queue.push({
      kind,
      id,
      data,
      base: row.revision,
      op: crypto.randomUUID(),
    });
  failure = "";
  persist();
  emit();
  flush();
  return row;
}
export function remove(kind, id) {
  activate();
  const old = state.records[kind].find((x) => x.id === id);
  if (!old) return;
  old.deleted = true;
  old.data = {};
  if (scope !== "guest")
    state.queue.push({
      kind,
      id,
      data: {},
      base: old.revision,
      op: crypto.randomUUID(),
      remove: true,
    });
  persist();
  emit();
  flush();
}
export function clear(kind) {
  activate();
  state.records[kind].forEach((x) => {
    x.deleted = true;
    x.data = {};
  });
  if (scope !== "guest")
    state.queue.push({ kind, clear: true, op: crypto.randomUUID() });
  persist();
  emit();
  flush();
}
export const hasMore = (kind) => more[kind];
export async function loadPage(kind, reset = false) {
  await ready;
  activate();
  if (!api.user || !api.client) return;
  const owner = scope,
    cursor = reset ? null : cursors[kind];
  try {
    const { data, error } = await api.client.rpc("get_private_records", {
      kind,
      before_time: cursor?.created_at || null,
      before_id: cursor?.id || null,
      page_size: 25,
      expected_user: owner,
    });
    if (error) throw error;
    if (scope !== owner || api.user?.id !== owner) return;
    for (const row of data || []) {
      if (
        state.queue.some((x) => x.kind === kind && (x.clear || x.id === row.id))
      )
        continue;
      const old = state.records[kind].find((x) => x.id === row.id);
      if (!old || row.revision >= old.revision)
        state.records[kind] = state.records[kind]
          .filter((x) => x.id !== row.id)
          .concat(row);
    }
    cursors[kind] = data?.at(-1);
    more[kind] = data?.length === 25;
    failure = "";
    persist();
    emit();
    return true;
  } catch {
    if (scope === owner) {
      failure =
        "History could not load. Local data is safe; retry when connected.";
      emit();
    }
    return false;
  }
}
export async function flush() {
  await ready;
  activate();
  if (syncing || !api.user || !api.client || !state.queue.length) return;
  syncing = true;
  const owner = scope;
  clearTimeout(retryTimer);
  try {
    while (state.queue.length && api.user?.id === owner) {
      const job = state.queue[0],
        { data, error } = await api.client.rpc(
          job.clear ? "clear_private_records" : "save_private_record",
          job.clear
            ? { kind: job.kind, operation_id: job.op, expected_user: owner }
            : {
                kind: job.kind,
                record_id: job.id,
                payload: job.data,
                base_revision: job.base,
                operation_id: job.op,
                remove_record: !!job.remove,
                expected_user: owner,
              },
        );
      if (error) throw error;
      if (api.user?.id !== owner) break;
      state.queue = state.queue.filter((x) => x.op !== job.op);
      if (!job.clear) {
        const clearing = state.queue.some(
          (x) => x.kind === job.kind && x.clear,
        );
        const newer = state.queue.filter(
          (x) => x.kind === job.kind && x.id === job.id,
        );
        if (data.conflict) {
          // 冲突副本使用服务器返回的 ID；后续编辑继续更新该副本。
          state.records[job.kind] = state.records[job.kind]
            .filter((x) => x.id !== job.id && x.id !== data.id)
            .concat({
              ...data,
              deleted: clearing || data.deleted,
              data: clearing
                ? {}
                : newer.length
                  ? state.records[job.kind].find((x) => x.id === job.id)
                      ?.data || data.data
                  : data.data,
            });
          newer.forEach((x) => {
            x.id = data.id;
            x.base = data.revision;
          });
          if (!clearing) emitConflict(job.id, data.id);
        } else {
          newer.forEach((x) => (x.base = data.revision));
          const local = state.records[job.kind].find((x) => x.id === data.id);
          state.records[job.kind] = state.records[job.kind]
            .filter((x) => x.id !== data.id)
            .concat(
              clearing
                ? { ...data, data: {}, deleted: true }
                : newer.length
                  ? { ...local, revision: data.revision }
                  : data,
            );
        }
      }
      failure = "";
      persist();
      emit();
    }
  } catch {
    failure = "Saved on this device · Sync failed. Retrying when connected.";
    emit();
    retryTimer = setTimeout(flush, 15000);
  } finally {
    syncing = false;
  }
}
function emitConflict(from, to) {
  window.dispatchEvent(
    new CustomEvent("personal-conflict", { detail: { from, to } }),
  );
  api.toast(
    uiMsg(
      "Another device edited this scheme. Your changes were kept in a conflict copy.",
    ),
  );
}
export function exportPersonal() {
  activate();
  return { scope, records: state.records, queue: state.queue };
}
window.addEventListener("online", () => {
  flush();
});
window.addEventListener("storage", (e) => {
  if (e.key === storageKey() && !syncing) {
    state = read();
    emit();
  }
});
window.addEventListener("workspace-ready", () => {
  activate();
});
