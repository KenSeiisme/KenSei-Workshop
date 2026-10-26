import {
  uiDate,
  uiMsg,
  uiJoin,
  uiError,
  uiText,
  uiConfirm,
} from "../site/ui.js";
// 恢复仅保存白名单文字；与 Workspace、同步队列及正式草稿完全分离。
const FIELDS = {
  "text-toolkit": ["text-input", "draft-name"],
  "markdown-studio": ["markdown-input", "draft-name"],
  "text-compare": [
    "compare-left",
    "compare-right",
    "compare-mode",
    "compare-case",
    "compare-space",
  ],
  "image-to-text": ["ocr-output", "draft-name"],
  "data-studio": ["data-json", "data-csv"],
  "subtitle-studio": [
    "sub-start",
    "sub-end",
    "sub-text",
    "sub-format",
    "sub-offset",
  ],
  "calculator-studio": ["calc-expression", "calc-angle"],
};
const LIMIT = 2 * 1024 * 1024;
let database;
function db() {
  return (database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open("kensei-tool-recovery-v1", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("preferences");
      request.result.createObjectStore("snapshots", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = null;
      reject(Error("Local recovery storage is unavailable."));
    };
    request.onblocked = () =>
      reject(Error("Close an older Workshop tab and retry local recovery."));
  }).catch((error) => {
    database = null;
    throw error;
  }));
}
async function read(scope, tool) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(["preferences", "snapshots"], "readonly"),
      preference = tx
        .objectStore("preferences")
        .get(JSON.stringify([scope, tool])),
      snapshots = tx.objectStore("snapshots").getAll();
    tx.oncomplete = () =>
      resolve({
        enabled: preference.result === true,
        snapshots: snapshots.result
          .filter((r) => r.scope === scope && r.tool === tool)
          .sort((a, b) => b.updated - a.updated || b.id.localeCompare(a.id)),
      });
    tx.onerror = tx.onabort = () =>
      reject(Error("Local recovery could not be read."));
  });
}
async function mutate(scope, tool, operation, value) {
  const database = await db();
  return new Promise((resolve, reject) => {
    let wrote = false;
    const tx = database.transaction(["preferences", "snapshots"], "readwrite"),
      preferences = tx.objectStore("preferences"),
      table = tx.objectStore("snapshots"),
      key = JSON.stringify([scope, tool]),
      pref = preferences.get(key),
      all = table.getAll();
    // 单一事务检查开关并写快照，避免关闭或切换账号后迟到的写入。
    all.onsuccess = () => {
      try {
        const rows = all.result.filter(
          (r) => r.scope === scope && r.tool === tool,
        );
        if (operation === "enable") preferences.put(value === true, key);
        if (operation === "clear" || (operation === "enable" && !value))
          rows.forEach((r) => table.delete(r.id));
        if (operation === "discard" && rows.some((r) => r.id === value))
          table.delete(value);
        if (operation === "save" && pref.result === true) {
          table.put(value);
          wrote = true;
          [value, ...rows.filter((r) => r.id !== value.id)]
            .sort((a, b) => b.updated - a.updated || b.id.localeCompare(a.id))
            .slice(3)
            .forEach((r) => table.delete(r.id));
        }
      } catch {
        // Quota/security failures inside IDB callbacks must reject the transaction, not escape as page errors.
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(operation === "save" ? wrote : true);
    tx.onerror = tx.onabort = () =>
      reject(
        Error(
          "Recovery could not be saved. Your text is still here; download it before leaving.",
        ),
      );
  });
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) uiText(node, text);
  if (className) node.className = className;
  return node;
}
export async function initRecovery(root, tool) {
  if (!FIELDS[tool]) return;
  const api = window.KenseiWorkspace,
    fields = FIELDS[tool]
      .map((id) => document.getElementById(id))
      .filter(Boolean),
    session = crypto.randomUUID(),
    panel = element("section", undefined, "recovery-panel"),
    heading = element("div", undefined, "recovery-heading"),
    label = element("label", undefined, "check-label"),
    toggle = element("input"),
    clear = element("button", uiMsg("Clear recovery"), "text-link"),
    state = element("p", uiMsg("Loading recovery preference…"), "muted small"),
    list = element("div", undefined, "recovery-list");
  toggle.type = "checkbox";
  toggle.id = "remember-on-device";
  toggle.disabled = true;
  const caption = document.createElement("span");
  uiText(caption, uiMsg("Remember on this device"));
  label.append(toggle, caption);
  clear.type = "button";
  clear.disabled = true;
  clear.dataset.clearRecovery = "";
  heading.append(label, clear);
  state.setAttribute("role", "status");
  state.dataset.recoveryState = "";
  panel.append(
    heading,
    element(
      "p",
      uiMsg(
        "Optional local recovery, separate from Workspace saves. Keeps up to 3 recent editing sessions, 2 MB each. No files, media or automatic cloud sync.",
      ),
      "muted small",
    ),
    state,
    list,
  );
  root.append(panel);
  let scope,
    enabled = false,
    timer,
    serial = 0,
    disposed = false;
  const current = (owner) =>
    !disposed && owner === scope && owner === (api.user?.id || "guest");
  const message = (text, error = false) => {
    uiText(state, text);
    state.classList.toggle("recovery-error", error);
  };
  const channel =
    typeof BroadcastChannel === "function"
      ? new BroadcastChannel("kensei-tool-recovery-v1")
      : null;
  let subtitle;
  if (tool === "subtitle-studio")
    subtitle = await import("./subtitle-studio.js");
  async function refresh() {
    const owner = scope,
      token = ++serial;
    try {
      const data = await read(owner, tool);
      if (!current(owner) || serial !== token) return;
      enabled = data.enabled;
      toggle.checked = enabled;
      list.replaceChildren();
      for (const row of data.snapshots.filter(
        (row) => row.session !== session,
      )) {
        const entry = element("div", undefined, "recovery-entry"),
          text = element(
            "span",
            "Unsaved local copy · " +
              uiDate(new Date(row.updated), {
                dateStyle: "medium",
                timeStyle: "short",
              }),
          ),
          actions = element("div", undefined, "action-row"),
          restore = element(
            "button",
            uiMsg("Restore copy"),
            "button secondary",
          ),
          discard = element("button", uiMsg("Discard"), "text-link");
        restore.type = discard.type = "button";
        restore.dataset.restoreRecovery = row.id;
        discard.dataset.discardRecovery = row.id;
        restore.onclick = async () => {
          if (!current(owner)) return;
          if (
            fields.some(
              (n) => n.value && n.type !== "checkbox" && n.tagName !== "SELECT",
            ) &&
            !uiConfirm(
              uiMsg(
                "Replace the current editor with this local copy? Workspace records will not be changed.",
              ),
            )
          )
            return;
          try {
            // 先验证全部字段，再修改界面，禁止部分恢复或导入任意字段。
            const values = fields.map((n) => {
              const value = row.fields?.[n.id];
              if (n.type === "checkbox") {
                if (typeof value !== "boolean")
                  throw Error("This recovery copy is invalid.");
              } else if (
                typeof value !== "string" ||
                (n.maxLength > 0 && value.length > n.maxLength) ||
                (n.tagName === "SELECT" &&
                  ![...n.options].some((o) => o.value === value))
              )
                throw Error(
                  "This recovery copy is invalid or exceeds the editor limit.",
                );
              return [n, value];
            });
            if (subtitle) subtitle.restoreRecovery(row.subtitle);
            values.forEach(([n, value]) => {
              if (n.type === "checkbox") n.checked = value;
              else n.value = value;
            });
            window.dispatchEvent(
              new CustomEvent("tool-recovery-restored", { detail: { tool } }),
            );
            const url = new URL(location.href);
            url.searchParams.delete("draft");
            history.replaceState(null, "", url);
            values.forEach(([n]) => {
              n.dispatchEvent(new Event("input", { bubbles: true }));
              n.dispatchEvent(new Event("change", { bubbles: true }));
            });
            message(
              uiMsg(
                "Recovered as an unsaved local copy. Workspace records are unchanged.",
              ),
            );
          } catch (error) {
            message(uiError(error), true);
          }
        };
        discard.onclick = async () => {
          if (!current(owner)) return;
          try {
            await mutate(owner, tool, "discard", row.id);
            await refresh();
            message(uiMsg("Recovery copy discarded."));
            channel?.postMessage({ scope: owner, tool });
          } catch (e) {
            message(uiError(e), true);
          }
        };
        actions.append(restore, discard);
        entry.append(text, actions);
        list.append(entry);
      }
    } catch (error) {
      if (current(owner)) message(uiError(error), true);
    }
  }
  async function save() {
    const owner = scope;
    if (!enabled || !current(owner) || window.KenseiTemporaryHandoff) return;
    const values = Object.fromEntries(
        fields.map((n) => [n.id, n.type === "checkbox" ? n.checked : n.value]),
      ),
      record = {
        id: JSON.stringify([owner, tool, session]),
        scope: owner,
        tool,
        session,
        updated: Date.now(),
        fields: values,
        ...(subtitle ? { subtitle: subtitle.recoveryData() } : {}),
      };
    if (new TextEncoder().encode(JSON.stringify(record)).length > LIMIT)
      return message(
        uiMsg(
          "Recovery not updated: this editor exceeds 2 MB. An older copy may remain; download the current content before leaving.",
        ),
        true,
      );
    try {
      const wrote = await mutate(owner, tool, "save", record);
      if (!current(owner) || !enabled) return;
      if (!wrote) {
        await refresh();
        message(
          uiMsg(
            "Recovery is off in another tab. Workspace records are unchanged.",
          ),
        );
        return;
      }
      message(
        uiJoin([
          uiMsg("Recovery saved locally · "),
          new Date(record.updated).toLocaleTimeString(),
          ". Separate from Workspace saves.",
        ]),
      );
      channel?.postMessage({ scope: owner, tool });
    } catch (error) {
      if (current(owner)) message(uiError(error), true);
    }
  }
  function schedule() {
    clearTimeout(timer);
    if (window.KenseiTemporaryHandoff) {
      message(
        uiMsg(
          "Transferred content stays temporary. Save a draft or download it to keep it.",
        ),
      );
      return;
    }
    if (enabled) {
      message(
        uiMsg(
          "Recovery pending · changes stay on this page until saved locally.",
        ),
      );
      timer = setTimeout(save, 500);
    }
  }
  root.addEventListener("input", (event) => {
    if (fields.includes(event.target)) schedule();
  });
  window.addEventListener("tool-content-changed", schedule);
  root.addEventListener("click", (event) => {
    if (!panel.contains(event.target)) setTimeout(schedule, 0);
  });
  toggle.onchange = async () => {
    clearTimeout(timer);
    const owner = scope,
      next = toggle.checked;
    enabled = false;
    toggle.disabled = true;
    try {
      await mutate(owner, tool, "enable", next);
      if (!current(owner)) return;
      await refresh();
      message(
        next
          ? uiMsg(
              "Recovery enabled for this tool and account on this device only.",
            )
          : uiMsg(
              "Recovery off. Local recovery copies cleared; Workspace records unchanged.",
            ),
      );
      if (next) schedule();
      channel?.postMessage({ scope: owner, tool });
    } catch (error) {
      message(uiError(error), true);
      await refresh();
    } finally {
      toggle.disabled = false;
    }
  };
  clear.onclick = async () => {
    clearTimeout(timer);
    const owner = scope;
    try {
      await mutate(owner, tool, "clear");
      if (!current(owner)) return;
      await refresh();
      message(
        uiMsg(
          "Recovery copies cleared. Editing and Workspace records are unchanged.",
        ),
      );
      channel?.postMessage({ scope: owner, tool });
    } catch (error) {
      message(uiError(error), true);
    }
  };
  if (channel)
    channel.onmessage = (event) => {
      if (event.data?.scope === scope && event.data?.tool === tool) refresh();
    };
  window.addEventListener("pagehide", () => {
    clearTimeout(timer);
    disposed = true;
    channel?.close();
  });
  if (!api.ready)
    await new Promise((resolve) =>
      window.addEventListener("workspace-ready", resolve, { once: true }),
    );
  scope = api.user?.id || "guest";
  await refresh();
  toggle.disabled = clear.disabled = false;
  const temporary = () => {
    if (window.KenseiTemporaryHandoff) {
      clearTimeout(timer);
      toggle.disabled = true;
      message(
        uiMsg(
          "Transferred content stays temporary. Save a draft or download it to keep it.",
        ),
      );
    }
  };
  window.addEventListener("handoff-temporary", temporary);
  temporary();
  panel.dataset.recoveryReady = "true";
  if (!state.classList.contains("recovery-error"))
    message(
      enabled
        ? uiMsg("Recovery enabled. Choose a dated local copy to restore.")
        : uiMsg("Recovery off. Workspace saves continue to work normally."),
    );
}
