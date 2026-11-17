import {
  backgroundMotion,
  observeMotionVisibility,
} from "./background-motion.js";

const scene = document.querySelector(".workshop-scene");
const layer = scene?.querySelector(".workshop-atmosphere");
if (layer) {
  const buttons = [...document.querySelectorAll("[data-background-motion]")];
  function sync() {
    const enabled = backgroundMotion.enabled();
    layer.toggleAttribute("data-motion-enabled", enabled);
    layer.toggleAttribute("data-motion-running", enabled && !document.hidden);
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(enabled));
      button.setAttribute("aria-disabled", String(backgroundMotion.reduced()));
    }
  }
  observeMotionVisibility([layer], ([entry]) => {
    layer.toggleAttribute("data-scene-visible", entry.isIntersecting);
  });
  for (const button of buttons) {
    button.addEventListener("click", () => backgroundMotion.toggle());
    button.hidden = false;
  }
  backgroundMotion.subscribe(sync);
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("pageshow", sync);
  window.addEventListener("pagehide", () =>
    layer.removeAttribute("data-motion-running"),
  );
  sync();
}
