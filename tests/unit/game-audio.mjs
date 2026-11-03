import assert from "node:assert/strict";
const hooks = new Map();
let created = 0;
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = {
  hidden: false,
  querySelectorAll: () => [],
  addEventListener: (name, fn) => hooks.set("document:" + name, fn),
};
class Audio {
  constructor() {
    created++;
    this.state = "running";
    this.currentTime = 0;
    this.destination = {};
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  close() {
    this.state = "closed";
    return Promise.resolve();
  }
  createOscillator() {
    return {
      frequency: { value: 0 },
      connect() {},
      disconnect() {},
      start() {},
      stop() {},
    };
  }
  createGain() {
    return {
      gain: {
        setValueAtTime() {},
        linearRampToValueAtTime() {},
        exponentialRampToValueAtTime() {},
      },
      connect() {},
      disconnect() {},
    };
  }
}
globalThis.window = {
  AudioContext: Audio,
  addEventListener: (name, fn) => hooks.set(name, fn),
};
const { audioEvent, playCue, unlockAudio, stopAudio, getAudioDiagnostics } =
  await import("../../src/games/audio.js");
assert.equal(created, 0);
playCue("win");
assert.equal(created, 0);
assert(await unlockAudio());
assert.equal(created, 1);
for (const kind of [
  "brick",
  "paddle",
  "point",
  "win",
  "loss",
  "move",
  "pair",
  "pickup",
])
  for (let i = 0; i < 20; i++) playCue(kind);
assert.ok(getAudioDiagnostics().voices <= 8);
assert.equal(playCue("not-a-defined-cue"), false);
stopAudio();
document.hidden = true;
assert.equal(await unlockAudio(), false);
document.hidden = false;
const before = { status: "playing", game: "2048", score: 0, board: [2] },
  after = { ...before, score: 4, board: [4] };
assert.equal(audioEvent(before, after, { type: "move" }), "merge");
assert.equal(audioEvent(before, { ...after, status: "lost" }), "over");
assert.equal(
  audioEvent({ status: "playing" }, { game: "minesweeper", status: "lost" }),
  "loss",
);
assert.equal(
  audioEvent({ status: "playing" }, { game: "memory-match", status: "won" }),
  "win",
);
assert.equal(
  audioEvent(
    { status: "playing" },
    {
      game: "reversi",
      status: "won",
      difficulty: "ai-easy",
      humanSide: 2,
      winner: 2,
    },
  ),
  "win",
);
assert.equal(
  audioEvent(
    { status: "playing" },
    {
      game: "reversi",
      status: "won",
      difficulty: "ai-easy",
      humanSide: 2,
      winner: 1,
    },
  ),
  "loss",
);
assert.equal(
  audioEvent({ status: "playing" }, { game: "connect-four", status: "draw" }),
  "draw",
);
assert.equal(
  audioEvent(
    { game: "brick-breaker", status: "playing", lives: 3, pickups: 0 },
    { game: "brick-breaker", status: "playing", lives: 3, pickups: 1 },
  ),
  "pickup",
);
assert.equal(
  audioEvent(
    { game: "brick-breaker", status: "playing", lives: 3 },
    { game: "brick-breaker", status: "playing", lives: 2 },
  ),
  "life",
);
assert.equal(
  audioEvent(
    { game: "snake", status: "playing", score: 0 },
    { game: "snake", status: "playing", score: 10 },
  ),
  "point",
);
assert.equal(
  audioEvent(
    { game: "block-drop", status: "playing", lines: 0 },
    { game: "block-drop", status: "playing", lines: 1 },
  ),
  "line",
);
for (const game of ["sudoku", "nonogram"])
  assert.equal(
    audioEvent(
      {
        game,
        status: "playing",
        board: Array(game === "sudoku" ? 81 : 25).fill(0),
      },
      {
        game,
        status: "playing",
        size: 5,
        rows: [],
        cols: [],
        board: [1, ...Array(game === "sudoku" ? 80 : 24).fill(0)],
      },
      { type: "set", index: 0, value: 1 },
    ),
    "input",
  );
hooks.get("pagehide")();
window.AudioContext = undefined;
assert.equal(await unlockAudio(), false);
console.log(
  "PASS shared sound: no context/autoplay at load, gesture activation, unavailable/hidden handling, bounded cues, game-specific events and player-perspective results.",
);
