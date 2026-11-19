import { $ } from "./common.js";
import { sendControl } from "./handoff.js";
export function init() {
  const ctx = window.KenseiAdvancedContexts["screen-recorder"];
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
    ["subtitle-studio", "video-studio"],
  );
}
