import { $, copy } from "./common.js";
import {
  parseHex,
  hexColor,
  rgbToHsl,
  hslToRgb,
  contrast,
  randomIndex,
} from "./daily-core.js";
function paint(rgb) {
  $("#color-status").classList.remove("error-text");
  const hex = hexColor(rgb),
    hsl = rgbToHsl(rgb);
  $("#color-picker").value = $("#color-hex").value = hex;
  $("#color-rgb").value = rgb.join(", ");
  $("#color-hsl").value = hsl
    .map((v, i) => v.toFixed(2) + (i ? "%" : ""))
    .join(", ");
  $("#color-status").textContent = "";
}
$("#color-picker").oninput = (e) => paint(parseHex(e.target.value));
$("#color-hex").onchange = (e) => {
  try {
    paint(parseHex(e.target.value));
  } catch (x) {
    $("#color-status").textContent = x.message;
  }
};
for (const kind of ["rgb", "hsl"])
  $("#color-" + kind).onchange = (e) => {
    try {
      const source = e.target.value.trim();
      if (!/^[\d.,%\s+-]+$/.test(source))
        throw new Error("Use three numeric components separated by commas.");
      const parts = source
        .replaceAll("%", "")
        .split(",")
        .map((s) => s.trim());
      const v = parts.map(Number),
        max = kind === "rgb" ? [255, 255, 255] : [360, 100, 100];
      if (
        v.length !== 3 ||
        parts.some((s) => s === "") ||
        v.some((x, i) => !Number.isFinite(x) || x < 0 || x > max[i])
      )
        throw new Error(
          kind === "rgb"
            ? "RGB components must be from 0 to 255."
            : "HSL uses 0–360°, 0–100%, 0–100%.",
        );
      paint(
        kind === "rgb" ? v.map(Math.round) : hslToRgb([v[0] % 360, v[1], v[2]]),
      );
    } catch (x) {
      $("#color-status").textContent = x.message;
    }
  };
$("#color-copy").onclick = () => {
  const out = $("#color-copy-output");
  try {
    out.value = hexColor(parseHex($("#color-hex").value));
    out.hidden = false;
    copy(out);
  } catch (e) {
    $("#color-status").textContent = e.message;
    $("#color-status").classList.add("error-text");
  }
};
function checkContrast() {
  const fg = $("#contrast-fg").value,
    bg = $("#contrast-bg").value,
    ratio = contrast(parseHex(fg), parseHex(bg));
  $("#contrast-preview").style.color = fg;
  $("#contrast-preview").style.backgroundColor = bg;
  $("#contrast-result").textContent =
    ratio.toFixed(2) +
    ":1 · Normal AA: " +
    (ratio >= 4.5 ? "Pass" : "Fail") +
    " · Large AA: " +
    (ratio >= 3 ? "Pass" : "Fail");
}
$("#contrast-fg").oninput = $("#contrast-bg").oninput = checkContrast;
const colors = ["#d6afe8", "#ef9bb7", "#9aaae5", "#b8d8ca", "#f3d7ac"];
const palette = $("#palette");
colors.forEach((color, i) => {
  const card = document.createElement("div");
  card.className = "palette-card";
  const input = document.createElement("input");
  input.type = "color";
  input.value = color;
  input.setAttribute("aria-label", "Palette color " + (i + 1));
  const code = document.createElement("input");
  code.readOnly = true;
  code.value = color;
  code.setAttribute("aria-label", "Palette HEX " + (i + 1));
  const label = document.createElement("label");
  label.className = "check-label";
  const lock = document.createElement("input");
  lock.type = "checkbox";
  lock.setAttribute("aria-label", "Lock color " + (i + 1));
  label.append(lock, "Lock");
  const button = document.createElement("button");
  button.className = "text-link";
  button.textContent = "Copy";
  button.onclick = () => copy(code);
  input.oninput = () => {
    code.value = input.value;
  };
  card.append(input, code, label, button);
  palette.append(card);
});
$("#palette-generate").onclick = () =>
  palette.querySelectorAll(".palette-card").forEach((card) => {
    if (card.querySelector('[type="checkbox"]').checked) return;
    const value = hexColor(
      hslToRgb([randomIndex(360), 40 + randomIndex(41), 35 + randomIndex(46)]),
    );
    card.querySelector('[type="color"]').value = value;
    card.querySelector("[readonly]").value = value;
  });
function gradient() {
  const angle = Number($("#gradient-angle").value);
  if (!Number.isFinite(angle) || angle < 0 || angle > 360) {
    $("#gradient-css").value = "Choose an angle from 0 to 360.";
    $("#gradient-copy").disabled = true;
    return;
  }
  const css =
    "linear-gradient(" +
    angle +
    "deg, " +
    $("#gradient-from").value +
    ", " +
    $("#gradient-to").value +
    ")";
  $("#gradient-preview").style.background = css;
  $("#gradient-css").value = "background: " + css + ";";
  $("#gradient-copy").disabled = false;
}
for (const name of ["from", "to", "angle"])
  $("#gradient-" + name).oninput = gradient;
$("#gradient-copy").onclick = () => copy($("#gradient-css"));
paint(parseHex("#d6afe8"));
checkContrast();
gradient();
