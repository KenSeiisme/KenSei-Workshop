import assert from "node:assert/strict";
import {
  audioContextType,
  supportsAudioEditing,
} from "../../src/tools/audio-context.js";
const FakeAudio = class {},
  FakeOffline = class {};
assert.equal(
  audioContextType(false, { webkitAudioContext: FakeAudio }),
  FakeAudio,
);
assert.equal(
  audioContextType(true, { webkitOfflineAudioContext: FakeOffline }),
  FakeOffline,
);
assert.equal(
  supportsAudioEditing({
    AudioContext: FakeAudio,
    OfflineAudioContext: FakeOffline,
  }),
  true,
);
assert.equal(supportsAudioEditing({ AudioContext: FakeAudio }), false);
assert.throws(
  () => audioContextType(false, {}),
  /Audio editing is unavailable/,
);
import { validateAnalysisRecipe } from "../../src/tools/data-analysis-core.js";
import { validateImageRecipe } from "../../src/tools/image-recipe-core.js";
import {
  validateOCRRecipe,
  originalPoint,
} from "../../src/tools/ocr-review-core.js";
import {
  validateMixRecipe,
  mixBudget,
} from "../../src/tools/audio-mix-core.js";
const data = validateAnalysisRecipe({
  slots: [{ headers: ["id"] }],
  sql: "SELECT * FROM table_1",
  config: { originalFiles: "must not persist", columns: ["a.id"] },
});
assert(!Object.hasOwn(data.config, "originalFiles"));
assert.throws(() => validateImageRecipe({ rotation: 33 }));
assert.throws(() =>
  validateOCRRecipe({
    languages: ["eng"],
    preprocessing: { crop: [90, 0, 20, 100] },
  }),
);
const track = { volume: 1, pan: 0, eq: [0, 0, 0] },
  clip = { slot: 0, track: 0, at: 0, start: 0, end: 2 };
const recipe = validateMixRecipe({
  tracks: [track],
  clips: [clip],
  originalAudio: "must not persist",
});
assert(!Object.hasOwn(recipe, "originalAudio"));
assert.equal(recipe.slots[0].minimumDuration, 2);
assert.equal(recipe.crossfade, 0.5);
assert.throws(() => mixBudget(recipe, []));
assert.throws(() =>
  mixBudget(recipe, [{ duration: 1, length: 44100, numberOfChannels: 1 }]),
);
assert.equal(
  mixBudget(recipe, [{ duration: 2, length: 88200, numberOfChannels: 1 }])
    .duration,
  2,
);
const meta = {
  sourceWidth: 1280,
  sourceHeight: 720,
  width: 360,
  height: 640,
  cropWidth: 640,
  cropHeight: 360,
  crop: [25, 25, 50, 50],
  rotation: 90,
};
const point = originalPoint(0, 0, meta);
assert(Math.abs(point[0] - 0.25) < 1e-10);
assert(Math.abs(point[1] - 0.75) < 1e-10);
console.log(
  "PASS recipe whitelists, media exclusion, invalid ranges, source mapping budget and inverse OCR rotation",
);
