import { $, api, downloadText, filename } from "./common.js";
import { ensureProfile, paintAvatar } from "./profile-service.js";
import {
  elementStamp,
  sharedChanges,
  sharedData,
  checkedSharedData,
} from "./shared-whiteboard-core.js";
import { sceneSettings } from "./whiteboard-core.js";
import {
  uiMsg,
  uiText,
  uiError,
  uiConfirm,
  uiOption,
  uiJoin,
} from "../site/ui.js";

// Shared scenes never pass through the private board store or its conflict-copy queue.
export function mountSharedBoard(bridge) {
  const clientId = crypto.randomUUID();
  const actor = () => api.user?.id || "guest";
  let active = false,
    room = null,
    owner = actor(),
    generation = 0,
    editing = false,
    connected = false;
  let privateSnapshot = null,
    known = new Map(),
    pending = new Map(),
    outbound = new Map(),
    settingsKnown = "",
    settingsPending = null;
  let channels = [],
    ownChannel = null,
    interval = null,
    heartbeat = null,
    saveTimer = null,
    maxSaveTimer = null,
    recoveryTimer = null;
  let cursor = null,
    operation = null,
    saving = false,
    refreshing = false,
    installing = false,
    buffered = [],
    lastRevision = 0;
  let latest = null,
    invites = null,
    recoveryDb = null,
    connectionSerial = 0,
    ownsRecovery = false,
    revisionOutbound = null,
    overLimit = false,
    accessToken = null,
    starting = false;
  const onlineMembers = new Map();
  const cursors = new Map();
  const url = new URL(location.href);
  let requested = url.searchParams.get("room");
  let invited = new URLSearchParams(url.hash.slice(1)).get("invite");
  const notice = (message, failed = false) => {
    uiText($("#shared-status"), message);
    $("#shared-status").classList.toggle("error-text", failed);
    uiText($("#tool-status"), message);
  };
  const live = (source) => uiText($("#shared-live-status"), uiMsg(source));
  const saved = (source) => uiText($("#shared-save-status"), uiMsg(source));
  async function rpc(action, body = {}) {
    if (!api.user || !api.client)
      throw Error("Sign in to use shared whiteboards.");
    const expected = actor();
    if (api.client.auth?.getSession) {
      const current = await api.client.auth.getSession();
      accessToken = current.data?.session?.access_token || null;
    }
    const { data, error } = await api.client.rpc("whiteboard_room", {
      action,
      body: {
        client_id: clientId,
        ...body,
        client_version: 2,
        ...(action === "create"
          ? { appState: sceneSettings(body.appState || {}) }
          : {}),
      },
    });
    if (actor() !== expected) throw Error("Account changed. Please reload.");
    if (error || data?.error) throw error || Error(data.error);
    return data;
  }
  const body = () => ({ room_id: room.id });
  const topic = (speaker) =>
    `whiteboard:${room.id}:${room.channel_key}:${speaker}`;
  function setEditing(value) {
    editing = !!value;
    bridge.editing(editing && connected);
    live(
      editing && connected
        ? "Connected"
        : connected
          ? "Read only · another editor or online capacity is busy"
          : "Reconnecting",
    );
  }
  function controls() {
    $("#shared-room-controls").hidden = !room;
    $("#shared-signin").hidden = !!api.user;
    for (const id of ["shared-new", "shared-join"])
      $("#" + id).disabled = !api.user || starting;
    $("#shared-copy-personal").disabled =
      !api.user || !privateSnapshot?.name || starting;
    $("#shared-select").disabled = starting;
    if (!room) return;
    const mine = room.owner_id === api.user?.id;
    $("#shared-owner-actions").hidden = !mine;
    $("#shared-leave").hidden = mine;
    if (document.activeElement !== $("#shared-name"))
      $("#shared-name").value = room.name;
    $("#shared-name").disabled = !mine;
    const out = $("#shared-members");
    out.replaceChildren();
    for (const member of room.members) {
      const row = document.createElement("div");
      row.className = "shared-member";
      const avatar = document.createElement("span");
      avatar.className = "avatar-badge avatar-small";
      paintAvatar(avatar, member.profile);
      const label = document.createElement("span");
      label.textContent = member.profile?.nickname || "Member";
      const state = document.createElement("small");
      uiText(
        state,
        uiJoin([
          member.id === room.owner_id ? uiMsg("Owner") : uiMsg("Member"),
          " · ",
          (onlineMembers.get(member.id) ?? member.online)
            ? uiMsg("Online")
            : uiMsg("Offline"),
        ]),
      );
      row.append(avatar, label, state);
      if (mine && member.id !== api.user.id) {
        const remove = document.createElement("button");
        remove.className = "text-link";
        uiText(remove, uiMsg("Remove"));
        remove.onclick = () => manage("remove", { user_id: member.id });
        row.append(remove);
      }
      out.append(row);
    }
  }
  async function recovery(value) {
    if (!room || (value !== undefined && !ownsRecovery)) return;
    const id = owner + ":" + room.id;
    const db = await (recoveryDb ||= new Promise((resolve, reject) => {
      const r = indexedDB.open("kensei-shared-whiteboard-recovery-v1", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("pending");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        "pending",
        value === undefined ? "readonly" : "readwrite",
      );
      const store = tx.objectStore("pending");
      const req =
        value === undefined
          ? store.get(id)
          : value === null
            ? store.delete(id)
            : store.put(structuredClone(value), id);
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  function draft() {
    return {
      elements: overLimit ? latest.elements : [...pending.values()],
      appState: settingsPending,
      operation,
      snapshot: latest,
      owner,
    };
  }
  function queueRecovery() {
    if (recoveryTimer) return;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      recovery(draft()).catch(() =>
        notice(
          uiMsg("Local recovery failed. Export a backup before leaving."),
          true,
        ),
      );
    }, 500);
  }
  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 2000);
    maxSaveTimer ||= setTimeout(flush, 5000);
  }
  function queueLocal(elements, state, files) {
    if (!active || !room || installing) return;
    if (!editing || !connected) return;
    try {
      if (elements.length > 10000) {
        latest = sharedData(room.name, elements, state);
        overLimit = true;
        outbound.clear();
        queueRecovery();
        saved("Save failed");
        notice(
          uiMsg(
            "This shared whiteboard exceeds 2 MB or 10,000 elements. Export or save a private copy.",
          ),
          true,
        );
        return;
      }
      sharedChanges(elements);
      const changes = elements.filter(
        (e) => known.get(e.id) !== elementStamp(e),
      );
      const settings = sceneSettings(state),
        signature = JSON.stringify(settings);
      if (!changes.length && signature === settingsKnown) return;
      for (const e of changes) {
        known.set(e.id, elementStamp(e));
        pending.set(e.id, structuredClone(e));
        outbound.set(e.id, structuredClone(e));
      }
      if (
        signature !== settingsKnown ||
        (!room.appState?.paper && changes.length)
      ) {
        settingsKnown = signature;
        settingsPending = settings;
      }
      latest = sharedData(room.name, elements, settings);
      saved("Pending save");
      queueRecovery();
      try {
        checkedSharedData(room.name, elements, settings);
      } catch (e) {
        notice(uiError(e), true);
        overLimit = true;
        outbound.clear();
        saved("Save failed");
        return;
      }
      overLimit = false;
      queueSave();
    } catch (e) {
      notice(uiError(e), true);
      setEditing(false);
    }
  }
  function applyScene(data, fromRecovery = false) {
    if (!data?.elements) return;
    if (!fromRecovery) sharedChanges(data.elements);
    const apiDrawing = bridge.api();
    if (!apiDrawing) return;
    const merged = bridge.reconcile(
      apiDrawing.getSceneElementsIncludingDeleted(),
      data.elements,
      apiDrawing.getAppState(),
    );
    known = new Map(merged.map((e) => [e.id, elementStamp(e)]));
    const settings = settingsPending || data.appState || room.appState;
    settingsKnown = JSON.stringify(sceneSettings(settings));
    latest = sharedData(room.name, merged, settings);
    bridge.remote(merged, settings);
  }
  function collaborators() {
    const map = new Map();
    for (const [id, position] of cursors) {
      const m = room?.members.find((x) => x.id === id);
      if (m && id !== api.user?.id)
        map.set(id, {
          pointer: { x: position.x, y: position.y, tool: "pointer" },
          button: position.button || "up",
          username: m.profile?.nickname || "Member",
          color: {
            background: position.color || "#d6b6ec",
            stroke: position.color || "#d6b6ec",
          },
        });
    }
    bridge.collaborators(map);
  }
  function receive(speaker, payload) {
    if (!room || !active) return;
    if (installing) {
      if (buffered.length < 100) buffered.push([speaker, payload]);
      return;
    }
    try {
      if (payload.elements) {
        if (JSON.stringify(payload.elements).length > 60000)
          throw Error("Remote update is too large.");
        applyScene({ elements: payload.elements, appState: room.appState });
      }
      if (
        payload.cursor &&
        Number.isFinite(payload.cursor.x) &&
        Number.isFinite(payload.cursor.y)
      ) {
        cursors.set(speaker, payload.cursor);
        collaborators();
      }
      if (payload.revision) refresh();
    } catch {
      notice(
        uiMsg(
          "A remote update could not be applied. Reconnect to reload the saved board.",
        ),
        true,
      );
    }
  }
  async function disconnect() {
    connectionSerial++;
    for (const c of channels)
      await api.client?.removeChannel(c).catch(() => {});
    channels = [];
    ownChannel = null;
    connected = false;
    cursors.clear();
    bridge.collaborators(new Map());
  }
  async function connect(token) {
    await disconnect();
    if (token !== generation || !room) return;
    installing = true;
    live("Connecting");
    const connectionToken = connectionSerial;
    try {
      const create = (speaker) =>
        new Promise((resolve, reject) => {
          const channel = api.client.channel(topic(speaker), {
            config: {
              private: true,
              broadcast: { self: false },
              presence: { key: api.user.id },
            },
          });
          channels.push(channel);
          if (speaker !== "control")
            channel.on("presence", { event: "sync" }, () => {
              onlineMembers.set(
                speaker,
                Object.keys(channel.presenceState()).length > 0,
              );
              controls();
            });
          if (speaker === "control")
            channel.on("broadcast", { event: "changed" }, () => refresh());
          else
            channel.on("broadcast", { event: "update" }, ({ payload }) =>
              receive(speaker, payload),
            );
          const deadline = setTimeout(
            () =>
              reject(Error("Shared connection timed out. Reconnect to retry.")),
            10000,
          );
          channel.subscribe((status) => {
            if (token !== generation || connectionToken !== connectionSerial)
              return;
            if (status === "SUBSCRIBED") {
              clearTimeout(deadline);
              if (speaker === api.user.id) {
                ownChannel = channel;
                if (editing)
                  channel.track({ client_id: clientId }).catch(() => {});
              }
              resolve();
            } else if (
              ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)
            ) {
              clearTimeout(deadline);
              connected = false;
              setEditing(false);
              reject(
                Error("Shared connection was interrupted. Reconnect to retry."),
              );
            }
          });
        });
      await Promise.all(
        ["control", ...room.members.map((x) => x.id)].map(create),
      );
      if (token !== generation) return;
      const snapshot = await rpc("get", body());
      if (token !== generation) return;
      room = snapshot;
      applyScene(snapshot);
      lastRevision = snapshot.revision;
      installing = false;
      connected = true;
      const waiting = buffered;
      buffered = [];
      for (const item of waiting) receive(...item);
      controls();
      setEditing(editing);
    } catch (e) {
      if (token !== generation) return;
      installing = false;
      connected = false;
      setEditing(false);
      notice(uiError(e), true);
    }
  }
  async function refresh() {
    if (!room || refreshing || !active) return;
    refreshing = true;
    const token = generation;
    try {
      const next = await rpc("get", body());
      if (token !== generation) return;
      const changed =
        next.channel_key !== room.channel_key ||
        next.members.map((x) => x.id).join() !==
          room.members.map((x) => x.id).join();
      room = next;
      if (next.revision !== lastRevision) {
        applyScene(next);
        lastRevision = next.revision;
      }
      controls();
      if (changed) await connect(token);
    } catch (e) {
      if (token === generation) {
        setEditing(false);
        notice(uiError(e), true);
      }
    } finally {
      refreshing = false;
    }
  }
  async function beat() {
    if (!room || !active || !navigator.onLine) return;
    const token = generation;
    try {
      const next = await rpc("heartbeat", body());
      if (token !== generation) return;
      const changed =
        next.channel_key !== room.channel_key ||
        next.members.map((x) => x.id).join() !==
          room.members.map((x) => x.id).join();
      const needsScene = next.revision !== lastRevision;
      room = { ...room, ...next, elements: room.elements };
      if (changed) await connect(token);
      else if (!connected) await connect(token);
      ownsRecovery ||= next.editing;
      setEditing(next.editing);
      controls();
      if (needsScene) await refresh();
      if (editing && (pending.size || operation)) flush();
    } catch (e) {
      if (token === generation) {
        connected = false;
        setEditing(false);
        notice(uiError(e), true);
      }
    }
  }
  async function flush() {
    clearTimeout(saveTimer);
    clearTimeout(maxSaveTimer);
    saveTimer = maxSaveTimer = null;
    if (
      !room ||
      !active ||
      saving ||
      !editing ||
      !connected ||
      overLimit ||
      (!pending.size && !settingsPending && !operation)
    )
      return;
    const token = generation;
    saving = true;
    saved("Saving");
    operation ||= {
      id: crypto.randomUUID(),
      elements: [...pending.values()].map((x) => structuredClone(x)),
      ...(settingsPending
        ? { appState: structuredClone(settingsPending) }
        : {}),
    };
    const sent = operation;
    try {
      await recovery(draft());
      const next = await rpc("save", {
        ...body(),
        channel_key: room.channel_key,
        operation_id: sent.id,
        elements: sent.elements,
        ...(sent.appState ? { appState: sent.appState } : {}),
      });
      if (token !== generation) return;
      for (const e of sent.elements)
        if (elementStamp(pending.get(e.id) || {}) === elementStamp(e))
          pending.delete(e.id);
      if (
        sent.appState &&
        JSON.stringify(settingsPending) === JSON.stringify(sent.appState)
      )
        settingsPending = null;
      operation = null;
      room = next;
      applyScene(next);
      lastRevision = next.revision;
      saved(pending.size || settingsPending ? "Pending save" : "Saved");
      await recovery(pending.size || settingsPending ? draft() : null);
      revisionOutbound = next.revision;
      for (const e of sent.elements)
        if (elementStamp(outbound.get(e.id) || {}) === elementStamp(e))
          outbound.delete(e.id);
      if (pending.size || settingsPending) queueSave();
    } catch (e) {
      if (token === generation) {
        saved("Save failed");
        notice(uiError(e), true);
        queueRecovery();
      }
    } finally {
      saving = false;
    }
  }
  function send() {
    if (!active || !connected || !editing || !ownChannel || overLimit) return;
    const elements = [...outbound.values()];
    const payload = {
      ...(elements.length ? { elements } : {}),
      ...(cursor ? { cursor } : {}),
      ...(revisionOutbound ? { revision: revisionOutbound } : {}),
    };
    if (!elements.length && !cursor && !revisionOutbound) return;
    if (new TextEncoder().encode(JSON.stringify(payload)).length > 48000) {
      queueSave();
      return;
    }
    outbound.clear();
    cursor = null;
    revisionOutbound = null;
    ownChannel
      .send({ type: "broadcast", event: "update", payload })
      .catch(() => {
        connected = false;
        setEditing(false);
      });
  }
  async function stop() {
    generation++;
    clearInterval(interval);
    clearInterval(heartbeat);
    clearTimeout(saveTimer);
    clearTimeout(maxSaveTimer);
    clearTimeout(recoveryTimer);
    if (room) {
      if (pending.size || operation) await recovery(draft()).catch(() => {});
      await rpc("release", body()).catch(() => {});
    }
    await disconnect();
    editing = false;
    room = null;
    operation = null;
    pending.clear();
    outbound.clear();
    known.clear();
    buffered = [];
    settingsPending = null;
    latest = null;
    invites = null;
  }
  async function loadRoom(data) {
    const loadingOwner = actor();
    const stopping = stop(),
      stopGeneration = generation;
    await stopping;
    if (loadingOwner !== actor() || generation !== stopGeneration) return;
    active = true;
    owner = actor();
    room = data;
    ownsRecovery = false;
    overLimit = false;
    const token = ++generation;
    lastRevision = data.revision;
    pending = new Map();
    known = new Map(data.elements.map((e) => [e.id, elementStamp(e)]));
    settingsKnown = JSON.stringify(sceneSettings(data.appState));
    latest = sharedData(data.name, data.elements, data.appState);
    await bridge.mount(latest);
    if (token !== generation) return;
    const restored = await recovery().catch(() => null);
    if (restored?.owner === owner) {
      pending = new Map((restored.elements || []).map((e) => [e.id, e]));
      settingsPending = restored.appState;
      operation = restored.operation;
      applyScene(
        {
          elements: restored.elements || [],
          appState: settingsPending || data.appState,
        },
        true,
      );
      try {
        checkedSharedData(room.name, latest.elements, latest.appState);
      } catch {
        overLimit = true;
      }
      saved(overLimit ? "Save failed" : "Pending save");
    } else saved("Saved");
    const access = await rpc("activate", body());
    if (token !== generation) return;
    editing = access.editing;
    ownsRecovery ||= editing;
    room = access;
    await connect(token);
    controls();
    // Coalesce edits/cursors at about 1.5 Hz, reserving Free-plan capacity for Pong and reconnects.
    interval = setInterval(send, 650);
    heartbeat = setInterval(beat, 10000);
    $("#shared-browser").open = false;
    requested = null;
    history.replaceState(
      null,
      "",
      location.pathname + "?room=" + encodeURIComponent(room.id),
    );
    notice(
      editing
        ? uiMsg("Everyone in this room can draw. Changes save automatically.")
        : uiMsg(
            "Read only. Another tab is editing, or online capacity is busy. Reconnect to retry.",
          ),
    );
    if (editing && (pending.size || operation)) queueSave();
  }
  async function list() {
    controls();
    if (!api.user) return;
    const token = generation;
    try {
      await ensureProfile();
      const rows = await rpc("list");
      if (token !== generation) return;
      const select = $("#shared-select");
      select.replaceChildren(uiOption(uiMsg("Choose a shared whiteboard"), ""));
      for (const row of rows) select.append(new Option(row.name, row.id));
      if (room) select.value = room.id;
    } catch (e) {
      notice(uiError(e), true);
    }
  }
  async function tab(shared) {
    if (shared === active) return;
    if (shared) {
      await bridge.beforeEnter();
      privateSnapshot = bridge.privateData();
      active = true;
      owner = actor();
      await bridge.mount(
        {
          name: "Shared whiteboard",
          elements: [],
          appState: { viewBackgroundColor: "#ffffff", gridSize: null },
        },
        { preview: true },
      );
      bridge.editing(false);
    } else {
      await flush();
      await stop();
      active = false;
      await bridge.personal();
      if (new URL(location.href).searchParams.has("room"))
        history.replaceState(null, "", location.pathname);
    }
    for (const [id, selected] of [
      ["board-personal-tab", !shared],
      ["board-shared-tab", shared],
    ]) {
      const n = $("#" + id);
      n.setAttribute("aria-selected", String(selected));
      n.tabIndex = selected ? 0 : -1;
    }
    $("#board-personal-panel").hidden = shared;
    $("#board-shared-panel").hidden = !shared;
    if (shared) await list();
  }
  async function create(copy) {
    if (starting) return;
    starting = true;
    controls();
    const requestGeneration = generation,
      requestOwner = actor();
    try {
      await ensureProfile();
      const source = copy ? privateSnapshot : null;
      const data = source
        ? bridge.normalize(source)
        : {
            name: "Shared whiteboard",
            elements: [],
            appState: { viewBackgroundColor: "#ffffff", gridSize: null },
          };
      const next = await rpc("create", data);
      if (
        requestGeneration !== generation ||
        requestOwner !== actor() ||
        !active
      )
        return;
      await loadRoom(next);
      await list();
    } catch (e) {
      notice(uiError(e), true);
    } finally {
      starting = false;
      controls();
    }
  }
  async function join() {
    if (starting) return;
    starting = true;
    controls();
    const requestGeneration = generation,
      requestOwner = actor();
    try {
      await ensureProfile();
      const value = $("#shared-code").value.trim();
      const args = value ? { code: value } : { token: invited };
      const next = await rpc("join", args);
      if (
        requestGeneration !== generation ||
        requestOwner !== actor() ||
        !active
      )
        return;
      invited = null;
      await loadRoom(next);
      await list();
    } catch (e) {
      notice(uiError(e), true);
    } finally {
      starting = false;
      controls();
    }
  }
  async function manage(action, extra = {}) {
    if (!room) return;
    if (
      ["remove", "reset_invite", "delete", "leave"].includes(action) &&
      !uiConfirm(uiMsg("Apply this change to the shared whiteboard?"))
    )
      return;
    try {
      const previous = room;
      const next = await rpc(action, { ...body(), ...extra });
      if (["delete", "leave"].includes(action)) {
        await stop();
        requested = null;
        history.replaceState(null, "", location.pathname);
        bridge.editing(false);
        controls();
        await list();
        return;
      }
      if (["reset_invite", "remove"].includes(action)) {
        $("#shared-invite-output").hidden = true;
        $("#shared-invite-output").textContent = "";
      }
      if (action === "reset_invite") {
        invites = next;
        notice(
          uiMsg("Invitation reset. Previously joined members keep access."),
        );
        return;
      }
      room = next;
      controls();
      if (previous.channel_key !== next.channel_key) await connect(generation);
      await list();
    } catch (e) {
      notice(uiError(e), true);
    }
  }
  async function invitation(codeOnly) {
    try {
      invites = await rpc("invite", body());
      const value = codeOnly
        ? invites.code
        : location.origin +
          location.pathname +
          "?room=" +
          room.id +
          "#invite=" +
          invites.token;
      const out = $("#shared-invite-output");
      out.hidden = true;
      try {
        await navigator.clipboard.writeText(value);
        notice(uiMsg("Invitation copied."));
      } catch {
        out.hidden = false;
        out.textContent = value;
        notice(uiMsg("Copy the invitation shown below."));
      }
    } catch (e) {
      notice(uiError(e), true);
    }
  }
  $("#board-personal-tab").onclick = () =>
    tab(false).catch((e) => notice(uiError(e), true));
  $("#board-shared-tab").onclick = () =>
    tab(true).catch((e) => notice(uiError(e), true));
  $(".board-mode-tabs").addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const shared =
      e.key === "End" ||
      (e.key === "ArrowRight" && !active) ||
      (e.key === "ArrowLeft" && !active);
    $("#" + (shared ? "board-shared-tab" : "board-personal-tab")).focus();
    tab(shared).catch((e) => notice(uiError(e), true));
  });
  $("#shared-new").onclick = () => create(false);
  $("#shared-copy-personal").onclick = () => create(true);
  $("#shared-join").onclick = join;
  $("#shared-login").onclick = () =>
    api.openAuth(location.pathname + location.search + location.hash);
  $("#shared-refresh").onclick = list;
  $("#shared-select").onchange = async (e) => {
    if (!e.target.value) return;
    try {
      await flush();
      const requestGeneration = generation;
      const chosen = await rpc("get", { room_id: e.target.value });
      if (requestGeneration !== generation || !active) return;
      await loadRoom(chosen);
    } catch (error) {
      notice(uiError(error), true);
    }
  };
  $("#shared-reconnect").onclick = beat;
  $("#shared-name").onchange = () =>
    manage("rename", { name: $("#shared-name").value });
  $("#shared-reset-invite").onclick = () => manage("reset_invite");
  $("#shared-delete").onclick = () => manage("delete");
  $("#shared-leave").onclick = () => manage("leave");
  $("#shared-invite").onclick = () => invitation(false);
  $("#shared-invite-code").onclick = () => invitation(true);
  $("#shared-private-copy").onclick = () =>
    bridge.privateCopy(data()).catch((e) => notice(uiError(e), true));
  for (const format of ["json", "png", "svg"])
    $("#shared-" + format).onclick = () => bridge.export(format);
  $("#shared-expand").onclick = () => $("#board-fullscreen").click();
  function data() {
    if (!room) throw Error("Choose a shared whiteboard.");
    const drawing = bridge.api();
    return sharedData(
      room.name,
      drawing?.getSceneElementsIncludingDeleted() || latest?.elements || [],
      bridge.state?.() ||
        drawing?.getAppState() ||
        latest?.appState ||
        room.appState,
    );
  }
  window.addEventListener("offline", () => {
    connected = false;
    setEditing(false);
    queueRecovery();
  });
  window.addEventListener("online", beat);
  window.addEventListener("pagehide", () => {
    if (room && accessToken) {
      const config = window.KENSEI_CONFIG;
      fetch(config.supabaseUrl + "/rest/v1/rpc/whiteboard_room", {
        method: "POST",
        keepalive: true,
        headers: {
          apikey: config.supabasePublishableKey,
          Authorization: "Bearer " + accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "release",
          body: { room_id: room.id, client_id: clientId },
        }),
      }).catch(() => {});
    }
    stop();
  });
  window.addEventListener("beforeunload", (e) => {
    if (active && (pending.size || operation)) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  window.addEventListener("workspace-ready", () =>
    workspaceChanged().catch((e) => notice(uiError(e), true)),
  );
  async function workspaceChanged() {
    const wasActive = active,
      desired = active || !!requested;
    if (owner !== actor()) {
      await stop();
      active = false;
      owner = actor();
      privateSnapshot = null;
      if (wasActive) {
        bridge.resetPrivate();
        await bridge.mount({
          name: "",
          elements: [],
          appState: { viewBackgroundColor: "#ffffff" },
        });
      }
    }
    if (desired) {
      await tab(true);
      if (requested && api.user && !invited) {
        try {
          await ensureProfile();
          await loadRoom(await rpc("get", { room_id: requested }));
        } catch (e) {
          notice(uiError(e), true);
        }
      }
    }
    if (desired && (!api.user || invited || !room)) bridge.showBoards?.();
    controls();
  }

  queueMicrotask(async () => {
    if (requested) {
      try {
        await tab(true);
        if (invited) {
          bridge.showBoards?.();
          notice(uiMsg("You have an invitation. Sign in, then choose Join."));
        } else if (api.user)
          await loadRoom(await rpc("get", { room_id: requested }));
        else bridge.showBoards?.();
      } catch (e) {
        notice(uiError(e), true);
      }
    }
  });
  return {
    get active() {
      return active;
    },
    data,
    personal: () => tab(false),
    change: queueLocal,
    pointer(payload) {
      if (editing)
        cursor = {
          x: payload.pointer.x,
          y: payload.pointer.y,
          button: payload.button,
          color: ["#d6b6ec", "#efbdd9", "#a7ceef", "#b0dbc7"][
            Math.max(
              0,
              room?.members.findIndex((x) => x.id === api.user?.id) || 0,
            )
          ],
        };
    },
  };
}
