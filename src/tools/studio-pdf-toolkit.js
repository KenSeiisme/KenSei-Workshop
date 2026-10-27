import { el, field, row, button as baseButton, select } from "./advanced-ui.js";
import { recipeControls, workspaceTabs } from "./studio-recipes.js";
import { library, download } from "./common.js";
import {
  pdfDocument,
  unicodeFont,
  pdfPoint,
  pdfBox,
  recipePdf,
} from "./pdf-studio-core.js";
import { uiMsg, uiText, uiConfirm } from "../site/ui.js";
export async function init() {
  const root = document.querySelector("[data-tool]"),
    original = el("div", "", { id: "pdf-pages-workspace" }),
    pane = el("section", "", {
      id: "pdf-fill-workspace",
      class: "panel studio-pdf tool-form",
    });
  const nodes = [...root.children].filter(
    (n) =>
      n.matches(
        ".tool-form,.pdf-layout,.advanced-panel,#job-status,.tool-job-status",
      ) || n.querySelector("#pdf-operation,#pdf-pages,#cancel-job"),
  );
  if (!nodes.length) return;
  nodes[0].before(original);
  nodes.forEach((n) => original.append(n));
  root.append(pane);
  workspaceTabs(root, [
    ["Pages & files", original],
    ["Fill & Annotate", pane],
  ]);
  let bytes = null,
    pdf = null,
    doc = null,
    pageIndex = 0,
    viewport = null,
    annotations = [],
    undo = [],
    redo = [],
    selected = null,
    revision = 0,
    renderId = 0,
    values = {};
  const file = el("input", "", {
      type: "file",
      accept: "application/pdf",
      id: "pdf-fill-file",
    }),
    page = select([]),
    canvas = el("canvas", "", { "aria-label": "PDF annotation canvas" }),
    layer = el("div", "", { class: "pdf-annotation-layer" }),
    stage = el("div", "", { class: "pdf-annotation-stage", tabIndex: 0 });
  stage.append(canvas, layer);
  stage.hidden = true;
  const forms = el("div", "", { class: "pdf-form-fields" }),
    list = el("div", "", { class: "annotation-list" }),
    status = el(
      "p",
      "Choose one PDF. Forms and annotation contents stay in this page.",
      { role: "status" },
    );
  const action = (label, fn, primary = false) =>
    baseButton(
      label,
      async () => {
        try {
          await fn();
        } catch (e) {
          uiText(status, uiMsg(e.message));
        }
      },
      primary,
    );
  const kind = select([
      ["text", "Text"],
      ["rectangle", "Rectangle"],
      ["highlight", "Highlight"],
      ["arrow", "Arrow"],
      ["signature", "Handwritten signature"],
    ]),
    text = el("textarea", "", {
      rows: 2,
      maxLength: 5000,
      "aria-label": "Annotation text",
    }),
    fontSize = el("input", "", { type: "number", min: 6, max: 96, value: 16 }),
    color = el("input", "", { type: "color", value: "#a855f7" }),
    lineWidth = el("input", "", {
      type: "number",
      min: 0.5,
      max: 12,
      step: 0.5,
      value: 2,
    }),
    flatten = el("input", "", { type: "checkbox" });
  const signature = el("canvas", "", {
    width: 480,
    height: 130,
    class: "signature-pad",
    tabIndex: 0,
    "aria-label": "Draw a signature",
  });
  let strokes = [],
    drawing = null;
  const sigPoint = (e) => {
    const r = signature.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  signature.onpointerdown = (e) => {
    e.preventDefault();
    signature.setPointerCapture(e.pointerId);
    drawing = [sigPoint(e)];
    strokes.push(drawing);
  };
  signature.onpointermove = (e) => {
    if (!drawing) return;
    drawing.push(sigPoint(e));
    paintSignature();
  };
  signature.onpointerup = signature.onpointercancel = () => (drawing = null);
  function paintSignature() {
    const c = signature.getContext("2d");
    c.clearRect(0, 0, 480, 130);
    c.strokeStyle = "#e9d5ff";
    c.lineWidth = 2;
    c.lineCap = "round";
    for (const stroke of strokes) {
      c.beginPath();
      stroke.forEach(([x, y], i) =>
        c[i ? "lineTo" : "moveTo"](x * 480, y * 130),
      );
      c.stroke();
    }
  }
  function changed() {
    revision++;
    uiText(
      status,
      uiMsg("Changes pending export. Your original PDF is unchanged."),
    );
  }
  function checkpoint() {
    undo.push(structuredClone(annotations));
    if (undo.length > 50) undo.shift();
    redo = [];
  }
  const properties = el("aside", "", { class: "studio-properties" });
  properties.append(
    el("h3", "Annotation properties"),
    field("Type", kind),
    field("Text", text),
    field("Font size", fontSize),
    field("Color", color),
    field("Line width", lineWidth),
    signature,
    row(
      action("Clear signature", () => {
        strokes = [];
        paintSignature();
      }),
      action("Add annotation", () => {
        if (!viewport) throw Error("Choose a PDF first.");
        if (kind.value === "text" && !text.value.trim())
          throw Error("Enter annotation text.");
        if (kind.value === "signature" && !strokes.some((s) => s.length > 1))
          throw Error("Draw a signature first.");
        checkpoint();
        const a = {
          id: crypto.randomUUID(),
          page: pageIndex,
          kind: kind.value,
          x: 0.15,
          y: 0.2,
          w: kind.value === "text" ? 0.5 : 0.3,
          h: kind.value === "text" ? 0.12 : 0.16,
          text: text.value,
          fontSize: +fontSize.value,
          color: color.value,
          lineWidth: +lineWidth.value,
          strokes: structuredClone(strokes),
        };
        annotations.push(a);
        selected = a.id;
        changed();
        paint();
      }),
    ),
    row(
      action("Undo", () => {
        if (!undo.length) return;
        redo.push(structuredClone(annotations));
        annotations = undo.pop();
        selected = null;
        changed();
        paint();
      }),
      action("Redo", () => {
        if (!redo.length) return;
        undo.push(structuredClone(annotations));
        annotations = redo.pop();
        selected = null;
        changed();
        paint();
      }),
      action("Delete selected", () => {
        if (!selected) return;
        checkpoint();
        annotations = annotations.filter((a) => a.id !== selected);
        selected = null;
        changed();
        paint();
      }),
    ),
    el(
      "p",
      "Drag to move; drag the corner to resize. Use arrow keys for the selected annotation; Shift resizes.",
      { class: "small muted" },
    ),
    list,
  );
  kind.onchange = () => {
    text.closest("label").hidden = kind.value !== "text";
    fontSize.closest("label").hidden = kind.value !== "text";
    signature.hidden = kind.value !== "signature";
  };
  kind.onchange();
  const layout = el("div", "", { class: "studio-workspace" });
  layout.append(stage, properties);
  workspaceTabs(
    layout,
    [
      ["Canvas", stage],
      ["Properties", properties],
    ],
    { mobile: true },
  );
  pane.append(
    row(field("Single PDF", file), field("Page", page)),
    status,
    el("h3", "Form fields"),
    forms,
    layout,
    field("Flatten form fields on export", flatten),
    action("Export annotated PDF", exportPDF, true),
  );
  const getSettings = () =>
    recipePdf({
      fontSize: fontSize.value,
      color: color.value,
      lineWidth: lineWidth.value,
      flatten: flatten.checked,
      kind: kind.value,
    });
  recipeControls(
    properties,
    "pdf-toolkit",
    getSettings,
    (s) => {
      fontSize.value = s.fontSize;
      color.value = s.color;
      lineWidth.value = s.lineWidth;
      flatten.checked = s.flatten;
      kind.value = s.kind;
    },
    recipePdf,
  );
  file.onchange = async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      if (f.size > 50 * 1048576)
        throw Error("PDF files must total 50 MB or less.");
      const originalBytes = new Uint8Array(await f.arrayBuffer()),
        lib = await library("pdf-lib.js", "PDFLib"),
        loaded = await lib.PDFDocument.load(originalBytes);
      if (loaded.getPageCount() > 200)
        throw Error("PDFs may contain at most 200 pages.");
      if (loaded.getForm().hasXFA())
        throw Error(
          "XFA forms are not supported. Choose a standard AcroForm PDF.",
        );
      const preview = await pdfDocument(originalBytes);
      await pdf?.destroy();
      bytes = originalBytes;
      doc = loaded;
      pdf = preview;
      annotations = [];
      undo = [];
      redo = [];
      values = {};
      selected = null;
      pageIndex = 0;
      page.replaceChildren(
        ...Array.from({ length: pdf.numPages }, (_, i) =>
          el("option", String(i + 1), { value: i }),
        ),
      );
      renderForms(lib);
      await render();
      uiText(
        status,
        uiMsg("Ready. Fill fields or add annotations, then export."),
      );
    } catch (e) {
      uiText(status, uiMsg(e.message));
    }
  };
  page.onchange = () => {
    pageIndex = +page.value;
    selected = null;
    render();
  };
  function renderForms(lib) {
    forms.replaceChildren();
    for (const f of doc.getForm().getFields()) {
      const name = f.getName();
      let input;
      if (f instanceof lib.PDFTextField) {
        input = el("textarea", "", {
          rows: f.isMultiline() ? 3 : 1,
          value: f.getText() || "",
          maxLength: f.getMaxLength() || 50000,
        });
        values[name] = { kind: "text", value: input.value };
      } else if (f instanceof lib.PDFCheckBox) {
        input = el("input", "", { type: "checkbox", checked: f.isChecked() });
        values[name] = { kind: "check", value: input.checked };
      } else if (
        f instanceof lib.PDFDropdown ||
        f instanceof lib.PDFRadioGroup
      ) {
        input = select(
          [["", "—"], ...f.getOptions().map((s) => [s, s])],
          f instanceof lib.PDFDropdown
            ? f.getSelected()[0] || ""
            : f.getSelected() || "",
        );
        values[name] = { kind: "select", value: input.value };
      } else continue;
      input.setAttribute("aria-label", name);
      input.disabled = f.isReadOnly();
      const label = el("label");
      const title = el("span");
      title.textContent = name;
      label.append(title, input);
      forms.append(label);
      input.oninput = () => {
        values[name].value =
          input.type === "checkbox" ? input.checked : input.value;
        changed();
      };
    }
    if (!forms.children.length)
      forms.append(
        el(
          "p",
          "No editable AcroForm fields in this PDF. Add annotations below.",
        ),
      );
  }
  async function render() {
    if (!pdf) return;
    const token = ++renderId,
      p = await pdf.getPage(pageIndex + 1),
      v = p.getViewport({ scale: 1 });
    const scale = Math.min(1.5, 760 / v.width),
      next = p.getViewport({ scale });
    const temp = document.createElement("canvas");
    temp.width = next.width;
    temp.height = next.height;
    await p.render({ canvasContext: temp.getContext("2d"), viewport: next })
      .promise;
    if (token !== renderId) return;
    viewport = next;
    stage.hidden = false;
    canvas.width = temp.width;
    canvas.height = temp.height;
    canvas.getContext("2d").drawImage(temp, 0, 0);
    stage.style.aspectRatio = next.width + "/" + next.height;
    paint();
  }
  function paint() {
    layer.replaceChildren();
    list.replaceChildren();
    for (const a of annotations.filter((a) => a.page === pageIndex)) {
      const n = el("div", "", {
        class:
          "pdf-annotation " + a.kind + (a.id === selected ? " selected" : ""),
        tabIndex: 0,
        "aria-label": "Annotation",
      });
      n.dataset.id = a.id;
      Object.assign(n.style, {
        left: a.x * 100 + "%",
        top: a.y * 100 + "%",
        width: a.w * 100 + "%",
        height: a.h * 100 + "%",
        color: a.color,
        borderColor: a.color,
        fontSize: a.fontSize * (viewport?.scale || 1) + "px",
      });
      if (a.kind === "text") n.textContent = a.text;
      else if (a.kind === "arrow") n.textContent = "↗";
      else if (a.kind === "signature") {
        const svg = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        svg.setAttribute("viewBox", "0 0 480 130");
        for (const stroke of a.strokes) {
          const path = document.createElementNS(svg.namespaceURI, "polyline");
          path.setAttribute(
            "points",
            stroke.map(([x, y]) => `${x * 480},${y * 130}`).join(" "),
          );
          path.setAttribute("fill", "none");
          path.setAttribute("stroke", a.color);
          path.setAttribute("stroke-width", a.lineWidth);
          svg.append(path);
        }
        n.append(svg);
      }
      const handle = el("span", "↘", { class: "annotation-resize" });
      n.append(handle);
      n.onpointerdown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        selected = a.id;
        layer
          .querySelectorAll(".selected")
          .forEach((x) => x.classList.remove("selected"));
        n.classList.add("selected");
        checkpoint();
        const r = layer.getBoundingClientRect(),
          start = { ...a },
          x = e.clientX,
          y = e.clientY,
          resize = e.target === handle;
        n.setPointerCapture(e.pointerId);
        n.onpointermove = (ev) => {
          const dx = (ev.clientX - x) / r.width,
            dy = (ev.clientY - y) / r.height;
          if (resize) {
            a.w = Math.max(0.02, Math.min(1 - a.x, start.w + dx));
            a.h = Math.max(0.02, Math.min(1 - a.y, start.h + dy));
          } else {
            a.x = Math.max(0, Math.min(1 - a.w, start.x + dx));
            a.y = Math.max(0, Math.min(1 - a.h, start.y + dy));
          }
          Object.assign(n.style, {
            left: a.x * 100 + "%",
            top: a.y * 100 + "%",
            width: a.w * 100 + "%",
            height: a.h * 100 + "%",
          });
        };
        n.onpointerup = n.onpointercancel = () => {
          n.onpointermove = null;
          changed();
        };
      };
      n.onkeydown = (e) => {
        if (
          ![
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "Delete",
          ].includes(e.key) ||
          e.isComposing
        )
          return;
        e.preventDefault();
        selected = a.id;
        checkpoint();
        if (e.key === "Delete")
          annotations = annotations.filter((x) => x !== a);
        else {
          const dx =
              e.key === "ArrowLeft"
                ? -0.005
                : e.key === "ArrowRight"
                  ? 0.005
                  : 0,
            dy =
              e.key === "ArrowUp" ? -0.005 : e.key === "ArrowDown" ? 0.005 : 0;
          if (e.shiftKey) {
            a.w = Math.max(0.02, Math.min(1 - a.x, a.w + dx));
            a.h = Math.max(0.02, Math.min(1 - a.y, a.h + dy));
          } else {
            a.x = Math.max(0, Math.min(1 - a.w, a.x + dx));
            a.y = Math.max(0, Math.min(1 - a.h, a.y + dy));
          }
        }
        changed();
        paint();
        layer.querySelector(`[data-id="${a.id}"]`)?.focus();
      };
      layer.append(n);
      const item = action("Select annotation", () => {
        selected = a.id;
        text.value = a.text;
        paint();
      });
      item.textContent = `${a.kind}: ${a.text.slice(0, 40)}`;
      list.append(item);
    }
  }
  async function exportPDF() {
    if (!bytes) throw Error("Choose a PDF first.");
    const rev = revision,
      lib = await library("pdf-lib.js", "PDFLib"),
      out = await lib.PDFDocument.load(bytes),
      font = await unicodeFont(out);
    for (const [name, data] of Object.entries(values)) {
      const f = out.getForm().getField(name);
      if (data.kind === "text") f.setText(data.value);
      else if (data.kind === "check") data.value ? f.check() : f.uncheck();
      else if (data.value) f.select(data.value);
      else f.clear?.();
    }
    out.getForm().updateFieldAppearances(font);
    if (flatten.checked) out.getForm().flatten();
    for (const a of annotations) {
      const p = out.getPage(a.page),
        v = (await pdf.getPage(a.page + 1)).getViewport({ scale: 1 }),
        b = pdfBox(v, a),
        rgb = lib.rgb(
          ...a.color
            .slice(1)
            .match(/../g)
            .map((s) => parseInt(s, 16) / 255),
        ),
        base = {
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          rotate: lib.degrees(b.angle),
        };
      if (a.kind === "text") {
        const lines = a.text.split("\n");
        lines.forEach((line, i) => {
          const at = pdfPoint(
            v,
            a.x,
            a.y + ((i + 1) * a.fontSize * 1.2) / v.height,
          );
          p.drawText(line, {
            x: at[0],
            y: at[1],
            size: a.fontSize,
            font,
            color: rgb,
            maxWidth: b.width,
            rotate: lib.degrees(v.rotation),
          });
        });
      } else if (a.kind === "rectangle")
        p.drawRectangle({
          ...base,
          borderWidth: a.lineWidth,
          borderColor: rgb,
        });
      else if (a.kind === "highlight")
        p.drawRectangle({ ...base, color: rgb, opacity: 0.25 });
      else if (a.kind === "arrow") {
        const from = pdfPoint(v, a.x, a.y + a.h),
          to = pdfPoint(v, a.x + a.w, a.y);
        p.drawLine({
          start: { x: from[0], y: from[1] },
          end: { x: to[0], y: to[1] },
          color: rgb,
          thickness: a.lineWidth,
        });
        const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
        for (const sign of [-1, 1])
          p.drawLine({
            start: { x: to[0], y: to[1] },
            end: {
              x: to[0] - 10 * Math.cos(angle + sign * 0.5),
              y: to[1] - 10 * Math.sin(angle + sign * 0.5),
            },
            color: rgb,
            thickness: a.lineWidth,
          });
      } else
        for (const stroke of a.strokes)
          for (let i = 1; i < stroke.length; i++) {
            const from = pdfPoint(
                v,
                a.x + stroke[i - 1][0] * a.w,
                a.y + stroke[i - 1][1] * a.h,
              ),
              to = pdfPoint(
                v,
                a.x + stroke[i][0] * a.w,
                a.y + stroke[i][1] * a.h,
              );
            p.drawLine({
              start: { x: from[0], y: from[1] },
              end: { x: to[0], y: to[1] },
              color: rgb,
              thickness: a.lineWidth,
            });
          }
    }
    const result = await out.save();
    if (rev !== revision)
      throw Error("The input changed. Export the updated PDF again.");
    download(new Blob([result], { type: "application/pdf" }), "annotated.pdf");
    uiText(
      status,
      uiMsg(
        "PDF exported. Editable fields are retained unless flattening was selected.",
      ),
    );
  }
  window.addEventListener("pagehide", () => {
    renderId++;
    pdf?.destroy();
  });
}
