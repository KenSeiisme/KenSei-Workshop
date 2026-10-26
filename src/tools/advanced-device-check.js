import { $ } from "./common.js";
import { el, row, button, field } from "./advanced-ui.js";
import { uiMsg, uiText } from "../site/ui.js";
export function init() {
  const ctx = window.KenseiAdvancedContexts["device-check"],
    matrix = el("div", "", { class: "key-matrix", "data-ui-opaque": "" }),
    known = new Map(),
    mouse = el("p"),
    bar = $("[role=tablist]"),
    touchTab = el("button", "Touch", {
      type: "button",
      role: "tab",
      id: "tab-touch",
      class: "filter",
      "aria-controls": "device-touch",
      "aria-selected": "false",
      tabIndex: -1,
    }),
    touch = el("section", "", {
      id: "device-touch",
      class: "panel tool-form",
      role: "tabpanel",
      hidden: true,
      "aria-labelledby": "tab-touch",
    }),
    surface = el("div", "", {
      class: "touch-test-surface",
      tabIndex: 0,
      "aria-label": "Multi-touch test area",
    }),
    info = el("p", "Not listening.");
  let touchEvents = null,
    points = new Map(),
    drag = null;
  const rows = [
    "Escape F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 F11 F12",
    "Backquote Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0 Minus Equal Backspace",
    "Tab KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP BracketLeft BracketRight Backslash",
    "CapsLock KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon Quote Enter",
    "ShiftLeft KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash ShiftRight",
    "ControlLeft MetaLeft AltLeft Space AltRight MetaRight ContextMenu ControlRight ArrowLeft ArrowUp ArrowDown ArrowRight Insert Delete Home End PageUp PageDown",
  ];
  for (const codes of rows) {
    const line = el("div");
    for (const code of codes.split(" ")) {
      const key = el("kbd");
      key.textContent = code.replace(/^Key|^Digit/, "");
      known.set(code, key);
      line.append(key);
    }
    matrix.append(line);
  }
  $("#keyboard-surface").append(matrix);
  $("#keyboard-surface").addEventListener("keydown", (e) => {
    if (ctx.active !== "keyboard") return;
    const key = known.get(e.code);
    if (key) {
      key.classList.add("received", "pressed");
    }
  });
  $("#keyboard-surface").addEventListener("keyup", (e) =>
    known.get(e.code)?.classList.remove("pressed"),
  );
  $("#mouse-surface").append(mouse);
  $("#mouse-surface").addEventListener("pointerdown", (e) => {
    if (ctx.active === "mouse") {
      drag = { x: e.clientX, y: e.clientY };
    }
  });
  $("#mouse-surface").addEventListener("pointermove", (e) => {
    if (ctx.active === "mouse" && drag && e.buttons)
      uiText(
        mouse,
        uiMsg("Drag distance: {0} px", [
          Math.hypot(e.clientX - drag.x, e.clientY - drag.y).toFixed(1),
        ]),
      );
  });
  $("#mouse-surface").addEventListener("pointerup", () => (drag = null));
  $("#mouse-surface").addEventListener("dblclick", () => {
    if (ctx.active === "mouse") uiText(mouse, uiMsg("Double-click received."));
  });
  function stop() {
    touchEvents?.abort();
    touchEvents = null;
    points.clear();
    surface.replaceChildren();
    surface.style.touchAction = "auto";
    uiText(info, uiMsg("Not listening."));
    drag = null;
    mouse.textContent = "";
    for (const key of known.values())
      key.classList.remove("pressed", "received");
  }
  function show() {
    ctx.stop();
    document.querySelectorAll("[data-device-tab]").forEach((n) => {
      const on = n === touchTab;
      n.setAttribute("aria-selected", String(on));
      n.classList.toggle("active", on);
      n.tabIndex = on ? 0 : -1;
      $("#device-" + n.dataset.deviceTab).hidden = !on;
    });
  }
  touchTab.dataset.deviceTab = "touch";
  touchTab.onclick = show;
  touchTab.onkeydown = (e) => {
    const buttons = [...document.querySelectorAll("[data-device-tab]")];
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const i =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? buttons.length - 1
            : (3 + (e.key === "ArrowRight" ? 1 : buttons.length - 1)) %
              buttons.length;
      buttons[i].click();
      buttons[i].focus();
    }
  };
  bar.append(touchTab);
  bar.after(touch);
  touch.append(
    el("h2", "Multi-touch"),
    row(
      button("Start touch test", () => {
        ctx.stop();
        touchEvents = new AbortController();
        surface.style.touchAction = "none";
        surface.focus();
        const update = (e) => {
          if (e.type === "pointerdown") {
            try {
              surface.setPointerCapture(e.pointerId);
            } catch {}
            points.set(e.pointerId, { x: e.clientX, y: e.clientY });
          } else if (e.type === "pointermove" && points.has(e.pointerId))
            points.set(e.pointerId, { x: e.clientX, y: e.clientY });
          else if (e.type !== "pointermove") points.delete(e.pointerId);
          surface.replaceChildren();
          const rect = surface.getBoundingClientRect();
          for (const [id, pos] of points) {
            const n = el("span", "", { class: "touch-point" });
            n.textContent = String(id);
            n.style.left = pos.x - rect.left + "px";
            n.style.top = pos.y - rect.top + "px";
            surface.append(n);
          }
          uiText(info, uiMsg("{0} active touch points", [points.size]));
        };
        for (const event of [
          "pointerdown",
          "pointermove",
          "pointerup",
          "pointercancel",
          "lostpointercapture",
        ])
          surface.addEventListener(event, update, {
            signal: touchEvents.signal,
          });
        surface.addEventListener("focusout", stop, {
          signal: touchEvents.signal,
        });
        surface.addEventListener(
          "keydown",
          (e) => {
            if (e.key === "Escape") stop();
          },
          { signal: touchEvents.signal },
        );
        uiText(info, uiMsg("Touch the area with multiple fingers."));
      }),
      button("Stop touch test", stop),
    ),
    info,
    surface,
  );
  window.addEventListener("device-stopped", stop);
  window.addEventListener("pagehide", stop);
  window.addEventListener("blur", stop);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });
}
