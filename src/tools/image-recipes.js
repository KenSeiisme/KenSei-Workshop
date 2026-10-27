import { el, field, row, select, button } from "./advanced-ui.js";
import { recipeControls } from "./studio-recipes.js";
import {
  validateImageRecipe,
  orientedCrop,
  drawWatermark,
} from "./image-recipe-core.js";
import { image, canvasBlob } from "./common.js";
import { uiMsg, uiText } from "../site/ui.js";
export function imageRecipes(context) {
  const parent = document.querySelector(".settings-panel"),
    controls = {};
  const options = el("details", "", { class: "image-pipeline" });
  options.open = true;
  options.append(
    el(
      "summary",
      "Batch recipe · orientation → crop → resize → watermark → encode",
    ),
  );
  const check = (key, text, value = false) => {
    const n = el("input", "", { type: "checkbox", checked: value });
    controls[key] = n;
    options.append(field(text, n));
    return n;
  };
  const input = (key, text, attrs) => {
    const n = el("input", "", attrs);
    controls[key] = n;
    options.append(field(text, n));
    return n;
  };
  check("orientation", "Enable orientation");
  controls.rotation = select([
    ["0", "0°"],
    ["90", "90°"],
    ["180", "180°"],
    ["270", "270°"],
  ]);
  options.append(field("Rotation", controls.rotation));
  check("flipX", "Flip horizontal");
  check("flipY", "Flip vertical");
  check("crop", "Enable centered crop");
  controls.ratio = select([
    ["1", "1:1"],
    ["1.333333333333", "4:3"],
    ["1.777777777778", "16:9"],
    [".5625", "9:16"],
  ]);
  options.append(field("Crop ratio", controls.ratio));
  check("resize", "Enable resize", true);
  check("watermark", "Enable watermark");
  input("text", "Watermark text", { maxLength: 100 });
  input("color", "Watermark color", { type: "color", value: "#ffffff" });
  input("opacity", "Watermark opacity", {
    type: "number",
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.7,
  });
  input("fontSize", "Text size · % of shorter side", {
    type: "number",
    min: 1,
    max: 20,
    value: 5,
  });
  controls.position = select([
    ["bottom-right", "Bottom right"],
    ["center", "Center"],
    ["top-left", "Top left"],
  ]);
  options.append(field("Watermark position", controls.position));
  check("encode", "Enable output encoding", true);
  parent.querySelector("h2").after(options);
  const overrideList = el("select", "", {
      "aria-label": "Image settings scope",
    }),
    enable = el("input", "", { type: "checkbox" }),
    info = el("p", "Global recipe applies unless this image has an override.", {
      class: "muted small",
    });
  const scope = row(
    field("Settings scope", overrideList),
    field("Override this image", enable),
  );
  options.prepend(scope, info);
  const overrides = new Map();
  let selected = -1,
    loading = false;
  const base = {
    width: document.querySelector("#image-width"),
    format: document.querySelector("#image-format"),
    quality: document.querySelector("#image-quality"),
    targetKiB: document.querySelector("#image-target-kib"),
  };
  let global;
  const read = () =>
    validateImageRecipe({
      ...Object.fromEntries(
        Object.entries(controls).map(([k, n]) => [
          k,
          n.type === "checkbox" ? n.checked : n.value,
        ]),
      ),
      width: +base.width.value || 1600,
      format: base.format.value,
      quality: +base.quality.value / 100,
      targetKiB: +base.targetKiB.value || 0,
    });
  function write(s) {
    loading = true;
    for (const [k, n] of Object.entries(controls)) {
      if (n.type === "checkbox") n.checked = s[k];
      else n.value = s[k];
    }
    base.width.value = s.width;
    base.format.value = s.format;
    base.quality.value = s.quality * 100;
    base.targetKiB.value = s.targetKiB || "";
    document.querySelector("#quality-value").value = s.quality * 100 + "%";
    loading = false;
  }
  function flush() {
    if (loading) return;
    if (selected < 0) global = read();
    else if (enable.checked) overrides.set(selected, read());
  }
  options.addEventListener("input", (e) => {
    if (e.target !== enable) {
      flush();
      context.stale();
    }
  });
  Object.values(base).forEach((n) =>
    n.addEventListener("input", () => {
      flush();
      context.stale();
    }),
  );
  enable.onchange = () => {
    if (selected < 0) {
      enable.checked = false;
      return;
    }
    if (enable.checked) overrides.set(selected, read());
    else {
      overrides.delete(selected);
      write(global);
    }
    context.stale();
  };
  function scopes() {
    if (selected < 0) global = read();
    selected = -1;
    overrides.clear();
    overrideList.replaceChildren(
      el("option", "Global recipe", { value: "-1" }),
    );
    context.files.forEach((f, i) => {
      const o = el("option", "", { value: i });
      o.textContent = f.name;
      overrideList.append(o);
    });
    enable.checked = false;
    enable.disabled = true;
  }
  overrideList.onchange = () => {
    flush();
    selected = +overrideList.value;
    enable.disabled = selected < 0;
    enable.checked = overrides.has(selected);
    write(overrides.get(selected) || global);
  };
  global = read();
  scopes();
  context.onFiles(scopes);
  const preview = el("div", "", { class: "compare-images" }),
    previewNote = el("p", "Select an image, then preview the current recipe.", {
      role: "status",
      class: "muted small",
    });
  options.append(
    button("Preview selected image", async () => {
      flush();
      const i = Math.max(0, selected),
        file = context.files[i];
      if (!file) throw Error("Choose images first.");
      const s = overrides.get(i) || global,
        original = await image(file),
        source = orientedCrop(original, s),
        out = document.createElement("canvas");
      out.width = s.resize ? s.width : source.width;
      out.height = Math.round((out.width * source.height) / source.width);
      if (out.width * out.height > 40000000 || out.height > 12000)
        throw Error("Target image is too large. Reduce the width.");
      out.getContext("2d").drawImage(source, 0, 0, out.width, out.height);
      drawWatermark(out, s);
      preview
        .querySelectorAll("img")
        .forEach((n) => URL.revokeObjectURL(n.src));
      preview.replaceChildren(
        el("img", "", {
          src: URL.createObjectURL(file),
          alt: "Original image",
        }),
        el("img", "", {
          src: URL.createObjectURL(await canvasBlob(out)),
          alt: "Recipe preview",
        }),
      );
      uiText(
        previewNote,
        uiMsg("Preview only. Process the batch to encode and download."),
      );
      source.width = source.height = out.width = out.height = 0;
    }),
    previewNote,
    preview,
  );
  const old = document.querySelector("#save-preset");
  old.hidden = true;
  recipeControls(
    parent,
    "image-studio",
    () => {
      flush();
      return global;
    },
    (s) => {
      selected = -1;
      overrideList.value = "-1";
      overrides.clear();
      global = s;
      write(s);
      context.stale();
    },
    validateImageRecipe,
    (s) => ({ width: s.width, format: s.format, quality: s.quality * 100 }),
  );
  return {
    get(i) {
      flush();
      return overrides.get(i) || global;
    },
    prepare: orientedCrop,
    watermark: drawWatermark,
  };
}
