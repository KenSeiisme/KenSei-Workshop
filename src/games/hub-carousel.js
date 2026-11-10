import { animateElement, effectsMode } from "./effects.js";
import { uiAttr, uiMsg, uiText } from "../site/ui.js";

export function mountHubCarousel(carousel) {
  const slides = [...carousel.querySelectorAll("[data-hub-featured]")];
  const rotate = carousel.querySelector("[data-hub-rotate]");
  rotate.removeAttribute("data-ui-attrs");
  const count = carousel.querySelector("[data-hub-slide-count]");
  let index = 0,
    playing = effectsMode() === "full",
    inView = !("IntersectionObserver" in window),
    hovering = false,
    pageHidden = false,
    touch = null,
    pointerAction = null,
    timer,
    transition;

  function schedule() {
    clearTimeout(timer);
    if (
      playing &&
      inView &&
      !hovering &&
      !touch &&
      !pageHidden &&
      !document.hidden
    )
      timer = setTimeout(() => move(1, false), 5000);
  }

  function renderControls() {
    const label = playing ? uiMsg("Pause slideshow") : uiMsg("Play slideshow");
    uiAttr(rotate, "aria-label", label);
    uiAttr(rotate, "title", label);
    rotate.firstElementChild.textContent = playing ? "Ⅱ" : "▶";
    count.setAttribute("aria-live", playing ? "off" : "polite");
  }

  function setPlaying(value) {
    playing = value;
    renderControls();
    schedule();
  }

  let shine, float;
  function embellish(slide) {
    shine?.cancel();
    float?.cancel();
    if (effectsMode() !== "full") return;
    shine = animateElement(
      slide.querySelector(".hub-art-shine"),
      [
        { transform: "translateX(-105%)", opacity: 0 },
        { opacity: 1, offset: 0.35 },
        { transform: "translateX(105%)", opacity: 0 },
      ],
      { duration: 680, easing: "ease-out" },
    );
    float = animateElement(
      slide.querySelector(".hub-art-tags"),
      [
        { transform: "translateY(5px)" },
        { transform: "translateY(-2px)", offset: 0.65 },
        { transform: "translateY(0)" },
      ],
      { duration: 360, easing: "ease-out" },
    );
  }
  function move(delta, manual) {
    if (manual) setPlaying(false);
    transition?.cancel();
    slides[index].hidden = true;
    index = (index + delta + slides.length) % slides.length;
    slides[index].hidden = false;
    embellish(slides[index]);
    transition = animateElement(
      slides[index],
      [
        { opacity: 0.4, transform: `translateX(${delta * 12}px)` },
        { opacity: 1, transform: "none" },
      ],
      { duration: 250, easing: "ease-out" },
    );
    uiText(count, `${index + 1} / ${slides.length}`);
    schedule();
  }

  rotate.addEventListener("pointerdown", () => (pointerAction = !playing));
  rotate.addEventListener("pointercancel", () => (pointerAction = null));
  rotate.addEventListener("click", (event) => {
    const requested = event.detail > 0 ? pointerAction : null;
    pointerAction = null;
    setPlaying(requested ?? !playing);
  });
  for (const button of carousel.querySelectorAll("[data-hub-slide]"))
    button.addEventListener("click", () =>
      move(Number(button.dataset.hubSlide), true),
    );
  for (const slide of slides)
    slide
      .querySelector(".hub-slide-art")
      .addEventListener("mouseenter", () => embellish(slide));
  carousel.addEventListener("focusin", (event) => {
    if (!carousel.contains(event.relatedTarget)) setPlaying(false);
  });
  carousel.addEventListener("keydown", (event) => {
    if (
      !["ArrowLeft", "ArrowRight"].includes(event.key) ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey
    )
      return;
    event.preventDefault();
    // Keep focus in the carousel if a slide link is about to become hidden.
    if (slides[index].contains(event.target))
      carousel
        .querySelector(
          `[data-hub-slide="${event.key === "ArrowLeft" ? "-1" : "1"}"]`,
        )
        .focus();
    move(event.key === "ArrowLeft" ? -1 : 1, true);
  });
  carousel.addEventListener("mouseenter", () => {
    hovering = true;
    schedule();
  });
  carousel.addEventListener("mouseleave", () => {
    hovering = false;
    schedule();
  });
  carousel.addEventListener(
    "touchstart",
    (event) => {
      touch = event.touches.length === 1 ? event.touches[0] : null;
      schedule();
    },
    { passive: true },
  );
  carousel.addEventListener(
    "touchend",
    (event) => {
      if (!touch) return;
      const dx = event.changedTouches[0].clientX - touch.clientX;
      const dy = event.changedTouches[0].clientY - touch.clientY;
      touch = null;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5)
        move(dx > 0 ? -1 : 1, true);
      else schedule();
    },
    { passive: true },
  );
  carousel.addEventListener("touchcancel", () => {
    touch = null;
    schedule();
  });
  if ("IntersectionObserver" in window)
    new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      schedule();
    }).observe(carousel);
  document.addEventListener("visibilitychange", schedule);
  window.addEventListener("pagehide", () => {
    pageHidden = true;
    schedule();
  });
  window.addEventListener("pageshow", () => {
    pageHidden = false;
    schedule();
  });
  window.addEventListener("game-effects-change", () => {
    if (effectsMode() !== "full") setPlaying(false);
  });
  renderControls();
  embellish(slides[index]);
  schedule();
}
