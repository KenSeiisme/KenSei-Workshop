import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { composePassage } from "../../src/tools/typing-content.js";
import { wheelTarget } from "../../src/tools/decision-motion.js";
const bank = JSON.parse(
  await fs.readFile("data/typing-sentences.json", "utf8"),
);
for (const lang of ["en", "zh"]) {
  const recent = [];
  for (let i = 0; i < 80; i++) {
    const result = composePassage(bank, lang, recent.slice(-10));
    assert(!recent.slice(-10).includes(result.sentenceIds[0]));
    recent.push(result.sentenceIds[0]);
    assert.equal(new Set(result.sentenceIds).size, result.sentenceIds.length);
    assert(result.text.length >= (lang === "en" ? 3000 : 1800));
    assert(result.text.length <= (lang === "en" ? 4500 : 2500));
  }
}
let seed = 19;
const random = (n) => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed % n;
};
for (const count of [1, 2, 3, 7, 50, 200])
  for (let i = 0; i < 200; i++) {
    const index = i % count,
      start = i * 93.231;
    const target = wheelTarget(count, index, start, random);
    const angle = ((-target.rotation % 360) + 360) % 360;
    assert.equal(Math.floor(angle / (360 / count)), index);
    assert(target.duration >= 2600 && target.duration <= 3400);
    assert(target.rotation > start + 720);
  }
console.log(
  "Typing content: 160 nonrepeating compositions. Wheel: 1200 random targets agree with pointer including 1 and 200 options.",
);
