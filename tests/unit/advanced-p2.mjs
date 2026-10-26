import assert from "node:assert/strict";
import {
  gradeCard,
  cardDue,
  validateDeck,
} from "../../src/tools/flashcard-core.js";
import { calendar, plannerEvents } from "../../src/tools/calendar-export.js";
import { scoreText } from "../../src/tools/sprint-core.js";
const now = Date.UTC(2026, 9, 26),
  card = { id: crypto.randomUUID(), front: "Q", back: "A", known: true };
assert(cardDue(card, now));
assert(
  !Object.hasOwn(
    validateDeck({ name: "Old deck", cards: [card] }).cards[0],
    "review",
  ),
);
let c = card;
for (const days of [1, 3, 7, 14, 30, 30]) {
  c = gradeCard(c, true, now);
  assert.equal(Date.parse(c.review.dueAt) - now, days * 86400000);
}
c = gradeCard(c, false, now);
assert.equal(c.review.stage, 0);
assert.equal(Date.parse(c.review.dueAt) - now, 600000);
assert.equal(cardDue(c, now + 599999), false);
assert.equal(cardDue(c, now + 600000), true);
assert.throws(() =>
  validateDeck({
    name: "Bad",
    cards: [
      { ...card, review: { stage: 6, dueAt: null, lastReviewedAt: null } },
    ],
  }),
);
assert.equal(scoreText("abcde", "abcde", "en", 15).speed, 4);
assert.equal(scoreText("你好", "你好", "zh", 120).speed, 1);
const events = plannerEvents({
  timeZone: "America/New_York",
  courses: [
    {
      id: crypto.randomUUID(),
      title: "中文, notes",
      startDate: "2026-03-01",
      endDate: "2026-03-16",
      sessions: [
        { id: crypto.randomUUID(), day: 1, start: "09:00", end: "10:00" },
      ],
    },
  ],
  tasks: [],
});
assert.equal(events.length, 3);
assert.equal(new Date(events[0].start).getUTCHours(), 14);
assert.equal(new Date(events[1].start).getUTCHours(), 13);
assert(calendar(events).includes("中文\\, notes"));
console.log(
  "PASS SRS intervals, legacy cards, practice durations and timezone-safe calendar",
);
