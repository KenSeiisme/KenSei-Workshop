import { $, api, status, download, downloadText, filename } from "./common.js";
import { createRecordStore, recordSignature } from "./record-store.js";
import { mountSharedBoard } from "./shared-whiteboard.js";
import {
  validateWhiteboard,
  whiteboardData,
  importWhiteboard,
  editableScene,
  assertVectorScene,
} from "./whiteboard-core.js";
import {
  uiOption,
  uiMsg,
  uiJoin,
  uiFrom,
  uiError,
  uiText,
  uiConfirm,
} from "../site/ui.js";

export const store = createRecordStore("whiteboard", validateWhiteboard, {
  syncDelay: 2000,
});
const owner = () => api.user?.id || "guest";
const host = $("#board-canvas"),
  drafts = new Map();
let engine,
  root,
  drawing,
  board = null,
  scope = owner(),
  timer,
  dirty = false,
  saving = false,
  serial = 0,
  switching = 0,
  signature = "",
  persistedSignature = "",
  lastScene = null,
  error = "",
  ignore = false,
  renderVersion = 0,
  shared = null;
const requested = new URLSearchParams(location.search).get("id");
const css = document.createElement("link");
css.rel = "stylesheet";
css.href = "/vendor/whiteboard/index.css";
document.head.append(css);
window.EXCALIDRAW_ASSET_PATH = "/vendor/whiteboard/";
const engineReady = import("/vendor/whiteboard/engine.js").then((mod) => {
  engine = mod;
  root = engine.createRoot(host);
  return mod;
});
const key = (account, id) => account + ":" + id;
let recoveryDatabase;
async function recovery(account, id, value) {
  const database = await (recoveryDatabase ||= new Promise(
    (resolve, reject) => {
      const request = indexedDB.open("kensei-whiteboard-recovery-v1", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("drawings");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(Error("Local recovery storage is unavailable."));
    },
  ));
  return new Promise((resolve, reject) => {
    const tx = database.transaction(
        "drawings",
        value === undefined ? "readonly" : "readwrite",
      ),
      table = tx.objectStore("drawings"),
      idKey = key(account, id),
      request =
        value === undefined
          ? table.get(idKey)
          : value === null
            ? table.delete(idKey)
            : table.put(structuredClone(value), idKey);
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () =>
      reject(Error("Recovery save failed. Export before leaving this page."));
  });
}
function message(text, failed = false) {
  status(text, failed);
}
function controls() {
  const enabled = !!board;
  for (const id of [
    "board-name",
    "board-delete",
    "board-json",
    "board-png",
    "board-svg",
  ])
    $("#" + id).disabled = !enabled;
  $("#board-guests").hidden = !api.user;
  uiText(
    $("#board-state"),
    error ||
      (dirty
        ? uiMsg("Unsaved changes · Saving locally…")
        : uiFrom(store.saveState())),
  );
}
function list() {
  const select = $("#board-select"),
    selected = board?.id;
  select.replaceChildren(uiOption(uiMsg("Choose a whiteboard"), ""));
  for (const row of store.rows())
    select.append(new Option(row.data.name, row.id));
  select.value = selected || "";
  $("#board-more").hidden = !store.hasMore();
  controls();
}
function currentData() {
  if (shared?.active) return shared.data();
  if (!board) throw Error("Create or choose a whiteboard first.");
  const scene = drawing
    ? {
        elements: drawing.getSceneElementsIncludingDeleted(),
        appState: drawing.getAppState(),
        files: drawing.getFiles(),
      }
    : lastScene;
  return whiteboardData(
    $("#board-name").value,
    scene?.elements || [],
    scene?.appState || {},
    scene?.files || {},
  );
}
function changed(elements, state, files) {
  if (shared?.active) {
    shared.change(elements, state, files);
    return;
  }
  if (ignore || !board || scope !== owner()) return;
  let data;
  try {
    data = whiteboardData($("#board-name").value, elements, state, files);
  } catch (e) {
    error = e.message;
    controls();
    message(uiError(e), true);
    if (lastScene && drawing) {
      ignore = true;
      drawing.updateScene({
        elements: lastScene.elements,
        appState: lastScene.appState,
      });
      queueMicrotask(() => (ignore = false));
    }
    return;
  }
  const next = recordSignature(data);
  if (next === signature) return;
  signature = next;
  lastScene = data;
  dirty = true;
  serial++;
  error = "";
  drafts.set(key(scope, board.id), {
    data,
    revision: board.revision,
    persistedSignature,
  });
  clearTimeout(timer);
  timer = setTimeout(() => save().catch((e) => message(uiError(e), true)), 500);
  controls();
}
function blockPaste(data) {
  try {
    if (data.files?.length || data.file)
      throw Error("Images and attached files are not supported.");
    if (data.elements) assertVectorScene(data.elements, data.files || {});
    return true;
  } catch (e) {
    message(uiError(e), true);
    return false;
  }
}
// Excalidraw sets the document language to its zh-TW package code. Keep the page's URL locale.
const preserveDocumentLocale = () => {
  const locale = globalThis.KenseiI18n?.getLocale() || "en";
  if (document.documentElement.lang !== locale)
    document.documentElement.lang = locale;
};
const documentLocaleObserver = new MutationObserver(preserveDocumentLocale);
documentLocaleObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["lang"],
});
window.addEventListener("pagehide", () => documentLocaleObserver.disconnect(), {
  once: true,
});
let mountedProps = null;
async function mount(data) {
  await engineReady;
  drawing = null;
  lastScene = data;
  signature = recordSignature(data);
  ignore = false;
  mountedProps = {
    key: key(scope, board?.id || "empty") + ":" + ++renderVersion,
    initialData: {
      elements: data.elements,
      appState: { ...data.appState, currentItemFontFamily: 2 },
    },
    theme: "dark",
    langCode: globalThis.KenseiI18n?.getLocale() === "zh-Hant" ? "zh-TW" : "en",
    aiEnabled: false,
    isCollaborating: !!shared?.active,
    onPointerUpdate: (payload) => shared?.pointer(payload),
    validateEmbeddable: () => false,
    viewModeEnabled: !board,
    autoFocus: false,
    handleKeyboardGlobally: false,
    UIOptions: {
      tools: { image: false },
      welcomeScreen: false,
      canvasActions: {
        loadScene: false,
        saveToActiveFile: false,
        saveAsImage: false,
        export: false,
        toggleTheme: false,
      },
    },
    excalidrawAPI: (instance) => {
      drawing = instance;
    },
    onChange: changed,
    onPaste: blockPaste,
    onLibraryChange: () => {},
    onLinkOpen: (el, event) => event.preventDefault(),
    children: engine.createElement(
      engine.MainMenu,
      null,
      engine.createElement(engine.MainMenu.DefaultItems.ClearCanvas),
      engine.createElement(engine.MainMenu.DefaultItems.ChangeCanvasBackground),
    ),
  };
  root.render(engine.createElement(engine.Excalidraw, mountedProps));
}
window.addEventListener("locale-change", () => {
  if (!mountedProps) return;
  mountedProps = {
    ...mountedProps,
    langCode: globalThis.KenseiI18n?.getLocale() === "zh-Hant" ? "zh-TW" : "en",
  };
  root.render(engine.createElement(engine.Excalidraw, mountedProps));
});
async function save() {
  clearTimeout(timer);
  if (!dirty || !board || scope !== owner()) return true;
  const data = currentData(),
    expected = scope,
    id = board.id,
    version = serial;
  saving = true;
  try {
    await recovery(expected, id, {
      data,
      revision: board.revision,
      persistedSignature,
    });
    const row = await store.put(
      validateWhiteboard(data),
      id,
      expected,
      board.revision,
    );
    if (owner() !== expected || board?.id !== id) return false;
    board = row;
    persistedSignature = recordSignature(row.data);
    if (serial === version) {
      dirty = false;
      error = "";
      drafts.delete(key(scope, id));
      await recovery(expected, id, null).catch(() => {});
    }
    list();
    return !dirty;
  } catch (e) {
    error = e.message;
    controls();
    message(uiError(e), true);
    return false;
  } finally {
    saving = false;
  }
}
async function open(id) {
  const token = ++switching;
  if (
    dirty &&
    !(await save()) &&
    !uiConfirm(
      uiMsg(
        "This board has unsaved edits. Keep them in this tab and switch boards?",
      ),
    )
  )
    return;
  const expected = owner(),
    row = await store.get(id);
  if (expected !== owner() || token !== switching) return;
  if (!row) {
    message(uiMsg("This whiteboard is unavailable or was deleted."), true);
    return;
  }
  board = structuredClone(row);
  scope = expected;
  dirty = false;
  error = "";
  const draft =
    drafts.get(key(scope, id)) || (await recovery(scope, id).catch(() => null));
  if (expected !== owner() || token !== switching) return;
  persistedSignature = recordSignature(board.data);
  if (draft) {
    board.revision = draft.revision;
    persistedSignature =
      draft.persistedSignature || recordSignature(draft.data);
  }
  const data = draft?.data || board.data;
  $("#board-name").value = data.name;
  dirty = !!draft;
  await mount(data);
  list();
  history.replaceState(null, "", "?id=" + encodeURIComponent(id));
  message(
    draft
      ? uiMsg(
          "Unfinished edits restored from this tab. Export or retry saving.",
        )
      : uiMsg("Whiteboard opened. Drawing changes save automatically."),
  );
}
async function newBoard(
  data = {
    version: 1,
    name: "Untitled whiteboard",
    elements: [],
    appState: { viewBackgroundColor: "#ffffff", gridSize: null },
  },
) {
  if (
    dirty &&
    !(await save()) &&
    !uiConfirm(
      uiMsg(
        "Keep the current unsaved edits in this tab and create a new whiteboard?",
      ),
    )
  )
    return;
  const expected = owner(),
    row = await store.put(
      validateWhiteboard(data),
      crypto.randomUUID(),
      expected,
    );
  if (expected !== owner()) return;
  await open(row.id);
}
$("#board-new").onclick = () =>
  newBoard().catch((e) => message(uiError(e), true));
