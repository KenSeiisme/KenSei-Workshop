import { $ } from "./common.js";
import { el, row, button, panel } from "./advanced-ui.js";
import { textReceiver } from "./handoff.js";
export function init() {
  const mode = $("#compare-mode");
  mode.append(el("option", "Words", { value: "words" }));
  const p = panel("Aligned comparison", $("#compare-output")),
    columns = el("div", "", { class: "compare-columns" }),
    left = el("pre"),
    right = el("pre");
  let differences = [],
    at = -1,
    scrolling = false;
  columns.append(left, right);
  p.append(
    row(
      button("Previous difference", () => jump(-1)),
      button("Next difference", () => jump(1)),
    ),
    columns,
  );
  function jump(step) {
    if (!differences.length) return;
    at = (at + step + differences.length) % differences.length;
    differences[at].scrollIntoView({ block: "nearest", behavior: "auto" });
    differences[at].setAttribute("tabindex", "-1");
    differences[at].focus({ preventScroll: true });
  }
  for (const [a, b] of [
    [left, right],
    [right, left],
  ])
    a.onscroll = () => {
      if (scrolling) return;
      scrolling = true;
      b.scrollTop = a.scrollTop;
      b.scrollLeft = a.scrollLeft;
      requestAnimationFrame(() => (scrolling = false));
    };
  window.addEventListener("compare-ready", ({ detail }) => {
    left.replaceChildren();
    right.replaceChildren();
    differences = [];
    at = -1;
    for (const part of detail) {
      const a = el("span"),
        b = el("span");
      a.textContent = part.added ? "" : part.value;
      b.textContent = part.removed ? "" : part.value;
      if (part.added) {
        b.className = "diff-added";
        differences.push(b);
      }
      if (part.removed) {
        a.className = "diff-removed";
        differences.push(a);
      }
      left.append(a);
      right.append(b);
    }
  });
  for (const s of [
    "#compare-left",
    "#compare-right",
    "#compare-mode",
    "#compare-case",
    "#compare-space",
  ])
    $(s).addEventListener("input", () => {
      left.replaceChildren();
      right.replaceChildren();
      differences = [];
    });
  textReceiver("text-compare", "#compare-left");
}
