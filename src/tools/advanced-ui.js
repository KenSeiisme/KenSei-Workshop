import { uiMsg, uiText, uiError, uiConfirm, uiAttr } from "../site/ui.js";
import { status } from "./common.js";
export function el(tag, text = "", attrs = {}) {
  const n = document.createElement(tag);
  if (["input", "textarea", "select", "button"].includes(tag))
    n.dataset.lock = "";
  if (text) uiText(n, uiMsg(text));
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (["placeholder", "title", "aria-label"].includes(k))
      uiAttr(n, k, uiMsg(v));
    else if (k === "list" || k === "form") n.setAttribute(k, v);
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  }
  return n;
}
export function button(text, fn, primary = false) {
  const b = el("button", text, {
    type: "button",
    class: "button " + (primary ? "primary" : "secondary"),
  });
  b.onclick = async () => {
    try {
      await fn(b);
    } catch (e) {
      status(uiError(e), true);
    }
  };
  return b;
}
export function field(text, input) {
  const label = el("label");
  // 翻譯只更新文字節點，保留同一個輸入控件與目前值。
  label.append(el("span", text), input);
  return label;
}
export function select(items, value) {
  const n = el("select");
  for (const [v, t] of items) n.append(el("option", t, { value: v }));
  if (value !== undefined) n.value = value;
  return n;
}
export function panel(title, anchor) {
  const p = el("section", "", {
    class: "panel tool-form advanced-panel daily-history",
  });
  p.append(el("h2", title));
  anchor?.insertAdjacentElement("afterend", p);
  return p;
}
export function row(...nodes) {
  const n = el("div", "", { class: "action-row" });
  n.append(...nodes);
  return n;
}
export function fileInput(files) {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  return dt.files;
}
export function setValue(input, value) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  window.dispatchEvent(new Event("tool-content-changed"));
}
export function replaceAllowed(hasContent) {
  return (
    !hasContent ||
    uiConfirm(uiMsg("Replace the current content with the received result?"))
  );
}
export function csvCell(v) {
  let s = String(v ?? "");
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function csvText(rows) {
  return "\ufeff" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
export function renderTable(headers, rows) {
  const wrap = el("div", "", { class: "table-scroll" }),
    t = el("table", "", { class: "data-table" }),
    head = el("tr");
  headers.forEach((h) => head.append(el("th", h)));
  const th = el("thead");
  th.append(head);
  const body = el("tbody");
  for (const values of rows) {
    const tr = el("tr");
    for (const v of values) {
      const td = el("td");
      td.textContent = String(v ?? "");
      tr.append(td);
    }
    body.append(tr);
  }
  t.append(th, body);
  wrap.append(t);
  return wrap;
}

export async function copyText(text, anchor = document.body) {
  try {
    await navigator.clipboard.writeText(String(text));
    status(uiMsg("Copied to clipboard."));
  } catch {
    const box = el("textarea", "", {
      value: String(text),
      readOnly: true,
      rows: 2,
    });
    anchor.append(box);
    box.focus();
    box.select();
    status(uiMsg("Clipboard unavailable. Copy the text shown below."));
  }
}
