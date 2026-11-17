import { animateElement } from "./effects.js";
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
    options = $("[data-shell-options-dialog]"),
    invite = $("[data-shell-invite-dialog]"),
    details = $("[data-shell-options-summary]"),
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
    returnFocus = null,
    metricCue,
    lastMetricCue = 0;
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
      const label = focus ? uiMsg("Exit focus") : uiMsg("Focus");
      uiText(button.querySelector("[data-shell-focus-label]") || button, label);
      uiAttr(button, "aria-label", label);
      uiAttr(button, "title", label);
      button.setAttribute("aria-pressed", String(focus));
    }
    requestSize();
  }
  function closeDialogs() {
    for (const dialog of root.querySelectorAll("dialog[open]")) dialog.close();
  }
  function openDialog(dialog, opener = document.activeElement, cover = false) {
    if (!dialog || dialog.open || (cover && !beforeCover())) return;
    if (!opener?.closest("dialog[open]")) returnFocus = opener;
    closeDialogs();
    dialog.showModal();
    if (dialog.classList.contains("game-setup-drawer"))
      animateElement(
        dialog,
        [
          {
            opacity: 0,
            transform: matchMedia("(max-width: 640px)").matches
              ? "translateY(18px)"
              : "translateX(18px)",
          },
          { opacity: 1, transform: "none" },
        ],
        { duration: 200, easing: "ease-out" },
      );
  }
  function focusSetup() {
    const target = [
      ...root.querySelectorAll(
        "[data-quick-setup] select, #game-setup select, #game-start",
      ),
    ].find((node) => !node.disabled && node.getClientRects().length);
    target?.focus({ preventScroll: true });
  }
  for (const button of root.querySelectorAll("[data-shell-setup]"))
    button.addEventListener("click", () => {
      if (options && state === "ready") openDialog(options, button);
      else if (!entry) openDialog(settings, button);
      else if (state === "ready") focusSetup();
      else openDialog(menu, button);
    });
  function paintSetupChoices() {
    if (!details) return;
    const online = $("[data-quick-setup] select")?.value === "online";
    const labels = [...options.querySelectorAll("[data-setup-choice]")]
      .filter(
        (select) =>
          !select.closest("label[hidden]") &&
          (!select.hasAttribute("data-setup-online") || online),
      )
      .map((select) => select.selectedOptions[0]?.textContent.trim())
      .filter(Boolean);
    details.hidden = !labels.length;
    uiText(details, labels.join(" · "));
  }
  if (options) {
    root.addEventListener("change", paintSetupChoices);
    window.addEventListener("locale-change", paintSetupChoices);
    queueMicrotask(paintSetupChoices);
  }
  for (const button of root.querySelectorAll("[data-shell-options]"))
    button.addEventListener("click", () => openDialog(options, button));
  for (const button of root.querySelectorAll("[data-shell-invite]"))
    button.addEventListener("click", () => openDialog(invite, button));

  const inviteCode = new URLSearchParams(location.search).get("code");
  if (invite && /^[a-z0-9]{8}$/i.test(inviteCode || "")) {
    const join = invite.querySelector("[data-invite-join]");
    const launch = $("[data-online-launch]");
    const find = launch.querySelector(".primary");
    find.classList.replace("primary", "secondary");
    join.classList.replace("secondary", "primary");
    launch.prepend(join);
    const preview = $("[data-invite-preview]");
    preview.hidden = false;
    uiText(preview, uiMsg("Room code · {0}", [inviteCode.toUpperCase()]));
  }
  for (const button of root.querySelectorAll("[data-shell-settings]"))
    button.addEventListener("click", () => openDialog(settings, button));
  for (const button of root.querySelectorAll("[data-shell-menu]"))
    button.addEventListener("click", () => openDialog(menu, button));
  for (const button of root.querySelectorAll("[data-shell-info]"))
    button.addEventListener("click", () => openDialog(info, button, true));
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
    if (
      state === "playing" &&
      oldState === "playing" &&
      typeof next.metric === "string" &&
      typeof last.metric === "string" &&
      next.metric !== last.metric &&
      performance.now() - lastMetricCue > 150
    ) {
      lastMetricCue = performance.now();
      metricCue?.cancel();
      metricCue = animateElement(
        $(".game-primary-metric strong, .pong-score"),
        [
          { opacity: 0.6, transform: "scale(0.96)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        { duration: 180, easing: "ease-out" },
      );
    }
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
      if (start && oldState !== state && state === "complete")
        uiText(start, uiMsg("Play again"));
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
    if (state !== oldState && ["complete", "finished"].includes(state)) {
      const completed = state;
      requestAnimationFrame(() => {
        if (disposed || state !== completed) return;
        const result = $(
          "#game-result:not([hidden]), [data-match-result]:not([hidden])",
        );
        animateElement(
          result,
          [
            { opacity: 0.5, translate: "0 6px", filter: "brightness(1.25)" },
            { opacity: 1, translate: "0 0", filter: "none" },
          ],
          { duration: 250, easing: "ease-out" },
        );
      });
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
