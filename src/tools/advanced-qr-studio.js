import { $, library, status, download } from "./common.js";

import { el, panel, row, button, field, select } from "./advanced-ui.js";
import { vcard, qrByteText } from "./qr-extra-core.js";
export function init() {
  const ctx = window.KenseiAdvancedContexts["qr-studio"],
    p = panel("Contact, email and batch codes", $("#qr-generate-panel")),
    kind = select([
      ["contact", "Contact card"],
      ["email", "Email"],
    ]),
    name = el("input", "", { maxLength: 200 }),
    phone = el("input", "", { maxLength: 100 }),
    email = el("input", "", { type: "email", maxLength: 254 }),
    subject = el("input", "", { maxLength: 500 }),
    body = el("textarea", "", { rows: 3, maxLength: 2000 }),
    batch = el("textarea", "", {
      rows: 5,
      placeholder: "One text or URL per line; up to 50",
    }),
    format = select([
      ["png", "PNG"],
      ["svg", "SVG"],
    ]),
    previews = el("div", "", { class: "qr-batch-previews" });
  // 生成擴充屬於 Generate，切換 Scan 時一起隱藏，不重建預覽或輸入。
  $("#qr-generate-panel").append(p);
  let outputs = [],
    epoch = 0;
  $("#qr-generate-panel").append(p);
  const reset = () => {
    epoch++;
    outputs = [];
    pack.disabled = true;
    previews.replaceChildren();
  };
  [batch, format, $("#qr-dark"), $("#qr-light")].forEach(
    (n) => (n.oninput = reset),
  );
  const pack = button("Download QR ZIP", async () => {
    if (!outputs.length) return;
    const token = epoch;
    const { zip } = await library("fflate.js", "fflate");
    const result = await new Promise((resolve, reject) =>
      zip(
        Object.fromEntries(
          outputs.map((data, i) => [
            "qr-" + String(i + 1).padStart(2, "0") + "." + format.value,
            data,
          ]),
        ),
        { level: 6 },
        (e, b) => (e ? reject(e) : resolve(b)),
      ),
    );
    if (token !== epoch) return;
    download(new Blob([result], { type: "application/zip" }), "qr-codes.zip");
  });
  pack.disabled = true;
  p.append(
    row(
      field("Additional content type", kind),
      field("Contact name", name),
      field("Phone", phone),
      field("Email address", email),
    ),
    field("Email subject", subject),
    field("Email body", body),
    button("Use content in generator", () => {
      if (kind.value === "contact" && !name.value.trim())
        throw Error("Enter a contact name.");
      if (
        (kind.value === "email" && !email.value) ||
        (email.value && !email.checkValidity())
      )
        throw Error("Enter a valid email address.");
      const text =
        kind.value === "contact"
          ? vcard(name.value, phone.value, email.value)
          : "mailto:" +
            encodeURIComponent(email.value) +
            "?subject=" +
            encodeURIComponent(subject.value) +
            "&body=" +
            encodeURIComponent(body.value);
      $("#qr-type").value = "text";
      $("#qr-type").dispatchEvent(new Event("change"));
      $("#qr-content").value = text;
      $("#qr-content").dispatchEvent(new Event("input"));
    }),
    field("Batch text / URL QR codes", batch),
    row(
      field("Batch format", format),
      button(
        "Generate batch preview",
        async () => {
          const list = batch.value
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
          if (
            !list.length ||
            list.length > 50 ||
            list.some((s) => s.length > 2000)
          )
            throw Error("Use 1–50 entries, up to 2,000 characters each.");
          reset();
          const token = epoch,
            Constructor = await library("qr-code-styling.js", "QRCodeStyling"),
            currentFormat = format.value;
          for (let i = 0; i < list.length; i++) {
            if (token !== epoch) return;
            if ($("#qr-dark").value === $("#qr-light").value)
              throw Error("Choose different foreground and background colors.");
            const code = new Constructor({
                width: 256,
                height: 256,
                data: qrByteText(list[i]),
                type: "svg",
                margin: 16,
                qrOptions: { errorCorrectionLevel: "M" },
                dotsOptions: { color: $("#qr-dark").value, type: "square" },
                backgroundOptions: { color: $("#qr-light").value },
              }),
              card = el("div"),
              label = el("p");
            label.textContent = i + 1 + ". " + list[i];
            code.append(card);
            const blob = await code.getRawData(currentFormat);
            if (token !== epoch) return;
            outputs.push(new Uint8Array(await blob.arrayBuffer()));
            card.append(label);
            previews.append(card);
            await new Promise((r) => setTimeout(r, 0));
          }
          pack.disabled = false;
        },
        true,
      ),
      button("Cancel batch", reset),
      pack,
    ),
    previews,
  );
}
