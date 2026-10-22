import assert from "node:assert/strict";
import {
  validatePlanner,
  validZone,
  dueEpoch,
  today,
  monday,
  addDays,
  taskState,
  weekEvents,
  emptyPlanner,
} from "../../src/tools/planner-core.js";

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = () => ({
  version: 1,
  name: " Semester 一 ",
  timeZone: "Asia/Kuala_Lumpur",
  courses: [
    {
      id: uid(1),
      title: " Programming ",
      color: "#D6B1EC",
      startDate: "2026-10-19",
      endDate: "2026-10-26",
      sessions: [
        { id: uid(2), day: 1, start: "09:00", end: "10:00" },
        { id: uid(3), day: 5, start: "14:00", end: "16:00" },
      ],
    },
  ],
  tasks: [
    {
      id: uid(4),
      title: " Report 中文 ",
      courseId: uid(1),
      type: "assignment",
      due: "2026-10-22T23:59",
      done: false,
    },
    {
      id: uid(5),
      title: "Exam",
      courseId: null,
      type: "exam",
      due: "2026-10-23T10:00",
      done: true,
    },
  ],
});
const data = validatePlanner(base());
assert.equal(data.name, "Semester 一");
assert.equal(data.courses[0].title, "Programming");
assert.equal(data.courses[0].color, "#d6b1ec");
assert.equal(data.tasks[0].title, "Report 中文");
assert.deepEqual(
  validatePlanner(JSON.parse(JSON.stringify(data))),
  data,
  "JSON round trip retains all meaningful fields",
);
assert.equal(validZone("Asia/Kuala_Lumpur"), true);
assert.equal(validZone("Definitely/Not_A_Zone"), false);
assert.equal(validZone("+08:00"), false);
assert.equal(emptyPlanner("bad-zone").timeZone, "UTC");
assert.equal(
  today("Asia/Kuala_Lumpur", Date.parse("2026-10-22T20:00:00Z")),
  "2026-10-23",
);
assert.equal(
  today("America/New_York", Date.parse("2026-10-22T02:00:00Z")),
  "2026-10-21",
);
assert.equal(monday("2026-10-25"), "2026-10-19");
assert.equal(addDays("2028-02-28", 1), "2028-02-29");
assert.equal(
  dueEpoch("2026-10-22T23:59", "Asia/Kuala_Lumpur"),
  Date.parse("2026-10-22T15:59:00Z"),
);
assert.throws(
  () => dueEpoch("2026-03-08T02:30", "America/New_York"),
  /daylight-saving/,
);
assert.equal(
  dueEpoch("2026-11-01T01:30", "America/New_York"),
  Date.parse("2026-11-01T05:30:00Z"),
  "repeated local times use the earlier occurrence",
);
assert.equal(
  taskState(data.tasks[0], data.timeZone, Date.parse("2026-10-23T00:00:00Z")),
  "overdue",
);
assert.equal(
  taskState(data.tasks[0], data.timeZone, Date.parse("2026-10-20T00:00:00Z")),
  "due",
);
assert.equal(
  taskState(data.tasks[1], data.timeZone, Date.parse("2030-01-01T00:00:00Z")),
  "done",
);
const week = weekEvents(data, "2026-10-19");
assert.equal(week.length, 7);
assert.equal(week[0].classes.length, 1);
assert.equal(week[3].tasks[0].id, uid(4));
assert.equal(week[4].classes.length, 1);
assert.equal(
  weekEvents(data, "2026-10-26")[0].classes.length,
  1,
  "course end date is inclusive",
);
assert.equal(
  weekEvents(data, "2026-11-02").flatMap((d) => d.classes).length,
  0,
);
const dst = emptyPlanner("America/New_York");
dst.courses.push({
  id: uid(10),
  title: "Early class",
  color: "#112233",
  startDate: "2026-03-01",
  endDate: "2026-03-15",
  sessions: [{ id: uid(11), day: 7, start: "02:30", end: "03:30" }],
});
const dstWeek = weekEvents(validatePlanner(dst), "2026-03-02");
assert.equal(dstWeek[6].classes.length, 0);
assert.equal(
  dstWeek[6].skipped.length,
  1,
  "a recurring class in a clock gap is flagged, never silently shifted",
);

for (const [edit, match] of [
  [
    (d) => {
      d.version = 2;
    },
    /version 1/,
  ],
  [
    (d) => {
      d.name = " ";
    },
    /Plan name/,
  ],
  [
    (d) => {
      d.timeZone = "bad-zone";
    },
    /time zone/,
  ],
  [
    (d) => {
      d.courses[0].startDate = "2026-02-30";
    },
    /calendar date/,
  ],
  [
    (d) => {
      d.courses[0].endDate = "2026-01-01";
    },
    /end date/,
  ],
  [
    (d) => {
      d.courses[0].sessions[0].day = 8;
    },
    /weekday/,
  ],
  [
    (d) => {
      d.courses[0].sessions[0].end = "08:00";
    },
    /end after/,
  ],
  [
    (d) => {
      d.courses[0].sessions[0].start = "25:00";
    },
    /valid time/,
  ],
  [
    (d) => {
      d.tasks[0].due = "2026-02-30T12:00";
    },
    /calendar date/,
  ],
  [
    (d) => {
      d.tasks[0].due = "2026-10-22";
    },
    /deadline/,
  ],
  [
    (d) => {
      d.tasks[0].courseId = uid(99);
    },
    /belong/,
  ],
  [
    (d) => {
      d.tasks[0].done = "false";
    },
    /completion/,
  ],
  [
    (d) => {
      d.tasks[0].type = "other";
    },
    /type/,
  ],
  [
    (d) => {
      d.tasks.push(structuredClone(d.tasks[0]));
    },
    /Task IDs/,
  ],
  [
    (d) => {
      d.courses.push(structuredClone(d.courses[0]));
    },
    /Course IDs/,
  ],
  [
    (d) => {
      d.courses[0].sessions[1].id = d.courses[0].sessions[0].id;
    },
    /Class time IDs/,
  ],
  [
    (d) => {
      d.tasks = Array.from({ length: 301 }, (_, i) => ({
        ...d.tasks[0],
        id: uid(i + 100),
      }));
    },
    /300/,
  ],
  [
    (d) => {
      d.courses = Array.from({ length: 31 }, (_, i) => ({
        ...d.courses[0],
        id: uid(i + 100),
        sessions: [],
      }));
    },
    /30/,
  ],
  [
    (d) => {
      d.courses[0].sessions = Array.from({ length: 15 }, (_, i) => ({
        ...d.courses[0].sessions[0],
        id: uid(i + 100),
      }));
    },
    /14/,
  ],
]) {
  const invalid = base();
  edit(invalid);
  assert.throws(() => validatePlanner(invalid), match);
}
const emoji = base();
emoji.name = "🧪".repeat(100);
assert.equal([...validatePlanner(emoji).name].length, 100);
emoji.name += "🧪";
assert.throws(() => validatePlanner(emoji), /100/);
console.log(
  "Study Planner core: JSON validation, limits, deadlines, time zones, DST and weekly recurrence passed.",
);
