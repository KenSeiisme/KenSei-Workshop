import assert from "node:assert/strict";
import fs from "node:fs";
import { create, all } from "mathjs";
const load = (file) =>
  import(
    "data:text/javascript;base64," + fs.readFileSync(file).toString("base64")
  );
const { calculate } = await load("tool-scripts/calculator-core.js"),
  { parseSubtitles, serialize, shiftCues } = await load(
    "tool-scripts/subtitle-core.js",
  ),
  { validateDeck } = await load("tool-scripts/flashcard-core.js");
const math = create(all, { number: "BigNumber", precision: 64 });
for (const [text, answer, mode] of [
  ["2+3*4", "14"],
  ["0.1+0.2", "0.3"],
  ["200*10%", "20"],
  ["200+10%", "200.1"],
  ["1/3+1/6", "0.5"],
  ["sin(30)", "0.5"],
  ["cos(0)", "1"],
  ["sin(pi/2)", "1", "rad"],
  ["sqrt(144)", "12"],
  ["5!", "120"],
  ["-2^2", "-4"],
])
  assert.ok(
    Math.abs(Number(calculate(math, text, mode).text) - Number(answer)) < 1e-12,
    text,
  );
for (const text of [
  "1/0",
  "tan(90)",
  "sqrt(-1)",
  "x=4",
  "[1,2]",
  "import(2)",
  "a.b",
  "1001!",
  "2^1000000000",
  "2%3",
])
  assert.throws(() => calculate(math, text), undefined, text);
const cues = parseSubtitles(
  "1\n00:00:01,000 --> 00:00:02,000\n你好\nHello\n\n2\n00:00:02,500 --> 00:00:04,000\n<svg onload=alert(1)>",
);
assert.equal(cues.length, 2);
assert.equal(parseSubtitles(serialize(cues, "vtt"))[0].text, "你好\nHello");
assert.equal(shiftCues(cues, 250)[0].start, 1250);
assert.throws(() => shiftCues(cues, -2000));
assert.throws(() => parseSubtitles("WEBVTT\n\nSTYLE\n::cue{color:red}"));
assert.equal(
  validateDeck({
    name: "中文",
    cards: [
      { id: crypto.randomUUID(), front: "01", back: "答案", known: true },
    ],
  }).cards[0].known,
  true,
);
console.log(
  "PASS scalar math reference values and rejected expressions; SRT/VTT timing and plain text; deck validation",
);
