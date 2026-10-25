import { uiMsg, uiFrom, uiText, uiAttr } from "../site/ui.js";
// 仅管理页面布局和焦点；对局状态、计时、随机数及 Public 资格由调用方管理。
export function mountPlayShell(root, { beforeCover = () => true } = {}) {
  if (!root?.hasAttribute("data-play-shell")) return null;
  const $ = (selector) => root.querySelector(selector),
    board = $("#game-board"),
    stage = $(".game-board-shell"),
    initialPreview = board?.innerHTML,
    initialClass = board?.className,
    settings = $("[data-shell-settings-dialog]"),
    menu = $("[data-shell-menu-dialog]"),
    info = $("[data-shell-info-dialog]"),
    entry = $("[data-shell-entry]"),
    entryActions = $("[data-shell-entry-actions]"),
    resultActions = $("[data-shell-result-actions]"),
    menuActions = $("[data-shell-menu-actions]"),
    status = $("#game-status"),
    start = $("#game-start"),
    restore = $("#game-restore"),
    retry = $("#game-submit-retry"),
    discard = $("#game-submit-discard"),
    localStart = $("#game-start-local"),
    saveLine = $("#game-save-line");
  let state = "ready",
    focus = false,
    frame = 0,
    disposed = false,
    previousSession = null,
    last = {},
    returnFocus = null;
  const move = (node, parent) => {
    if (node && parent && node.parentElement !== parent) parent.append(node);
  };
  function resize() {
    frame = 0;
    if (disposed || !stage) return;
    const height = window.visualViewport?.height || window.innerHeight;
    const sideControls =
      focus &&
      matchMedia("(max-height: 480px) and (orientation: landscape)").matches;
    const bottom = [
      $(".game-control-deck"),
      $(".pong-room-controls"),
      $(".pong-connection"),
      $(".pong-room-message"),
      $("[data-shell-status-slot]"),
    ]
      .filter(Boolean)
      .filter(
        (node) =>
          !sideControls || !node.classList.contains("game-control-deck"),
      )
      .reduce((sum, node) => sum + node.getBoundingClientRect().height, 0);
    const safeReserve = Math.max(
      32,
      parseFloat(getComputedStyle(root).paddingBottom) + 12,
    );
    const available = Math.max(
      140,
      Math.floor(
        height - stage.getBoundingClientRect().top - bottom - safeReserve,
      ),
    );
    root.style.setProperty("--shell-stage-space", `${available}px`);
  }
  function requestSize() {
    if (!frame && !disposed) frame = requestAnimationFrame(resize);
  }
  function setFocus(value) {
    focus = !!value;
    root.dataset.focus = String(focus);
    document.body.classList.toggle("game-is-focused", focus);
    for (const button of root.querySelectorAll("[data-shell-focus]")) {
      button.hidden = state === "ready";
      uiText(button, focus ? uiMsg("Exit focus") : uiMsg("Focus"));
      button.setAttribute("aria-pressed", String(focus));
    }
    requestSize();
  }
  function closeDialogs() {
    for (const dialog of root.querySelectorAll("dialog[open]")) dialog.close();
  }
  function openDialog(dialog, cover = false) {
    if (!dialog || dialog.open || (cover && !beforeCover())) return;
    returnFocus = document.activeElement;
    closeDialogs();
    dialog.showModal();
  }
  function focusSetup() {
    const target = [
      ...root.querySelectorAll("#game-setup select, #game-start"),
    ].find((node) => !node.disabled && node.getClientRects().length);
    target?.focus({ preventScroll: true });
  }
  for (const button of root.querySelectorAll("[data-shell-setup]"))
    button.addEventListener("click", () => {
      if (!entry) openDialog(settings);
      else if (state === "ready") focusSetup();
      else openDialog(menu);
    });
  for (const button of root.querySelectorAll("[data-shell-settings]"))
    button.addEventListener("click", () => openDialog(settings));
  for (const button of root.querySelectorAll("[data-shell-menu]"))
    button.addEventListener("click", () => openDialog(menu));
  for (const button of root.querySelectorAll("[data-shell-info]"))
    button.addEventListener("click", () => openDialog(info, true));
  for (const button of root.querySelectorAll("[data-shell-focus]"))
    button.addEventListener("click", () => {
      setFocus(!focus);
      // 布局变化不会重建棋盘，也不调用游戏的 pause/start。
      (board || $(".pong-canvas"))?.focus({ preventScroll: true });
    });
  for (const dialog of root.querySelectorAll("dialog")) {
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") event.stopPropagation();
    });
    dialog.addEventListener("close", () => {
      if (!root.querySelector("dialog[open]")) {
        const target =
          returnFocus?.isConnected && returnFocus.getClientRects().length
            ? returnFocus
            : board || $(".pong-canvas");
        target?.focus({ preventScroll: true });
      }
    });
    for (const button of dialog.querySelectorAll("[data-shell-close]"))
      button.addEventListener("click", () => dialog.close());
  }
  function update(next) {
    const oldState = state;
    state = next.state || "ready";
    const changed =
      state !== oldState ||
      Object.keys(next).some((key) => next[key] !== last[key]);
    last = { ...next };
    if (!changed) return;
    root.dataset.shellState = state;
    const label = next.label || "Ready to play";
    for (const node of root.querySelectorAll("[data-shell-mode]")) {
      if (node.textContent !== label) uiText(node, uiFrom(label));
      uiAttr(node, "title", uiFrom(label));
    }
    if (state === "ready") {
      if (oldState !== "ready") setFocus(false);
      if (entry) entry.hidden = false;
      move(start, entryActions);
      move(restore, entryActions);
      move(retry, entryActions);
      move(discard, entryActions);
      move(localStart, entryActions);
      move(saveLine, entry);
      move(status, $("[data-shell-entry-message]"));
      if (start) {
        uiText(
          start,
          next.startFailed ? uiMsg("Retry start") : uiMsg("Start game →"),
        );
        start.classList.toggle("primary", !next.pending);
        start.classList.toggle("secondary", !!next.pending);
      }
      if (restore)
        uiText(
          restore,
          next.legacy
            ? uiMsg("Continue saved game · Legacy")
            : uiMsg("Continue saved game"),
        );
      const detail = $("#game-save-detail");
      if (detail) {
        detail.hidden = !next.saveInfo || !!restore?.hidden;
        uiText(detail, next.saveInfo || "");
      }
      const summary = $("#game-mode-summary");
      if (summary)
        uiText(
          summary,
          next.legacy
            ? uiMsg("{0} · Legacy rules", [uiFrom(label)])
            : uiFrom(label),
        );
    } else {
      if (entry) entry.hidden = true;
      move(status, $("[data-shell-status-slot]"));
      const destination = state === "complete" ? resultActions : menuActions;
      move(start, destination);
      move(retry, state === "complete" ? resultActions : entryActions);
      move(discard, state === "complete" ? resultActions : entryActions);
      move(localStart, destination);
      move(saveLine, $("[data-shell-status-slot]"));
      if (next.startFailed && start) uiText(start, uiMsg("Retry start"));
    }
    const setupButton = $("#game-settings-change");
    if (setupButton) {
      setupButton.hidden = state === "ready";
      setupButton.disabled = !!next.busy || !!next.pending;
    }
    if (localStart) {
      localStart.hidden = !next.localFallback;
      localStart.disabled = !!next.busy;
    }
    if (start) start.disabled = !!next.busy || !!next.pending;
    if (restore) {
      restore.disabled = !!next.busy;
      restore.classList.remove("primary");
      restore.classList.add("secondary");
    }
    if (state === "playing" && oldState !== "playing") {
      closeDialogs();
      setFocus(true);
    }
    if (next.session && next.session !== previousSession) {
      previousSession = next.session;
      closeDialogs();
      setFocus(true);
    }
    for (const button of root.querySelectorAll("[data-shell-focus]"))
      button.hidden = state === "ready";
    requestSize();
  }
  const observer = new ResizeObserver(requestSize);
  const observedNodes = [
    $(".game-shell-toolbar"),
    $(".game-metrics"),
    $(".game-control-deck"),
    $(".pong-player-row"),
    $(".pong-room-controls"),
    stage,
  ].filter(Boolean);
  function connect() {
    disposed = false;
    for (const node of observedNodes) observer.observe(node);
    window.addEventListener("resize", requestSize);
    window.visualViewport?.addEventListener("resize", requestSize);
  }
  connect();
  const cleanup = () => {
    disposed = true;
    cancelAnimationFrame(frame);
    frame = 0;
    observer.disconnect();
    window.removeEventListener("resize", requestSize);
    window.visualViewport?.removeEventListener("resize", requestSize);
    document.body.classList.remove("game-is-focused");
  };
  window.addEventListener("pagehide", cleanup);
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    connect();
    setFocus(focus);
  });
  requestSize();
  return {
    update,
    closeDialogs,
    requestSize,
    openSettings: () => openDialog(settings),
    focusSetup,
    restorePreview() {
      if (board && !board.querySelector("[data-shell-preview]")) {
        board.className = initialClass;
        board.innerHTML = initialPreview;
        board.dataset.active = "false";
      }
      requestSize();
    },
  };
}
