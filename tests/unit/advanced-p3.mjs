import assert from "node:assert/strict";
import {
  keptRanges,
  shapeSamples,
  pcmWav,
} from "../../src/tools/audio-edit-core.js";
assert.deepEqual(keptRanges("0-10\n20-25", 30), [
  [0, 10],
  [20, 25],
]);
assert.throws(() => keptRanges("20-10", 30));
assert.throws(() => keptRanges("0-31", 30));
const samples = [new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5])];
shapeSamples(samples, 1, 1, 1, true);
assert.equal(samples[0][0], 0);
assert.equal(samples[0][4], 0);
assert.equal(samples[0][2], 1);
const wav = await pcmWav(samples, 44100).arrayBuffer();
assert.equal(new DataView(wav).getUint32(40, true), 10);
assert.equal(wav.byteLength, 54);
console.log(
  "PASS audio range validation, fades, normalization and PCM WAV output",
);
