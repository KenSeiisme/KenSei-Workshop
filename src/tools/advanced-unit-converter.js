import { $, status } from "./common.js";
import { units, convert } from "./daily-core.js";
import {
  el,
  panel,
  row,
  button,
  field,
  select,
  copyText,
} from "./advanced-ui.js";
import {
  uiMsg,
  uiText,
  uiError,
  uiFrom,
  uiRender,
  uiOption,
} from "../site/ui.js";
export function init() {
  const p = panel("Multiple conversions", $("#unit-result").closest("section")),
    digits = el("input", "", { type: "number", min: 2, max: 15, value: 12 }),
    checks = el("div", "", { class: "action-row" }),
    results = el("div"),
    favorites = select([["", "Saved combinations"]]),
    key = "kensei-unit-favorites-v1";
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(key)) || [];
    if (!Array.isArray(saved)) saved = [];
    saved = saved
      .filter(
        (s) =>
          units[s.category] &&
          Array.isArray(s.targets) &&
          s.targets.every((i) => Number.isInteger(i) && units[s.category][i]) &&
          units[s.category][s.from] &&
          s.digits >= 2 &&
          s.digits <= 15,
      )
      .slice(0, 20);
  } catch {}
  function choices() {
    checks.replaceChildren();
    units[$("#unit-category").value].forEach((u, i) => {
      const n = el("input", "", { type: "checkbox", value: i, checked: true }),
        l = el("label");
      const text = el("span");
      uiText(text, uiFrom(u.name));
      l.append(n, text);
      checks.append(l);
      n.onchange = render;
    });
    render();
  }
  function render() {
    results.replaceChildren();
    try {
      const n = +digits.value;
      if (!Number.isInteger(n) || n < 2 || n > 15)
        throw Error("Choose 2–15 significant digits.");
      for (const c of checks.querySelectorAll("input:checked")) {
        const i = +c.value,
          value = Number(
            convert(
              $("#unit-value").value,
              $("#unit-category").value,
              +$("#unit-from").value,
              i,
            ).toPrecision(n),
          ).toString(),
          text =
            value +
            " " +
            uiRender(uiFrom(units[$("#unit-category").value][i].name)),
          label = el("span");
        label.textContent = text;
        results.append(
          row(
            label,
            button("Copy", () => copyText(text, p)),
          ),
        );
      }
    } catch (e) {
      uiText(results, uiError(e));
    }
  }
  function draw() {
    favorites.replaceChildren(uiOption(uiMsg("Saved combinations"), ""));
    saved.forEach((s, i) =>
      favorites.add(
        new Option(
          uiRender(uiFrom(s.category)) +
            " · " +
            uiRender(uiFrom(units[s.category][s.from].name)),
          String(i),
        ),
      ),
    );
  }
  favorites.onchange = () => {
    const s = saved[+favorites.value];
    if (!s || favorites.value === "") return;
    $("#unit-category").value = s.category;
    $("#unit-category").dispatchEvent(new Event("change"));
    $("#unit-from").value = String(s.from);
    digits.value = s.digits;
    checks
      .querySelectorAll("input")
      .forEach((n) => (n.checked = s.targets.includes(+n.value)));
    $("#unit-from").dispatchEvent(new Event("change"));
    render();
  };
  p.append(
    row(
      field("Significant digits", digits),
      favorites,
      button("Save combination on this device", () => {
        const combo = {
          category: $("#unit-category").value,
          from: +$("#unit-from").value,
          digits: +digits.value,
          targets: [...checks.querySelectorAll("input:checked")].map(
            (n) => +n.value,
          ),
        };
        if (
          combo.digits < 2 ||
          combo.digits > 15 ||
          !Number.isInteger(combo.digits)
        )
          throw Error("Choose 2–15 significant digits.");
        saved = [
          combo,
          ...saved.filter((s) => JSON.stringify(s) !== JSON.stringify(combo)),
        ].slice(0, 20);
        localStorage.setItem(key, JSON.stringify(saved));
        draw();
      }),
      button("Clear saved combinations", () => {
        localStorage.removeItem(key);
        saved = [];
        draw();
      }),
    ),
    checks,
    results,
  );
  $("#unit-category").addEventListener("change", choices);
  for (const id of ["unit-value", "unit-from", "unit-to", "unit-swap"])
    $("#" + id).addEventListener(
      id === "unit-value" ? "input" : id === "unit-swap" ? "click" : "change",
      render,
    );
  digits.oninput = render;
  window.addEventListener("locale-change", () => {
    draw();
    render();
  });
  draw();
  choices();
}
