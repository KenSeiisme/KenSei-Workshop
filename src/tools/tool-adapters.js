import { feedback } from "./tool-state.js";
import {
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
} from "./tool-layout.js";
import {
  uiSource,
  uiMsg,
  uiFrom,
  uiText,
  uiAttr,
  uiConfirm,
} from "../site/ui.js";

const examples = {
  "text-toolkit": {
    "text-input":
      "  a little more clarity  \n\nUseful tools, fewer distractions.",
    "draft-name": "Example notes",
  },
  "markdown-studio": {
    "markdown-input":
      "# Study notes\n\n- Read the chapter\n- Try one example\n\n| Topic | Status |\n| --- | --- |\n| Practice | Ready |\n\n```js\nconsole.log('Hello, KenSei');\n```",
    "draft-name": "Example notes",
  },
  "text-compare": {
    "compare-left": "One small step.\nKeep learning.",
    "compare-right": "One useful step.\nKeep learning.\nTry again.",
  },
  "data-studio": {
    "data-json": '[{"name":"KenSei","task":"Review notes","done":false}]',
    "data-csv": "name,task,done\nKenSei,Review notes,false",
  },
  "calculator-studio": { "calc-expression": "sqrt(144) + 200 * 10%" },
};
function example(tool, root) {
  if (!examples[tool]) return;
  const button = el(
    "button",
    uiMsg("Try an example"),
    "button secondary tool-example",
  );
  button.type = "button";
  const first = $("#" + Object.keys(examples[tool])[0]);
  first.closest("section, .editor-pane, .panel")?.prepend(button);
  button.onclick = () => {
    if (
      Object.keys(examples[tool]).some((id) => $("#" + id)?.value.trim()) &&
      !uiConfirm(
        uiMsg(
          "Replace the current text with an example? Saved Workspace records are unchanged.",
        ),
      )
    )
      return;
    for (const [id, value] of Object.entries(examples[tool])) {
      const node = $("#" + id);
      if (!node) continue;
      node.value = value;
      node.dispatchEvent(new Event("input", { bubbles: true }));
    }
    first.focus();
    feedback(
      "ready",
      uiMsg("Example loaded. Edit it or run the tool when you are ready."),
    );
  };
}
function fileRows(tool) {
  const input = $(tool === "image-studio" ? "#image-file" : "#check-files");
  if (!input) return;
  const list = el("ul", undefined, "file-state-list");
  uiAttr(list, "aria-label", uiMsg("Selected files and processing state"));
  input.closest("section").append(list);
  input.addEventListener("change", () => {
    list.replaceChildren();
    for (const file of [...input.files]) {
      const row = el("li"),
        name = el("span", file.name),
        state = el("span", uiMsg("Waiting"), "file-state");
      row.append(name, state);
      list.append(row);
    }
  });
  if (tool === "image-studio") {
    window.addEventListener("tool-file-state", (event) => {
      if (event.detail?.tool !== tool) return;
      const { index, state } = event.detail;
      if (index === -1)
        [...list.children].forEach((row) => {
          if (
            state === "Waiting" ||
            !["Complete", "Failed"].includes(uiSource(row.lastChild))
          )
            uiText(row.lastChild, state);
        });
      else if (list.children[index])
        uiText(list.children[index].lastChild, state);
    });
    return;
  }
  const status = $("#tool-status");
  observeText(status, (node) => {
    const text = uiSource(node),
      match = text.match(/(?:file|image)\s+(\d+)/i),
      index = match ? Number(match[1]) - 1 : -1;
    $$("li", list).forEach((row, i) => {
      uiText(
        row.lastChild,
        /complete|done/i.test(text)
          ? uiMsg("Complete")
          : /cancel/i.test(text)
            ? uiMsg("Cancelled")
            : i < index
              ? uiMsg("Complete")
              : i === index
                ? /failed|could not/i.test(text)
                  ? uiMsg("Failed")
                  : uiMsg("Processing")
                : uiMsg("Waiting"),
      );
    });
  });
}
function adapt(tool, root) {
  switch (tool) {
    case "image-studio": {
      nativeTabs(
        [$("#image-mode-batch"), $("#image-mode-edit")],
        [$("#image-batch-mode"), $("#image-edit-mode")],
      );
      foldRange(
        $("#edit-watermark")?.closest("label"),
        $("#edit-font-size")?.closest("label"),
        "Watermark settings",
      );
      step($(".image-input"), "1 · Select images");
      step($(".settings-panel"), "2 · Output settings");
      const result = summary($("#batch-results"), "image-batch-summary");
      observeText($("#batch-results"), () => {
        if (result.dataset.measured) return;
        const rows = $$("#batch-results > *"),
          good = rows.filter((n) => n.querySelector("a[download]")),
          errors = rows.length - good.length;
        uiText(
          result,
          rows.length
            ? uiMsg(
                "{0} image(s) ready · {1} failed. Individual results below retain their dimensions and sizes.",
                [good.length, errors],
              )
            : uiMsg("Your batch results will appear here."),
        );
      });
      fileRows(tool);
      break;
    }
    case "qr-studio": {
      const buttons = [$("#qr-generate-tab"), $("#qr-scan-tab")];
      if (buttons.every(Boolean))
        nativeTabs(buttons, [$("#qr-generate-panel"), $("#qr-scan-panel")]);
      outputActions(["#qr-png", "#qr-svg"]);
      $("#qr-scan-status")?.classList.add("recording-status");
      break;
    }
    case "pdf-toolkit": {
      step($("#pdf-files")?.closest("section"), "1 · Sources & operation");
      step($("#pdf-pages")?.closest("section"), "2 · Select pages");
      step($("#pdf-preview")?.closest("section"), "3 · Output preview");
      const label = summary($(".pdf-layout"), "pdf-source-summary");
      const update = () => {
        const files = $("#pdf-files").files;
        uiText(
          label,
          uiMsg(
            "{0} source file(s) · {1} page preview(s). Selection and rotation are reflected in the next output.",
            [files.length, $$("#pdf-pages > *").length],
          ),
        );
      };
      $("#pdf-files").addEventListener("change", update);
      observeText($("#pdf-pages"), update);
      update();
      break;
    }
    case "image-to-text":
      outputActions(["#ocr-copy", "#ocr-download"]);
      step($("#ocr-file")?.closest("section"), "1 · Image & languages");
      step($("#ocr-output")?.closest("section"), "2 · Review recognized text");
      break;
    case "zip-studio":
      tabs($$(".studio-grid > section", root), ["Pack files", "Inspect ZIP"], {
        mobile: true,
        name: "ZIP mode",
      });
      break;
    case "file-renamer": {
      foldRange(
        $("#rename-prefix")?.closest(".form-row"),
        $("#rename-order")?.closest("label"),
        "Rename rules",
      );
      const node = summary($("#rename-preview"), "rename-summary");
      observeText($("#rename-preview"), () => {
        const rows = $$("#rename-preview .rename-row, #rename-preview tr");
        uiText(
          node,
          uiMsg(
            "{0} selected files · {1} row(s) need attention. Resolve every conflict before export.",
            [
              $("#rename-files").files.length,
              rows.filter((n) =>
                /conflict|invalid|reserved|duplicate/i.test(uiSource(n)),
              ).length,
            ],
          ),
        );
      });
      break;
    }
    case "file-check":
      fileRows(tool);
      root.classList.add("tool-checksums");
      break;
    case "text-toolkit": {
      const toolbar = $(".editor-toolbar > div");
      toolbar?.setAttribute("role", "group");
      uiAttr(toolbar, "aria-label", uiMsg("Text transformations and undo"));
      $("#text-clear")?.classList.add("tool-danger");
      break;
    }
    case "markdown-studio":
      tabs($$(".editor-split > .editor-pane", root), ["Edit", "Preview"], {
        mobile: true,
        name: "Markdown view",
      });
      outputActions(["#markdown-md", "#markdown-html"]);
      $(".draft-controls")?.before($("#markdown-md").parentNode);
      break;
    case "text-compare": {
      const legend = el("div", undefined, "diff-legend");
      legend.append(
        el("span", uiMsg("+ Added"), "diff-added"),
        el("span", uiMsg("− Removed"), "diff-removed"),
      );
      $("#compare-output")?.before(legend);
      const result = summary($("#compare-output"), "compare-summary");
      observeText($("#tool-status"), (n) => {
        uiText(result, uiFrom(uiSource(n)));
      });
      break;
    }
    case "data-studio":
      tabs($$(".studio-grid > section", root), ["JSON", "CSV"], {
        mobile: true,
        name: "Data format",
      });
      $("#data-page")
        ?.closest(".section-heading")
        ?.classList.add("tool-save-status");
      break;
    case "calculator-studio":
      fold($("#calc-history")?.closest("section"), "Calculation history");
      $("#calc-result")?.classList.add("checksum");
      break;
    case "subtitle-studio": {
      const video = $("#sub-video-file")?.closest("section");
      if (video) {
        const download = $("#sub-download"),
          format = $("#sub-format")?.closest("label");
        const row = el("div", undefined, "tool-output-actions");
        video.after(row);
        row.append(format, download);
        fold(video, "Preview with a local video");
      }
      $("#sub-page")?.parentNode.classList.add("tool-save-status");
      break;
    }
    case "focus-timer":
      $(".timer-settings")?.classList.add("tool-fold");
      $("#timer-reset")?.classList.add("tool-danger");
      observeText($("#timer-start"), (node) =>
        feedback(
          uiSource(node) === "Pause" ? "working" : "ready",
          uiSource(node) === "Pause"
            ? uiMsg("Timer running. Pause here whenever you need a break.")
            : uiMsg(
                "Timer ready. Choose your phase and start when you are ready.",
              ),
        ),
      );
      break;
    case "flashcards": {
      const panels = [
        $(".flash-layout > section:first-child"),
        $(".flash-layout > section:nth-child(2)"),
        $("#study-start")?.closest("section"),
      ];
      if (panels.every(Boolean)) {
        const original = $(".flash-layout"),
          host = el("div", undefined, "flash-layout tool-flash-workspace");
        original.before(host);
        panels.forEach((p) => host.append(p));
        original.remove();
        const show = tabs(panels, ["Decks", "Edit cards", "Review"], {
          mobile: true,
          name: "Flashcard workspace",
        });
        root.addEventListener("click", (e) => {
          if (
            e.target.closest(
              "#deck-new,#deck-list [data-deck],#deck-list button",
            )
          )
            show(1);
          if (e.target.closest("#study-start")) show(2);
        });
      }
      break;
    }
    case "study-planner": {
      $("#planner-save-state")?.classList.add("tool-save-status");
      for (const [field, newId, title] of [
        ["#planner-course-title", "#planner-course-new", "Course editor"],
        ["#planner-task-title", "#planner-task-new", "Task editor"],
      ]) {
        const section = $(field)?.closest(".planner-editor");
        if (!section) continue;
        // Keep lists visible; only fold the actual edit fields below their list.
        const start = $(field).closest("label"),
          last = section.lastElementChild,
          details = foldRange(start, last, title);
        if (details) {
          root.addEventListener("click", (e) => {
            if (
              e.target.closest(newId) ||
              e.target.closest(
                field.includes("course")
                  ? "#planner-courses button"
                  : "#planner-tasks button",
              )
            )
              details.open = true;
          });
        }
      }
      break;
    }
    case "whiteboard": {
      const controls = $(".whiteboard-controls");
      const first = $("#board-select")?.closest(".action-row");
      if (first) fold(first, "Choose a whiteboard", true);
      outputActions([
        "#board-json",
        "#board-png",
        "#board-svg",
        "#board-fullscreen",
      ]);
      controls?.classList.add("tool-board-toolbar");
      break;
    }
    case "time-studio": {
      const world = $("#world-clocks")?.closest("section"),
        convert = $("#time-date")?.closest("section"),
        dates = $("#date-start")?.closest("section"),
        history = $("#countdowns")?.closest("section");
      if (world && convert && dates && history) {
        const countdown = el("section", undefined, "panel tool-form"),
          start = $$("h2", dates)[1];
        if (start) {
          let n = start;
          while (n) {
            const next = n.nextSibling;
            countdown.append(n);
            n = next;
          }
        }
        countdown.append(history);
        const host = el("div");
        world.before(host);
        [world, convert, dates, countdown].forEach((p) => host.append(p));
        $$(".studio-grid", root)
          .filter((n) => !n.children.length)
          .forEach((n) => n.remove());
        tabs(
          [world, convert, dates, countdown],
          ["World clocks", "Convert", "Date difference", "Countdowns"],
          { mobile: true, name: "Time mode" },
        );
      }
      break;
    }
    case "answer-book":
      fold($("#answer-history"), "Answer history");
      $(".answer-book")?.classList.add("tool-answer-stage");
      break;
    case "decision-studio": {
      const node = summary(
        $("#decision-options")?.closest("label"),
        "decision-option-summary",
      );
      const update = () => {
        const options = $("#decision-options")
          .value.split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        uiText(
          node,
          uiMsg("{0} unique options · {1}. Each option has equal chance.", [
            new Set(options).size,
            $("#decision-mode").selectedOptions[0].textContent,
          ]),
        );
      };
      $("#decision-options")?.addEventListener("input", update);
      $("#decision-mode")?.addEventListener("change", update);
      update();
      $("#decision-save-state")?.classList.add("tool-save-status");
      break;
    }
    case "color-studio": {
      for (const id of ["#color-copy", "#palette-generate", "#gradient-copy"]) {
        $(id)?.closest("section")?.classList.add("tool-color-section");
      }
      const paletteState = summary($("#palette"), "palette-lock-state");
      const updateLocks = () => {
        const locks = $$("#palette input[type=checkbox]");
        locks.forEach((n) => {
          n.closest(".palette-card").dataset.locked = String(n.checked);
          uiText(
            n.parentNode.lastChild,
            n.checked ? uiMsg("Locked") : uiMsg("Lock"),
          );
        });
        uiText(
          paletteState,
          uiMsg(
            "{0} of {1} colors locked. Generate keeps every locked color.",
            [locks.filter((n) => n.checked).length, locks.length],
          ),
        );
      };
      $$("#palette input[type=checkbox]").forEach((n) =>
        n.addEventListener("change", updateLocks),
      );
      updateLocks();
      break;
    }
    case "unit-converter":
      $(".conversion-grid")?.before(
        el("span", uiMsg("1 · Value & units"), "tool-step"),
      );
      step($("#unit-result")?.closest("label"), "2 · Converted result");
      $("#unit-result")?.classList.add("large-result");
      $("#unit-output")?.classList.add("large-result");
      break;
    case "password-generator": {
      const input = $("#password-output"),
        button = el("button", uiMsg("Show password"), "button secondary");
      input.type = "password";
      input.classList.add("checksum");
      input.after(button);
      button.id = "password-visibility";
      button.type = "button";
      button.setAttribute("aria-pressed", "false");
      button.onclick = () => {
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        uiText(button, show ? uiMsg("Hide password") : uiMsg("Show password"));
        button.setAttribute("aria-pressed", String(show));
      };
      break;
    }
    case "audio-studio": {
      const first = $("#audio-record-start")?.closest("section"),
        file = $("#audio-file")?.closest("label");
      if (file) step(file, "Import an existing clip");
      $("#audio-record-status")?.classList.add("recording-status");
      step($("#audio-wave")?.closest(".panel"), "Edit & export your selection");
      break;
    }
    case "screen-recorder":
      $("#screen-status")?.classList.add("recording-status");
      outputActions(["#screen-download", "#screen-discard"]);
      break;
    case "network-test": {
      const history = $("#network-history")?.closest("section");
      fold(history, "Completed tests & comparison");
      $("#network-status")?.classList.add("recording-status");
      break;
    }
    case "device-check": {
      for (const name of ["keyboard", "mouse", "screen"]) {
        const state = $("#" + name + "-status");
        observeText(state, (n) => {
          $("#device-" + name)?.classList.toggle(
            "tool-stage-active",
            !/not listening|stopped|start|fullscreen may/i.test(uiSource(n)),
          );
        });
      }
      break;
    }
    case "typing-sprint": {
      observeText($("#typing-status"), () =>
        root.classList.toggle(
          "tool-session-active",
          !$("#typing-input").disabled,
        ),
      );
      break;
    }
  }
}

export { adapt, example };
