const key = "kensei-home-motion-v1";
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
let preference = true;
function readPreference() {
  try {
    preference = localStorage.getItem(key) !== "off";
  } catch {}
}
readPreference();
const changes = new EventTarget();
const publish = () => changes.dispatchEvent(new Event("change"));

export const backgroundMotion = {
  enabled: () => preference && !reduced.matches,
  reduced: () => reduced.matches,
  toggle() {
    if (reduced.matches) return;
    preference = !preference;
    try {
      localStorage.setItem(key, preference ? "on" : "off");
    } catch {}
    publish();
  },
  subscribe(callback) {
    changes.addEventListener("change", callback);
  },
};

reduced.addEventListener("change", publish);
window.addEventListener("storage", (event) => {
  if (event.key !== key && event.key !== null) return;
  readPreference();
  publish();
});

export function observeMotionVisibility(nodes, onChange, options) {
  if (!("IntersectionObserver" in window)) return;
  const observer = new IntersectionObserver(onChange, options);
  for (const node of nodes) observer.observe(node);
  return observer;
}
