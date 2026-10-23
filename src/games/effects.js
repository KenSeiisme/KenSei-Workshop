const KEY = "kensei-game-effects-v1";
const media = matchMedia("(prefers-reduced-motion: reduce)");
const choices = new Set(["auto", "reduced", "off"]);
let choice = "auto",
  mounted = false;
const animations = new Set(),
  demoTimers = new Map(),
  seen = new WeakSet();
try {
  const saved = localStorage.getItem(KEY);
  if (choices.has(saved)) choice = saved;
} catch {}
export const effectsMode = () =>
  choice === "auto" ? (media.matches ? "reduced" : "full") : choice;
export function animateElement(element, frames, options = {}) {
  if (!element?.animate || effectsMode() === "off") return null;
  const reduced = effectsMode() !== "full";
  const animation = element.animate(
    reduced ? [{ opacity: 0.7 }, { opacity: 1 }] : frames,
    {
      ...options,
      duration: reduced
        ? Math.min(80, options.duration || 80)
        : options.duration || 120,
      delay: reduced ? 0 : options.delay || 0,
      fill: "none",
    },
  );
  animations.add(animation);
  animation.finished.then(
    () => animations.delete(animation),
    () => animations.delete(animation),
  );
  return animation;
}
export function cancelEffects() {
  for (const root of document.querySelectorAll(
    ".games-page,.is-public-profile",
  ))
    for (const animation of root.getAnimations?.({ subtree: true }) || [])
      animation.cancel();
  for (const animation of animations) animation.cancel();
  animations.clear();
  for (const [card, timer] of demoTimers) {
    clearTimeout(timer);
    delete card.dataset.demo;
  }
  demoTimers.clear();
}
function applyChoice() {
  cancelEffects();
  document.documentElement.dataset.gameEffects = effectsMode();
  document
    .querySelectorAll("[data-effects-select]")
    .forEach((select) => (select.value = choice));
  window.dispatchEvent(
    new CustomEvent("game-effects-change", {
      detail: { choice, mode: effectsMode() },
    }),
  );
}
export function mountEffects() {
  document.querySelectorAll("[data-effects-select]").forEach((select) => {
    select.value = choice;
    if (select.dataset.bound) return;
    select.dataset.bound = "true";
    select.addEventListener("change", () => {
      choice = choices.has(select.value) ? select.value : "auto";
      try {
        localStorage.setItem(KEY, choice);
      } catch {}
      applyChoice();
    });
  });
  document.documentElement.dataset.gameEffects = effectsMode();
  if (mounted) return;
  mounted = true;
  media.addEventListener("change", applyChoice);
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      choice = choices.has(e.newValue) ? e.newValue : "auto";
      applyChoice();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelEffects();
  });
  window.addEventListener("pagehide", cancelEffects);
}
export function bindCardDemos(root = document) {
  for (const card of root.querySelectorAll("[data-game-card]")) {
    if (card.dataset.demoBound) continue;
    card.dataset.demoBound = "true";
    const play = () => {
      if (effectsMode() !== "full" || demoTimers.has(card)) return;
      card.dataset.demo = "playing";
      demoTimers.set(
        card,
        setTimeout(() => {
          delete card.dataset.demo;
          demoTimers.delete(card);
          card.dataset.demoDone = "true";
        }, 1100),
      );
    };
    const reset = () => {
      if (demoTimers.has(card)) clearTimeout(demoTimers.get(card));
      demoTimers.delete(card);
      delete card.dataset.demo;
      delete card.dataset.demoDone;
    };
    card.addEventListener("pointerenter", () => {
      if (!card.dataset.demoDone) play();
    });
    card.addEventListener("pointerleave", reset);
    card.addEventListener("focusin", (e) => {
      if (!card.contains(e.relatedTarget) && !card.dataset.demoDone) play();
    });
    card.addEventListener("focusout", (e) => {
      if (!card.contains(e.relatedTarget)) reset();
    });
  }
}
let observer;
export function revealGameCards(root) {
  if (!root) return;
  observer ||=
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries)
              if (entry.isIntersecting) {
                observer.unobserve(entry.target);
                if (seen.has(entry.target)) continue;
                seen.add(entry.target);
                animateElement(
                  entry.target,
                  [
                    { opacity: 0, transform: "translateY(18px)" },
                    { opacity: 1, transform: "translateY(0)" },
                  ],
                  { duration: 280, easing: "cubic-bezier(.2,.8,.2,1)" },
                );
              }
          },
          { threshold: 0.1 },
        )
      : null;
  for (const card of root.querySelectorAll(".profile-game-card"))
    if (!seen.has(card)) observer?.observe(card);
}
