(() => {
  "use strict";
  const stack = document.querySelector("[data-site-notices]");
  const ui = window.KenseiI18n;
  if (!stack || !ui) return;
  const entries = new Map();
  function place() {
    const parent =
      [...document.querySelectorAll("dialog:modal")].at(-1) ||
      document.fullscreenElement ||
      document.body;
    if (stack.parentElement !== parent) parent.append(stack);
  }
  function remove(key) {
    const entry = entries.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.node.remove();
    entries.delete(key);
  }
  new MutationObserver(place).observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["open"],
  });
  document.addEventListener("fullscreenchange", place);
  window.KenseiNotify = (message, { kind = "notice", key = "notice" } = {}) => {
    place();
    remove(key);
    if (entries.size === 3) remove(entries.keys().next().value);
    const node = document.createElement("div");
    node.className = "toast";
    node.dataset.kind = kind;
    node.setAttribute("role", "status");
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.className = "toast-icon";
    icon.textContent =
      kind === "achievement" ? "✦" : kind === "setting" ? "✓" : "ⓘ";
    const content = document.createElement("span");
    node.append(icon, content);
    stack.append(node);
    ui.text(content, message);
    entries.set(key, {
      node,
      timer: setTimeout(
        () => remove(key),
        kind === "achievement" ? 6000 : kind === "setting" ? 3000 : 5500,
      ),
    });
  };
})();
