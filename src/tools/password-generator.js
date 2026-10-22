import { $, copy } from "./common.js";
import { password } from "./daily-core.js";
const groups = {
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lower: "abcdefghijklmnopqrstuvwxyz",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?/",
};
function generate() {
  try {
    $("#password-output").value = password(
      Number($("#password-length").value),
      Object.entries(groups)
        .filter(([k]) => $("#password-" + k).checked)
        .map(([, v]) => v),
      $("#password-ambiguous").checked,
    );
    $("#password-status").textContent =
      "Ready. This password exists only on this page.";
    $("#password-copy").disabled = false;
  } catch (e) {
    $("#password-output").value = "";
    $("#password-status").textContent = e.message;
    $("#password-copy").disabled = true;
  }
}
$("#password-generate").onclick = generate;
document
  .querySelectorAll("input:not([readonly])")
  .forEach((n) => n.addEventListener("change", generate));
$("#password-copy").onclick = () => copy($("#password-output"));
window.addEventListener("pagehide", () => {
  $("#password-output").value = "";
});
generate();