$("#board-select").onchange = (e) => {
  if (e.target.value)
    open(e.target.value).catch((e) => message(uiError(e), true));
};
$("#board-name").oninput = () => {
  if (!board) return;
  const scene = drawing
    ? {
        elements: drawing.getSceneElementsIncludingDeleted(),
        appState: drawing.getAppState(),
        files: drawing.getFiles(),
      }
    : lastScene;
  if (scene) changed(scene.elements, scene.appState, scene.files || {});
};
$("#board-delete").onclick = async () => {
  if (!board || !uiConfirm(uiMsg("Delete this whiteboard?"))) return;
  try {
    clearTimeout(timer);
    dirty = false;
    drafts.delete(key(scope, board.id));
    await recovery(scope, board.id, null).catch(() => {});
    await store.remove(board.id);
    board = null;
    $("#board-name").value = "";
    await mount({ elements: [], appState: { viewBackgroundColor: "#ffffff" } });
    list();
    message(uiMsg("Whiteboard deleted."));
  } catch (e) {
    message(uiError(e), true);
  }
};
$("#board-more").onclick = () =>
  store.load().catch((e) => message(uiError(e), true));
$("#board-retry").onclick = async () => {
  await save();
  await store.flush();
  await store.load(true);
  list();
};
$("#board-import").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    if (file.size > 2000000) throw Error("Import whiteboards up to 2 MB.");
    await newBoard(
      importWhiteboard(
        JSON.parse(await file.text()),
        file.name.replace(/\.(?:excalidraw|json)$/i, ""),
      ),
    );
    message(uiMsg("Imported as a new whiteboard."));
  } catch (e) {
    message(uiJoin([uiMsg("Import failed: "), uiError(e)]), true);
  }
};
async function exportBoard(format) {
  try {
    const data = currentData();
    if (format === "json")
      return downloadText(
        JSON.stringify(editableScene(data)),
        filename(data.name) + ".excalidraw",
        "application/json",
      );
    await engineReady;
    const elements = data.elements.filter((el) => !el.isDeleted);
    if (!elements.length)
      throw Error("Add a drawing or text before exporting an image.");
    const minX = Math.min(...elements.map((el) => el.x)),
      maxX = Math.max(...elements.map((el) => el.x + Math.abs(el.width))),
      minY = Math.min(...elements.map((el) => el.y)),
      maxY = Math.max(...elements.map((el) => el.y + Math.abs(el.height)));
    if (
      maxX - minX > 16000 ||
      maxY - minY > 16000 ||
      (maxX - minX) * (maxY - minY) > 32000000
    )
      throw Error(
        "This canvas is too large to export as an image. Export the editable file instead.",
      );
    const options = {
      elements,
      appState: {
        ...data.appState,
        exportBackground: true,
        exportWithDarkMode: true,
      },
      files: {},
      exportPadding: 20,
    };
    if (format === "svg") {
      const svg = await engine.exportToSvg(options);
      // Excalidraw 将字体嵌入导出 SVG，所有子集字体由本站加载。
      downloadText(
        svg.outerHTML,
        filename(data.name) + ".svg",
        "image/svg+xml",
      );
    } else {
      const canvas = await engine.exportToCanvas(options);
      const blob = await new Promise((resolve, reject) => {
        try {
          canvas.toBlob(
            (b) =>
              b
                ? resolve(b)
                : reject(
                    Error("Canvas export is unavailable in this browser."),
                  ),
            "image/png",
          );
        } catch (e) {
          reject(e);
        }
      });
      download(blob, filename(data.name) + ".png");
    }
    message(uiMsg("Whiteboard exported."));
  } catch (e) {
    message(uiJoin([uiMsg("Export failed: "), uiError(e)]), true);
  }
}
$("#board-json").onclick = () => exportBoard("json");
$("#board-png").onclick = () => exportBoard("png");
$("#board-svg").onclick = () => exportBoard("svg");
$("#board-fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if ($("#board-canvas-shell").requestFullscreen)
      await $("#board-canvas-shell").requestFullscreen();
    else
      message(
        uiMsg(
          "Fullscreen is unavailable. You can zoom and pan inside the canvas.",
        ),
      );
  } catch (e) {
    message(
      uiMsg("Fullscreen could not start. Use the canvas normally."),
      true,
    );
  }
};
$("#board-guests").onclick = async () => {
  const out = $("#board-guest-list");
  out.replaceChildren();
  out.hidden = false;
  try {
    const rows = await store.guestRows();
    if (!rows.length) {
      uiText(out, uiMsg("No guest whiteboards on this device."));
      return;
    }
    for (const row of rows) {
      const b = document.createElement("button");
      b.className = "saved-row text-link";
      uiText(
        b,
        uiJoin([uiMsg("Copy “"), row.data.name, uiMsg("” to my account")]),
      );
      b.onclick = async () => {
        const expected = owner();
        if (expected === "guest") return;
        try {
          const copy = await store.put(
            {
              ...row.data,
              name: [...row.data.name].slice(0, 88).join("") + " (copy)",
            },
            crypto.randomUUID(),
            expected,
          );
          if (owner() === expected) {
            out.hidden = true;
            await open(copy.id);
            message(
              uiMsg(
                "Guest whiteboard copied. The original remains on this device.",
              ),
            );
          }
        } catch (e) {
          message(uiError(e), true);
        }
      };
      out.append(b);
    }
  } catch (e) {
    message(uiError(e), true);
  }
};
host.addEventListener(
  "drop",
  (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    message(
      uiMsg(
        "Use Import for vector whiteboards. Image and file drops are not supported.",
      ),
      true,
    );
  },
  true,
);
host.addEventListener("dragover", (e) => e.preventDefault(), true);
host.addEventListener(
  "paste",
  (e) => {
    if (e.clipboardData?.files.length) {
      e.preventDefault();
      e.stopImmediatePropagation();
      message(uiMsg("Image and file paste is not supported."), true);
    }
  },
  true,
);
host.addEventListener(
  "keydown",
  (e) => {
    if (
      e.key === "0" &&
      !e.ctrlKey &&
      !e.metaKey &&
      !["INPUT", "TEXTAREA"].includes(e.target.tagName)
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      message(
        uiMsg("Libraries are not included. Use the drawing and text tools."),
      );
      return;
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      ["o", "s", "k"].includes(e.key.toLowerCase())
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key.toLowerCase() === "o" && shared?.active)
        message(uiMsg("Import into Personal, then choose Share a copy."));
      else if (e.key.toLowerCase() === "o") $("#board-import").click();
      else if (e.key.toLowerCase() === "s") exportBoard("json");
      else message(uiMsg("Linked elements are not included in this version."));
    }
  },
  true,
);
store.subscribe(() => {
  if (shared?.active) return;
  list();
  if (!board || scope !== owner() || saving) return;
  const row = store.rows().find((r) => r.id === board.id);
  if (!row) return;
  const incoming = recordSignature(row.data);
  if (incoming === persistedSignature) {
    board.revision = row.revision;
    return;
  }
  if (dirty) return;
  board = structuredClone(row);
  persistedSignature = incoming;
  $("#board-name").value = row.data.name;
  mount(row.data)
    .then(() => message(uiMsg("Whiteboard refreshed from your workspace.")))
    .catch((e) => message(uiError(e), true));
});
window.addEventListener("record-conflict", async ({ detail }) => {
  if (shared?.active) return;
  if (detail.kind !== "whiteboard" || board?.id !== detail.from) return;
  board.id = detail.to;
  history.replaceState(null, "", "?id=" + encodeURIComponent(detail.to));
  message(
    uiMsg(
      "Another device edited this board. Your changes were kept in a conflict copy.",
    ),
  );
  list();
});
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
async function start() {
  if (shared?.active) return;
  const token = ++switching,
    expected = owner();
  clearTimeout(timer);
  if (board && dirty)
    try {
      const value = {
        data: currentData(),
        revision: board.revision,
        persistedSignature,
      };
      drafts.set(key(scope, board.id), value);
      recovery(scope, board.id, value).catch(() => {});
    } catch {}
  board = null;
  drawing = null;
  dirty = false;
  error = "";
  scope = expected;
  $("#board-name").value = "";
  $("#board-guest-list").hidden = true;
  controls();
  try {
    await store.ready();
    if (expected !== owner() || token !== switching || shared?.active) return;
    await store.flush();
    await store.load(true);
    if (expected !== owner() || token !== switching || shared?.active) return;
    list();
    const id = requested || store.rows()[0]?.id;
    if (id) await open(id);
    else
      await mount({
        elements: [],
        appState: { viewBackgroundColor: "#ffffff" },
      });
  } catch (e) {
    message(uiError(e), true);
  }
}
shared = mountSharedBoard({
  resetPrivate: () => {
    board = null;
    dirty = false;
    error = "";
    scope = owner();
    $("#board-name").value = "";
  },
  api: () => drawing,
  async mount(data) {
    await mount(data);
    for (let i = 0; i < 100 && !drawing; i++)
      await new Promise((resolve) => setTimeout(resolve, 30));
    if (!drawing)
      throw Error("The whiteboard editor could not start. Reload to retry.");
  },
  editing(value) {
    if (!mountedProps) return;
    mountedProps = {
      ...mountedProps,
      isCollaborating: true,
      viewModeEnabled: !value,
    };
    root.render(engine.createElement(engine.Excalidraw, mountedProps));
  },
  remote(elements, appState) {
    drawing?.updateScene({
      elements,
      appState,
      captureUpdate: engine.CaptureUpdateAction.NEVER,
    });
  },
  reconcile: (...args) => engine.reconcileElements(...args),
  collaborators: (collaborators) =>
    drawing?.updateScene({
      collaborators,
      captureUpdate: engine.CaptureUpdateAction.NEVER,
    }),
  beforeEnter: async () => {
    if (!(await save()))
      throw Error("Save or export your private edits before opening Shared.");
  },
  privateData: () =>
    board
      ? whiteboardData(
          $("#board-name").value,
          drawing?.getSceneElementsIncludingDeleted() ||
            lastScene?.elements ||
            [],
          drawing?.getAppState() || lastScene?.appState || {},
        )
      : null,
  normalize: (data) => ({
    ...data,
    elements: engine.restoreElements(
      data.elements.filter((e) => !e.isDeleted),
      null,
    ),
  }),
  personal: async () => {
    if (board) await open(board.id);
    else await start();
  },
  privateCopy: async (data) => {
    const copy = await store.put(
      validateWhiteboard({
        ...data,
        elements: data.elements.filter((e) => !e.isDeleted),
        name: [...data.name].slice(0, 88).join("") + " (copy)",
      }),
      crypto.randomUUID(),
      owner(),
    );
    message(uiMsg("A private copy was saved to your workspace."));
    return copy;
  },
  export: exportBoard,
});
window.addEventListener("workspace-ready", start);
start();
