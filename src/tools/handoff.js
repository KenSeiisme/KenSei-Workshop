import { plannedPackage } from "./archive-package.js";
import { api, status } from "./common.js";
import { el, button, row, setValue } from "./advanced-ui.js";
import { uiError, uiMsg, uiText } from "../site/ui.js";
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
  "zip-studio": {
    label: "ZIP Studio",
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
    mimes: ["text/csv"],
  },
  "video-studio": {
    label: "Video Studio",
    kind: "files",
    count: 2,
    bytes: 255000000,
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
    if (
      target === "video-studio" &&
      (!/\.(mp4|webm)$/i.test(fs[0].name || "") ||
        fs[0].size > 250000000 ||
        (fs[1] &&
          (!/\.(srt|vtt)$/i.test(fs[1].name || "") || fs[1].size > 5000000)))
    )
      throw Error("Send one MP4 or WebM video with an optional SRT or VTT.");
    if (target === "zip-studio") plannedPackage(fs, payload.paths);
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
const lifetime = 300000;
const slow = 15000;
const fallback = () =>
  uiMsg(
    "Transfer unavailable. Download and import the file, or copy the text.",
  );
const expired = () =>
  uiMsg(
    "Transfer expired or the source tab was closed. Send the result again.",
  );
const changedAccount = () =>
  uiMsg("The account or transfer changed. Send the result again.");
const cancelled = () => uiMsg("Transfer cancelled.");
const channelName = (id) => "kensei-handoff-v1:" + id;

function transferPanel() {
  const box = el("div", "", { class: "handoff-progress" });
  const note = el("p", "", { role: "status" });
  box.append(note);
  return { box, show: (message) => uiText(note, message) };
}

// Transfer controls remain available while a receiving tool locks its form.
function transferButton(label, action) {
  const node = button(label, action);
  node.removeAttribute("data-lock");
  return node;
}

function startTransfer(box, target, payload) {
  const owner = identity();
  const id = crypto.randomUUID();
  const expires = Date.now() + lifetime;
  const channel = new BroadcastChannel(channelName(id));
  const { box: panel, show } = transferPanel();
  const link = el("a", "Open receiving tool", {
    href:
      (window.KenseiI18n?.localePath("/tools/" + target + "/") ||
        "/tools/" + target + "/") +
      "#handoff=" +
      id,
    target: "_blank",
    rel: "noopener",
    class: "text-link",
  });
  link.dataset.handoffOpen = "";
  let recipient,
    sent = false,
    done = false,
    hint;
  const post = (action, extra = {}) =>
    channel.postMessage({
      action,
      id,
      target,
      identity: owner,
      to: recipient,
      ...extra,
    });
  const wait = () => {
    show(uiMsg("Waiting for the receiving tool. Keep this tab open."));
    clearTimeout(hint);
    hint = setTimeout(() => {
      if (!done)
        show(
          uiMsg(
            "The receiving tool is taking longer than expected. Open it or retry.",
          ),
        );
    }, slow);
  };
  const retry = transferButton("Retry transfer", () => {
    if (done) return;
    sent = false;
    wait();
    post("probe");
  });
  const cancel = transferButton("Cancel transfer", () => close(cancelled()));
  panel.append(link, retry, cancel);
  box.append(panel);

  function close(message, notify = true) {
    if (done) return;
    done = true;
    if (notify) post("closed");
    clearTimeout(hint);
    clearTimeout(timeout);
    channel.close();
    pending.delete(close);
    payload = null;
    link.hidden = retry.hidden = cancel.hidden = true;
    if (message) show(message);
  }
  const timeout = setTimeout(() => close(expired()), lifetime);
  pending.add(close);
  channel.onmessage = ({ data }) => {
    if (
      data?.id !== id ||
      data.target !== target ||
      data.identity !== owner ||
      (recipient && data.receiver !== recipient)
    )
      return;
    if (identity() !== owner) return close(changedAccount());
    if (Date.now() >= expires) return close(expired());
    if (data.action === "ready" && !sent) {
      recipient = data.receiver;
      sent = true;
      post("payload", { expires, payload });
      show(uiMsg("Sending result to the receiving tool…"));
    } else if (data.action === "received") {
      clearTimeout(hint);
      show(uiMsg("Waiting for import in the receiving tool."));
    } else if (data.action === "importing") {
      show(uiMsg("Importing in the receiving tool…"));
    } else if (data.action === "error") {
      show(
        uiMsg(
          "The receiving tool could not import the result. Retry there or send it again.",
        ),
      );
    } else if (data.action === "accepted") {
      close(uiMsg("Result received. The original stays here."), false);
    } else if (data.action === "cancel") {
      close(cancelled(), false);
    }
  };
  wait();
  link.click();
  return () => {
    close(cancelled());
    panel.remove();
  };
}

export function sendControl(anchor, getPayload, allowed) {
  const box = row();
  const controls = [];
  let disposeTransfer;
  box.classList.add("handoff-controls");
  box.append(el("span", "Send to"));
  for (const target of allowed) {
    if (!targets[target]) continue;
    const b = button(targets[target].label, () => {
      if (!("BroadcastChannel" in window)) {
        status(fallback(), true);
        return;
      }
      const payload = validateHandoff(target, getPayload());
      disposeTransfer?.();
      disposeTransfer = startTransfer(box, target, payload);
    });
    controls.push({ b, target });
    box.append(b);
  }
  anchor.append(box);
  const refresh = () => {
    if (!box.isConnected) return dispose();
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
    disposeTransfer?.();
  }
  window.addEventListener("pagehide", dispose, { once: true });
  refresh();
  return box;
}

export function receiveHandoff(target, accept, hasContent = () => false) {
  const url = new URL(location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const id = fragment.get("handoff");
  if (!id) return;
  const root = document.querySelector("[data-tool]");
  const { box, show } = transferPanel();
  root.prepend(box);
  const forgetLink = () => {
    fragment.delete("handoff");
    url.hash = fragment.toString();
    history.replaceState(
      null,
      "",
      location.pathname + location.search + url.hash,
    );
  };
  if (!/^[0-9a-f-]{36}$/i.test(id) || !("BroadcastChannel" in window)) {
    show(fallback());
    forgetLink();
    return;
  }
  const channel = new BroadcastChannel(channelName(id));
  const receiver = crypto.randomUUID();
  const abort = new AbortController();
  let owner,
    payload,
    expires = Date.now() + lifetime;
  let state = "waiting",
    closed = false;
  let timeout, hint;
  const post = (action) =>
    channel.postMessage({ action, id, target, receiver, identity: owner });
  const busy = () => root.getAttribute("aria-busy") === "true";
  const start = transferButton("Import result", () => apply());
  const retry = transferButton("Retry transfer", () => {
    if (payload) return apply();
    show(uiMsg("Waiting for the result from the source tab…"));
    armHint();
    ready();
  });
  const cancel = transferButton("Cancel transfer", () =>
    close(cancelled(), true),
  );
  box.append(start, retry, cancel);
  start.hidden = true;

  function ready() {
    if (!api.ready || closed) return;
    owner ??= identity();
    if (owner !== identity()) return close(changedAccount(), true);
    if (state === "accepted") post("accepted");
    else if (state === "waiting") post("ready");
  }
  function armHint() {
    clearTimeout(hint);
    hint = setTimeout(() => {
      if (state === "waiting")
        show(
          uiMsg(
            "Still waiting. Retry or send the result again from the source tool.",
          ),
        );
    }, slow);
  }
  function close(message, notify = false) {
    if (closed) return;
    if (notify && state !== "accepted" && owner) post("cancel");
    closed = true;
    clearInterval(ping);
    clearTimeout(timeout);
    clearTimeout(hint);
    abort.abort();
    channel.close();
    pending.delete(close);
    payload = null;
    start.hidden = retry.hidden = cancel.hidden = true;
    forgetLink();
    if (message && state !== "accepted") show(message);
  }
  function current() {
    return (
      !closed &&
      !abort.signal.aborted &&
      identity() === owner &&
      Date.now() < expires
    );
  }
  async function apply() {
    if (state !== "received" && state !== "error") return;
    if (!current()) return close(changedAccount(), true);
    if (busy()) {
      show(
        uiMsg(
          "This tool is busy. Wait for it to finish, then import the result.",
        ),
      );
      return;
    }
    const wasTemporary = window.KenseiTemporaryHandoff;
    state = "importing";
    start.hidden = retry.hidden = true;
    show(uiMsg("Importing the received result…"));
    post("importing");
    window.KenseiTemporaryHandoff = true;
    try {
      const result = await accept(payload, current);
      if (!current()) return;
      if (result === false) throw Error("The result could not be imported.");
      window.dispatchEvent(new Event("handoff-temporary"));
      state = "accepted";
      payload = null;
      cancel.hidden = true;
      forgetLink();
      post("accepted");
      show(uiMsg("Result received. Review the input, then start processing."));
    } catch (error) {
      if (current()) {
        state = "error";
        retry.hidden = false;
        show(uiError(error));
        post("error");
      }
    } finally {
      if (state !== "accepted") window.KenseiTemporaryHandoff = wasTemporary;
    }
  }

  const ping = setInterval(() => {
    if (state === "waiting") ready();
    else if (identity() !== owner) close(changedAccount(), true);
  }, 1000);
  timeout = setTimeout(() => close(expired()), lifetime);
  pending.add(close);
  channel.onmessage = ({ data }) => {
    if (
      closed ||
      data?.id !== id ||
      data.target !== target ||
      data.identity !== owner ||
      (data.to && data.to !== receiver)
    )
      return;
    if (data.action === "closed") return close(expired());
    if (data.action === "probe" || state === "accepted") {
      if (state === "waiting" || state === "accepted") ready();
      else post(state);
      return;
    }
    if (data.action !== "payload" || state !== "waiting") return;
    expires = Math.min(expires, data.expires);
    if (!current()) return close(expired(), true);
    clearTimeout(timeout);
    timeout = setTimeout(
      () => close(expired()),
      Math.max(0, expires - Date.now()),
    );
    clearTimeout(hint);
    try {
      payload = validateHandoff(target, data.payload);
      state = "received";
      post("received");
      if (!busy() && !hasContent()) apply();
      else {
        start.hidden = false;
        retry.hidden = true;
        show(
          busy()
            ? uiMsg(
                "This tool is busy. Wait for it to finish, then import the result.",
              )
            : uiMsg("Importing this result will replace the current input."),
        );
      }
    } catch (error) {
      show(uiError(error));
      post("error");
    }
  };
  show(uiMsg("Waiting for the result from the source tab…"));
  armHint();
  ready();
}

let owner = identity();
window.addEventListener("workspace-ready", () => {
  if (owner !== identity()) {
    owner = identity();
    for (const close of [...pending]) close(changedAccount(), true);
  }
});
window.addEventListener("pagehide", () => {
  for (const close of [...pending]) close(undefined, true);
});
export function textReceiver(
  tool,
  selector,
  hasContent = () => !!document.querySelector(selector)?.value,
) {
  receiveHandoff(
    tool,
    (p) => setValue(document.querySelector(selector), p.text),
    hasContent,
  );
}
