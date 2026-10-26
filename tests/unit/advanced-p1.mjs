import assert from "node:assert/strict";
import { targetCompression } from "../../src/tools/target-compression.js";
import { applyRenameRules } from "../../src/tools/rename-rules.js";
import {
  parseManifest,
  compareManifest,
} from "../../src/tools/check-manifest.js";
let count = 0;
const result = await targetCompression(
  async (q) => {
    count++;
    return { size: Math.round(q * 1000) };
  },
  1,
  450,
);
assert(result.met);
assert(result.blob.size <= 450);
assert(count <= 8);
assert(result.quality > 0.43);
const impossible = await targetCompression(
  async (q) => ({ size: 100 + q * 1000 }),
  1,
  20,
);
assert(!impossible.met);
assert(impossible.calls <= 8);
assert.equal(
  applyRenameRules("Photo", { name: "Photo.png", lastModified: 0 }, 1, [
    { type: "lower", value: "" },
    { type: "template", value: "{name}_{n:03}" },
  ]),
  "photo_002",
);
const digest = "a".repeat(64),
  expected = parseManifest(digest + "  data.txt\n" + digest + " *absent.txt");
assert.equal(
  compareManifest(expected, [{ name: "data.txt", sha256: digest }])[0].state,
  "Match",
);
assert.equal(compareManifest(expected, [])[1].state, "Missing");
assert.throws(() => parseManifest('{"files":[{"name":"x","sha256":"bad"}]}'));
console.log(
  "PASS P1 pure behavior: eight-encode target bound, best fit/unreachable, ordered templates and checksum manifests",
);
