import { $ } from "./common.js";
import { el, row, field, select } from "./advanced-ui.js";
import { randomIndex } from "./daily-core.js";
import { uiMsg, uiText, uiError } from "../site/ui.js";
import { passphrase } from "./passphrase-core.js";
export function init() {
  const mode = select([
      ["password", "Random characters"],
      ["words", "Random word passphrase"],
    ]),
    count = select([
      ["6", "6 words"],
      ["7", "7 words"],
      ["8", "8 words"],
    ]),
    base = $("#password-generate").onclick,
    wordCount = field("Word count", count),
    group = row(field("Generator mode", mode), wordCount),
    characterSettings = [
      $("#password-length").closest("label"),
      $(".password-options"),
    ];
  let words = null,
    version = 0;
  $("#password-output").closest(".panel").querySelector("h2").after(group);
  wordCount.hidden = true;
  count.disabled = true;
  function invalidate() {
    version++;
    $("#password-output").value = "";
    $("#password-copy").disabled = true;
    uiText($("#password-status"), uiMsg("Settings changed. Generate again."));
  }
  count.onchange = invalidate;
  mode.onchange = () => {
    invalidate();
    count.disabled = mode.value !== "words";
    wordCount.hidden = mode.value !== "words";
    characterSettings.forEach((node) => {
      node.hidden = mode.value === "words";
    });
  };
  $("#password-generate").onclick = async () => {
    if (mode.value !== "words") return base();
    const token = ++version;
    $("#password-generate").disabled = true;
    try {
      words ||= await fetch("/vendor/passphrases/words.json").then((r) => {
        if (!r.ok)
          throw Error("Word list could not load. Retry when connected.");
        return r.json();
      });
      if (token !== version) return;
      $("#password-output").value = passphrase(words, +count.value);
      $("#password-copy").disabled = false;
      uiText(
        $("#password-status"),
        uiMsg("Ready. This passphrase exists only on this page."),
      );
    } catch (e) {
      uiText($("#password-status"), uiError(e));
    } finally {
      $("#password-generate").disabled = false;
    }
  };
  // Existing character controls must not silently replace a word passphrase.
  document
    .querySelectorAll(
      '#password-length,[id^="password-upper"],[id^="password-lower"],#password-digits,#password-symbols,#password-ambiguous',
    )
    .forEach((n) =>
      n.addEventListener(
        "change",
        (e) => {
          if (mode.value === "words") e.stopImmediatePropagation();
        },
        true,
      ),
    );
  window.addEventListener("pagehide", () => {
    version++;
    $("#password-output").value = "";
  });
}
