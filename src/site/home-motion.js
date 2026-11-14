import { mountHomeDepth } from "./home-depth.js";

const preferenceKey = "kensei-home-motion-v1";
const sceneSelector = ".home-intro, .home-section";

export function mountHomeMotion(root) {
  if (!("IntersectionObserver" in window) || !Element.prototype.animate) return;

  const toggle = root.querySelector("[data-home-motion-toggle]");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const wide = matchMedia("(min-width: 1050px) and (min-height: 700px)");
  const scenes = [...root.querySelectorAll(sceneSelector)];
  const anchors = [...root.querySelectorAll(".home-bubble-anchor")];
  const visible = new Set();
  const entered = new WeakSet();
  const gridVisible = new Set();
  const pendingEntry = new Set();
  const effects = new Map();
  let preference = true;
  let frame = 0;
  let lastY = scrollY;
  let movingDown = scrollY > 0;
  let lastBurst = -Infinity;
  const particles = Array.from({ length: 30 }, (_, index) => {
    const node = document.createElement("span");
    node.className = "home-particle";
    if (index % 5 === 2) node.classList.add("is-ring");
    if (index % 5 === 4) node.classList.add("is-diamond");
    return node;
  });

  try {
    preference = localStorage.getItem(preferenceKey) !== "off";
  } catch {}

  const enabled = () => preference && !reduced.matches;
  const playing = () => enabled() && !document.hidden;

  function play(scene, element, frames, options, particle = false) {
    const animation = element.animate(frames, options);
    const finish = () => {
      effects.delete(animation);
      if (particle) element.remove();
    };
    effects.set(animation, { scene, particle });
    animation.finished.then(finish, finish);
  }

  function cancelEffects(scene, particlesOnly = false) {
    for (const [animation, effect] of effects) {
      if (
        (!scene || effect.scene === scene) &&
        (!particlesOnly || effect.particle)
      )
        animation.cancel();
    }
  }

  function introduceCards(scene) {
    if (scene.querySelector(".home-card:focus-within")) return;
    const [lead, ...cards] = scene.querySelectorAll(".home-card");
    const targets = [lead.querySelector("[data-home-cover]"), ...cards];
    const shift = wide.matches ? 16 : 9;
    for (const [index, target] of targets.entries()) {
      play(
        scene,
        target,
        [
          { transform: "translateY(" + shift + "px)", opacity: 0.85 },
          { transform: "translateY(0)", opacity: 1 },
        ],
        {
          duration: 330,
          delay: index * 44,
          easing: "ease-out",
          fill: "backwards",
        },
      );
    }
  }

  function scatter(scene, y, card = null) {
    const now = performance.now();
    if (!playing() || (card && (pendingEntry.size || now - lastBurst < 170)))
      return;
    const desktop = wide.matches;
    const limit = desktop ? 30 : 12;
    const count = card ? (desktop ? 8 : 4) : desktop ? 16 : 9;
    const available = particles
      .slice(0, limit)
      .filter((particle) => !particle.parentNode);
    if (!card && available.length < count) {
      cancelEffects(null, true);
      return false;
    }
    if (!available.length) return false;
    const layer = scene.querySelector(".home-particles");
    const rect = layer.getBoundingClientRect();
    const bounds = card?.getBoundingClientRect();
    lastBurst = now;

    for (const [index, particle] of available.slice(0, count).entries()) {
      const sign = index % 2 ? 1 : -1;
      const edge = desktop ? Math.max(8, (rect.width - 1200) / 2) : 7;
      const side = sign === 1 ? rect.width - edge : edge;
      const x = bounds
        ? (sign === 1 ? bounds.right : bounds.left) - rect.left
        : side;
      particle.style.left =
        Math.max(5, Math.min(rect.width - 6, x + sign * ((index * 7) % 17))) +
        "px";
      particle.style.top = Math.max(8, y + ((index * 13) % 42)) + "px";
      particle.style.setProperty("--particle-size", 2 + (index % 5) + "px");
      particle.dataset.sectionBurst = !card && index === 0 ? "start" : "";
      layer.append(particle);
      const rise = (desktop ? 54 : 28) + ((index * 13) % 43);
      const drift = sign * (8 + ((index * 4) % 22));
      play(
        scene,
        particle,
        [
          { transform: "translate(0, 9px) scale(0.65)", opacity: 0 },
          { opacity: 0.85, offset: 0.21 },
          {
            transform: "translate(" + drift + "px, -" + rise + "px)",
            opacity: 0,
          },
        ],
        { duration: 650 + index * 16, delay: index * 22, easing: "ease-out" },
        true,
      );
    }
    return true;
  }

  const depth = mountHomeDepth(root, wide, queuePaint, (card) => {
    const scene = card.closest(sceneSelector);
    const top =
      card.getBoundingClientRect().top - scene.getBoundingClientRect().top;
    scatter(scene, top + 38, card);
  });

  const visibility = new IntersectionObserver(
    (entries) => {
      for (const { target: scene, isIntersecting } of entries) {
        if (isIntersecting) visible.add(scene);
        else {
          visible.delete(scene);
          scene.style.removeProperty("--home-parallax");
          cancelEffects(scene);
        }
      }
      fitBubbleBudget();
      queuePaint();
    },
    { rootMargin: "-72px 0px 0px 0px", threshold: 0.01 },
  );

  // Observe bubble silhouettes independently of their slow animated offset.
  const bubbleVisibility = new IntersectionObserver(
    (entries) => {
      for (const { target, isIntersecting } of entries)
        target.toggleAttribute("data-home-bubble-visible", isIntersecting);
      fitBubbleBudget();
    },
    { rootMargin: "-72px 0px 335px 0px", threshold: 0.01 },
  );

  function fitBubbleBudget() {
    let remaining = wide.matches ? 16 : 8;
    for (const anchor of anchors) {
      const bubble = anchor.firstElementChild;
      const eligible =
        visible.has(anchor.closest(sceneSelector)) &&
        anchor.hasAttribute("data-home-bubble-visible") &&
        anchor.getBoundingClientRect().width > 0;
      const show = eligible && remaining > 0;
      if (show) remaining--;
      bubble.toggleAttribute("data-home-bubble-active", show);
      bubble.toggleAttribute("data-home-budget-hidden", eligible && !show);
    }
  }

  const entrances = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const scene = entry.target.closest(".home-section");
        if (!entry.isIntersecting) {
          gridVisible.delete(scene);
          pendingEntry.delete(scene);
          continue;
        }
        gridVisible.add(scene);
        if (entered.has(scene)) continue;
        entered.add(scene);
        if (!playing()) continue;
        introduceCards(scene);
        if (movingDown || scrollY > lastY) pendingEntry.add(scene);
      }
      queuePaint();
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.01 },
  );

  function queuePaint() {
    if (frame || !playing()) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      for (const scene of pendingEntry) {
        if (!gridVisible.has(scene)) {
          pendingEntry.delete(scene);
          continue;
        }
        const top =
          scene.querySelector(".home-cards").getBoundingClientRect().top -
          scene.getBoundingClientRect().top;
        if (scatter(scene, top + 32)) pendingEntry.delete(scene);
        else {
          queuePaint();
          break;
        }
      }
      depth.paint();
      if (!wide.matches) return;
      for (const scene of visible) {
        const distance = scene.getBoundingClientRect().top / innerHeight;
        const offset = Math.max(-24, Math.min(24, Math.round(distance * 24)));
        scene.style.setProperty("--home-parallax", offset + "px");
      }
    });
  }

  function sync() {
    root.dataset.homeMotion = enabled() ? "on" : "off";
    root.toggleAttribute("data-home-visible", playing());
    toggle.setAttribute("aria-pressed", String(enabled()));
    toggle.setAttribute("aria-disabled", String(reduced.matches));
    if (reduced.matches)
      toggle.setAttribute("aria-describedby", "home-motion-system");
    else toggle.removeAttribute("aria-describedby");
    if (!playing() || !wide.matches) {
      cancelAnimationFrame(frame);
      frame = 0;
      for (const scene of scenes) scene.style.removeProperty("--home-parallax");
    }
    if (!playing()) {
      pendingEntry.clear();
      cancelEffects();
      depth.clear();
    } else queuePaint();
  }

  for (const anchor of anchors) bubbleVisibility.observe(anchor);
  for (const scene of scenes) {
    visibility.observe(scene);
    const cards = scene.querySelector(".home-cards");
    if (cards) entrances.observe(cards);
    scene.addEventListener("focusin", (event) => {
      if (!event.target.closest(".home-card")) return;
      for (const [animation, effect] of effects) {
        if (effect.scene === scene && !effect.particle) animation.cancel();
      }
    });
  }
  window.addEventListener(
    "scroll",
    () => {
      const y = scrollY;
      if (y !== lastY) movingDown = y > lastY;
      lastY = y;
      queuePaint();
    },
    { passive: true },
  );
  reduced.addEventListener("change", sync);
  wide.addEventListener("change", () => {
    cancelEffects(null, true);
    fitBubbleBudget();
    sync();
  });
  window.addEventListener("resize", queuePaint, { passive: true });
  document.addEventListener("visibilitychange", () => {
    lastBurst = performance.now();
    sync();
  });
  toggle.addEventListener("click", () => {
    if (reduced.matches) return;
    preference = !preference;
    try {
      localStorage.setItem(preferenceKey, preference ? "on" : "off");
    } catch {}
    sync();
  });
  toggle.hidden = false;
  sync();
}
