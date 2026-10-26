import { $ } from "./common.js";
import { el, row, field, select, button } from "./advanced-ui.js";
import { sendControl } from "./handoff.js";
export function init() {
  const ctx = window.KenseiAdvancedContexts["screen-recorder"],
    preset = select([
      ["1080", "1080p · 30fps"],
      ["720", "720p · 30fps"],
    ]);
  window.KenseiRecorderPreset = 1080;
  preset.onchange = () => (window.KenseiRecorderPreset = +preset.value);
  $("#screen-start").before(
    row(
      field("Recording preset", preset),
      button("Cancel countdown", () => ctx.cancelCountdown()),
    ),
  );
  sendControl(
    $("#screen-download").parentElement,
    () =>
      ctx.result
        ? {
            kind: "files",
            files: [
              new File(
                [ctx.result],
                "recording." +
                  (ctx.result.type.includes("mp4") ? "mp4" : "webm"),
                { type: ctx.result.type },
              ),
            ],
          }
        : null,
    ["subtitle-studio"],
  );
}
