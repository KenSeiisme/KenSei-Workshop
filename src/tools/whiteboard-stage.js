import { $, api } from "./common.js";
import { el, field, row, select } from "./advanced-ui.js";
import { uiMsg, uiText, uiDate } from "../site/ui.js";

export function createWhiteboardStage({
  open,
  settingsChanged,
  preferenceChanged,
  refresh,
}) {
  const page = $("[data-tool='whiteboard']"),
    toolbar = $(".whiteboard-toolbar"),
    shell = $("#board-canvas-shell"),
    stage = el("div", "", {
      id: "whiteboard-stage",
      class: "whiteboard-stage",
    });
  page.classList.add("whiteboard-page");
  toolbar.before(stage);
  stage.append(toolbar, shell);
  const feedback = $(".tool-feedback");
  stage.append(feedback);
  function dialog(id, title, trigger) {
    const d = el("dialog", "", { id, class: "board-dialog" }),
      heading = el("h2", title, { id: id + "-title" }),
      close = el("button", "Close ×", {
        type: "button",
        class: "button secondary",
      });
    d.setAttribute("aria-labelledby", heading.id);
    close.onclick = () => d.close();
    d.append(row(heading, close));
    stage.append(d);
    trigger?.setAttribute("aria-haspopup", "dialog");
    trigger?.setAttribute("aria-controls", id);
    trigger?.addEventListener("click", () => d.showModal());
    d.addEventListener("close", () => trigger?.focus({ preventScroll: true }));
    return d;
  }
  const boards = dialog("board-drawer", "Your whiteboards", $("#board-boards"));
  boards.append(
    $(".board-mode-tabs"),
    $("#board-personal-panel"),
    $("#board-shared-panel"),
  );
  $("#board-title").onclick = () => boards.showModal();
  const more = dialog("board-menu", "Whiteboard menu", $("#board-menu-open")),
    menu = el("div", "", { id: "board-more-content" });
  more.append(menu);
  const exportRow = row($("#board-json"), $("#board-png"), $("#board-svg"));
  const include = el("input", "", {
      type: "checkbox",
      checked: true,
      id: "board-include-paper",
    }),
    selection = el("input", "", {
      type: "checkbox",
      id: "board-export-selection",
    }),
    keep = el("input", "", {
      type: "checkbox",
      checked: true,
      id: "board-keep-tool",
    }),
    snap = el("input", "", {
      type: "checkbox",
      checked: true,
      id: "board-snap-ports",
    });
  const help = el("button", "Help", {
    type: "button",
    class: "button secondary",
    "data-open-help": "",
  });
  const favorite =
    document.querySelector('[data-favorite="whiteboard"]') ||
    el("button", "Favorite", {
      class: "favorite icon-button",
      "data-favorite": "whiteboard",
      "aria-pressed": "false",
      "aria-label": "Favorite Whiteboard",
    });
  favorite.hidden = false;
  menu.append(
    el("h3", "Export"),
    field("Include paper pattern", include),
    field("Export selected elements only", selection),
    exportRow,
    el("h3", "Drawing preferences"),
    field("Keep tool active", keep),
    field("Snap to points", snap),
    row(help, favorite),
  );
  const lang = select(
    [
      ["en", "English"],
      ["zh-Hant", "繁體中文"],
    ],
    globalThis.KenseiI18n?.getLocale() || "en",
  );
  lang.dataset.languageSelect = "";
  lang.setAttribute("aria-label", "Interface language");
  menu.append(field("Interface language", lang));
  // 原有 Help 保持同一份內容；放入全屏容器，避免被瀏覽器隱藏。
  const helpDialog = $("#tool-help");
  stage.append(helpDialog);
  help.onclick = () => {
    more.close();
    helpDialog.showModal();
  };
  const background = dialog(
      "board-background-panel",
      "Paper background",
      $("#board-background"),
    ),
    kind = select([
      ["plain", "Plain"],
      ["ruled", "Ruled"],
      ["grid", "Grid"],
      ["dots", "Dots"],
      ["graph", "Graph paper"],
    ]),
    spacing = select(
      [
        ["10", "10 · close"],
        ["20", "20 · medium"],
        ["40", "40 · wide"],
      ],
      "20",
    ),
    color = el("input", "", {
      type: "color",
      value: "#ffffff",
      id: "board-paper-color",
    });
  kind.id = "board-paper-type";
  spacing.id = "board-paper-spacing";
  background.append(
    field("Paper style", kind),
    field("Paper spacing", spacing),
    field("Base color", color),
  );
  const welcome = el("div", "", {
      class: "board-welcome",
      id: "board-welcome",
    }),
    card = el("section", "", { class: "board-welcome-card" }),
    create = el("button", "New whiteboard", {
      class: "button primary",
      id: "board-entry-new",
    }),
    resume = el("button", "Continue", {
      class: "button secondary",
      id: "board-continue",
      hidden: true,
    }),
    recentText = el("p", "", { class: "muted small", id: "board-recent" }),
    browse = el("button", "Open boards", { class: "text-link" });
  card.append(
    el("p", "Ready canvas", { class: "eyebrow" }),
    el("h2", "A little space for your ideas."),
    row(create, resume),
    recentText,
    browse,
  );
  welcome.append(card);
  shell.append(welcome);
  const status = $("#tool-status");
  stage.append(status);
  let backgroundColor = "#ffffff";
  let active = false,
    editable = false,
    recent = null,
    focus = false;
  create.onclick = () => $("#board-new").click();
  resume.onclick = () => {
    if (recent) open(recent.id);
  };
  browse.onclick = () => boards.showModal();
  const owner = () => api.user?.id || "guest",
    preferenceKey = () => `kensei-whiteboard-preferences:${owner()}`;
  function loadPreferences() {
    try {
      const p = JSON.parse(localStorage.getItem(preferenceKey()) || "{}");
      keep.checked = p.keep !== false;
      snap.checked = p.snap !== false;
    } catch {
      keep.checked = snap.checked = true;
    }
    preferenceChanged({ keep: keep.checked, snap: snap.checked });
  }
  keep.onchange = snap.onchange = () => {
    try {
      localStorage.setItem(
        preferenceKey(),
        JSON.stringify({ keep: keep.checked, snap: snap.checked }),
      );
    } catch {}
    preferenceChanged({ keep: keep.checked, snap: snap.checked });
  };
  function resize() {
    const height = window.visualViewport?.height || innerHeight,
      top = stage.getBoundingClientRect().top;
    stage.style.height = Math.max(220, height - Math.max(0, top) - 10) + "px";
    refresh();
  }
  function setFocus(value) {
    focus = value;
    document.body.classList.toggle("whiteboard-focus", focus);
    $("#board-focus").hidden = !active;
    uiText($("#board-focus"), uiMsg(focus ? "Exit focus" : "Focus"));
    requestAnimationFrame(resize);
  }
  $("#board-focus").onclick = async () => {
    if (document.fullscreenElement)
      await document.exitFullscreen().catch(() => {});
    setFocus(!focus);
  };
  $("#board-fullscreen").onclick = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
      return;
    }
    setFocus(true);
    try {
      if (!stage.requestFullscreen) throw Error("unsupported");
      await stage.requestFullscreen();
    } catch {
      uiText(
        status,
        uiMsg("Fullscreen is unavailable. Focus mode is still available."),
      );
    }
  };
  function fullChanged() {
    uiText(
      $("#board-fullscreen"),
      uiMsg(document.fullscreenElement ? "Exit fullscreen" : "Fullscreen"),
    );
    requestAnimationFrame(resize);
  }
  document.addEventListener("fullscreenchange", fullChanged);
  window.addEventListener("resize", resize);
  window.visualViewport?.addEventListener("resize", resize);
  const stateObserver = new MutationObserver(() => updateStatus());
  for (const id of ["board-state", "shared-save-status", "shared-live-status"])
    stateObserver.observe($("#" + id), {
      childList: true,
      subtree: true,
      characterData: true,
    });
  function updateStatus() {
    const shared =
        $("#board-shared-tab").getAttribute("aria-selected") === "true",
      name = !active
        ? ""
        : shared
          ? $("#shared-name").value
          : $("#board-name").value;
    $("#board-title-label").textContent =
      name ||
      globalThis.KenseiI18n?.render(uiMsg("Whiteboard")) ||
      "Whiteboard";
    $("#board-header-state").textContent = !active
      ? uiMsg("Choose new or continue")
      : shared
        ? [
            $("#shared-live-status").textContent,
            $("#shared-save-status").textContent,
          ]
            .filter(Boolean)
            .join(" · ")
        : $("#board-state").textContent;
  }
  for (const id of ["board-name", "shared-name"])
    $("#" + id).addEventListener("input", updateStatus);
  for (const n of [kind, spacing, color])
    n.onchange = () => {
      if (editable)
        settingsChanged({
          viewBackgroundColor: n === color ? color.value : backgroundColor,
          paper: { version: 1, type: kind.value, spacing: +spacing.value },
        });
    };
  window.addEventListener("pagehide", () => {
    stateObserver.disconnect();
    window.removeEventListener("resize", resize);
    window.visualViewport?.removeEventListener("resize", resize);
    document.removeEventListener("fullscreenchange", fullChanged);
  });
  window.addEventListener("locale-change", () => {
    lang.value = globalThis.KenseiI18n?.getLocale() || "en";
  });
  loadPreferences();
  requestAnimationFrame(resize);
  return {
    get active() {
      return active;
    },
    get includePaper() {
      return include.checked;
    },
    get keep() {
      return keep.checked;
    },
    get snap() {
      return snap.checked;
    },
    nativeLock(value) {
      keep.checked = value;
      try {
        localStorage.setItem(
          preferenceKey(),
          JSON.stringify({ keep: value, snap: snap.checked }),
        );
      } catch {}
    },
    activate(data) {
      active = !!data.name;
      welcome.hidden = active;
      $("#board-focus").hidden = !active;
      if (active) {
        boards.close();
        more.close();
        setFocus(true);
      } else setFocus(false);
      updateStatus();
    },
    edit(value) {
      editable = value;
      for (const n of [kind, spacing, color]) n.disabled = !value;
    },
    paper(state) {
      backgroundColor = state.viewBackgroundColor;
      kind.value = state.paper.type;
      spacing.value = String(state.paper.spacing);
      if (/^#[0-9a-f]{6}$/i.test(state.viewBackgroundColor))
        color.value = state.viewBackgroundColor;
    },
    recent(row) {
      recent = row;
      resume.hidden = !row;
      recentText.replaceChildren();
      if (row) {
        const name = el("span", "", { "data-ui-opaque": "" });
        name.textContent = row.data.name;
        recentText.append(name, document.createTextNode(" · "));
        const date = el("span");
        uiText(
          date,
          uiDate(row.updated_at || row.created_at || Date.now(), {
            dateStyle: "short",
            timeStyle: "short",
          }),
        );
        recentText.append(date);
      }
    },
    identity() {
      loadPreferences();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      setFocus(false);
      recent = null;
      resume.hidden = true;
    },
    closeMenus() {
      boards.close();
      more.close();
      background.close();
    },
    resize,
  };
}
