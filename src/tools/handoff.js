import { api, status } from "./common.js";
import {
  el,
  button,
  row,
  replaceAllowed,
  fileInput,
  setValue,
} from "./advanced-ui.js";
import { uiMsg, uiText } from "../site/ui.js";
const pending = new Set(),
  identity = () => api.user?.id || "guest";
const IMAGE = ["image/png", "image/jpeg", "image/webp"];
export const targets = {
  "image-studio": {
    label: "Image Studio",
    kind: "files",
    count: 20,
    bytes: 100 * 1048576,
    perFile: 20 * 1048576,
    mimes: IMAGE,
  },
  "image-to-text": {
    label: "Image to Text",
    kind: "files",
    count: 20,
    bytes: 100 * 1048576,
    perFile: 50 * 1048576,
    mimes: [...IMAGE, "application/pdf"],
  },
  "pdf-toolkit": {
    label: "PDF Toolkit",
    kind: "files",
    count: 200,
    bytes: 50 * 1048576,
    mimes: [...IMAGE, "application/pdf"],
  },
  "file-renamer": {
    label: "File Renamer",
    kind: "files",
    count: 100,
    bytes: 100000000,
  },
  "text-toolkit": { label: "Text Toolkit", kind: "text", chars: 100000 },
  "markdown-studio": {
    label: "Markdown Studio",
    kind: "text",
    chars: 100000,
    bytes: 200000,
  },
  "text-compare": {
    label: "Text Compare",
    kind: "text",
    chars: 100000,
    bytes: 200000,
  },
  flashcards: {
    label: "Flashcards",
    kind: "files",
    count: 1,
    bytes: 1000000,
    mimes: ["text/csv", "application/json"],
  },
  "subtitle-studio": {
    label: "Subtitle Studio",
    kind: "files",
    count: 1,
    bytes: 500000000,
    video: true,
  },
};
export function validateHandoff(target, payload) {
  const rule = targets[target];
  if (!rule || payload?.kind !== rule.kind)
    throw Error("This result is not compatible with the selected tool.");
  if (rule.kind === "text") {
    if (
      typeof payload.text !== "string" ||
      !payload.text.length ||
      payload.text.length > rule.chars ||
      (rule.bytes && new TextEncoder().encode(payload.text).length > rule.bytes)
    )
      throw Error(
        "This text exceeds the receiving tool limit. Select a smaller part or download it.",
      );
  } else {
    const fs = payload.files;
    if (
      !Array.isArray(fs) ||
      !fs.length ||
      fs.length > rule.count ||
      fs.some((f) => !(f instanceof Blob)) ||
      fs.reduce((n, f) => n + f.size, 0) > rule.bytes ||
      fs.some((f) => rule.perFile && f.size > rule.perFile)
    )
      throw Error(
        "These files exceed the receiving tool limits. Choose fewer or smaller files.",
      );
    if (rule.mimes && fs.some((f) => !rule.mimes.includes(f.type)))
      throw Error("This file format is not supported by the receiving tool.");
    if (rule.video && fs.some((f) => !f.type.startsWith("video/")))
      throw Error("Choose a video recording for Subtitle Studio.");
    if (
      target === "pdf-toolkit" &&
      fs.some((f) => f.type === "application/pdf") &&
      fs.some((f) => f.type !== "application/pdf")
    )
      throw Error("Send PDFs and images separately.");
  }
  return payload;
}
export function sendControl(anchor, getPayload, allowed) {
  const box = row(),
    controls = [];
  box.classList.add("handoff-controls");
  const heading = el("span", "Send to");
  box.append(heading);
  for (const target of allowed) {
    if (!targets[target]) continue;
    const b = button(targets[target].label, () => {
      if (!("BroadcastChannel" in window)) {
        status(
          uiMsg(
            "Direct transfer is unavailable. Download and import the result instead.",
          ),
          true,
        );
        return;
      }
      const payload = validateHandoff(target, getPayload()),
        owner = identity(),
        id = crypto.randomUUID(),
        channel = new BroadcastChannel("kensei-handoff-v1:" + id),
        expires = Date.now() + 300000;
      let delivered = false,
        sent = false;
      const close = () => {
        channel.close();
        pending.delete(close);
        clearTimeout(timer);
      };
      const timer = setTimeout(close, 300000);
      pending.add(close);
      channel.onmessage = ({ data }) => {
        if (data?.id !== id || data.target !== target) return;
        if (identity() !== owner || Date.now() > expires) {
          close();
          return;
        }
        if (
          data.action === "ready" &&
          data.identity === owner &&
          !delivered &&
          !sent
        ) {
          sent = true;
          channel.postMessage({
            action: "payload",
            id,
            target,
            identity: owner,
            expires,
            payload,
          });
        }
        if (data.action === "accepted" && data.identity === owner) {
          delivered = true;
          close();
          status(uiMsg("Result received. The original stays here."));
        }
      };
      const url =
        (window.KenseiI18n?.localePath("/tools/" + target + "/") ||
          "/tools/" + target + "/") +
        "#handoff=" +
        id;
      const link = el("a", "Open receiving tool", {
        href: url,
        target: "_blank",
        rel: "noopener",
        class: "text-link",
      });
      link.onclick = () => {};
      box.querySelector("[data-handoff-open]")?.remove();
      link.dataset.handoffOpen = "";
      box.append(link);
      link.click();
      status(
        uiMsg(
          "Keep this tab open until the receiving tool confirms the transfer.",
        ),
      );
    });
    controls.push({ b, target });
    box.append(b);
  }
  anchor.append(box);
  const refresh = () => {
    if (!box.isConnected) {
      dispose();
      return;
    }
    for (const { b, target } of controls) {
      if (b.hasAttribute("data-was-disabled")) continue;
      try {
        validateHandoff(target, getPayload());
        b.disabled = false;
      } catch {
        b.disabled = true;
      }
    }
  };
  const observer = new MutationObserver(refresh);
  observer.observe(document.querySelector("[data-tool]") || anchor, {
    childList: true,
    subtree: true,
  });
  document.addEventListener("input", refresh);
  window.addEventListener("tool-content-changed", refresh);
  function dispose() {
    observer.disconnect();
    document.removeEventListener("input", refresh);
    window.removeEventListener("tool-content-changed", refresh);
  }
  window.addEventListener("pagehide", dispose, { once: true });
  refresh();
  return box;
}
export function receiveHandoff(target, accept, hasContent = () => false) {
  const u = new URL(location.href),
    id = new URLSearchParams(u.hash.slice(1)).get("handoff");
  if (!id) return;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !("BroadcastChannel" in window)) {
    status(
      uiMsg("Transfer unavailable. Import the original file or copy the text."),
      true,
    );
    return;
  }
  const c = new BroadcastChannel("kensei-handoff-v1:" + id);
  let finished = false,
    receiving = false;
  const close = () => {
    finished = true;
    c.close();
    clearInterval(ping);
    clearTimeout(timeout);
  };
  const ping = setInterval(() => {
    if (api.ready)
      c.postMessage({ action: "ready", id, target, identity: identity() });
  }, 400);
  const timeout = setTimeout(() => {
    close();
    status(
      uiMsg(
        "Transfer expired or the source tab was closed. Send the result again.",
      ),
      true,
    );
  }, 20000);
  c.onmessage = async ({ data }) => {
    if (
      finished ||
      receiving ||
      data?.action !== "payload" ||
      data.id !== id ||
      data.target !== target
    )
      return;
    receiving = true;
    try {
      if (data.identity !== identity() || Date.now() > data.expires)
        throw Error("The account or transfer changed. Send the result again.");
      validateHandoff(target, data.payload);
      if (!replaceAllowed(hasContent())) {
        close();
        return;
      }
      window.KenseiTemporaryHandoff = true;
      window.dispatchEvent(new Event("handoff-temporary"));
      await accept(data.payload);
      if (data.identity !== identity())
        throw Error("The account or transfer changed. Send the result again.");
      c.postMessage({ action: "accepted", id, target, identity: identity() });
      history.replaceState(null, "", location.pathname + location.search);
      close();
      status(
        uiMsg("Result received. Review the input, then start processing."),
      );
    } catch (e) {
      receiving = false;
      status(e.message, true);
      close();
    }
  };
  window.addEventListener("pagehide", close, { once: true });
}
let owner = identity();
window.addEventListener("workspace-ready", () => {
  if (owner !== identity()) {
    owner = identity();
    for (const close of [...pending]) close();
  }
});
window.addEventListener("pagehide", () => {
  for (const close of [...pending]) close();
});
export function textReceiver(tool, selector) {
  receiveHandoff(
    tool,
    (p) => setValue(document.querySelector(selector), p.text),
    () => !!document.querySelector(selector)?.value,
  );
}
export async function filesReceiver(tool, selector) {
  receiveHandoff(
    tool,
    (p) => {
      const n = document.querySelector(selector);
      n.files = fileInput(p.files);
      n.dispatchEvent(new Event("change", { bubbles: true }));
    },
    () => !!document.querySelector(selector)?.files.length,
  );
}
