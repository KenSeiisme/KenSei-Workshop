import {
  $,
  $$,
  api,
  toast,
  library,
  image,
  canvasBlob,
  status,
  download,
} from "./common.js";
import "./qr-scan.js";
import { uiMsg, uiError, uiPrompt } from "../site/ui.js";

let logo = "",
  qr = null,
  revision = 0;
function invalidateOutput() {
  revision++;
  qr = null;
  $("#qr-png").disabled = $("#qr-svg").disabled = true;
  status(uiMsg("Inputs changed. Generate again to update the preview."));
}
for (const input of document.querySelectorAll(
  "#qr-generate-panel input,#qr-generate-panel textarea,#qr-generate-panel select",
)) {
  input.addEventListener("input", invalidateOutput);
  input.addEventListener("change", invalidateOutput);
}
const type = $("#qr-type");
function fields() {
  $$("[data-qr-section]").forEach(
    (n) => (n.hidden = n.dataset.qrSection !== type.value),
  );
  $("#qr-content-group").hidden = type.value === "wifi";
}
type.onchange = fields;
fields();
const wifiEscape = (s) => s.replace(/([\\;,:\"])/g, "\\$1");
function payload() {
  if (type.value === "wifi") {
    if (!$("#qr-ssid").value) throw new Error("Enter a Wi-Fi network name.");
    const encryption = $("#qr-encryption").value;
    return `WIFI:T:${encryption};S:${wifiEscape($("#qr-ssid").value)};P:${encryption === "nopass" ? "" : wifiEscape($("#qr-password").value)};H:${$("#qr-hidden").checked};;`;
  }
  const text = $("#qr-content").value.trim();
  if (!text) throw new Error("Enter content for your QR code.");
  if (type.value === "url") {
    let url;
    try {
      url = new URL(text);
    } catch {
      throw new Error("Enter a complete https:// or http:// URL.");
    }
    if (!["https:", "http:"].includes(url.protocol))
      throw new Error("Use an https:// or http:// URL.");
  }
  return text;
}
$("#qr-logo").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const img = await image(f),
      c = document.createElement("canvas");
    const scale = Math.min(1, 512 / Math.max(img.width, img.height));
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const blob = await canvasBlob(c);
    logo = await new Promise((r) => {
      const reader = new FileReader();
      reader.onload = () => r(reader.result);
      reader.readAsDataURL(blob);
    });
    status(uiMsg("Logo ready. Generate your code to apply it."));
  } catch (e) {
    status(uiError(e), true);
  }
};
$("#qr-remove-logo").onclick = () => {
  logo = "";
  $("#qr-logo").value = "";
  invalidateOutput();
};
$("#qr-generate").onclick = async (e) => {
  e.target.disabled = true;
  const job = ++revision;
  try {
    const data = payload(),
      width = +$("#qr-size").value;
    const Constructor = await library("qr-code-styling.js", "QRCodeStyling");
    if (job !== revision) return;
    if ($("#qr-dark").value === $("#qr-light").value)
      throw new Error("Choose different foreground and background colors.");
    const next = new Constructor({
      width,
      height: width,
      type: "svg",
      data,
      margin: 16,
      qrOptions: { errorCorrectionLevel: logo ? "H" : "M" },
      dotsOptions: { color: $("#qr-dark").value, type: "square" },
      backgroundOptions: { color: $("#qr-light").value },
      image: logo || undefined,
      imageOptions: { imageSize: 0.25, margin: 4, saveAsBlob: true },
    });
    $("#qr-preview").replaceChildren();
    next.append($("#qr-preview"));
    qr = next;
    window.dispatchEvent(new Event("tool-output-current"));
    $("#qr-png").disabled = $("#qr-svg").disabled = false;
    status(uiMsg("Ready. Scan the code to check it before sharing."));
  } catch (e) {
    status(uiError(e), true);
  } finally {
    e.target.disabled = false;
  }
};
for (const ext of ["png", "svg"])
  $("#qr-" + ext).onclick = async () => {
    try {
      if (qr) download(await qr.getRawData(ext), "kensei-qr." + ext);
    } catch {
      status(
        uiMsg("Could not export the code. Generate again and retry."),
        true,
      );
    }
  };
$("#save-qr-preset").onclick = async () => {
  const name = uiPrompt(
    uiMsg("Name this appearance preset:"),
    uiMsg("My QR style"),
  );
  if (!name?.trim()) return;
  try {
    await api.saveItem("preset", {
      tool: "qr-studio",
      name: name.trim().slice(0, 100),
      dark: $("#qr-dark").value,
      light: $("#qr-light").value,
      size: +$("#qr-size").value,
    });
    toast(
      uiMsg("Appearance saved. Content, passwords and logos are excluded."),
    );
  } catch {
    toast(uiMsg("Preset could not be saved. Try again."));
  }
};
function loadPreset() {
  const id = new URLSearchParams(location.search).get("preset"),
    p = api
      .items("preset")
      .find((x) => x.id === id && x.data.tool === "qr-studio")?.data;
  if (p) {
    invalidateOutput();
    $("#qr-dark").value = p.dark;
    $("#qr-light").value = p.light;
    $("#qr-size").value = p.size;
    status(uiMsg("Appearance preset loaded. Add content to generate a code."));
  }
}
loadPreset();
window.addEventListener("workspace-ready", loadPreset);
