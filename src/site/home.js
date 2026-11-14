const root = document.querySelector(".workshop-home");
const featured = [
  ...root.querySelectorAll(".home-section:has([data-home-popular])"),
];

function updatePopular() {
  if (!featured.length) return;
  const inView = (section) => {
    const { top, bottom } = section.getBoundingClientRect();
    return top < innerHeight && bottom > 0;
  };
  const locked = new Set(
    featured.filter(
      (section) => location.hash === "#" + section.id || inView(section),
    ),
  );
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) locked.add(entry.target);
    }
  });
  for (const section of featured) observer.observe(section);
  for (const section of featured) {
    for (const event of ["focusin", "pointerdown"]) {
      section.addEventListener(event, () => locked.add(section), {
        once: true,
      });
    }
  }

  fetch("/api/home-popular", { signal: AbortSignal.timeout(4500) })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      for (const section of featured) {
        const ranking = data?.[section.dataset.homeSection];
        if (
          locked.has(section) ||
          inView(section) ||
          ranking?.source !== "analytics" ||
          !Array.isArray(ranking.slugs) ||
          ranking.slugs.length !== 4 ||
          new Set(ranking.slugs).size !== 4
        )
          continue;
        const grid = section.querySelector(".home-cards");
        const live = new Map(
          [...grid.children].map((card) => [card.dataset.homeCard, card]),
        );
        const templates = new Map(
          [...section.querySelector("template").content.children].map(
            (card) => [card.dataset.homeCard, card],
          ),
        );
        const cards = ranking.slugs.map(
          (slug) => live.get(slug) || templates.get(slug)?.cloneNode(true),
        );
        if (cards.some((card) => !card)) continue;
        grid.replaceChildren(...cards);
        section.querySelector("[data-home-featured]").hidden = true;
        section.querySelector("[data-home-popular]").hidden = false;
      }
    })
    .catch(() => {})
    .finally(() => observer.disconnect());
}

const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const wide = matchMedia("(min-width: 1050px) and (min-height: 700px)");
const sections = [...root.querySelectorAll(".home-section")];
const visibility = new Set();
const covers = new IntersectionObserver(
  (entries) => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      covers.unobserve(target);
      if (
        !reduced.matches &&
        target.animate &&
        !target.closest(".home-section").contains(document.activeElement)
      ) {
        target.animate(
          [
            { opacity: 0.66, transform: "translateY(10px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          { duration: 380, easing: "ease-out" },
        );
      }
    }
  },
  { threshold: 0.15 },
);
const entered = new WeakSet();
const motion = new IntersectionObserver((entries) => {
  for (const { target, isIntersecting } of entries) {
    if (isIntersecting) {
      visibility.add(target);
      if (!entered.has(target)) {
        entered.add(target);
        covers.observe(target.querySelector("[data-home-cover]"));
      }
    } else visibility.delete(target);
  }
  queuePaint();
});
let frame = 0;

function queuePaint() {
  if (!frame && !reduced.matches && !document.hidden)
    frame = requestAnimationFrame(paint);
}

function paint() {
  frame = 0;
  for (const section of visibility) {
    if (wide.matches) {
      const distance = section.getBoundingClientRect().top / innerHeight;
      const offset = Math.max(-16, Math.min(16, Math.round(distance * 16)));
      section.style.setProperty("--home-parallax", offset + "px");
    }
  }
}

function syncMotion() {
  if (reduced.matches || !wide.matches)
    for (const section of sections)
      section.style.removeProperty("--home-parallax");
  if (reduced.matches) {
    cancelAnimationFrame(frame);
    frame = 0;
    for (const section of sections)
      for (const animation of section
        .querySelector("[data-home-cover]")
        .getAnimations())
        animation.cancel();
  } else queuePaint();
}

for (const section of sections) motion.observe(section);
reduced.addEventListener("change", syncMotion);
wide.addEventListener("change", syncMotion);
document.addEventListener("visibilitychange", queuePaint);
window.addEventListener("scroll", () => wide.matches && queuePaint(), {
  passive: true,
});
updatePopular();
