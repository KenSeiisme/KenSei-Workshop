import { addDays, date, dueEpoch } from "./planner-core.js";

export function distributeReview(topics, start, examDay, weekdays, dailyLimit) {
  const days = [];
  // A bounded term-length schedule keeps dates and previews manageable.
  for (
    let day = start, offset = 0;
    day < examDay && offset < 366;
    day = addDays(day, 1), offset++
  ) {
    if (weekdays.includes(date(day).dayOfWeek)) days.push(day);
  }
  const count = Math.min(topics.length, days.length * dailyLimit);
  const usedDays = Math.min(count, days.length);
  const slots = Array.from({ length: usedDays }, (_, i) => {
    const index =
      usedDays === 1 ? 0 : Math.round((i * (days.length - 1)) / (usedDays - 1));
    return days[index];
  });
  return {
    scheduled: topics
      .slice(0, count)
      .map((title, i) => ({
        title,
        day: slots[Math.floor((i * usedDays) / count)],
      })),
    unscheduled: topics.slice(count),
  };
}

export function checkReviewDates(
  entries,
  { start, exam, zone, weekdays, limit, now },
) {
  const counts = new Map();
  for (const { due } of entries) {
    const day = due.slice(0, 10);
    if (
      day < start ||
      day >= exam.due.slice(0, 10) ||
      !weekdays.includes(date(day).dayOfWeek) ||
      dueEpoch(due, zone) <= now
    )
      throw Error(
        "Choose a future review time on an available day before the exam.",
      );
    const count = (counts.get(day) || 0) + 1;
    if (count > limit)
      throw Error("A review day exceeds the daily session limit.");
    counts.set(day, count);
  }
}
