import { feedback, stateFor } from "./tool-state.js";

import { $, $$, el, observeText } from "./tool-layout.js";
import { adapt, example } from "./tool-adapters.js";
import {
  uiSource,
  uiMsg,
  uiFrom,
  uiError,
  uiText,
  uiAttr,
} from "../site/ui.js";

const statusIds = {
  "audio-studio": ["tool-status", "mix-status"],
  "pdf-toolkit": ["tool-status", "pdf-fill-status"],
  "data-studio": ["tool-status", "analyze-status"],
  "image-to-text": ["tool-status", "ocr-review-status"],
  "image-studio": ["image-result", "edit-status"],
  "qr-studio": ["tool-status", "qr-scan-status"],
  "focus-timer": ["timer-summary"],
  "answer-book": ["answer-status"],
  "decision-studio": ["decision-note"],
  "typing-sprint": ["typing-status"],
  "device-check": ["screen-status", "keyboard-status", "mouse-status"],
  "network-test": ["network-status"],
  "color-studio": ["color-status"],
  "unit-converter": ["unit-status"],
  "password-generator": ["password-status"],
  "time-studio": ["time-state", "time-notice"],
  "screen-recorder": ["screen-status"],
};
export async function initToolUI() {
  const root = $("[data-tool]");
  if (!root || root.dataset.uiReady) return;
  const tool = root.dataset.tool;
  const helpTrigger = $("[data-open-help]"),
    helpDialog = $("#tool-help");
  helpTrigger.onclick = () => {
    helpTrigger.focus();
    helpDialog.showModal();
  };
  helpDialog.addEventListener("close", () =>
    helpTrigger.focus({ preventScroll: true }),
  );
  $("[data-close-help]").onclick = () => $("#tool-help").close();
  for (const id of statusIds[tool] || ["tool-status"]) {
    const node = $("#" + id);
    const update = (n) => {
      if (n.closest("[hidden]")) return;
      const message = uiSource(n).trim();
      if (message)
        feedback(
          stateFor(message, n.classList.contains("error-text")),
          uiFrom(message),
        );
    };
    observeText(node, update);
    if (node?.classList.contains("error-text")) update(node);
  }
  $$(
    "#draft-state,#deck-save-state,#planner-save-state,#board-state,#decision-save-state,[data-save-state]",
    root,
  ).forEach((node) => {
    const update = () => {
      const text = uiSource(node);
      node.dataset.saveKind = /failed|unavailable/i.test(text)
        ? "Save failed"
        : /unsaved|new item not added/i.test(text)
          ? "Unsaved changes"
          : /syncing/i.test(text)
            ? "Syncing"
            : /pending/i.test(text)
              ? "Pending sync"
              : /synced|saved and synced/i.test(text)
                ? "Synced"
                : /saved|loaded/i.test(text)
                  ? "Saved locally"
                  : "Unsaved changes";
      uiAttr(node, "data-save-label", uiFrom(node.dataset.saveKind));
      node.dataset.saveRepeat = String(
        text.toLowerCase().startsWith(node.dataset.saveKind.toLowerCase()),
      );
    };
    observeText(node, update);
    update();
  });
  root.addEventListener("keydown", (event) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.target.closest(".excalidraw") ||
      ["typing-sprint", "device-check", "whiteboard"].includes(tool)
    )
      return;
    if (
      !(event.ctrlKey || event.metaKey) ||
      !event.target.matches("textarea,input")
    )
      return;
    if (event.key.toLowerCase() === "s" && $("#save-draft")) {
      event.preventDefault();
      $("#save-draft").click();
    }
    if (
      event.key === "Enter" &&
      ["calculator-studio", "text-compare"].includes(tool)
    ) {
      event.preventDefault();
      $(tool === "text-compare" ? "#compare-run" : "#calc-run")?.click();
    }
  });
  window.addEventListener("tool-toast", (event) =>
    feedback(stateFor(event.detail), event.detail),
  );
  adapt(tool, root);
  example(tool, root);
  let edited = null;
  const fieldError = el("p", undefined, "error-text tool-field-error");
  fieldError.id = "tool-field-error";
  function clearFieldError() {
    fieldError.remove();
    if (edited) {
      edited.removeAttribute("aria-invalid");
      const ids = (edited.getAttribute("aria-describedby") || "")
        .split(" ")
        .filter((id) => id && id !== fieldError.id);
      if (ids.length) edited.setAttribute("aria-describedby", ids.join(" "));
      else edited.removeAttribute("aria-describedby");
    }
  }
  root.addEventListener("input", (event) => {
    if (
      !event.target.matches("input,textarea,select") ||
      event.target.closest(".recovery-panel,.excalidraw")
    )
      return;
    clearFieldError();
    edited = event.target;
  });
  const stateObserver = new MutationObserver(() => {
    const box = $(".tool-feedback");
    if (box.dataset.state !== "error") {
      clearFieldError();
      return;
    }
    if (
      !edited ||
      /permission|connection|unavailable|could not load|timed out/.test(
        uiSource(box.querySelector(".tool-state-message")),
      )
    )
      return;
    uiText(fieldError, box.querySelector(".tool-state-message").textContent);
    (edited.closest("label") || edited).after(fieldError);
    edited.setAttribute("aria-invalid", "true");
    const ids = new Set(
      (edited.getAttribute("aria-describedby") || "")
        .split(" ")
        .filter(Boolean),
    );
    ids.add(fieldError.id);
    edited.setAttribute("aria-describedby", [...ids].join(" "));
  });
  stateObserver.observe($(".tool-feedback"), {
    attributes: true,
    attributeFilter: ["data-state"],
    childList: true,
    subtree: true,
  });
  window.addEventListener("pagehide", () => stateObserver.disconnect(), {
    once: true,
  });
  // Long static format notes live in Help; dynamic statuses and consent notices stay in place.
  if (
    ![
      "network-test",
      "screen-recorder",
      "audio-studio",
      "device-check",
      "typing-sprint",
    ].includes(tool)
  ) {
    const help = $("#tool-help");
    $$("p.muted.small", root)
      .filter(
        (n) =>
          !n.id &&
          !n.hasAttribute("data-save-state") &&
          /\bMB\b|UTF-8|100,000 characters|200 cards/.test(uiSource(n)) &&
          !n.closest("dialog"),
      )
      .forEach((n) => {
        help.append(el("p", uiFrom(uiSource(n))));
        n.classList.add("tool-help-note");
      });
  }
  const staleInputs = {
    "text-compare":
      "#compare-left,#compare-right,#compare-mode,#compare-case,#compare-space",
    "calculator-studio": "#calc-expression,#calc-angle",
    "pdf-toolkit":
      "#pdf-ranges,#pdf-operation,#pdf-image-format,#pdf-scale,#pdf-watermark,#pdf-add-numbers",
    "image-studio": "#image-width,#image-height,#image-format,#image-quality",
    "data-studio": "#data-json,#data-csv",
    "subtitle-studio": "#sub-start,#sub-end,#sub-text",
  };
  if (staleInputs[tool])
    root.addEventListener("input", (event) => {
      if (!event.target.matches(staleInputs[tool])) return;
      feedback(
        "stale",
        tool === "subtitle-studio"
          ? uiMsg(
              "Cue edits are not committed. Save the cue before downloading subtitles.",
            )
          : uiMsg("Inputs changed. Run the tool again to update the result."),
      );
      if (tool === "calculator-studio") $("#calc-copy").disabled = true;
      if (tool === "subtitle-studio") $("#sub-download").disabled = true;
    });
  // Mark every tool only after its specific adapter is installed; recovery loads independently of auth.
  root.dataset.uiReady = "true";
  if (
    [
      "text-toolkit",
      "markdown-studio",
      "text-compare",
      "image-to-text",
      "data-studio",
      "subtitle-studio",
      "calculator-studio",
    ].includes(tool)
  )
    import("./local-recovery.js")
      .then((module) => module.initRecovery(root, tool))
      .catch((error) => {
        const state = $("[data-recovery-state]");
        if (state) {
          uiText(state, uiError(error));
          state.classList.add("recovery-error");
        }
      });
}
