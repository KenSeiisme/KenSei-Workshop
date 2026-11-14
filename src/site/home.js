import { mountHomeMotion } from "./home-motion.js";

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
          [
            ...section.querySelector("[data-home-card-alternates]").content
              .children,
          ].map((card) => [card.dataset.homeCard, card]),
        );
        const cards = ranking.slugs.map(
          (slug) => live.get(slug) || templates.get(slug)?.cloneNode(true),
        );
        if (cards.some((card) => !card)) continue;
        grid.replaceChildren(...cards);
        const artwork = section.querySelector("[data-float-slug]");
        if (ranking.slugs.includes(artwork?.dataset.floatSlug)) {
          const fallback = [
            ...section.querySelector("[data-home-float-alternates]").content
              .children,
          ].find((item) => !ranking.slugs.includes(item.dataset.floatSlug));
          if (fallback) artwork.replaceWith(fallback.cloneNode(true));
        }
        section.querySelector("[data-home-featured]").hidden = true;
        section.querySelector("[data-home-popular]").hidden = false;
      }
    })
    .catch(() => {})
    .finally(() => observer.disconnect());
}

mountHomeMotion(root);
updatePopular();
