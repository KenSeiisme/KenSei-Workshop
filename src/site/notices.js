(() => {
  "use strict";
  const stack = document.querySelector("[data-site-notices]");
  const ui = window.KenseiI18n;
  if (!stack || !ui) return;

  const kinds = {
    info: ["Information", 4000, 0],
    success: ["Success", 4000, 0],
    warning: ["Warning", 10000, 1],
    error: ["Error", 10000, 2],
    reward: ["Reward", 6000, 2],
    social: ["Social", 4000, 1],
  };
  const aliases = { notice: "info", setting: "success", achievement: "reward" };
  const entries = new Map(),
    shown = new Set();
  const volumeKey = "kensei-notice-volume-v1";
  const lastVolumeKey = "kensei-notice-last-volume-v1";
  let volume = 25,
    lastVolume = 25,
    editingVolume = false,
    context,
    output,
    previewTicket = 0,
    lastSound = -Infinity,
    soundDb;
  const voices = new Set();
  const level = () => 0.3 * (volume / 100) ** 1.3;
  function readVolume() {
    try {
      const value = localStorage.getItem(volumeKey);
      if (value !== null && Number.isFinite(Number(value)))
        volume = Math.max(0, Math.min(100, Number(value)));
      const previous = Number(localStorage.getItem(lastVolumeKey));
      if (previous > 0 && previous <= 100) lastVolume = previous;
      if (volume) lastVolume = volume;
    } catch {}
  }
  readVolume();
  let savedSettings = volume + ":" + lastVolume;
  window.addEventListener("storage", (event) => {
    if (
      event.key === volumeKey ||
      event.key === lastVolumeKey ||
      event.key === null
    ) {
      if (editingVolume) return; // 本次手勢結束時提交本機值，不被其他分頁打斷。
      if (
        (event.key === volumeKey || event.key === null) &&
        event.newValue === null
      ) {
        volume = 25;
        lastVolume = 25;
      } else readVolume();
      savedSettings = volume + ":" + lastVolume;
      updateOutput();
      window.dispatchEvent(new Event("notice-volume-change"));
    }
  });

  function updateOutput() {
    if (!output) return;
    const now = context.currentTime;
    output.gain.cancelScheduledValues(now);
    output.gain.setTargetAtTime(level(), now, 0.012);
  }
  async function resumeAudio() {
    if (document.hidden) return { ok: false, reason: "hidden" };
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return { ok: false, reason: "unsupported" };
    try {
      if (!context) {
        context = new Audio();
        output = context.createGain();
        output.gain.value = level();
        const filter = context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 2400;
        filter.Q.value = 0.5;
        const limiter = context.createDynamicsCompressor();
        limiter.threshold.value = -6;
        limiter.knee.value = 12;
        limiter.ratio.value = 12;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.15;
        output.connect(filter).connect(limiter).connect(context.destination);
      }
      if (context.state !== "running") {
        // 每次新的使用者操作都可再次呼叫 resume，避免沿用遭攔截的等待。
        const resumePromise = context.resume();
        // 被瀏覽器攔截時 resume 可能一直等待，讓設定區能顯示重試。
        let timer;
        await Promise.race([
          resumePromise,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("blocked")), 1800);
          }),
        ]).finally(() => clearTimeout(timer));
      }
      return { ok: context.state === "running", reason: "blocked" };
    } catch {
      return { ok: false, reason: "blocked" };
    }
  }

  function unlock(event) {
    if (!event.isTrusted || !volume || document.hidden) return;
    void resumeAudio();
  }
  document.addEventListener("pointerdown", unlock, {
    capture: true,
    passive: true,
  });
  document.addEventListener("keydown", unlock, { capture: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      previewTicket++;
      for (const voice of voices) voice.stop();
      context?.suspend().catch(() => {});
    } else if (volume) context?.resume().catch(() => {});
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
    info: [440],
    success: [392, 523],
    warning: [294, 277],
    error: [262, 220],
    reward: [392, 494, 587],
    social: [370, 440],
  };
  function playTones(kind, preview = false) {
    // 所有聲音共用平滑音量和限幅；只保留兩組，避免連續提示堆積。
    if (voices.size >= 2) voices.values().next().value.stop();
    const nodes = [];
    let stopped = false;
    const voice = {
      preview,
      stop() {
        if (stopped) return;
        stopped = true;
        for (const [oscillator, envelope] of nodes) {
          const now = context.currentTime;
          envelope.gain.cancelScheduledValues(now);
          envelope.gain.setTargetAtTime(0, now, 0.005);
          try {
            oscillator.stop(now + 0.025);
          } catch {}
        }
        voices.delete(voice);
      },
    };
    voices.add(voice);
    const frequencies = tones[kind] || tones.info;
    frequencies.forEach((frequency, index) => {
      const start = context.currentTime + index * 0.105;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(0.65, start + 0.035);
      envelope.gain.exponentialRampToValueAtTime(0.001, start + 0.21);
      envelope.gain.linearRampToValueAtTime(0, start + 0.235);
      oscillator.connect(envelope).connect(output);
      nodes.push([oscillator, envelope]);
      oscillator.onended = () => {
        oscillator.disconnect();
        envelope.disconnect();
        if (index === frequencies.length - 1) voices.delete(voice);
      };
      oscillator.start(start);
      oscillator.stop(start + 0.24);
    });
  }
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
    playTones(kind);
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

  function glyph(name) {
    const ns = "http://www.w3.org/2000/svg";
    const icon = document.createElementNS(ns, "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("class", "toast-icon");
    icon.setAttribute("aria-hidden", "true");
    const shape = document.createElementNS(ns, "use");
    shape.setAttribute("href", "/assets/ui-icons.svg#" + name);
    icon.append(shape);
    return icon;
  }
  function setVolume(value, save) {
    if (!Number.isFinite(value)) return;
    volume = Math.max(0, Math.min(100, value));
    if (volume) lastVolume = volume;
    updateOutput();
    if (save) {
      editingVolume = false;
      const signature = volume + ":" + lastVolume;
      if (signature !== savedSettings) {
        try {
          localStorage.setItem(volumeKey, String(volume));
          localStorage.setItem(lastVolumeKey, String(lastVolume));
          savedSettings = signature;
        } catch {}
      }
    }
    window.dispatchEvent(new Event("notice-volume-change"));
  }
  window.KenseiNoticeSettings = {
    async preview(kind = "success") {
      const ticket = ++previewTicket;
      for (const voice of voices) if (voice.preview) voice.stop();
      if (!volume) return { ok: false, reason: "muted" };
      const result = await resumeAudio();
      if (ticket !== previewTicket || document.hidden)
        return { ok: false, reason: "cancelled" };
      if (!result.ok) return result;
      playTones(kind, true);
      return { ok: true };
    },
    get volume() {
      return volume;
    },
    get lastVolume() {
      return lastVolume;
    },
    begin() {
      editingVolume = true;
    },
    adjust(value) {
      editingVolume = true;
      setVolume(value, false);
    },
    commit() {
      setVolume(volume, true);
    },
    set(value) {
      setVolume(value, true);
    },
    toggleMute() {
      setVolume(volume ? 0 : lastVolume, true);
    },
  };
  function categoryOf(message) {
    const source = String(message?.source || message || "");
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
    const [label, duration, priority] = kinds[category];
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
    close.append(glyph("close"));
    copy.append(heading, content);
    node.append(
      glyph(
        category === "success"
          ? "tick"
          : category === "reward"
            ? "achievement"
            : category === "social"
              ? "request"
              : category,
      ),
      copy,
      close,
    );
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
