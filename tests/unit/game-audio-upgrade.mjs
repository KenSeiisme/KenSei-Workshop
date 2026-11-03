import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import {
  AUDIO_PROFILES,
  normalizeAudioPreference,
  audioEvent,
  audioEvents,
  resultCue,
  createCountdownTracker,
} from "../../src/games/audio-events.js";
const preference = normalizeAudioPreference(null, {
  enabled: false,
  volume: 0.73,
});
assert.equal(preference.enabled, false);
assert.equal(preference.volume, 0.73);
assert.equal(preference.musicVolume, 0.12);
assert.equal(
  normalizeAudioPreference({
    version: 2,
    musicEnabled: false,
    musicVolume: 2,
    volume: -1,
  }).musicVolume,
  1,
);
assert.equal(
  normalizeAudioPreference({
    version: 2,
    musicEnabled: false,
    musicVolume: 0,
    volume: 0,
  }).musicEnabled,
  false,
);
assert.equal(Object.keys(AUDIO_PROFILES).length, 13);
const before = {
  game: "2048",
  status: "playing",
  moves: 1,
  score: 0,
  board: [2, 0, 0, 0],
};
assert.equal(
  audioEvent(before, structuredClone(before), { type: "move" }),
  null,
);
assert.equal(
  audioEvent(
    before,
    { ...before, moves: 2, board: [0, 2, 0, 0] },
    { type: "move" },
  ),
  "move",
);
assert.equal(
  audioEvent(before, { ...before, board: [4, 0, 0, 0], score: 4 }),
  "merge",
);
const saved = JSON.stringify(before);
audioEvents(before, { ...before, score: 4, board: [4, 0, 0, 0] });
assert.equal(JSON.stringify(before), saved);
for (const [name, cue] of [
  ["Multiball", "multiball"],
  ["Wide Paddle", "wide"],
  ["Slow Ball", "slow"],
])
  assert.equal(
    audioEvent(
      { game: "brick-breaker", status: "playing", pickups: 0 },
      {
        game: "brick-breaker",
        status: "playing",
        pickups: 1,
        lastPickup: name,
      },
    ),
    cue,
  );
for (const game of ["connect-four", "reversi"]) {
  assert.equal(
    audioEvent(
      { game, status: "playing" },
      { game, status: "won", difficulty: "local", winner: 1 },
    ),
    "end",
  );
  assert.equal(
    audioEvent(
      { game, status: "playing" },
      { game, status: "won", difficulty: "ai-normal", humanSide: 2, winner: 1 },
    ),
    "loss",
  );
  assert.equal(
    audioEvent(
      { game, status: "playing" },
      { game, status: "draw", winner: 0 },
    ),
    "draw",
  );
}
assert.equal(resultCue(-1, 1), "loss");
assert.equal(resultCue(1, 1), "win");
assert.equal(resultCue(1, null), "end");
assert.equal(resultCue(null, 1, "both-lose"), "loss");
assert.equal(resultCue(null, 1, "interrupted"), "end");
assert.equal(
  audioEvent(
    { game: "snake", status: "playing", score: 0, moves: 0 },
    { game: "snake", status: "playing", score: 0, moves: 0, ticks: 2 },
  ),
  null,
);
assert.equal(
  audioEvent(
    { game: "snake", status: "playing", score: 0, moves: 0 },
    { game: "snake", status: "playing", score: 10, moves: 0 },
  ),
  "point",
);
const track = createCountdownTracker(),
  info = {
    matchId: "fixture",
    turnId: 1,
    periodId: 3,
    playing: true,
    ownTurn: true,
    controller: true,
    visible: true,
    connected: true,
    overtime: true,
  };
assert.equal(track({ ...info, remainingMs: 6000 }), null);
assert.equal(track({ ...info, remainingMs: 5000 }).seconds, 5);
assert.equal(track({ ...info, remainingMs: 4900 }), null);
assert.equal(track({ ...info, remainingMs: 2000 }).seconds, 2);
assert.equal(track({ ...info, remainingMs: 1000, controller: false }), null);
assert.equal(track({ ...info, remainingMs: 900, ownTurn: false }), null);
assert.equal(track({ ...info, remainingMs: 800, visible: false }), null);
track(null);
assert.equal(track({ ...info, remainingMs: 1000 }), null);
const manifest = JSON.parse(
  fs.readFileSync("src/assets/game-audio/manifest.json"),
);
for (const [name, profile] of Object.entries(manifest.profiles)) {
  const entries = new Map(
    [...Object.values(profile.cues).flat(), profile.music].map((v) => [
      v.file,
      v,
    ]),
  );
  let bytes = fs.statSync("src/assets/game-audio/manifest.json").size,
    pcm = 0;
  for (const v of entries.values()) {
    const b = fs.readFileSync("src/assets/game-audio/" + v.file);
    assert.equal(b.length, v.bytes);
    assert.equal(crypto.createHash("sha256").update(b).digest("hex"), v.sha256);
    bytes += b.length;
    pcm += Math.ceil(v.duration * 48000) * 2 * 4;
  }
  assert.ok(bytes <= 2 * 1024 * 1024, name);
  assert.ok(pcm <= 32 * 1024 * 1024, name);
  assert.ok(profile.music.loopEnd > 30 && profile.music.loopEnd <= 60);
  for (const cue of [
    "move",
    "win",
    "loss",
    "draw",
    "end",
    "capture",
    "pass",
    "countdown",
    "multiball",
    "wide",
    "slow",
  ])
    assert.ok(profile.cues[cue]?.length, name + cue);
}
console.log(
  "PASS audio v2 migration, 13 profiles, effective actions, player perspective, powerups, no mutation, countdown dedupe, pinned assets and download / PCM budgets.",
);
