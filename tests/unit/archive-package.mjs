import assert from "node:assert/strict";
import {
  plannedPackage,
  verificationRows,
  digest,
} from "../../src/tools/archive-package.js";
assert.throws(
  () => plannedPackage([{ name: "large.bin", size: 100000001 }]),
  /100 MB/,
);
assert.throws(
  () =>
    plannedPackage(
      Array.from({ length: 101 }, (_, i) => ({ name: "file-" + i, size: 1 })),
    ),
  /100 files/,
);
const files = [new File(["A"], "same.bin"), new File(["B"], "same.bin")];
assert.deepEqual(
  plannedPackage(files, ["課程/甲/same.bin", "課程/乙/same.bin"]),
  ["課程/甲/same.bin", "課程/乙/same.bin"],
);
assert.throws(() => plannedPackage(files, ["a.txt", "A.txt"]), /unique/);
assert.throws(
  () => plannedPackage(files, ["SHA256SUMS", "file.bin"]),
  /reserve/,
);
assert.throws(() => plannedPackage(files, ["a.txt", "a.txt/b.txt"]), /folder/);
assert.throws(() => plannedPackage(files, ["../a.txt", "b.txt"]), /unsafe/);
assert.equal(
  await digest(new TextEncoder().encode("abc")),
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
);
assert.deepEqual(
  verificationRows(
    [
      { name: "A", sha256: "1" },
      { name: "B", sha256: "2" },
      { name: "C", sha256: "3" },
    ],
    [
      { name: "A", index: 0 },
      { name: "B", index: 1 },
      { name: "X", index: 2 },
    ],
    new Map([
      [0, { sha256: "1" }],
      [1, { sha256: "x" }],
    ]),
  ),
  [
    { name: "A", state: "Match" },
    { name: "B", state: "Mismatch" },
    { name: "C", state: "Missing" },
    { name: "X", state: "Not in manifest" },
  ],
);
assert.deepEqual(
  verificationRows(
    [{ name: "甲/A", sha256: "1" }],
    [
      { name: "甲/A", index: 0 },
      { name: "甲/a", index: 1 },
    ],
    new Map(),
  ).map((row) => row.state),
  ["Ambiguous", "Ambiguous"],
);
console.log(
  "PASS ZIP path limits, same basename in different folders, SHA-256, and all verification states",
);
