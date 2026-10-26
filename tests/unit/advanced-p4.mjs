import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { weightedIndex, wheelTarget } from "../../src/tools/decision-motion.js";
import { passphrase } from "../../src/tools/passphrase-core.js";
import { vcard } from "../../src/tools/qr-extra-core.js";
import { calculateSheet } from "../../src/tools/calculator-sheet-core.js";
const require = createRequire(import.meta.url),
  { create, all } = require("mathjs"),
  math = create(all, { number: "BigNumber", precision: 64 });
const counts = [0, 0, 0],
  weights = [1, 3, 100];
for (let t = 0; t < 104; t++) counts[weightedIndex(weights, () => t)]++;
assert.deepEqual(counts, weights);
for (let i = 0; i < 3; i++)
  for (const fraction of [0, 999999]) {
    const target = wheelTarget(weights, i, 0, (n) =>
      n === 1000000 ? fraction : 0,
    );
    const angle = ((-target.rotation % 360) + 360) % 360,
      start = (360 * weights.slice(0, i).reduce((n, w) => n + w, 0)) / 104,
      end = start + (360 * weights[i]) / 104;
    assert(angle > start && angle < end);
  }
assert.throws(() => weightedIndex([0, 100]));
assert.throws(() => weightedIndex([101]));
const words = JSON.parse(fs.readFileSync("src/vendor/passphrases/words.json"));
assert.equal(new Set(words).size, 7776);
let ticket = 0;
const phrase = passphrase(words, 6, () => ticket++);
assert.equal(phrase, words.slice(0, 6).join("-"));
assert.throws(() => passphrase(words, 5));
assert(vcard("小明;A", "123", "a@example.com").includes("小明\\;A"));
const sheet = calculateSheet(
  math,
  "price = 12.50\nquantity = 3\nprice * quantity\nbad = 1/0\nprice + 2",
);
assert.equal(sheet.rows[2].result, "37.5");
assert(sheet.rows[3].error);
assert.equal(sheet.rows[4].result, "14.5");
assert(!Object.hasOwn(sheet.variables, "bad"));
assert(calculateSheet(math, "constructor = 1").rows[0].error);
console.log(
  "PASS weighted tickets/angles, pinned EFF phrases, vCard escaping and safe multiline calculation",
);
