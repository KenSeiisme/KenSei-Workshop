import { $, download, filename } from "./common.js";
import { el, panel, row, button, select } from "./advanced-ui.js";
import { sendControl } from "./handoff.js";
import { uiMsg, uiConfirm, uiRender } from "../site/ui.js";
export async function init() {
  const ctx = window.KenseiAdvancedContexts.whiteboard,
    p = panel("Templates and selection export", $("#board-canvas-shell")),
    kind = select([
      ["flow", "Flowchart"],
      ["mind", "Mind map"],
      ["notes", "Study notes"],
    ]),
    only = el("input", "", { type: "checkbox" });
  let result = null;
  const selection = el("label", "Export selected elements only");
  selection.prepend(only);
  p.append(
    row(
      kind,
      button("Insert template", async () => {
        if (
          !uiConfirm(uiMsg("Insert this template into the current whiteboard?"))
        )
          return;
        await ctx.ready();
        const specs =
          kind.value === "flow"
            ? [
                ["Begin", 0, 0],
                ["Process", 0, 140],
                ["Finish", 0, 280],
              ]
            : kind.value === "mind"
              ? [
                  ["Main idea", 0, 120],
                  ["Topic A", 250, 0],
                  ["Topic B", 250, 240],
                ]
              : [
                  ["Topic", 0, 0],
                  ["Key points", 0, 150],
                  ["Questions", 320, 150],
                ];
        const elements = specs.flatMap(([text, x, y]) => [
          {
            type: "rectangle",
            x,
            y,
            width: 220,
            height: 90,
            strokeColor: "#a855f7",
            backgroundColor: "#f3e8ff",
            fillStyle: "solid",
          },
          {
            type: "text",
            x: x + 18,
            y: y + 25,
            text: uiRender(uiMsg(text)),
            fontSize: 24,
            fontFamily: 2,
          },
        ]);
        for (let i = 1; i < specs.length; i++)
          elements.push({
            type: "arrow",
            x: specs[0][1] + 110,
            y: specs[0][2] + 90,
            points: [
              [0, 0],
              [specs[i][1] - specs[0][1], specs[i][2] - specs[0][2] - 90],
            ],
            endArrowhead: "arrow",
          });
        await ctx.insert(ctx.engine.convertToExcalidrawElements(elements));
      }),
    ),
    selection,
    button("Prepare PNG", async () => {
      await ctx.ready();
      const d = ctx.drawing;
      if (!d) throw Error("Open a whiteboard first.");
      const app = d.getAppState(),
        elements = d
          .getSceneElements()
          .filter((e) => !only.checked || app.selectedElementIds[e.id]);
      if (!elements.length) throw Error("Select at least one drawing element.");
      const bounds = elements.reduce(
        (b, e) => [
          Math.min(b[0], e.x),
          Math.min(b[1], e.y),
          Math.max(b[2], e.x + Math.abs(e.width)),
          Math.max(b[3], e.y + Math.abs(e.height)),
        ],
        [Infinity, Infinity, -Infinity, -Infinity],
      );
      if (
        (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]) > 32000000 ||
        bounds[2] - bounds[0] > 16000 ||
        bounds[3] - bounds[1] > 16000
      )
        throw Error("This selection is too large. Export an editable file.");
      const canvas = await ctx.engine.exportToCanvas({
        elements,
        appState: { ...app, exportBackground: true },
        files: {},
        exportPadding: 20,
      });
      if (canvas.width * canvas.height > 32000000)
        throw Error("This selection is too large. Export an editable file.");
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      if (!blob) throw Error("Canvas export is unavailable.");
      result = new File([blob], "whiteboard.png", { type: "image/png" });
      save.disabled = false;
      window.dispatchEvent(new Event("tool-content-changed"));
    }),
  );
  const save = button("Download PNG", () => {
    if (result) download(result, result.name);
  });
  save.disabled = true;
  p.append(save);
  sendControl(p, () => (result ? { kind: "files", files: [result] } : null), [
    "image-studio",
    "pdf-toolkit",
  ]);
}
