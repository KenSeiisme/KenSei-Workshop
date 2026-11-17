(() => {
  "use strict";
  const stack = document.querySelector("[data-site-notices]");
  const ui = window.KenseiI18n;
  if (!stack || !ui) return;

  const kinds = {
    info: [
      "Information",
      "M12 11v6m0-10h.01 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z",
      4000,
      0,
    ],
    success: ["Success", "m4 12 5 5L20 6", 4000, 0],
    warning: ["Warning", "M12 8v5m0 3h.01M12 3 2 21h20L12 3Z", 10000, 1],
    error: [
      "Error",
      "m8 8 8 8m0-8-8 8 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z",
      10000,
      2,
    ],
    reward: [
      "Reward",
      "m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z",
      6000,
      2,
    ],
    social: [
      "Social",
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m18-14v6m-3-3h6 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
      4000,
      1,
    ],
  };
  const aliases = { notice: "info", setting: "success", achievement: "reward" };
  const entries = new Map(),
    shown = new Set();
  const volumeKey = "kensei-notice-volume-v1";
  let volume = 25,
    context,
    lastSound = -Infinity,
    soundDb;
  function readVolume() {
    try {
      const value = localStorage.getItem(volumeKey);
      if (value !== null && Number.isFinite(Number(value)))
        volume = Math.max(0, Math.min(100, Number(value)));
    } catch {}
  }
  readVolume();
  window.addEventListener("storage", (event) => {
    if (event.key === volumeKey || event.key === null) {
      if (event.newValue === null) volume = 25;
      else readVolume();
      window.dispatchEvent(new Event("notice-volume-change"));
    }
  });

  function unlock(event) {
    if (!event.isTrusted || !volume || document.hidden) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (Audio && !context) context = new Audio();
      if (context?.state !== "running") context?.resume().catch(() => {});
    } catch {}
  }
  document.addEventListener("pointerdown", unlock, {
    capture: true,
    passive: true,
  });
  document.addEventListener("keydown", unlock, { capture: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) context?.suspend().catch(() => {});
    else if (volume) context?.resume().catch(() => {});
  });

  function soundClaim(keys, expiry) {
    if (!window.indexedDB) return Promise.resolve(false);
    soundDb ||= new Promise((resolve, reject) => {
      const request = indexedDB.open("kensei-notice-sounds", 1);
      request.onupgradeneeded = () => {
        request.result
          .createObjectStore("claims")
          .createIndex("expiry", "expiry");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => reject(request.error);
    });
    return soundDb
      .then(
        (db) =>
          new Promise((resolve, reject) => {
            const tx = db.transaction("claims", "readwrite");
            const store = tx.objectStore("claims");
            let claimed = false;
            for (const key of keys) {
              const lookup = store.get(key);
              lookup.onsuccess = () => {
                if (lookup.result?.expiry > Date.now()) return;
                store.put({ expiry }, key);
                claimed = true;
              };
            }
            const cursor = store
              .index("expiry")
              .openKeyCursor(IDBKeyRange.upperBound(Date.now()));
            cursor.onsuccess = () => {
              if (!cursor.result) return;
              store.delete(cursor.result.primaryKey);
              cursor.result.continue();
            };
            tx.oncomplete = () => resolve(claimed);
            tx.onabort = tx.onerror = () => reject(tx.error);
          }),
      )
      .catch(() => false);
  }
  const tones = {
    info: [520],
    success: [500, 660],
    warning: [360, 360],
    error: [340, 280],
    reward: [470, 620, 780],
    social: [510, 570],
  };
  async function sound(kind, key, events, account) {
    if (!volume || !context || context.state !== "running" || document.hidden)
      return;
    const now = Date.now();
    const accepted = await soundClaim(
      events.length ? events : ["toast:" + key],
      now + (events.length ? 7 * 86400000 : 1000),
    );
    if (
      !accepted ||
      (account && window.KenseiWorkspace?.user?.id !== account) ||
      !volume ||
      context.state !== "running" ||
      document.hidden ||
      performance.now() - lastSound < 280
    )
      return;
    lastSound = performance.now();
    tones[kind].forEach((frequency, index) => {
      const start = context.currentTime + index * 0.09;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.002, volume * 0.0004),
        start + 0.023,
      );
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(start);
      oscillator.stop(start + 0.13);
    });
  }

  function place() {
    const parent =
      [...document.querySelectorAll("dialog:modal")].at(-1) ||
      document.fullscreenElement ||
      document.body;
    stack.dataset.layer = parent.matches("dialog")
      ? "dialog"
      : parent === document.body
        ? "page"
        : "fullscreen";
    if (stack.parentElement !== parent) parent.append(stack);
  }
  function remove(key, restoreFocus = false) {
    const entry = entries.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.node.remove();
    entries.delete(key);
    if (
      restoreFocus &&
      entry.previous?.isConnected &&
      entry.previous.getClientRects().length &&
      !entry.previous.closest(".toast")
    )
      entry.previous.focus({ preventScroll: true });
  }
  function resume(entry) {
    if (entry.hovered || entry.focused) return;
    clearTimeout(entry.timer);
    entry.started = performance.now();
    entry.timer = setTimeout(() => remove(entry.key), entry.remaining);
  }
  function pause(entry) {
    if (!entry.timer) return;
    clearTimeout(entry.timer);
    entry.timer = null;
    entry.remaining = Math.max(
      0,
      entry.remaining - (performance.now() - entry.started),
    );
  }
  function hover(entry, value) {
    if (entry.hovered === value) return;
    entry.hovered = value;
    if (value) pause(entry);
    else resume(entry);
  }
  let hoverFrame = 0,
    pointer;
  document.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType !== "mouse" || !entries.size) return;
      pointer = { x: event.clientX, y: event.clientY };
      if (hoverFrame) return;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        for (const entry of entries.values()) {
          const rect = entry.node.getBoundingClientRect();
          hover(
            entry,
            !!pointer &&
              pointer.x >= rect.left &&
              pointer.x <= rect.right &&
              pointer.y >= rect.top &&
              pointer.y <= rect.bottom,
          );
        }
      });
    },
    { passive: true },
  );
  document.addEventListener("pointerout", (event) => {
    if (event.relatedTarget) return;
    pointer = null;
    for (const entry of entries.values()) hover(entry, false);
  });
  new MutationObserver(place).observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["open"],
  });
  document.addEventListener("fullscreenchange", place);

  function glyph(path) {
    const ns = "http://www.w3.org/2000/svg";
    const icon = document.createElementNS(ns, "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("class", "toast-icon");
    icon.setAttribute("aria-hidden", "true");
    const shape = document.createElementNS(ns, "path");
    shape.setAttribute("d", path);
    icon.append(shape);
    return icon;
  }
  window.KenseiNoticeSettings = {
    get volume() {
      return volume;
    },
    set(value) {
      if (!Number.isFinite(value)) return;
      volume = Math.max(0, Math.min(100, value));
      try {
        localStorage.setItem(volumeKey, String(volume));
      } catch {}
      window.dispatchEvent(new Event("notice-volume-change"));
    },
  };
  function categoryOf(message) {
    const source = String(message || "");
    if (
      /could not|failed|unable to|unavailable|permission denied|not supported/i.test(
        source,
      )
    )
      return "error";
    if (
      /^(?:please |first )?(?:choose|select|give|add|use|enter)\b|\b(?:too large|limit reached)\b/i.test(
        source,
      )
    )
      return "warning";
    if (
      /\b(?:saved|removed|copied|complete|synced|exported|downloaded)\b/i.test(
        source,
      )
    )
      return "success";
    return "info";
  }
  window.KenseiNotify = (message, options = {}) => {
    const input = options.kind || categoryOf(message);
    const category =
      aliases[input] || (Object.hasOwn(kinds, input) ? input : "info");
    const [label, path, duration, priority] = kinds[category];
    const key = options.key || category + ":" + ui.render(message);
    const events = options.events || [];
    if (events.length && events.every((id) => shown.has(id))) return;
    if (shown.size > 500) shown.clear();
    for (const id of events) shown.add(id);
    const prior = entries.get(key);
    if (prior && prior.message === ui.render(message)) {
      prior.remaining = duration;
      resume(prior);
      return;
    }
    place();
    const previous = document.activeElement;
    const oldFocused = prior?.node.contains(previous);
    remove(key);
    if (entries.size >= 3) {
      const candidate = [...entries.values()]
        .filter((value) => !value.node.contains(document.activeElement))
        .sort((a, b) => a.priority - b.priority)[0];
      if (!candidate || candidate.priority > priority) return;
      remove(candidate.key);
    }
    const node = document.createElement("div");
    node.className = "toast";
    node.dataset.kind = input;
    node.dataset.category = category;
    const copy = document.createElement("div"),
      heading = document.createElement("strong"),
      content = document.createElement("span"),
      close = document.createElement("button");
    copy.className = "toast-copy";
    if (!options.announced)
      copy.setAttribute("role", category === "error" ? "alert" : "status");
    close.className = "toast-close icon-button";
    close.type = "button";
    ui.attr(close, "aria-label", ui.msg("Dismiss notice"));
    close.append(glyph("m6 6 12 12m0-12L6 18"));
    copy.append(heading, content);
    node.append(glyph(path), copy, close);
    stack.append(node);
    ui.text(heading, ui.from(label));
    ui.text(content, message);
    const entry = {
      key,
      node,
      priority,
      previous: oldFocused ? prior.previous : previous,
      account: options.account,
      message: ui.render(message),
      remaining: duration,
    };
    entries.set(key, entry);
    close.onclick = () => remove(key, node.contains(document.activeElement));
    node.onfocusin = () => {
      entry.focused = true;
      pause(entry);
    };
    node.onfocusout = (event) => {
      if (node.contains(event.relatedTarget)) return;
      entry.focused = false;
      resume(entry);
    };
    if (oldFocused) close.focus();
    resume(entry);
    if (!options.quiet) void sound(category, key, events, options.account);
  };
  window.KenseiNotify.clearAccount = () => {
    for (const [key, entry] of entries) if (entry.account) remove(key);
  };
})();
