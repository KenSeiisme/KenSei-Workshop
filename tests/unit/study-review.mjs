import assert from "node:assert/strict";
import {
  distributeReview,
  checkReviewDates,
} from "../../src/tools/review-plan-core.js";
const topics = ["A", "B", "C"];
assert.deepEqual(
  distributeReview(
    topics,
    "2026-11-16",
    "2026-11-23",
    [1, 2, 3, 4, 5],
    1,
  ).scheduled.map((s) => s.day),
  ["2026-11-16", "2026-11-18", "2026-11-20"],
);
assert.deepEqual(
  distributeReview(topics, "2026-11-16", "2026-11-17", [1], 1).unscheduled,
  ["B", "C"],
);
const options = {
  start: "2026-11-16",
  zone: "Asia/Kuala_Lumpur",
  exam: { due: "2026-11-17T09:00" },
  weekdays: [1],
  limit: 1,
  now: Date.parse("2026-11-16T08:30:00Z"),
};
assert.doesNotThrow(() =>
  checkReviewDates([{ due: "2026-11-16T18:00" }], options),
);
assert.throws(
  () => checkReviewDates([{ due: "2026-11-16T15:59" }], options),
  /future/,
);
assert.throws(
  () => checkReviewDates([{ due: "2026-11-17T00:00" }], options),
  /before the exam/,
);
assert.throws(
  () =>
    checkReviewDates(
      [{ due: "2026-11-16T18:00" }, { due: "2026-11-16T19:00" }],
      options,
    ),
  /limit/,
);
console.log(
  "PASS spaced revision dates, unavailable slots, local time and daily capacity",
);
