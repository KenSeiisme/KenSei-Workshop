import { uiMsg, uiText } from "../site/ui.js";
import {
  AUDIO_PROFILES,
  normalizeAudioPreference,
  audioEvents,
  PRIORITY_CUES,
  TERMINAL_CUES,
  createCountdownTracker,
} from "./audio-events.js";
export { audioEvent, audioEvents, resultCue } from "./audio-events.js";
const KEY = "kensei-game-audio-v2",
  LEGACY = "kensei-game-audio-v1",
  BASE = "/assets/game-audio/";
function readPreference(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}
let preference = normalizeAudioPreference(
  readPreference(KEY),
  readPreference(LEGACY),
);
let context,
  masterGain,
  effectsGain,
  musicGain,
  armed = false,
  closed = false;
let state = { game: "", phase: "ready", runId: "" },
  family = "",
  manifest,
  profile,
  loading,
  loadError = "",
  failed = new Set();
let loadGeneration = 0,
  loadAbort;
function invalidateLoad() {
  loadGeneration++;
  loadAbort?.abort();
  loadAbort = null;
  loading = null;
}
let music = null,
  musicOffset = 0,
  musicStartedAt = 0,
  decodedBytes = 0,
  fetchedBytes = 0;
const voices = new Set(),
  buffers = new Map(),
  lastPlayed = new Map(),
  bindings = new WeakSet(),
  once = new Set();
const countdown = createCountdownTracker();
let collisionTimes = [],
  emitted = 0,
  cueCounts = {},
  lastVariants = new Map(),
  focused = true,
  channel;
const tabId =
  globalThis.crypto?.randomUUID?.() || `audio-${Date.now()}-${Math.random()}`;
