import { api } from "./common.js";
export function createRecordStore(kind, validate, { syncDelay = 0 } = {}) {
  if (!["planner", "whiteboard"].includes(kind))
    throw Error("Unknown private record kind.");
  const sessions = new Map(),
    listeners = new Set(),
    channel =
      typeof BroadcastChannel === "function"
        ? new BroadcastChannel(`kensei-record-${kind}-v1`)
        : null;
  let database,
    active = null,
    activation = 0;
  const account = () => api.user?.id || "guest";
  const authReady = api.ready
    ? Promise.resolve()
    : new Promise((r) =>
        window.addEventListener("workspace-ready", r, { once: true }),
      );
  function db() {
    return (database ||= new Promise((resolve, reject) => {
      if (!window.indexedDB)
        return reject(
          Error(
            "Private local storage is unavailable. Enable site storage or export your record.",
          ),
        );
      const request = indexedDB.open(`kensei-record-${kind}-v1`, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("scopes");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(Error("Local storage could not open."));
    }));
  }
  async function disk(scope, value) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(
          "scopes",
          value ? "readwrite" : "readonly",
        ),
        request = transaction
          .objectStore("scopes")
          [value ? "put" : "get"](
            ...(value ? [structuredClone(value), scope] : [scope]),
          );
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () =>
        reject(Error("Local save failed. Export your record before leaving."));
      transaction.onabort = () =>
        reject(Error("Local save failed. Export your record before leaving."));
    });
  }
  function notify(s) {
    if (active === s) listeners.forEach((fn) => fn());
  }
  async function persist(s, fn, broadcast = true) {
    try {
      const database = await db();
      await new Promise((resolve, reject) => {
        const tx = database.transaction("scopes", "readwrite"),
          table = tx.objectStore("scopes"),
          get = table.get(s.scope);
        let failure;
        get.onsuccess = () => {
          try {
            s.state = get.result || { records: {}, queue: [] };
            fn();
            table.put(structuredClone(s.state), s.scope);
          } catch (e) {
            failure = e;
            tx.abort();
          }
        };
        tx.oncomplete = resolve;
        tx.onerror = tx.onabort = () =>
          reject(
            failure ||
              Error("Local save failed. Export your record before leaving."),
          );
      });
      s.localError = "";
      if (!s.state.queue.length && s.failure.includes("Sync failed"))
        s.failure = "";
      if (broadcast) channel?.postMessage({ scope: s.scope });
    } catch (e) {
      s.localError = e.message;
      notify(s);
      throw e;
    }
  }
  async function rpc(name, args) {
    let timer;
    try {
      return await Promise.race([
        api.client.rpc(name, args),
        new Promise(
          (_, reject) =>
            (timer = setTimeout(
              () => reject(Error("Sync request timed out.")),
              15000,
            )),
        ),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function session() {
    await authReady;
    const scope = account();
    if (!sessions.has(scope))
      sessions.set(
        scope,
        (async () => {
          let state = await disk(scope);
          if (!state || !state.records || !Array.isArray(state.queue))
            state = { records: {}, queue: [] };
          return {
            scope,
            state,
            chain: Promise.resolve(),
            flushing: false,
            sending: null,
            failure: "",
            localError: "",
            cursor: null,
            more: false,
          };
        })().catch((e) => {
          sessions.delete(scope);
          throw e;
        }),
      );
    return sessions.get(scope);
  }
  async function ready() {
    const token = ++activation,
      s = await session();
    if (token === activation && s.scope === account()) {
      active = s;
      notify(s);
    }
    return s;
  }
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  const rows = () =>
    Object.values(active?.scope === account() ? active.state.records : {})
      .filter((r) => !r.deleted)
      .sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
      );
  const hasMore = () => active?.more || false;
  const saveState = () =>
    active?.localError ||
    active?.failure ||
    (active?.scope === "guest"
      ? "Saved on this device"
      : active?.state.queue.length
        ? active?.flushing
          ? "Saved locally · Syncing"
          : "Saved locally · Pending sync"
        : "Saved · Synced");
  async function change(s, fn, broadcast = true) {
    const next = s.chain
      .catch(() => {})
      .then(async () => {
        await persist(s, fn, broadcast);
        notify(s);
      });
    s.chain = next;
    return next;
  }
  async function put(
    data,
    id = crypto.randomUUID(),
    expected = account(),
    baseRevision,
  ) {
    data = validate(data);
    if (
      baseRevision !== undefined &&
      (!Number.isSafeInteger(baseRevision) || baseRevision < 0)
    )
      throw Error("Invalid record revision.");
    const s = await session();
    if (s.scope !== expected || account() !== expected)
      throw Error("Account changed. Reopen the record in the correct account.");
    let row;
    await change(s, () => {
      const old = s.state.records[id],
        now = new Date().toISOString();
      row = {
        id,
        data,
        revision: baseRevision ?? old?.revision ?? 0,
        created_at: old?.created_at || now,
        updated_at: now,
        deleted: false,
      };
      s.state.records[id] = row;
      if (s.scope !== "guest") {
        const pending = s.state.queue.find(
          (x) => x.id === id && !x.sent && !x.remove,
        );
        if (pending) pending.data = data;
        else
          s.state.queue.push({
            id,
            data,
            base: row.revision,
            op: crypto.randomUUID(),
          });
      }
      s.failure = "";
    });
    s.notBefore = Date.now() + syncDelay;
    clearTimeout(s.debounce);
    s.debounce = setTimeout(() => flush(s), syncDelay);
    return row;
  }
  async function remove(id, expected = account()) {
    const s = await session();
    if (s.scope !== expected || account() !== expected)
      throw Error("Account changed. Reopen the record.");
    await change(s, () => {
      const old = s.state.records[id];
      if (!old) return;
      s.state.records[id] = { ...old, data: {}, deleted: true };
      if (s.scope !== "guest") {
        s.state.queue = s.state.queue.filter((x) => x.id !== id || x.sent);
        s.state.queue.push({
          id,
          data: {},
          base: old.revision,
          op: crypto.randomUUID(),
          remove: true,
        });
      }
    });
    flush(s);
  }
  async function clear(expected = account()) {
    const s = await session();
    if (s.scope !== expected || account() !== expected)
      throw Error("Account changed. Reopen the workspace.");
    await change(s, () => {
      for (const r of Object.values(s.state.records)) {
        r.deleted = true;
        r.data = {};
      }
      s.state.queue = s.state.queue.filter((x) => x.sent);
      if (s.scope !== "guest")
        s.state.queue.push({ clear: true, op: crypto.randomUUID() });
    });
    flush(s);
  }
  function pending(s, id) {
    return s.state.queue.some((x) => x.clear || x.id === id);
  }
  async function merge(s, records) {
    await change(s, () => {
      for (const row of records) {
        if (pending(s, row.id)) continue;
        const old = s.state.records[row.id];
        if (!old || row.revision >= old.revision) s.state.records[row.id] = row;
      }
    });
  }
  async function load(reset = false) {
    const s = await session();
    if (s.scope === "guest" || !api.client) return;
    try {
      const cursor = reset ? null : s.cursor,
        { data, error } = await rpc("get_private_records", {
          kind,
          before_time: cursor?.created_at || null,
          before_id: cursor?.id || null,
          page_size: 25,
          expected_user: s.scope,
        });
      if (error) throw error;
      if (account() !== s.scope) return false;
      await merge(s, data || []);
      s.cursor = data?.at(-1);
      s.more = data?.length === 25;
      s.failure = "";
      notify(s);
      return true;
    } catch {
      s.failure =
        "History could not load. Your local records remain available; retry.";
      notify(s);
      return false;
    }
  }
  async function get(id) {
    const s = await session();
    if (s.scope !== "guest" && api.client && !pending(s, id)) {
      try {
        const { data, error } = await rpc("get_private_record", {
          kind,
          record_id: id,
          expected_user: s.scope,
        });
        if (error) throw error;
        if (account() !== s.scope) return null;
        if (data) await merge(s, [data]);
        s.failure = "";
      } catch {
        s.failure =
          "Could not refresh this record. Local edits will be kept; retry sync.";
        notify(s);
      }
    }
    return account() === s.scope && !s.state.records[id]?.deleted
      ? s.state.records[id]
      : null;
  }
  async function flush(provided) {
    const s = provided || (await session());
    if (
      s.flushing ||
      s.scope === "guest" ||
      account() !== s.scope ||
      !api.client ||
      !s.state.queue.length
    )
      return;
    if ((s.notBefore || 0) > Date.now()) {
      clearTimeout(s.debounce);
      s.debounce = setTimeout(() => flush(s), s.notBefore - Date.now());
      return;
    }
    s.flushing = true;
    clearTimeout(s.retry);
    try {
      await s.chain.catch(() => {});
      while (account() === s.scope) {
        let job;
        await change(s, () => {
          if (s.state.queue[0]) {
            s.state.queue[0].sent = true;
            job = structuredClone(s.state.queue[0]);
          }
        });
        if (!job) break;
        s.sending = job.op;
        const { data, error } = await rpc(
          job.clear ? "clear_private_records" : "save_private_record",
          job.clear
            ? { kind, operation_id: job.op, expected_user: s.scope }
            : {
                kind,
                record_id: job.id,
                payload: job.data,
                base_revision: job.base,
                operation_id: job.op,
                remove_record: !!job.remove,
                expected_user: s.scope,
              },
        );
        if (error) throw error;
        await change(s, () => {
          if (!s.state.queue.some((x) => x.op === job.op)) return;
          s.state.queue = s.state.queue.filter((x) => x.op !== job.op);
          if (!job.clear) {
            if (!data?.id) throw Error("No saved record returned.");
            const acknowledgedRevision = data.ack_revision ?? data.revision;
            const newer = s.state.queue.filter((x) => x.id === job.id),
              clearing = s.state.queue.some((x) => x.clear),
              local = s.state.records[job.id];
            if (data.conflict) {
              delete s.state.records[job.id];
              const replacement = {
                ...data,
                ...(newer.length ? { revision: acknowledgedRevision } : {}),
                ...(newer.length && local
                  ? { data: local.data, deleted: local.deleted }
                  : {}),
              };
              if (clearing) {
                replacement.deleted = true;
                replacement.data = {};
              }
              s.state.records[data.id] = replacement;
              newer.forEach((x) => {
                x.id = data.id;
                x.base = acknowledgedRevision;
              });
              if (active === s)
                window.dispatchEvent(
                  new CustomEvent("record-conflict", {
                    detail: { kind, from: job.id, to: data.id },
                  }),
                );
            } else {
              s.state.records[data.id] = clearing
                ? { ...data, deleted: true, data: {} }
                : newer.length
                  ? { ...local, revision: acknowledgedRevision }
                  : data;
              newer.forEach((x) => (x.base = acknowledgedRevision));
            }
          }
          s.failure = "";
        });
        s.sending = null;
      }
    } catch {
      s.failure =
        "Saved on this device · Sync failed. Retrying when connected.";
      notify(s);
      s.retry = setTimeout(() => flush(s), 15000);
    } finally {
      s.flushing = false;
      s.sending = null;
      notify(s);
    }
  }
  async function exportRows() {
    await ready();
    if (account() !== "guest") {
      if (!(await load(true)))
        throw Error(
          "Could not export every cloud record. Retry when connected.",
        );
      while (hasMore())
        if (!(await load()))
          throw Error(
            "Could not export every cloud record. Retry when connected.",
          );
    }
    return rows();
  }
  channel &&
    (channel.onmessage = async ({ data }) => {
      if (data.scope !== account()) return;
      const s = await session();
      if (s.flushing) return;
      // 从同一事务队列刷新，保留已落盘的本机操作且不回广播。
      await change(s, () => {}, false).catch(() => {});
    });
  window.addEventListener("workspace-ready", () =>
    ready()
      .then((s) => flush(s))
      .catch(() => {}),
  );
  window.addEventListener("online", () => flush().catch(() => {}));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden)
      ready()
        .then(async (s) => {
          await flush(s);
          await load(true);
        })
        .catch(() => {});
  });

  async function guestRows() {
    const state = await disk("guest");
    return Object.values(state?.records || {}).filter((r) => !r.deleted);
  }
  return {
    ready,
    subscribe,
    rows,
    hasMore,
    saveState,
    put,
    remove,
    clear,
    load,
    get,
    flush,
    exportRows,
    guestRows,
  };
}

// JSONB may reorder keys; compare record content independently of transport order.
export function recordSignature(data) {
  return JSON.stringify(data, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]]),
        )
      : value,
  );
}
