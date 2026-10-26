import { uiMsg, uiText, uiError } from "../site/ui.js";
import { $, image, downloadText } from "./common.js";
import { parseHex, hexColor, contrast } from "./daily-core.js";
import { el, panel, row, field, button, renderTable } from "./advanced-ui.js";
export function init() {
  const p = panel(
      "Image colors and palette export",
      $("#palette").closest("section"),
    ),
    file = el("input", "", {
      type: "file",
      accept: "image/png,image/jpeg,image/webp",
    }),
    canvas = el("canvas", "", {
      width: 400,
      height: 200,
      tabIndex: 0,
      "aria-label": "Click an image pixel to select its color",
    }),
    out = el("div");
  let loaded = false,
    token = 0;
  canvas.style.maxWidth = "100%";
  const colors = () =>
    [...$("#palette").querySelectorAll("input[type=color]")].map(
      (n) => n.value,
    );
  function matrix() {
    const list = colors();
    out.replaceChildren(
      renderTable(
        ["Contrast", ...list],
        list.map((a) => [
          a,
          ...list.map(
            (b) => contrast(parseHex(a), parseHex(b)).toFixed(2) + ":1",
          ),
        ]),
      ),
    );
  }
  file.onchange = async () => {
    const id = ++token,
      f = file.files[0];
    if (!f) return;
    try {
      const img = await image(f);
      if (id !== token) return;
      const scale = Math.min(1, 600 / Math.max(img.width, img.height));
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const x = canvas.getContext("2d", { willReadFrequently: true });
      x.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = x.getImageData(0, 0, canvas.width, canvas.height).data,
        hist = new Map();
      for (let i = 0; i < data.length; i += 16) {
        if (data[i + 3] < 200) continue;
        const rgb = [data[i], data[i + 1], data[i + 2]].map((v) =>
            Math.min(255, Math.round(v / 32) * 32),
          ),
          hex = hexColor(rgb);
        hist.set(hex, (hist.get(hex) || 0) + 1);
      }
      const top = [...hist]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map((x) => x[0]);
      if (!top.length) throw Error("This image has no visible colors.");
      [...$("#palette").querySelectorAll(".palette-card")].forEach(
        (card, i) => {
          if (card.querySelector("[type=checkbox]").checked) return;
          card.querySelector("[type=color]").value = card.querySelector(
            "[readonly]",
          ).value = top[i % top.length];
        },
      );
      loaded = true;
      matrix();
    } catch (e) {
      const n = el("p");
      uiText(n, uiError(e));
      out.replaceChildren(n);
    }
  };
  canvas.onclick = (e) => {
    if (!loaded) return;
    const rect = canvas.getBoundingClientRect(),
      x = Math.min(
        canvas.width - 1,
        Math.max(
          0,
          Math.floor(((e.clientX - rect.left) * canvas.width) / rect.width),
        ),
      ),
      y = Math.min(
        canvas.height - 1,
        Math.max(
          0,
          Math.floor(((e.clientY - rect.top) * canvas.height) / rect.height),
        ),
      );
    const data = canvas.getContext("2d").getImageData(x, y, 1, 1).data;
    $("#color-picker").value = hexColor([...data].slice(0, 3));
    $("#color-picker").dispatchEvent(new Event("input"));
  };
  p.append(
    field("Local image", file),
    canvas,
    row(
      button("Export palette CSS", () =>
        downloadText(
          ":root {\n" +
            colors()
              .map((c, i) => "  --color-" + (i + 1) + ": " + c + ";")
              .join("\n") +
            "\n}",
          "palette.css",
          "text/css",
        ),
      ),
      button("Export palette JSON", () =>
        downloadText(
          JSON.stringify({ colors: colors() }, null, 2),
          "palette.json",
          "application/json",
        ),
      ),
    ),
    out,
  );
  $("#palette").addEventListener("input", matrix);
  $("#palette-generate").addEventListener("click", matrix);
  matrix();
}
