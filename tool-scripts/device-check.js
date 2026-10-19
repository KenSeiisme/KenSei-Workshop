import { $, $$, esc } from "./common.js";
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
  $("#keyboard-last").textContent = "Press a key after starting.";
  $("#keyboard-status").textContent = "Not listening.";
  $("#mouse-status").textContent =
    "Not listening. Start and move your mouse inside this area.";
  $("#mouse-buttons").textContent = "Buttons: none";
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
  $("#screen-status").textContent =
    "Screen test running. Use Esc or Exit test to finish.";
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
    $("#screen-status").textContent =
      "Fullscreen unavailable. The embedded screen test is still active.";
  }
});
$("#screen-exit").addEventListener("click", stop);
$("#screen-stop").addEventListener("click", stop);
$("#keyboard-start").addEventListener("click", () => {
  start("keyboard");
  const area = $("#keyboard-surface");
  area.focus();
  $("#keyboard-status").textContent =
    "Listening inside this area. Tab away or click outside to stop.";
  const render = (e) => {
    $("#keyboard-last").textContent =
      `${e.type === "keydown" ? "Down" : "Up"} · key: ${e.key} · code: ${e.code || "unavailable"}${e.repeat ? " · repeat" : ""}`;
    $("#keyboard-keys").innerHTML = [...pressed]
      .map((x) => `<kbd>${esc(x)}</kbd>`)
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
  $("#mouse-clicks").textContent =
    `Clicks · Left: ${clicks[0]} · Middle: ${clicks[1]} · Right: ${clicks[2]} · Other: ${clicks[3]}`;
  $("#mouse-wheel").textContent =
    `Wheel · X: ${Math.round(scrollX)} · Y: ${Math.round(scrollY)}`;
}
$("#mouse-start").addEventListener("click", () => {
  start("mouse");
  const area = $("#mouse-surface");
  area.focus();
  $("#mouse-status").textContent = "Listening inside this area.";
  listen(area, "pointerdown", (e) => {
    if (e.pointerType !== "mouse") {
      $("#mouse-status").textContent =
        "Touch or pen detected. Use a mouse for physical button testing.";
      return;
    }
    clicks[Math.min(e.button, 3)]++;
    $("#mouse-buttons").textContent = "Buttons bitmask: " + e.buttons;
    mouseStats();
  });
  listen(area, "pointerup", (e) => {
    $("#mouse-buttons").textContent = "Buttons bitmask: " + e.buttons;
  });
  listen(
    area,
    "wheel",
    (e) => {
      e.preventDefault();
      scrollX += e.deltaX;
      scrollY += e.deltaY;
      $("#mouse-status").textContent =
        "Wheel delta mode: " +
        (["pixels", "lines", "pages"][e.deltaMode] || e.deltaMode);
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
  $("#device-touch-note").textContent =
    "Touch device detected. Screen checks work here; physical keyboard and mouse checks need connected hardware.";
