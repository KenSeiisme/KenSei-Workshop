import { uiFrom, uiText, uiAttr } from "../site/ui.js";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) uiText(node, text);
  if (className) node.className = className;
  return node;
};
function fold(node, title, open = false) {
  if (!node) return null;
  const details = el("details", undefined, "tool-fold"),
    summary = el("summary", uiFrom(title));
  const key = "kensei-tool-view:" + $("[data-tool]").dataset.tool + ":" + title;
  try {
    const saved = sessionStorage.getItem(key);
    if (saved !== null) open = saved === "open";
  } catch {}
  details.open = open;
  details.addEventListener("toggle", () => {
    try {
      sessionStorage.setItem(key, details.open ? "open" : "closed");
    } catch {}
  });
  node.before(details);
  details.append(summary, node);
  return details;
}
function foldRange(first, last, title) {
  if (!first || !last || first.parentNode !== last.parentNode) return null;
  const group = el("div", undefined, "tool-fold-content");
  first.before(group);
  let current = first;
  while (current) {
    const next = current.nextSibling;
    group.append(current);
    if (current === last) break;
    current = next;
  }
  return fold(group, title);
}
function step(node, text) {
  if (node) node.prepend(el("span", uiFrom(text), "tool-step"));
}
function tabs(panels, labels, { mobile = false, name = "Tool sections" } = {}) {
  if (panels.some((p) => !p) || panels.length < 2) return;
  const parent = panels[0].parentNode,
    bar = el("div", undefined, "tool-tabs");
  bar.setAttribute("role", "tablist");
  uiAttr(bar, "aria-label", uiFrom(name));
  panels[0].before(bar);
  const id = crypto.randomUUID(),
    query = matchMedia("(max-width:767px)");
  let active = 0;
  const buttons = panels.map((panel, i) => {
    const button = el("button", uiFrom(labels[i]), "tool-tab");
    button.type = "button";
    button.id = `tab-${id}-${i}`;
    panel.id ||= `panel-${id}-${i}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", button.id);
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", panel.id);
    button.onclick = () => show(i);
    button.onkeydown = (event) => {
      let j = i;
      if (event.key === "ArrowRight") j = (i + 1) % panels.length;
      else if (event.key === "ArrowLeft")
        j = (i + panels.length - 1) % panels.length;
      else if (event.key === "Home") j = 0;
      else if (event.key === "End") j = panels.length - 1;
      else return;
      event.preventDefault();
      buttons[j].focus();
    };
    bar.append(button);
    return button;
  });
  function show(index) {
    active = index;
    const single = !mobile || query.matches;
    bar.hidden = !single;
    panels.forEach((panel, i) => {
      panel.hidden = single && i !== active;
      buttons[i].setAttribute("aria-selected", String(i === active));
      buttons[i].tabIndex = i === active ? 0 : -1;
    });
    parent.classList.toggle("tool-tabs-host", single);
  }
  query.addEventListener("change", () => show(active));
  show(0);
  window.addEventListener("tool-show-tab", (event) => {
    const node = $(event.detail?.selector || "__none__");
    const index = panels.findIndex((p) => p === node || p.contains(node));
    if (index >= 0) show(index);
  });
  return show;
}
function nativeTabs(buttons, panels) {
  if (buttons.length < 2) return;
  buttons[0].parentNode.setAttribute("role", "tablist");
  buttons.forEach((button, i) => {
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", panels[i].id);
    panels[i].setAttribute("role", "tabpanel");
    panels[i].setAttribute("aria-labelledby", button.id);
    const refresh = () =>
      buttons.forEach((b, j) => {
        const active = !panels[j].hidden;
        b.setAttribute("aria-selected", String(active));
        b.tabIndex = active ? 0 : -1;
      });
    button.addEventListener("click", refresh);
    button.addEventListener("keydown", (event) => {
      let j;
      if (event.key === "ArrowRight") j = (i + 1) % buttons.length;
      else if (event.key === "ArrowLeft")
        j = (i + buttons.length - 1) % buttons.length;
      else if (event.key === "Home") j = 0;
      else if (event.key === "End") j = buttons.length - 1;
      else return;
      event.preventDefault();
      buttons[j].focus();
    });
    refresh();
  });
}
function outputActions(ids) {
  const nodes = ids.map((id) => $(id)).filter(Boolean);
  if (nodes.length < 2) return;
  const row = el("div", undefined, "tool-output-actions");
  nodes[0].before(row);
  nodes.forEach((n) => row.append(n));
}
function observeText(node, callback) {
  if (!node) return;
  const observer = new MutationObserver(() => callback(node));
  observer.observe(node, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  window.addEventListener("pagehide", () => observer.disconnect(), {
    once: true,
  });
}
function summary(anchor, id) {
  if (!anchor) return;
  let node = $("#" + id);
  if (!node) {
    node = el("p", undefined, "tool-result-summary");
    node.id = id;
    anchor.before(node);
  }
  return node;
}

export {
  $,
  $$,
  el,
  fold,
  foldRange,
  step,
  tabs,
  nativeTabs,
  outputActions,
  observeText,
  summary,
};
