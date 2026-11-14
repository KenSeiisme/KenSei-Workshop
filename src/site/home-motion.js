const preferenceKey = "kensei-home-motion-v1";

export function mountHomeMotion(root) {
  if (!("IntersectionObserver" in window) || !Element.prototype.animate) return;

  const toggle = root.querySelector("[data-home-motion-toggle]");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const wide = matchMedia("(min-width: 1050px) and (min-height: 700px)");
  const scenes = [...root.querySelectorAll(".home-intro, .home-section")];
  const anchors = [...root.querySelectorAll(".home-bubble-anchor")];
  const visible = new Set();
  const entered = new WeakSet();
  const effects = new Map();
  let preference = true;
  let frame = 0;
  let lastY = scrollY;
  let movingDown = scrollY > 0;

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

  function scatter(scene, y) {
    const desktop = wide.matches;
    const limit = desktop ? 18 : 8;
    const count = Math.min(
      desktop ? 10 : 6,
      limit - root.querySelectorAll(".home-particle").length,
    );
    const layer = scene.querySelector(".home-particles");
    const width = layer.clientWidth;

    // Two short fountains hug the scene's edge and stay behind the cards.
    for (let index = 0; index < count; index++) {
      const particle = document.createElement("span");
      particle.className = "home-particle";
      const sign = index % 2 ? 1 : -1;
      const edge = desktop ? Math.max(8, (width - 1200) / 2) : 7;
      const inset = edge + ((index * 7) % (desktop ? 45 : 15));
      particle.style.left = (sign === 1 ? width - inset : inset) + "px";
      particle.style.top = Math.max(8, y + ((index * 13) % 44)) + "px";
      particle.style.setProperty("--particle-size", 2 + (index % 4) + "px");
      layer.append(particle);
      const rise = (desktop ? 48 : 25) + ((index * 13) % 39);
      const drift = sign * (8 + ((index * 4) % 22));
      play(
        scene,
        particle,
        [
          { transform: "translate(0, 9px) scale(0.6)", opacity: 0 },
          { opacity: 0.85, offset: 0.2 },
          {
            transform: "translate(" + drift + "px, -" + rise + "px)",
            opacity: 0,
          },
        ],
        { duration: 610 + index * 19, delay: index * 34, easing: "ease-out" },
        true,
      );
    }
  }

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
      queuePaint();
    },
    { rootMargin: "-88px 0px 0px 0px", threshold: 0.01 },
  );

  // Observe bubble silhouettes independently of their slow animated offset.
  const bubbleVisibility = new IntersectionObserver(
    (entries) => {
      for (const { target, isIntersecting } of entries)
        target.toggleAttribute("data-home-bubble-visible", isIntersecting);
      fitBubbleBudget();
    },
    { rootMargin: "-88px 0px 0px 0px", threshold: 0.01 },
  );

  function fitBubbleBudget() {
    let remaining = wide.matches ? 9 : 4;
    for (const anchor of anchors) {
      const bubble = anchor.firstElementChild;
      const eligible =
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
        if (!entry.isIntersecting || entered.has(scene) || !playing()) continue;
        entered.add(scene);
        entrances.unobserve(entry.target);
        introduceCards(scene);
        if (movingDown) {
          const y =
            entry.intersectionRect.top - scene.getBoundingClientRect().top;
          scatter(scene, y + 32);
        }
      }
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.01 },
  );

  function queuePaint() {
    if (frame || !playing() || !wide.matches) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
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
    if (!playing()) cancelEffects();
    else queuePaint();
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
  document.addEventListener("visibilitychange", sync);
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
