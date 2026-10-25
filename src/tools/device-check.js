import { $, $$, esc } from "./common.js";
import { uiMsg, uiJoin, uiText, uiHtml } from "../site/ui.js";

let controller = null,
  active = null,
  pressed = new Set(),
  clicks = [0, 0, 0, 0],
  scrollX = 0,
  scrollY = 0;
function stop() {
  controller?.abort();
  controller = null;
  active = null;
  pressed.clear();
  $("#keyboard-keys").replaceChildren();
  uiText($("#keyboard-last"), uiMsg("Press a key after starting."));
  uiText($("#keyboard-status"), uiMsg("Not listening."));
  uiText(
    $("#mouse-status"),
    uiMsg("Not listening. Start and move your mouse inside this area."),
  );
  uiText($("#mouse-buttons"), uiMsg("Buttons: none"));
  $("#screen-surface").hidden = true;
  $("#keyboard-stop").disabled = true;
  $("#mouse-stop").disabled = true;
  $("#screen-stop").disabled = true;
  $("#screen-fullscreen").disabled = true;
  if (document.fullscreenElement === $("#screen-surface"))
    document.exitFullscreen().catch(() => {});
}
function listen(target, event, fn, options = {}) {
  target.addEventListener(event, fn, { ...options, signal: controller.signal });
}
function start(type) {
  stop();
  active = type;
  controller = new AbortController();
  $("#" + type + "-stop").disabled = false;
  listen(document, "visibilitychange", () => {
    if (document.hidden) stop();
  });
  listen(window, "blur", () => stop());
  listen(window, "pagehide", stop);
}
function tab(name) {
  stop();
  $$("[data-device-tab]").forEach((b) => {
    const yes = b.dataset.deviceTab === name;
    b.classList.toggle("active", yes);
    b.setAttribute("aria-selected", String(yes));
    b.tabIndex = yes ? 0 : -1;
    $("#device-" + b.dataset.deviceTab).hidden = !yes;
  });
}
$$("[data-device-tab]").forEach((b, index) => {
  b.addEventListener("click", () => tab(b.dataset.deviceTab));
  b.addEventListener("keydown", (e) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const buttons = $$("[data-device-tab]"),
        i =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? 2
              : (index + (e.key === "ArrowRight" ? 1 : 2)) % 3;
      tab(buttons[i].dataset.deviceTab);
      buttons[i].focus();
    }
  });
});
$("#screen-start").addEventListener("click", () => {
  start("screen");
  const surface = $("#screen-surface");
  surface.hidden = false;
  surface.style.background = $("#screen-pattern").value;
  $("#screen-fullscreen").disabled = false;
  surface.focus();
  listen(document, "keydown", (e) => {
    if (e.key === "Escape") stop();
  });
  listen(document, "fullscreenchange", () => {
    if (!document.fullscreenElement && active === "screen") stop();
  });
  uiText(
    $("#screen-status"),
    uiMsg("Screen test running. Use Esc or Exit test to finish."),
  );
});
$("#screen-pattern").addEventListener("change", () => {
  if (active === "screen")
    $("#screen-surface").style.background = $("#screen-pattern").value;
});
$("#screen-fullscreen").addEventListener("click", async () => {
  try {
    await $("#screen-surface").requestFullscreen();
    $("#screen-surface").focus({ preventScroll: true });
  } catch {
    uiText(
      $("#screen-status"),
      uiMsg(
        "Fullscreen unavailable. The embedded screen test is still active.",
      ),
    );
  }
});
$("#screen-exit").addEventListener("click", stop);
$("#screen-stop").addEventListener("click", stop);
$("#keyboard-start").addEventListener("click", () => {
  start("keyboard");
  const area = $("#keyboard-surface");
  area.focus();
  uiText(
    $("#keyboard-status"),
    uiMsg("Listening inside this area. Tab away or click outside to stop."),
  );
  const render = (e) => {
    uiText(
      $("#keyboard-last"),
      uiMsg("{0} · key: {1} · code: {2}{3}", [
        e.type === "keydown" ? uiMsg("Down") : uiMsg("Up"),
        e.key,
        e.code || "unavailable",
        e.repeat ? uiMsg(" · repeat") : "",
      ]),
    );
    $("#keyboard-keys").innerHTML = [...pressed]
      .map((x) => uiHtml`<kbd>${esc(x)}</kbd>`)
      .join("");
  };
  listen(area, "keydown", (e) => {
    if (e.key === "Escape") {
      stop();
      return;
    }
    pressed.add(e.code || e.key);
    render(e);
  });
  listen(area, "keyup", (e) => {
    pressed.delete(e.code || e.key);
    render(e);
  });
  listen(area, "focusout", (e) => {
    if (!area.contains(e.relatedTarget)) stop();
  });
});
$("#keyboard-stop").addEventListener("click", stop);
function mouseStats() {
  uiText(
    $("#mouse-clicks"),
    uiMsg("Clicks · Left: {0} · Middle: {1} · Right: {2} · Other: {3}", [
      clicks[0],
      clicks[1],
      clicks[2],
      clicks[3],
    ]),
  );
  uiText(
    $("#mouse-wheel"),
    uiMsg("Wheel · X: {0} · Y: {1}", [
      Math.round(scrollX),
      Math.round(scrollY),
    ]),
  );
}
$("#mouse-start").addEventListener("click", () => {
  start("mouse");
  const area = $("#mouse-surface");
  area.focus();
  uiText($("#mouse-status"), uiMsg("Listening inside this area."));
  listen(area, "pointerdown", (e) => {
    if (e.pointerType !== "mouse") {
      uiText(
        $("#mouse-status"),
        uiMsg(
          "Touch or pen detected. Use a mouse for physical button testing.",
        ),
      );
      return;
    }
    clicks[Math.min(e.button, 3)]++;
    uiText(
      $("#mouse-buttons"),
      uiJoin([uiMsg("Buttons bitmask: "), e.buttons]),
    );
    mouseStats();
  });
  listen(area, "pointerup", (e) => {
    uiText(
      $("#mouse-buttons"),
      uiJoin([uiMsg("Buttons bitmask: "), e.buttons]),
    );
  });
  listen(
    area,
    "wheel",
    (e) => {
      e.preventDefault();
      scrollX += e.deltaX;
      scrollY += e.deltaY;
      uiText(
        $("#mouse-status"),
        uiJoin([
          uiMsg("Wheel delta mode: "),
          ["pixels", "lines", "pages"][e.deltaMode] || e.deltaMode,
        ]),
      );
      mouseStats();
    },
    { passive: false },
  );
  listen(area, "contextmenu", (e) => e.preventDefault());
  listen(area, "pointerleave", stop);
  listen(area, "focusout", (e) => {
    if (!area.contains(e.relatedTarget)) stop();
  });
});
$("#mouse-stop").addEventListener("click", stop);
$("#mouse-reset").addEventListener("click", () => {
  clicks = [0, 0, 0, 0];
  scrollX = scrollY = 0;
  mouseStats();
});
if (matchMedia("(pointer: coarse)").matches)
  uiText(
    $("#device-touch-note"),
    uiMsg(
      "Touch device detected. Screen checks work here; physical keyboard and mouse checks need connected hardware.",
    ),
  );
