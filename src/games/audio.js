import { uiMsg, uiText } from "../site/ui.js";
// 声音属于表现层：只读游戏状态，不修改规则、存档或随机数。
const KEY = "kensei-game-audio-v1";
let preference = { enabled: true, volume: 0.35 },
  context,
  armed = false;
const voices = new Set(),
  lastPlayed = new Map(),
  bindings = new WeakSet();
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || "null");
  if (
    saved &&
    typeof saved.enabled === "boolean" &&
    Number.isFinite(saved.volume)
  )
    preference = {
      enabled: saved.enabled,
      volume: Math.max(0, Math.min(1, saved.volume)),
    };
} catch {}
const sequences = {
  move: [260],
  merge: [392, 523],
  reveal: [330],
  flag: [440, 330],
  flip: [350],
  pair: [523, 659],
  miss: [240, 200],
  input: [392],
  conflict: [175],
  line: [440, 554, 659],
  brick: [640],
  paddle: [310],
  serve: [392, 523],
  point: [659, 784],
  pickup: [523, 659, 784],
  life: [330, 220, 165],
  win: [523, 659, 784, 1047],
  over: [392, 330, 262],
  loss: [294, 220, 147],
  draw: [330, 392, 330],
  milestone: [659, 831, 988],
};
function paint() {
  document.querySelectorAll("[data-audio-toggle]").forEach((b) => {
    uiText(b, preference.enabled ? uiMsg("Sound on") : uiMsg("Sound off"));
    b.setAttribute("aria-pressed", String(preference.enabled));
  });
  document.querySelectorAll("[data-audio-volume]").forEach((input) => {
    if (document.activeElement !== input)
      input.value = String(Math.round(preference.volume * 100));
    input.setAttribute(
      "aria-valuetext",
      `${Math.round(preference.volume * 100)} percent`,
    );
  });
}
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(preference));
  } catch {}
  paint();
}
export function stopAudio() {
  armed = false;
  for (const voice of voices) {
    try {
      voice.oscillator.stop();
    } catch {}
    voice.gain.disconnect();
  }
  voices.clear();
  lastPlayed.clear();
}
export async function unlockAudio() {
  if (!preference.enabled || document.hidden) return false;
  try {
    context ||= new (window.AudioContext || window.webkitAudioContext)();
    if (context.state === "suspended") await context.resume();
    armed = context.state === "running";
    return armed;
  } catch {
    return false;
  }
}
export function playCue(kind, pitch = 1) {
  if (
    !armed ||
    !preference.enabled ||
    !preference.volume ||
    document.hidden ||
    context?.state !== "running"
  )
    return;
  const now = performance.now(),
    interval = ["brick", "paddle"].includes(kind)
      ? 45
      : kind === "input"
        ? 95
        : 70;
  if (now - (lastPlayed.get(kind) ?? -Infinity) < interval) return;
  lastPlayed.set(kind, now);
  const notes = sequences[kind] || sequences.move;
  for (const [i, note] of notes.entries()) {
    if (voices.size >= 8) break;
    const oscillator = context.createOscillator(),
      gain = context.createGain();
    const at = context.currentTime + i * 0.065;
    oscillator.type = ["brick", "flag"].includes(kind) ? "triangle" : "sine";
    oscillator.frequency.value = Math.max(80, Math.min(1800, note * pitch));
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(preference.volume * 0.12, at + 0.007);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.11);
    oscillator.connect(gain);
    gain.connect(context.destination);
    const voice = { oscillator, gain };
    voices.add(voice);
    oscillator.onended = () => {
      voices.delete(voice);
      gain.disconnect();
      oscillator.disconnect();
    };
    oscillator.start(at);
    oscillator.stop(at + 0.12);
  }
}
export function audioEvent(before, after, event = {}) {
  if (!before || !after) return null;
  if (after.game === "sudoku" && event.type === "digit" && event.value) {
    const row = Math.floor(event.index / 9),
      col = event.index % 9;
    if (
      after.board.some(
        (v, i) =>
          i !== event.index &&
          v === event.value &&
          (Math.floor(i / 9) === row ||
            i % 9 === col ||
            (Math.floor(i / 27) === Math.floor(row / 3) &&
              Math.floor((i % 9) / 3) === Math.floor(col / 3))),
      )
    )
      return "conflict";
  }
  if (after.status !== "playing" && before.status === "playing") {
    if (after.status === "draw") return "draw";
    if (["connect-four", "reversi"].includes(after.game))
      return after.difficulty === "local" ||
        after.winner === (after.humanSide || 1)
        ? "win"
        : "loss";
    return after.status === "won"
      ? "win"
      : ["2048", "snake", "block-puzzle", "block-drop"].includes(after.game)
        ? "over"
        : "loss";
  }
  if (after.game === "brick-breaker") {
    if (after.lives < before.lives) return "life";
    if (after.stage > before.stage) return "line";
    if ((after.pickups || 0) > (before.pickups || 0)) return "pickup";
    if (after.score > before.score) return "brick";
    if ((after.paddleHits || 0) > (before.paddleHits || 0)) return "paddle";
    const a = after.balls?.[0] || after.ball,
      b = before.balls?.[0] || before.ball;
    if (a?.launched && !b?.launched) return "serve";
    if (a?.vy < 0 && b?.vy > 0 && a.y > 390 * 1024) return "paddle";
    return null;
  }
  if (after.game === "memory-match")
    return after.matched.length > before.matched.length
      ? "pair"
      : after.holdUntil && !before.holdUntil
        ? "miss"
        : event.type
          ? "flip"
          : null;
  if (after.game === "2048")
    return after.score > before.score ? "merge" : event.type ? "move" : null;
  if (after.game === "minesweeper")
    return event.type === "flag" ? "flag" : event.type ? "reveal" : null;
  if (after.game === "snake")
    return after.score > before.score ? "point" : event.type ? "move" : null;
  if (after.game === "block-drop")
    return after.lines > before.lines
      ? "line"
      : after.lastGain > before.lastGain || after.moves > before.moves
        ? "move"
        : null;
  if (after.game === "block-puzzle")
    return after.cleared > before.cleared ? "line" : event.type ? "move" : null;
  if (["sudoku", "nonogram"].includes(after.game))
    return event.type ? "input" : null;
  return event.type ? "move" : null;
}
export function observeAudio(before, after, event) {
  const kind = audioEvent(before, after, event);
  if (kind)
    playCue(
      kind,
      after.game === "2048" && kind === "merge"
        ? Math.min(1.7, 1 + Math.log2(Math.max(...after.board)) / 32)
        : 1,
    );
}
export function mountAudio(root = document) {
  root
    .querySelectorAll("[data-audio-toggle], [data-audio-volume]")
    .forEach((node) => {
      if (bindings.has(node)) return;
      bindings.add(node);
      if (node.matches("[data-audio-toggle]"))
        node.addEventListener("click", () => {
          preference.enabled = !preference.enabled;
          if (preference.enabled) unlockAudio();
          else stopAudio();
          persist();
        });
      else
        node.addEventListener("input", () => {
          preference.volume = Number(node.value) / 100;
          persist();
          unlockAudio();
        });
    });
  paint();
}
window.addEventListener("storage", (e) => {
  if (e.key !== KEY) return;
  try {
    const value = JSON.parse(e.newValue);
    if (typeof value?.enabled === "boolean" && Number.isFinite(value.volume)) {
      preference = {
        enabled: value.enabled,
        volume: Math.max(0, Math.min(1, value.volume)),
      };
      stopAudio();
      paint();
    }
  } catch {}
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopAudio();
});
window.addEventListener("pagehide", () => {
  stopAudio();
  context?.close().catch(() => {});
  context = null;
});
