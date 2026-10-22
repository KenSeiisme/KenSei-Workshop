import { $, api, status, download, downloadText, filename } from "./common.js";
import { createRecordStore, recordSignature } from "./record-store.js";
import {
  validateWhiteboard,
  whiteboardData,
  importWhiteboard,
  editableScene,
  assertVectorScene,
} from "./whiteboard-core.js";

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
  renderVersion = 0;
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
  $("#board-state").textContent =
    error || (dirty ? "Unsaved changes · Saving locally…" : store.saveState());
}
function list() {
  const select = $("#board-select"),
    selected = board?.id;
  select.replaceChildren(new Option("Choose a whiteboard", ""));
  for (const row of store.rows())
    select.append(new Option(row.data.name, row.id));
  select.value = selected || "";
  $("#board-more").hidden = !store.hasMore();
  controls();
}
function currentData() {
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
  if (ignore || !board || scope !== owner()) return;
  let data;
  try {
    data = whiteboardData($("#board-name").value, elements, state, files);
  } catch (e) {
    error = e.message;
    controls();
    message(e.message, true);
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
  timer = setTimeout(() => save().catch((e) => message(e.message, true)), 500);
  controls();
}
function blockPaste(data) {
  try {
    if (data.files?.length || data.file)
      throw Error("Images and attached files are not supported.");
    if (data.elements) assertVectorScene(data.elements, data.files || {});
    return true;
  } catch (e) {
    message(e.message, true);
    return false;
  }
}
async function mount(data) {
  await engineReady;
  drawing = null;
  lastScene = data;
  signature = recordSignature(data);
  ignore = false;
  root.render(
    engine.createElement(engine.Excalidraw, {
      key: key(scope, board?.id || "empty") + ":" + ++renderVersion,
      initialData: {
        elements: data.elements,
        appState: { ...data.appState, currentItemFontFamily: 2 },
      },
      theme: "dark",
      langCode: "en",
      aiEnabled: false,
      isCollaborating: false,
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
        engine.createElement(
          engine.MainMenu.DefaultItems.ChangeCanvasBackground,
        ),
      ),
    }),
  );
}
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
    message(e.message, true);
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
    !confirm(
      "This board has unsaved edits. Keep them in this tab and switch boards?",
    )
  )
    return;
  const expected = owner(),
    row = await store.get(id);
  if (expected !== owner() || token !== switching) return;
  if (!row) {
    message("This whiteboard is unavailable or was deleted.", true);
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
      ? "Unfinished edits restored from this tab. Export or retry saving."
      : "Whiteboard opened. Drawing changes save automatically.",
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
    !confirm(
      "Keep the current unsaved edits in this tab and create a new whiteboard?",
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
  newBoard().catch((e) => message(e.message, true));
$("#board-select").onchange = (e) => {
  if (e.target.value)
    open(e.target.value).catch((e) => message(e.message, true));
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
  if (!board || !confirm("Delete this whiteboard?")) return;
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
    message("Whiteboard deleted.");
  } catch (e) {
    message(e.message, true);
  }
};
$("#board-more").onclick = () =>
  store.load().catch((e) => message(e.message, true));
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
    message("Imported as a new whiteboard.");
  } catch (e) {
    message("Import failed: " + e.message, true);
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
    message("Whiteboard exported.");
  } catch (e) {
    message("Export failed: " + e.message, true);
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
        "Fullscreen is unavailable. You can zoom and pan inside the canvas.",
      );
  } catch (e) {
    message("Fullscreen could not start. Use the canvas normally.", true);
  }
};
$("#board-guests").onclick = async () => {
  const out = $("#board-guest-list");
  out.replaceChildren();
  out.hidden = false;
  try {
    const rows = await store.guestRows();
    if (!rows.length) {
      out.textContent = "No guest whiteboards on this device.";
      return;
    }
    for (const row of rows) {
      const b = document.createElement("button");
      b.className = "saved-row text-link";
      b.textContent = "Copy “" + row.data.name + "” to my account";
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
              "Guest whiteboard copied. The original remains on this device.",
            );
          }
        } catch (e) {
          message(e.message, true);
        }
      };
      out.append(b);
    }
  } catch (e) {
    message(e.message, true);
  }
};
host.addEventListener(
  "drop",
  (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    message(
      "Use Import for vector whiteboards. Image and file drops are not supported.",
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
      message("Image and file paste is not supported.", true);
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
      message("Libraries are not included. Use the drawing and text tools.");
      return;
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      ["o", "s", "k"].includes(e.key.toLowerCase())
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key.toLowerCase() === "o") $("#board-import").click();
      else if (e.key.toLowerCase() === "s") exportBoard("json");
      else message("Linked elements are not included in this version.");
    }
  },
  true,
);
store.subscribe(() => {
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
    .then(() => message("Whiteboard refreshed from your workspace."))
    .catch((e) => message(e.message, true));
});
window.addEventListener("record-conflict", async ({ detail }) => {
  if (detail.kind !== "whiteboard" || board?.id !== detail.from) return;
  board.id = detail.to;
  history.replaceState(null, "", "?id=" + encodeURIComponent(detail.to));
  message(
    "Another device edited this board. Your changes were kept in a conflict copy.",
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
    if (expected !== owner() || token !== switching) return;
    await store.flush();
    await store.load(true);
    if (expected !== owner() || token !== switching) return;
    list();
    const id = requested || store.rows()[0]?.id;
    if (id) await open(id);
    else
      await mount({
        elements: [],
        appState: { viewBackgroundColor: "#ffffff" },
      });
  } catch (e) {
    message(e.message, true);
  }
}
window.addEventListener("workspace-ready", start);
start();
