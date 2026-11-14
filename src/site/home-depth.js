const cardSelector = ".home-card, .home-portal";

export function mountHomeDepth(root, wide, schedule, onShift) {
  const groups = [...root.querySelectorAll(".home-portals, .home-cards")];
  let current = null;
  let pointer = null;

  const inViewport = (element) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom > 80 && rect.top < innerHeight;
  };

  function scrollTarget() {
    const line = 80 + (innerHeight - 80) * 0.46;
    const group = groups.find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top <= line && rect.bottom >= line;
    });
    if (!group) return null;

    const cards = [...group.children];
    const top = group.getBoundingClientRect().top;
    const portals = group.classList.contains("home-portals");
    if (portals && cards[0].offsetTop === cards[1].offsetTop) return null;

    const stops = cards
      .map((card, index) => {
        // The lead spans three desktop rows. Give it a stop before the right column.
        const lead = !portals && wide.matches && index === 0;
        const sameRow =
          !portals &&
          !wide.matches &&
          cards.some(
            (other) => other !== card && other.offsetTop === card.offsetTop,
          );
        const rowPosition = sameRow ? (index % 2 ? 0.72 : 0.28) : 0.5;
        const offset = lead ? 12 : card.offsetHeight * rowPosition;
        return {
          card,
          distance: Math.abs(top + card.offsetTop + offset - line),
        };
      })
      .filter(({ card }) => inViewport(card));

    const closest = stops.reduce(
      (best, stop) => (!best || stop.distance < best.distance ? stop : best),
      null,
    );
    const previous = stops.find(({ card }) => card === current);
    if (closest && previous && previous.distance <= closest.distance + 16)
      return current;
    return closest?.card ?? null;
  }

  function highlight(next) {
    if (next === current) return;
    const previous = current;
    current = next;
    previous?.removeAttribute("data-home-spotlight");
    if (previous?.parentElement !== next?.parentElement)
      previous?.parentElement.removeAttribute("data-home-depth");
    if (!next) return;
    next.parentElement.setAttribute("data-home-depth", "");
    next.setAttribute("data-home-spotlight", "");
    if (previous?.parentElement === next.parentElement) onShift(next);
  }

  root.addEventListener("pointerover", (event) => {
    if (event.pointerType !== "mouse") return;
    const card = event.target.closest(cardSelector);
    if (!card) return;
    pointer = card;
    schedule();
  });
  root.addEventListener("pointerout", (event) => {
    if (
      !pointer ||
      !pointer.contains(event.target) ||
      pointer.contains(event.relatedTarget)
    )
      return;
    pointer = null;
    schedule();
  });
  root.addEventListener("focusin", () => schedule());
  root.addEventListener("focusout", () => schedule());

  return {
    clear() {
      highlight(null);
    },
    paint() {
      const focus = document.activeElement?.closest(cardSelector);
      const keyboard =
        focus?.matches(":focus-visible") && inViewport(focus) ? focus : null;
      const hovered =
        pointer?.isConnected && inViewport(pointer) && pointer.matches(":hover")
          ? pointer
          : null;
      highlight(keyboard || hovered || scrollTarget());
    },
  };
}