const sequences = {
  move: [260],
  merge: [392, 523],
  reveal: [330],
  flag: [440, 330],
  flip: [350],
  pair: [523, 659],
  miss: [240, 200],
  input: [392],
  erase: [290],
  conflict: [175],
  line: [440, 554, 659],
  brick: [640],
  paddle: [310],
  serve: [392, 523],
  point: [659, 784],
  pickup: [523, 659, 784],
  multiball: [523, 659, 784],
  wide: [392, 523, 659],
  slow: [440, 392, 330],
  life: [330, 220, 165],
  win: [523, 659, 784, 1047],
  over: [392, 330, 262],
  loss: [294, 220, 147],
  draw: [330, 392, 330],
  milestone: [659, 831, 988],
  rotate: [370],
  harddrop: [190, 310],
  capture: [310, 240],
  pass: [290],
  turn: [440],
  pause: [260, 220],
  reconnect: [330, 440],
  countdown: [520],
  end: [392, 330],
};
function nodes(selector) {
  return document.querySelectorAll(selector);
}
function visible() {
  return !document.hidden && !closed && focused;
}
function gainTo(node, value, duration = 0.025) {
  if (!node || !context) return;
  const p = node.gain,
    at = context.currentTime;
  p.cancelScheduledValues?.(at);
  p.setValueAtTime(p.value || 0, at);
  p.linearRampToValueAtTime(value, at + duration);
}
function paint() {
  for (const node of nodes("[data-audio-toggle]")) {
    uiText(node, preference.enabled ? uiMsg("Sound on") : uiMsg("Sound off"));
    node.setAttribute("aria-pressed", String(preference.enabled));
  }
  for (const [selector, value] of [
    ["[data-audio-volume]", preference.volume],
    ["[data-music-volume]", preference.musicVolume],
  ])
    for (const node of nodes(selector)) {
      if (document.activeElement !== node)
        node.value = String(Math.round(value * 100));
      node.setAttribute("aria-valuetext", `${Math.round(value * 100)}%`);
    }
  for (const node of nodes("[data-music-toggle]"))
    node.checked = preference.musicEnabled;
  for (const node of nodes("[data-audio-countdown]"))
    node.checked = preference.countdown;
  for (const node of nodes("[data-audio-countdown-wrap]"))
    node.hidden = state.game !== "go";
  for (const node of nodes("[data-audio-status]")) {
    node.hidden = !loadError;
    uiText(
      node,
      loadError === "unsupported"
        ? uiMsg(
            "Audio is not available in this browser. You can keep playing silently.",
          )
        : loadError === "blocked"
          ? uiMsg("Tap the sound button or game area to resume audio.")
          : loadError === "music"
            ? uiMsg("Music could not load. Retry audio; you can keep playing.")
            : uiMsg(
                "Some sounds could not load. Basic sounds remain available.",
              ),
    );
  }
  for (const node of nodes("[data-audio-retry]"))
    node.hidden = !loadError || loadError === "unsupported";
}
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(preference));
  } catch {}
  paint();
  applyLevels();
}
function applyLevels() {
  gainTo(masterGain, preference.enabled ? 1 : 0);
  gainTo(effectsGain, preference.volume);
  gainTo(musicGain, preference.musicVolume);
  if (!preference.enabled) {
    stopVoices();
    pauseMusic();
  } else if (!preference.musicEnabled || !preference.musicVolume) pauseMusic();
  else startMusic();
}
function stopVoice(voice) {
  voices.delete(voice);
  try {
    voice.source.stop();
  } catch {}
  try {
    voice.source.disconnect();
    voice.gain.disconnect();
  } catch {}
}
function stopVoices() {
  for (const voice of [...voices]) stopVoice(voice);
  lastPlayed.clear();
  collisionTimes = [];
}
function pauseMusic(reset = false, fade = 0) {
  const old = music;
  if (!old) {
    if (reset) musicOffset = 0;
    return;
  }
  music = null;
  musicOffset = reset
    ? 0
    : Math.max(
        0,
        (musicOffset + context.currentTime - musicStartedAt) % old.length,
      );
  gainTo(old.gain, 0, fade);
  try {
    old.source.stop(context.currentTime + fade + 0.01);
  } catch {}
  if (!fade) {
    try {
      old.source.disconnect();
      old.gain.disconnect();
    } catch {}
  }
}
export function stopAudio() {
  armed = false;
  stopVoices();
  pauseMusic();
  paint();
}
export function pauseAudio() {
  const wasPlaying = state.phase === "playing";
  state.phase = "paused";
  stopVoices();
  pauseMusic(false, 0.1);
  if (wasPlaying) playCue("pause");
}
function claimFocus() {
  focused = true;
  const at = Math.max(
    performance.timeOrigin + performance.now(),
    focusClaim.at + 0.001,
  );
  focusClaim = { at, id: tabId };
  try {
    channel?.postMessage({ type: "claim", ...focusClaim });
  } catch {
    channel = null;
    connectFocusChannel();
  }
}
let focusClaim = { at: 0, id: "" };
function connectFocusChannel() {
  try {
    if (typeof window.BroadcastChannel === "function") {
      channel = new window.BroadcastChannel("kensei-game-audio-focus-v1");
      channel.onmessage = ({ data }) => {
        if (
          data?.type === "claim" &&
          data.id !== tabId &&
          Number.isFinite(data.at) &&
          (data.at > focusClaim.at ||
            (data.at === focusClaim.at && data.id > focusClaim.id))
        ) {
          focusClaim = { at: data.at, id: data.id };
          focused = false;
          stopVoices();
          pauseMusic();
        }
      };
    }
  } catch {}
}
connectFocusChannel();
function buildContext() {
  if (context && context.state !== "closed") return;
  invalidateLoad();
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) throw Error("Audio unavailable");
  try {
    context = new Audio({ latencyHint: "interactive", sampleRate: 48000 });
  } catch {
    context = new Audio();
  }
  masterGain = context.createGain();
  effectsGain = context.createGain();
  musicGain = context.createGain();
  const limiter = context.createWaveShaper?.();
  if (limiter) {
    const curve = new Float32Array(2049);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1,
        a = Math.abs(x);
      curve[i] =
        a <= 0.8 ? x : Math.sign(x) * (0.8 + 0.2 * Math.tanh((a - 0.8) * 5));
    }
    limiter.curve = curve;
    limiter.connect(masterGain);
  }
  effectsGain.connect(limiter || masterGain);
  musicGain.connect(limiter || masterGain);
  masterGain.connect(context.destination);
  masterGain.gain.setValueAtTime(
    preference.enabled ? 1 : 0,
    context.currentTime,
  );
  effectsGain.gain.setValueAtTime(preference.volume, context.currentTime);
  musicGain.gain.setValueAtTime(preference.musicVolume, context.currentTime);
}
export async function unlockAudio({ claim = true } = {}) {
  if (!preference.enabled || document.hidden || closed) return false;
  if (!window.AudioContext && !window.webkitAudioContext) {
    loadError = "unsupported";
    paint();
    return false;
  }
  if (claim) claimFocus();
  if (!focused) return false;
  try {
    buildContext();
    // 用户手势里立即发起 resume，不等待素材请求。
    if (context.state === "suspended" || context.state === "interrupted")
      await context.resume();
    armed = context.state === "running";
    if (armed) {
      if (loadError === "blocked") loadError = "";
      ensureAssets();
      startMusic();
    } else loadError = "blocked";
    paint();
    return armed;
  } catch {
    loadError = "blocked";
    paint();
    return false;
  }
}
function assetUrl(entry) {
  if (
    !entry ||
    !/^[a-zA-Z0-9_.-]+\.(wav|mp3|ogg)$/.test(entry.file) ||
    !Number.isFinite(entry.bytes) ||
    entry.bytes <= 0
  )
    throw Error("Invalid audio asset");
  return `${BASE}${entry.file}?v=${String(entry.sha256).slice(0, 12)}`;
}
async function ensureAssets(retry = false) {
  if (!family || !context || closed) return;
  if (loading) return loading;
  if (profile && !retry) return;
  const ownerFamily = family,
    ownerContext = context,
    generation = ++loadGeneration;
  const controller = new AbortController();
  loadAbort = controller;
  const current = () =>
    generation === loadGeneration &&
    ownerFamily === family &&
    context === ownerContext &&
    !closed;
  loading = (async () => {
    try {
      if (!manifest) {
        const response = await fetch(BASE + "manifest.json", {
          signal: controller.signal,
        });
        if (!response.ok) throw Error("Manifest unavailable");
        const candidate = await response.json();
        if (!current()) return;
        if (candidate.version !== 1) throw Error("Audio version");
        manifest = candidate;
      }
      const data = manifest.profiles[ownerFamily];
      if (!data) throw Error("Audio profile unavailable");
      const entries = new Map(
        [...Object.values(data.cues).flat(), data.music].map((x) => [
          x.file,
          x,
        ]),
      );
      if (
        [...entries.values()].reduce((n, x) => n + x.bytes, 0) +
          JSON.stringify(manifest).length >
        2 * 1024 * 1024
      )
        throw Error("Audio download budget");
      await Promise.all(
        [...entries.values()].map(async (entry) => {
          if (buffers.has(entry.file)) return;
          try {
            if (!current()) return;
            const response = await fetch(assetUrl(entry), {
              signal: controller.signal,
            });
            if (!response.ok) throw Error("Sound unavailable");
            const bytes = await response.arrayBuffer();
            if (!current()) return;
            fetchedBytes += bytes.byteLength;
            if (bytes.byteLength !== entry.bytes)
              throw Error("Sound size mismatch");
            const buffer = await ownerContext.decodeAudioData(bytes);
            const size = buffer.length * buffer.numberOfChannels * 4;
            if (!current()) return;
            if (size + decodedBytes > 32 * 1024 * 1024)
              throw Error("Audio memory budget");
            decodedBytes += size;
            buffers.set(entry.file, buffer);
            failed.delete(entry.file);
          } catch {
            if (current()) failed.add(entry.file);
          }
        }),
      );
      if (!current()) return;
      profile = data;
      loadError = failed.has(data.music.file)
        ? "music"
        : failed.size
          ? "effects"
          : "";
      startMusic();
    } catch {
      if (current()) loadError = "music";
    } finally {
      if (current()) {
        loading = null;
        loadAbort = null;
        paint();
      }
    }
  })();
  return loading;
}
function startMusic() {
  if (
    music ||
    !armed ||
    !visible() ||
    !preference.enabled ||
    !preference.musicEnabled ||
    !preference.musicVolume ||
    state.phase !== "playing" ||
    context?.state !== "running"
  )
    return;
  const descriptor = profile?.music,
    buffer = descriptor && buffers.get(descriptor.file);
  if (!buffer || !context.createBufferSource) return;
  const source = context.createBufferSource(),
    gain = context.createGain();
  source.buffer = buffer;
  source.loop = true;
  source.loopStart = Math.max(0, descriptor.loopStart || 0);
  source.loopEnd = Math.min(
    buffer.duration,
    descriptor.loopEnd || buffer.duration,
  );
  const length = source.loopEnd - source.loopStart;
  if (!(length > 0)) return;
  source.connect(gain);
  gain.connect(musicGain);
  gain.gain.setValueAtTime(0, context.currentTime);
  gain.gain.linearRampToValueAtTime(
    descriptor.gain ?? 1,
    context.currentTime + 0.3,
  );
  musicOffset %= length;
  musicStartedAt = context.currentTime;
  music = { source, gain, length };
  source.onended = () => {
    try {
      source.disconnect();
      gain.disconnect();
    } catch {}
  };
  source.start(0, source.loopStart + musicOffset);
}
function duckMusic() {
  if (!musicGain || !context) return;
  const now = context.currentTime,
    p = musicGain.gain;
  p.cancelScheduledValues?.(now);
  p.setValueAtTime(p.value || preference.musicVolume, now);
  p.linearRampToValueAtTime(preference.musicVolume * 0.4, now + 0.04);
  p.linearRampToValueAtTime(preference.musicVolume, now + 0.55);
}
export function setAudioState(next) {
  const game = next.game || state.game,
    nextFamily = AUDIO_PROFILES[game] || "",
    runId = String(next.runId ?? state.runId);
  if (
    game === state.game &&
    runId === state.runId &&
    next.phase === state.phase
  )
    return;
  if (game !== state.game || runId !== state.runId) {
    pauseMusic(true);
    stopVoices();
    once.clear();
    countdown(null);
  }
  if (nextFamily !== family) {
    invalidateLoad();
    pauseMusic(true);
    family = nextFamily;
    profile = null;
    buffers.clear();
    decodedBytes = 0;
    failed.clear();
  }
  state = { game, runId, phase: next.phase || "ready" };
  if (state.phase !== "playing")
    pauseMusic(false, state.phase === "complete" ? 0.18 : 0.1);
  else {
    if (armed) ensureAssets();
    startMusic();
  }
  paint();
}
function variation(n, kind) {
  if (n < 2) return 0;
  const array = new Uint32Array(1);
  globalThis.crypto?.getRandomValues?.(array);
  let index = array[0] % n;
  if (index === lastVariants.get(kind)) index = (index + 1) % n;
  lastVariants.set(kind, index);
  return index;
}
function reserve(kind) {
  const priority = PRIORITY_CUES.has(kind),
    limit = priority ? 8 : 6;
  if (voices.size >= limit) {
    if (!priority) return false;
    const expendable = [...voices].find((v) => !v.priority);
    if (!expendable) return false;
    stopVoice(expendable);
  }
  return true;
}
function sample(kind, pitch) {
  const list = profile?.cues[kind],
    descriptor = list?.[variation(list.length, kind)],
    buffer = descriptor && buffers.get(descriptor.file);
  if (!buffer || !context.createBufferSource) return false;
  const source = context.createBufferSource(),
    gain = context.createGain();
  source.buffer = buffer;
  source.playbackRate.value = Math.max(0.8, Math.min(1.7, pitch));
  gain.gain.setValueAtTime(descriptor.gain ?? 1, context.currentTime);
  source.connect(gain);
  gain.connect(effectsGain);
  const voice = { source, gain, priority: PRIORITY_CUES.has(kind) };
  voices.add(voice);
  source.onended = () => {
    voices.delete(voice);
    try {
      source.disconnect();
      gain.disconnect();
    } catch {}
  };
  source.start();
  return true;
}
function synthesize(kind, pitch) {
  // 降级合成声仍保留语义，整段旋律只占一个并发名额。
  const notes = sequences[kind];
  if (!notes) return;
  const source = context.createOscillator(),
    gain = context.createGain(),
    at = context.currentTime;
  source.type = ["brick", "flag", "countdown"].includes(kind)
    ? "triangle"
    : "sine";
  gain.gain.setValueAtTime(0, at);
  notes.forEach((note, i) => {
    const start = at + i * 0.065;
    source.frequency.setValueAtTime?.(
      Math.max(80, Math.min(1800, note * pitch)),
      start,
    );
    source.frequency.value = Math.max(80, Math.min(1800, note * pitch));
    gain.gain.linearRampToValueAtTime(0.12, start + 0.007);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.06);
  });
  source.connect(gain);
  gain.connect(effectsGain);
  const voice = { source, gain, priority: PRIORITY_CUES.has(kind) };
  voices.add(voice);
  source.onended = () => {
    voices.delete(voice);
    try {
      gain.disconnect();
      source.disconnect();
    } catch {}
  };
  source.start(at);
  source.stop(at + notes.length * 0.065 + 0.06);
}
export function playCue(kind, pitch = 1, options = {}) {
  if (kind === "tap") kind = "pass";
  if (
    !sequences[kind] ||
    !armed ||
    !visible() ||
    !preference.enabled ||
    !preference.volume ||
    context?.state !== "running"
  )
    return false;
  if (kind === "countdown" && !preference.countdown) return false;
  if (options.id && once.has(options.id)) return false;
  const now = performance.now(),
    interval =
      kind === "countdown" ? 350 : ["input", "erase"].includes(kind) ? 95 : 70;
  if (now - (lastPlayed.get(kind) ?? -Infinity) < interval) return false;
  if (["brick", "paddle"].includes(kind)) {
    collisionTimes = collisionTimes.filter((t) => now - t < 1000);
    if (collisionTimes.length >= 10) return false;
    collisionTimes.push(now);
  }
  if (!reserve(kind)) return false;
  lastPlayed.set(kind, now);
  if (options.id) {
    once.add(options.id);
    if (once.size > 512) once.delete(once.values().next().value);
  }
  if (PRIORITY_CUES.has(kind)) duckMusic();
  if (!sample(kind, pitch)) synthesize(kind, pitch);
  if (TERMINAL_CUES.has(kind)) pauseMusic(false, 0.3);
  emitted++;
  cueCounts[kind] = (cueCounts[kind] || 0) + 1;
  return true;
}
export function observeAudio(before, after, event = {}) {
  const cues = audioEvents(before, after, event);
  for (const kind of cues)
    playCue(
      kind,
      after.game === "2048" && kind === "merge"
        ? Math.min(1.7, 1 + Math.log2(Math.max(...after.board)) / 32)
        : 1,
    );
}
export function observeCountdown(info) {
  const cue = countdown(info);
  if (cue) playCue("countdown", 1, { id: cue.key });
}
export function getAudioDiagnostics() {
  return {
    game: state.game,
    phase: state.phase,
    family,
    armed,
    focused,
    enabled: preference.enabled,
    volume: preference.volume,
    musicEnabled: preference.musicEnabled,
    musicVolume: preference.musicVolume,
    countdown: preference.countdown,
    musicPlaying: !!music,
    musicOffset,
    voices: voices.size,
    decodedBytes,
    fetchedBytes,
    failed: [...failed],
    loadError,
    emitted,
    cueCounts: { ...cueCounts },
  };
}
export function mountAudio(root = document) {
  const gameNode = document.querySelector?.("[data-game]");
  const game =
    gameNode?.dataset.game ||
    (document.querySelector?.("[data-chess]")
      ? "chess"
      : document.querySelector?.("[data-go]")
        ? "go"
        : document.querySelector?.("[data-pong]")
          ? "pong"
          : "");
  if (game && !state.game) setAudioState({ game, phase: "ready" });
  for (const node of root.querySelectorAll(
    "[data-audio-toggle], [data-audio-volume], [data-music-toggle], [data-music-volume], [data-audio-countdown], [data-audio-retry]",
  )) {
    if (bindings.has(node)) continue;
    bindings.add(node);
    if (node.matches("[data-audio-toggle]"))
      node.addEventListener("click", () => {
        if (loadError === "blocked" && preference.enabled) {
          unlockAudio();
          return;
        }
        preference.enabled = !preference.enabled;
        if (preference.enabled) unlockAudio();
        else stopAudio();
        persist();
      });
    else if (node.matches("[data-audio-retry]"))
      node.addEventListener("click", async () => {
        await unlockAudio();
        ensureAssets(true);
      });
    else
      node.addEventListener("input", () => {
        if (node.matches("[data-audio-volume]"))
          preference.volume = Math.max(
            0,
            Math.min(1, Number(node.value) / 100),
          );
        else if (node.matches("[data-music-volume]"))
          preference.musicVolume = Math.max(
            0,
            Math.min(1, Number(node.value) / 100),
          );
        else if (node.matches("[data-music-toggle]"))
          preference.musicEnabled = node.checked;
        else preference.countdown = node.checked;
        persist();
        unlockAudio();
      });
  }
  paint();
}
window.addEventListener("storage", (event) => {
  if (event.key === KEY) {
    try {
      preference = normalizeAudioPreference(JSON.parse(event.newValue));
      applyLevels();
      paint();
    } catch {}
  }
});
for (const type of ["pointerdown", "keydown"])
  document.addEventListener(
    type,
    (event) => {
      if (
        state.phase !== "playing" ||
        !event.isTrusted ||
        event.isComposing ||
        event.target?.closest?.("input,textarea,select,[contenteditable=true]")
      )
        return;
      if (
        event.target?.closest?.(
          "[data-game], [data-go], [data-chess], [data-pong]",
        )
      )
        unlockAudio();
    },
    { capture: true },
  );
document.addEventListener("visibilitychange", () => {
  countdown(null);
  if (document.hidden) {
    stopVoices();
    pauseMusic();
    context?.suspend?.().catch(() => {});
  } else if (armed && focused && state.phase === "playing")
    unlockAudio({ claim: false });
});
window.addEventListener("pagehide", () => {
  closed = true;
  invalidateLoad();
  stopAudio();
  context?.close().catch(() => {});
  context = null;
  channel?.close();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    closed = false;
    armed = false;
    channel = null;
    connectFocusChannel();
    paint();
  }
});
window.addEventListener("locale-change", paint);
