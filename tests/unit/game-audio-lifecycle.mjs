import assert from "node:assert/strict";
const hooks = new Map(),
  channels = [],
  storage = new Map([
    [
      "kensei-game-audio-v2",
      JSON.stringify({
        version: 2,
        enabled: false,
        volume: 0.62,
        musicEnabled: true,
        musicVolume: 0.12,
        countdown: true,
      }),
    ],
    ["kensei-game-audio-v1", "malformed legacy value"],
  ]);
globalThis.localStorage = {
  getItem: (k) => storage.get(k) || null,
  setItem: (k, v) => storage.set(k, v),
};
const button = {
  matches: (s) => s === "[data-audio-toggle]",
  setAttribute() {},
  addEventListener: (n, fn) => hooks.set("button:" + n, fn),
};
globalThis.document = {
  hidden: false,
  querySelector: () => null,
  querySelectorAll: (s) => (s.includes("[data-audio-toggle]") ? [button] : []),
  addEventListener: (n, fn) => hooks.set("document:" + n, fn),
};
let created = 0;
const param = () => ({
  value: 0,
  setValueAtTime(v) {
    this.value = v;
  },
  linearRampToValueAtTime(v) {
    this.value = v;
  },
  exponentialRampToValueAtTime() {},
  cancelScheduledValues() {},
});
class Context {
  constructor() {
    created++;
    this.state = "running";
    this.currentTime = 0;
    this.destination = {};
  }
  createGain() {
    return { gain: param(), connect() {}, disconnect() {} };
  }
  createBufferSource() {
    return {
      playbackRate: { value: 1 },
      connect() {},
      disconnect() {},
      start() {},
      stop() {},
    };
  }
  decodeAudioData() {
    return this.state === "closed"
      ? Promise.reject(Error("old context"))
      : Promise.resolve({ duration: 40, length: 40, numberOfChannels: 2 });
  }
  close() {
    this.state = "closed";
    return Promise.resolve();
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
}
class Channel {
  constructor() {
    this.closed = false;
    channels.push(this);
  }
  postMessage() {
    if (this.closed) throw Error("closed channel");
  }
  close() {
    this.closed = true;
  }
}
globalThis.window = {
  AudioContext: Context,
  BroadcastChannel: Channel,
  addEventListener: (n, fn) => hooks.set("window:" + n, fn),
};
let releaseOld,
  releaseNew,
  calls = 0;
const manifest = {
  version: 1,
  profiles: {
    board: {
      music: {
        file: "loop.mp3",
        bytes: 4,
        sha256: "fixture",
        duration: 40,
        loopEnd: 40,
      },
      cues: {},
    },
  },
};
globalThis.fetch = (url) => {
  if (url.endsWith("manifest.json")) {
    const response = { ok: true, json: async () => manifest };
    return new Promise((resolve) => {
      if (++calls === 1) releaseOld = () => resolve(response);
      else releaseNew = () => resolve(response);
    });
  }
  return Promise.resolve({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(4),
  });
};
const audio = await import("../../src/games/audio.js");
audio.setAudioState({ game: "go", phase: "playing", runId: "fixture" });
audio.mountAudio();
assert.equal(
  audio.getAudioDiagnostics().enabled,
  false,
  "valid current mute survives malformed legacy JSON",
);
assert.equal(await audio.unlockAudio(), false);
assert.equal(created, 0);
hooks.get("button:click")();
assert.equal(created, 1);
hooks.get("window:pagehide")({ persisted: true });
hooks.get("window:pageshow")({ persisted: true });
await audio.unlockAudio();
assert.equal(created, 2);
assert.equal(channels.length, 2);
releaseNew();
for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
assert.equal(
  audio.getAudioDiagnostics().musicPlaying,
  true,
  "first restored gesture loads in the new context",
);
const snapshot = audio.getAudioDiagnostics();
releaseOld();
for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
assert.deepEqual(
  audio.getAudioDiagnostics(),
  snapshot,
  "stale completion cannot replace state, errors or counters",
);
assert.deepEqual(snapshot.failed, []);
assert.equal(snapshot.loadError, "");
const current = channels.at(-1);
current.onmessage({
  data: { type: "claim", id: "peer", at: Number.MAX_SAFE_INTEGER },
});
assert.equal(audio.getAudioDiagnostics().focused, false);
await audio.unlockAudio();
assert.equal(audio.getAudioDiagnostics().focused, true);
current.onmessage({ data: { type: "claim", id: "peer", at: 1 } });
assert.equal(
  audio.getAudioDiagnostics().focused,
  true,
  "old cross-tab claim cannot revoke the latest local gesture",
);
hooks.get("window:pagehide")({ persisted: false });
console.log(
  "PASS independent preference parsing, BFCache channel reopening, first-gesture loading, stale fetch isolation and ordered cross-tab ownership.",
);
