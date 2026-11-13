(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const hover = matchMedia("(hover: hover) and (pointer: fine)");
  const active = new Map();

  for (const card of document.querySelectorAll(
    ".tools-page [data-tool-card], .listing-projects .project-card-link",
  )) {
    const cover = card.querySelector(".tool-card-preview, .project-cover");
    if (!cover) continue;
    const shine = document.createElement("span");
    shine.className = "catalog-shine";
    shine.setAttribute("aria-hidden", "true");
    cover.append(shine);

    const sweep = () => {
      if (reduced.matches || !shine.animate) return;
      active.get(card)?.cancel();
      const animation = shine.animate(
        [
          { transform: "translateX(-130%) skewX(-17deg)", opacity: 0 },
          { opacity: 0.85, offset: 0.35 },
          { transform: "translateX(170%) skewX(-17deg)", opacity: 0 },
        ],
        { duration: 600, easing: "ease-out" },
      );
      active.set(card, animation);
      const clear = () => {
        if (active.get(card) === animation) active.delete(card);
      };
      animation.finished.then(clear, clear);
    };
    card.addEventListener("pointerenter", (event) => {
      if (hover.matches && event.pointerType === "mouse") sweep();
    });
    card.addEventListener("focusin", (event) => {
      if (
        !card.contains(event.relatedTarget) &&
        event.target.matches(":focus-visible")
      )
        sweep();
    });
  }
  reduced.addEventListener("change", () => {
    if (reduced.matches)
      for (const animation of active.values()) animation.cancel();
  });
})();
