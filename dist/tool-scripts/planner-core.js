import { Temporal as T } from "../vendor/temporal.js";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PLANNER_LIMITS = Object.freeze({
  courses: 30,
  sessions: 14,
  tasks: 300,
  bytes: 1000000,
});
function text(value, maximum, label) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    [...value.trim()].length > maximum
  )
    throw Error(`${label} needs 1–${maximum} characters.`);
  return value.trim();
}
function id(value) {
  if (typeof value !== "string" || !uuid.test(value))
    throw Error("Use valid, unique item IDs.");
  return value.toLowerCase();
}
export function validZone(zone) {
  try {
    if (
      typeof zone !== "string" ||
      !zone ||
      zone.length > 100 ||
      /^[+-]/.test(zone)
    )
      return false;
    new Intl.DateTimeFormat("en", { timeZone: zone }).format();
    return true;
  } catch {
    return false;
  }
}
export function date(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw Error("Choose a valid calendar date.");
  try {
    return T.PlainDate.from(value, { overflow: "reject" });
  } catch {
    throw Error("Choose a valid calendar date.");
  }
}
function time(value) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw Error("Choose a valid time in HH:mm format.");
  return value;
}
export function dueEpoch(value, zone) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
  )
    throw Error("Choose a deadline date and time.");
  date(value.slice(0, 10));
  time(value.slice(11));
  if (!validZone(zone)) throw Error("Choose a valid IANA time zone.");
  const plain = T.PlainDateTime.from(value),
    result = plain.toZonedDateTime(zone, { disambiguation: "earlier" });
  // 夏令时跳过的当地时间不能悄悄移动；重复时间使用较早的一次。
  if (!plain.equals(result.toPlainDateTime()))
    throw Error(
      "This deadline falls in a daylight-saving time gap. Choose another time.",
    );
  return Number(result.epochMilliseconds);
}
export function validatePlanner(data) {
  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.courses) ||
    !Array.isArray(data.tasks)
  )
    throw Error("Use a version 1 Study Planner JSON file.");
  const name = text(data.name, 100, "Plan name");
  if (!validZone(data.timeZone))
    throw Error("Choose a valid IANA time zone, such as Asia/Kuala_Lumpur.");
  if (
    data.courses.length > PLANNER_LIMITS.courses ||
    data.tasks.length > PLANNER_LIMITS.tasks
  )
    throw Error(
      "A plan supports up to 30 courses and 300 assignments / exams.",
    );
  const courseIds = new Set(),
    sessionIds = new Set(),
    taskIds = new Set();
  const courses = data.courses.map((c) => {
    if (
      !c ||
      !Array.isArray(c.sessions) ||
      c.sessions.length > PLANNER_LIMITS.sessions
    )
      throw Error("Each course supports up to 14 weekly class times.");
    const courseId = id(c.id);
    if (courseIds.has(courseId))
      throw Error("Course IDs must be unique within a plan.");
    courseIds.add(courseId);
    date(c.startDate);
    date(c.endDate);
    if (c.startDate > c.endDate)
      throw Error("Course end date must be on or after its start date.");
    if (typeof c.color !== "string" || !/^#[0-9a-f]{6}$/i.test(c.color))
      throw Error("Choose a valid course color.");
    return {
      id: courseId,
      title: text(c.title, 100, "Course title"),
      color: c.color.toLowerCase(),
      startDate: c.startDate,
      endDate: c.endDate,
      sessions: c.sessions.map((s) => {
        if (!s || !Number.isInteger(s.day) || s.day < 1 || s.day > 7)
          throw Error("Choose a weekday from Monday to Sunday.");
        const sessionId = id(s.id);
        if (sessionIds.has(sessionId))
          throw Error("Class time IDs must be unique within a plan.");
        sessionIds.add(sessionId);
        time(s.start);
        time(s.end);
        if (s.start >= s.end)
          throw Error(
            "A class must end after it starts on the same day. Split overnight classes into two times.",
          );
        return { id: sessionId, day: s.day, start: s.start, end: s.end };
      }),
    };
  });
  const tasks = data.tasks.map((task) => {
    if (
      !task ||
      !["assignment", "exam"].includes(task.type) ||
      typeof task.done !== "boolean"
    )
      throw Error("Each task needs a type and completion state.");
    const taskId = id(task.id),
      courseId = task.courseId === null ? null : id(task.courseId);
    if (taskIds.has(taskId))
      throw Error("Task IDs must be unique within a plan.");
    taskIds.add(taskId);
    if (courseId && !courseIds.has(courseId))
      throw Error("A task's course must belong to this plan.");
    dueEpoch(task.due, data.timeZone);
    return {
      id: taskId,
      title: text(task.title, 200, "Task title"),
      courseId,
      type: task.type,
      due: task.due,
      done: task.done,
    };
  });
  const result = { version: 1, name, timeZone: data.timeZone, courses, tasks };
  if (
    new TextEncoder().encode(JSON.stringify(result)).length >
    PLANNER_LIMITS.bytes
  )
    throw Error(
      "This plan exceeds 1 MB. Export your edits before removing some items.",
    );
  return result;
}
export function today(zone, epoch = Date.now()) {
  return T.Instant.fromEpochMilliseconds(epoch)
    .toZonedDateTimeISO(zone)
    .toPlainDate()
    .toString();
}
export function monday(value) {
  const d = date(value);
  return d.subtract({ days: d.dayOfWeek - 1 }).toString();
}
export function addDays(value, days) {
  return date(value).add({ days }).toString();
}
export function taskState(task, zone, now = Date.now()) {
  return task.done
    ? "done"
    : dueEpoch(task.due, zone) < now
      ? "overdue"
      : "due";
}
export function weekEvents(plan, start) {
  const days = Array.from({ length: 7 }, (_, i) => ({
    date: addDays(start, i),
    classes: [],
    tasks: [],
    skipped: [],
  }));
  for (const day of days) {
    const weekday = date(day.date).dayOfWeek;
    for (const course of plan.courses) {
      if (day.date < course.startDate || day.date > course.endDate) continue;
      for (const session of course.sessions) {
        if (session.day !== weekday) continue;
        const entry = { course, session };
        try {
          dueEpoch(`${day.date}T${session.start}`, plan.timeZone);
          dueEpoch(`${day.date}T${session.end}`, plan.timeZone);
          day.classes.push(entry);
        } catch {
          day.skipped.push(entry);
        }
      }
    }
    day.classes.sort(
      (a, b) =>
        a.session.start.localeCompare(b.session.start) ||
        a.course.title.localeCompare(b.course.title),
    );
    day.tasks = plan.tasks
      .filter((task) => task.due.slice(0, 10) === day.date)
      .sort((a, b) => a.due.localeCompare(b.due));
  }
  return days;
}
export function emptyPlanner(
  zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
) {
  return {
    version: 1,
    name: "New study plan",
    timeZone: validZone(zone) ? zone : "UTC",
    courses: [],
    tasks: [],
  };
}
