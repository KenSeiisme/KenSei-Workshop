import { uiAttr, uiMsg } from "../site/ui.js";

export function videoIcon(button, icon, label) {
  const ns = "http://www.w3.org/2000/svg";
  const glyph = document.createElementNS(ns, "svg");
  const use = document.createElementNS(ns, "use");
  for (const [key, value] of Object.entries({
    class: "ui-icon",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.6",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }))
    glyph.setAttribute(key, value);
  use.setAttribute("href", "/assets/ui-icons.svg#" + icon);
  glyph.append(use);
  button.replaceChildren(glyph);
  button.classList.add("video-icon-button");
  uiAttr(button, "aria-label", uiMsg(label));
  uiAttr(button, "title", uiMsg(label));
  return button;
}
