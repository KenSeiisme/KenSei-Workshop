import { $, api, status, downloadText } from "./common.js";
import { createRecordStore, recordSignature } from "./record-store.js";
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
} from "./planner-core.js";
import {
  uiOption,
  uiMsg,
  uiJoin,
  uiFrom,
  uiError,
  uiText,
  uiAttr,
  uiConfirm,
} from "../site/ui.js";

const store = createRecordStore("planner", validatePlanner),
  owner = () => api.user?.id || "guest";
const weekdays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
let plan = null,
  scope = owner(),
  courseId = null,
  taskId = null,
  sessions = [],
  dirty = false,
  editVersion = 0,
  timer,
  saving = null,
  generation = 0,
  week = null;
let requested = new URLSearchParams(location.search).get("id"),
  initializing = 0,
  lastPersistedSignature = "";
const recoveryKey = (account = scope) =>
  "kensei-planner-recovery-v1:" + account;
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) uiText(element, text);
  if (className) element.className = className;
  return element;
}
function on(id, event, handler) {
  $("#" + id).addEventListener(event, (...args) =>
    Promise.resolve()
      .then(() => handler(...args))
      .catch((error) => {
        status(uiError(error), true);
        state();
      }),
  );
}
function courseFields() {
  return {
    title: $("#planner-course-title").value,
    startDate: $("#planner-course-start").value,
    endDate: $("#planner-course-end").value,
    color: $("#planner-course-color").value,
    sessions: structuredClone(sessions),
  };
}
function taskFields() {
  return {
    title: $("#planner-task-title").value,
    type: $("#planner-task-type").value,
    courseId: $("#planner-task-course").value || null,
    due: $("#planner-task-due").value,
    done: $("#planner-task-done").checked,
  };
}
function snapshot() {
  if (!plan) return null;
  return {
    format: "kensei-planner-backup",
    version: 1,
    id: plan.id,
    revision: plan.revision,
    plan: structuredClone(plan.data),
    editing: {
      name: $("#planner-name").value,
      timeZone: $("#planner-zone").value,
      courseId,
      course: courseFields(),
      taskId,
      task: taskFields(),
    },
  };
}
function recovery() {
  if (!plan || owner() !== scope) return;
  if (!dirty && !hasUnadded()) {
    forgetRecovery();
    return;
  }
  try {
    sessionStorage.setItem(recoveryKey(), JSON.stringify(snapshot()));
  } catch {
    /* 编辑仍在页面中，导出按钮始终可用。 */
  }
}
function forgetRecovery() {
  try {
    sessionStorage.removeItem(recoveryKey());
  } catch {
    /* Storage can be disabled. */
  }
}
function hasUnadded() {
  return (
    !!plan &&
    ((!courseId &&
      ($("#planner-course-title").value.trim() || sessions.length)) ||
      (!taskId && $("#planner-task-title").value.trim()))
  );
}
function readEdits() {
  const data = structuredClone(plan.data);
  data.name = $("#planner-name").value;
  data.timeZone = $("#planner-zone").value.trim();
  if (courseId)
    data.courses = data.courses.map((c) =>
      c.id === courseId ? { id: c.id, ...courseFields() } : c,
    );
  if (taskId)
    data.tasks = data.tasks.map((t) =>
      t.id === taskId ? { id: t.id, ...taskFields() } : t,
    );
  return data;
}
function state() {
  uiText(
    $("#planner-save-state"),
    uiJoin([
      saving
        ? uiMsg("Saving edits… · ")
        : dirty
          ? uiMsg("Unsaved edits · ")
          : "",
      uiFrom(store.saveState()),
      hasUnadded() ? uiMsg(" · New item not added yet") : "",
    ]),
  );
}
function change({ schedule = true } = {}) {
  if (!plan || owner() !== scope) return;
  dirty = true;
  editVersion++;
  recovery();
  state();
  clearTimeout(timer);
  if (schedule) timer = setTimeout(() => saveEdits(), 500);
}
async function saveEdits() {
  clearTimeout(timer);
  if (saving) {
    await saving;
    if (dirty) return saveEdits();
    return true;
  }
  if (!dirty || !plan) return true;
  if (owner() !== scope) return false;
  let data;
  try {
    data = validatePlanner(readEdits());
  } catch (error) {
    status(
      uiJoin([
        uiError(error),
        uiMsg(
          " Your edits remain here; export JSON to keep a recovery backup.",
        ),
      ]),
      true,
    );
    state();
    return false;
  }
  const expected = scope,
    version = editVersion,
    token = generation,
    id = plan.id,
    baseRevision = plan.revision || 0;
  saving = (async () => {
    try {
      const row = await store.put(data, id, expected, baseRevision);
      if (owner() !== expected || generation !== token || plan?.id !== id)
        return false;
      plan = { ...row, data: version === editVersion ? row.data : plan.data };
      lastPersistedSignature = recordSignature(row.data);
      if (version === editVersion) {
        dirty = false;
        if (!hasUnadded()) forgetRecovery();
        else recovery();
      }
      if ($("#tool-status")?.classList.contains("error-text"))
        status(
          uiMsg(
            "Changes saved. Private account sync will retry automatically when needed.",
          ),
        );
      renderList();
      renderCalendar();
      renderItems();
      return true;
    } catch (error) {
      if (owner() === expected && generation === token) {
        status(
          uiJoin([
            uiError(error),
            uiMsg(" Your edits remain here and can be exported."),
          ]),
          true,
        );
        recovery();
      }
      return false;
    }
  })();
  state();
  const result = await saving;
  saving = null;
  state();
  return result;
}
async function leaveEditor() {
  if (!(await saveEdits())) return false;
  if (
    hasUnadded() &&
    !uiConfirm(
      uiMsg(
        "This new course or task has not been added. Discard the unadded item? Export JSON first to keep a recovery backup.",
      ),
    )
  )
    return false;
  return true;
}
function setAddress(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set("id", id);
  else url.searchParams.delete("id");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}
function defaults() {
  const d = today(
    validZone($("#planner-zone").value) ? $("#planner-zone").value : "UTC",
  );
  return { date: d, end: addDays(d, 120) };
}
function courseChoices(value = $("#planner-task-course").value) {
  const select = $("#planner-task-course");
  select.replaceChildren(uiOption(uiMsg("No course"), ""));
  for (const c of plan?.data.courses || [])
    select.append(new Option(c.title, c.id));
  select.value = [...select.options].some((option) => option.value === value)
    ? value
    : "";
}
function fillCourse(course = null) {
  courseId = course?.id || null;
  const d = defaults();
  $("#planner-course-title").value = course?.title || "";
  $("#planner-course-start").value = course?.startDate || d.date;
  $("#planner-course-end").value = course?.endDate || d.end;
  $("#planner-course-color").value = course?.color || "#d6b1ec";
  sessions = structuredClone(course?.sessions || []);
  uiText(
    $("#planner-course-save"),
    course ? uiMsg("Save course") : uiMsg("Add course"),
  );
  $("#planner-course-delete").hidden = !course;
  uiText(
    $("#planner-course-edit-label"),
    course
      ? uiMsg("Editing course · changes save automatically")
      : uiMsg("Add a course"),
  );
  renderSessions();
  renderItems();
}
function fillTask(task = null) {
  taskId = task?.id || null;
  $("#planner-task-title").value = task?.title || "";
  $("#planner-task-type").value = task?.type || "assignment";
  courseChoices(task?.courseId || "");
  $("#planner-task-due").value = task?.due || defaults().date + "T23:59";
  $("#planner-task-done").checked = task?.done || false;
  uiText(
    $("#planner-task-save"),
    task ? uiMsg("Save task") : uiMsg("Add task"),
  );
  $("#planner-task-delete").hidden = !task;
  uiText(
    $("#planner-task-edit-label"),
    task
      ? uiMsg("Editing task · changes save automatically")
      : uiMsg("Add an assignment or exam"),
  );
  renderItems();
}
function fillPlan(row) {
  generation++;
  plan = structuredClone(row);
  lastPersistedSignature = recordSignature(row.data);
  dirty = false;
  editVersion++;
  $("#planner-fields").disabled = false;
  $("#planner-empty").hidden = true;
  $("#planner-name").value = plan.data.name;
  $("#planner-zone").value = plan.data.timeZone;
  week = monday(today(plan.data.timeZone));
  fillCourse();
  fillTask();
  renderList();
  renderCalendar();
  state();
  setAddress(plan.id);
}
function clearEditor() {
  generation++;
  plan = null;
  dirty = false;
  courseId = taskId = null;
  sessions = [];
  week = null;
  lastPersistedSignature = "";
  $("#planner-fields").disabled = true;
  $("#planner-empty").hidden = false;
  for (const id of [
    "planner-name",
    "planner-zone",
    "planner-course-title",
    "planner-task-title",
  ])
    $("#" + id).value = "";
  for (const id of [
    "planner-week",
    "planner-courses",
    "planner-tasks",
    "planner-sessions",
  ])
    $("#" + id).replaceChildren();
  uiText(
    $("#planner-week-label"),
    ($("#planner-task-summary").textContent = ""),
  );
  setAddress(null);
  state();
}
function renderList() {
  const container = $("#planner-list");
  container.replaceChildren();
  for (const row of store.rows()) {
    const button = node(
      "button",
      row.data.name + " · " + row.data.courses.length + " courses",
      "saved-row text-link",
    );
    button.setAttribute("aria-current", String(row.id === plan?.id));
    button.onclick = () => open(row.id);
    container.append(button);
  }
  if (!container.children.length)
    container.append(
      node("p", uiMsg("No plans saved in this account yet."), "muted small"),
    );
  $("#planner-more").hidden = !store.hasMore();
  state();
}
function currentData() {
  try {
    return validatePlanner(readEdits());
  } catch {
    return plan?.data;
  }
}
function renderCalendar() {
  if (!plan) return;
  const data = currentData(),
    container = $("#planner-week");
  if (!week) week = monday(today(data.timeZone));
  container.replaceChildren();
  uiText(
    $("#planner-week-label"),
    `${week} – ${addDays(week, 6)} · ${data.timeZone}`,
  );
  uiText(
    $("#planner-zone-note"),
    uiMsg(
      "All classes and deadlines use {0}, including on other devices. Changing the plan zone keeps written dates and times.",
      [data.timeZone],
    ),
  );
  for (const day of weekEvents(data, week)) {
    const column = node("section", undefined, "planner-day");
    column.dataset.today = String(day.date === today(data.timeZone));
    const index = new Date(day.date + "T00:00:00Z").getUTCDay();
    column.append(
      node(
        "h4",
        (index === 0
          ? "Sun"
          : ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][index]) +
          " " +
          day.date.slice(5),
      ),
    );
    for (const { course, session } of day.classes) {
      const button = node("button", course.title, "planner-event");
      button.style.setProperty("--course-color", course.color);
      button.append(node("small", `${session.start}–${session.end}`));
      button.onclick = () => chooseCourse(course.id);
      column.append(button);
    }
    for (const task of day.tasks) {
      const button = node(
        "button",
        (task.done ? "✓ " : "") + task.title,
        "planner-event",
      );
      button.dataset.done = String(task.done);
      button.append(
        node(
          "small",
          `${task.type === "exam" ? "Exam" : "Due"} ${task.due.slice(11)}`,
        ),
      );
      button.onclick = () => chooseTask(task.id);
      column.append(button);
    }
    for (const { course } of day.skipped)
      column.append(
        node(
          "p",
          `${course.title}: class skipped because a clock change removes this local time.`,
          "planner-dst-warning",
        ),
      );
    if (column.children.length === 1)
      column.append(
        node("p", uiMsg("No classes or deadlines"), "planner-empty-day"),
      );
    container.append(column);
  }
}
function renderItems() {
  if (!plan) return;
  const data = currentData(),
    courses = $("#planner-courses"),
    tasks = $("#planner-tasks");
  courses.replaceChildren();
  tasks.replaceChildren();
  for (const course of data.courses) {
    const row = node("div", undefined, "planner-item"),
      button = node("button", course.title, "text-link");
    row.dataset.selected = String(courseId === course.id);
    button.append(
      node(
        "small",
        `${course.startDate} – ${course.endDate} · ${course.sessions.length} weekly times`,
      ),
    );
    button.onclick = () => chooseCourse(course.id);
    row.append(button);
    courses.append(row);
  }
  const counts = { due: 0, overdue: 0, done: 0 },
    filter = $("#planner-task-filter").value;
  for (const task of [...data.tasks].sort((a, b) =>
    a.due.localeCompare(b.due),
  )) {
    const taskStatus = taskState(task, data.timeZone);
    counts[taskStatus]++;
    if (
      filter !== "all" &&
      (filter === "open" ? taskStatus === "done" : taskStatus !== filter)
    )
      continue;
    const row = node("div", undefined, "planner-item"),
      checked = document.createElement("input"),
      button = node("button", task.title, "text-link");
    row.dataset.selected = String(taskId === task.id);
    checked.type = "checkbox";
    checked.checked = task.done;
    uiAttr(
      checked,
      "aria-label",
      uiJoin([uiMsg("Mark "), task.title, uiMsg("done")]),
    );
    checked.onchange = () => toggleTask(task.id, checked.checked);
    const label = node(
      "small",
      `${task.type === "exam" ? "Exam" : "Assignment"} · ${task.due.replace("T", " ")} · ${taskStatus === "due" ? "Due" : taskStatus === "overdue" ? "Overdue" : "Done"}`,
    );
    if (taskStatus === "overdue") label.className = "planner-overdue";
    button.append(label);
    button.onclick = () => chooseTask(task.id);
    row.append(checked, button);
    tasks.append(row);
  }
  if (!courses.children.length)
    courses.append(
      node(
        "p",
        uiMsg("Add courses to build your weekly schedule."),
        "muted small",
      ),
    );
  if (!tasks.children.length)
    tasks.append(node("p", uiMsg("No tasks in this view."), "muted small"));
  uiText(
    $("#planner-task-summary"),
    uiMsg("{0} due · {1} overdue · {2} done · {3}", [
      counts.due,
      counts.overdue,
      counts.done,
      data.timeZone,
    ]),
  );
}
function renderSessions() {
  const container = $("#planner-sessions");
  container.replaceChildren();
  sessions.forEach((session) => {
    const row = node("div", undefined, "planner-session"),
      remove = node("button", uiMsg("Remove"), "text-link");
    row.append(
      node(
        "span",
        `${weekdays[session.day - 1]} ${session.start}–${session.end}`,
      ),
    );
    uiAttr(
      remove,
      "aria-label",
      uiMsg("Remove {0} {1} class time", [
        weekdays[session.day - 1],
        session.start,
      ]),
    );
    remove.onclick = () => {
      sessions = sessions.filter((x) => x.id !== session.id);
      renderSessions();
      if (courseId) change();
      else {
        recovery();
        state();
      }
    };
    row.append(remove);
    container.append(row);
  });
}
async function open(id) {
  try {
    if (!(await leaveEditor())) return;
    const expected = owner(),
      token = generation,
      row = await store.get(id);
    if (owner() !== expected || token !== generation) return;
    if (!row)
      throw Error(
        "This plan is unavailable or was deleted. Your current edits remain here.",
      );
    fillPlan(row);
    status(
      uiMsg(
        "Plan opened. Existing items save automatically; use Add for a new course or task.",
      ),
    );
  } catch (error) {
    status(uiError(error), true);
  }
}
async function chooseCourse(id) {
  if (!(await saveEdits())) return;
  if (
    !courseId &&
    ($("#planner-course-title").value.trim() || sessions.length) &&
    !uiConfirm(uiMsg("Discard this unadded course?"))
  )
    return;
  const course = plan?.data.courses.find((c) => c.id === id);
  if (course) {
    fillCourse(course);
    recovery();
    state();
    $("#planner-course-title").focus();
  }
}
async function chooseTask(id) {
  if (!(await saveEdits())) return;
  if (
    !taskId &&
    $("#planner-task-title").value.trim() &&
    !uiConfirm(uiMsg("Discard this unadded task?"))
  )
    return;
  const task = plan?.data.tasks.find((t) => t.id === id);
  if (task) {
    fillTask(task);
    recovery();
    state();
    $("#planner-task-title").focus();
  }
}
async function toggleTask(id, done) {
  if (!plan || owner() !== scope) return;
  const data = readEdits();
  data.tasks = data.tasks.map((t) => (t.id === id ? { ...t, done } : t));
  try {
    plan.data = validatePlanner(data);
    if (taskId === id) $("#planner-task-done").checked = done;
    change({ schedule: false });
    await saveEdits();
    renderCalendar();
    renderItems();
  } catch (error) {
    status(uiError(error), true);
    renderItems();
  }
}
async function guestCopies() {
  const target = owner();
  $("#planner-guest-copy").hidden = target === "guest";
  if (target === "guest") return;
  try {
    const rows = await store.guestRows();
    if (owner() !== target) return;
    const select = $("#planner-guest-plan");
    select.replaceChildren();
    for (const row of rows) select.append(new Option(row.data.name, row.id));
    $("#planner-copy-account").disabled = !rows.length;
    if (!rows.length)
      select.append(uiOption(uiMsg("No guest plans on this device"), ""));
  } catch {
    $("#planner-copy-account").disabled = true;
  }
}
function restoreEditing(saved) {
  const edit = saved.editing;
  if (!edit || typeof edit !== "object") return;
  if (typeof edit.name === "string")
    $("#planner-name").value = edit.name.slice(0, 100);
  if (typeof edit.timeZone === "string")
    $("#planner-zone").value = edit.timeZone.slice(0, 100);
  const course = edit.course;
  if (course && typeof course === "object") {
    courseId = plan.data.courses.some((c) => c.id === edit.courseId)
      ? edit.courseId
      : null;
    $("#planner-course-title").value =
      typeof course.title === "string" ? course.title.slice(0, 100) : "";
    $("#planner-course-start").value = course.startDate || "";
    $("#planner-course-end").value = course.endDate || "";
    $("#planner-course-color").value = /^#[0-9a-f]{6}$/i.test(course.color)
      ? course.color
      : "#d6b1ec";
    sessions = Array.isArray(course.sessions)
      ? course.sessions
          .slice(0, 14)
          .filter(
            (s) =>
              s &&
              Number.isInteger(s.day) &&
              s.day >= 1 &&
              s.day <= 7 &&
              typeof s.start === "string" &&
              typeof s.end === "string" &&
              typeof s.id === "string",
          )
          .map((s) => ({ id: s.id, day: s.day, start: s.start, end: s.end }))
      : [];
    uiText(
      $("#planner-course-save"),
      courseId ? uiMsg("Save course") : uiMsg("Add course"),
    );
    $("#planner-course-delete").hidden = !courseId;
    uiText(
      $("#planner-course-edit-label"),
      courseId
        ? uiMsg("Recovered course edits · changes save automatically")
        : uiMsg("Recovered unadded course"),
    );
    renderSessions();
  }
  const task = edit.task;
  if (task && typeof task === "object") {
    taskId = plan.data.tasks.some((t) => t.id === edit.taskId)
      ? edit.taskId
      : null;
    $("#planner-task-title").value =
      typeof task.title === "string" ? task.title.slice(0, 200) : "";
    $("#planner-task-type").value =
      task.type === "exam" ? "exam" : "assignment";
    courseChoices(task.courseId || "");
    $("#planner-task-due").value = task.due || "";
    $("#planner-task-done").checked = task.done === true;
    uiText(
      $("#planner-task-save"),
      taskId ? uiMsg("Save task") : uiMsg("Add task"),
    );
    $("#planner-task-delete").hidden = !taskId;
    uiText(
      $("#planner-task-edit-label"),
      taskId
        ? uiMsg("Recovered task edits · changes save automatically")
        : uiMsg("Recovered unadded task"),
    );
  }
  change();
  renderCalendar();
  renderItems();
}

on("planner-new", "click", async () => {
  if (!(await leaveEditor())) return;
  const expected = owner(),
    row = { id: crypto.randomUUID(), revision: 0, data: emptyPlanner() };
  fillPlan(row);
  change({ schedule: false });
  if (expected === owner()) await saveEdits();
  status(uiMsg("New plan. Add courses and deadlines below."));
  $("#planner-name").focus();
});
for (const id of ["planner-name", "planner-zone"])
  on(id, "input", () => change());
for (const id of [
  "planner-course-title",
  "planner-course-start",
  "planner-course-end",
  "planner-course-color",
])
  on(id, "input", () => {
    if (courseId) change();
    else {
      recovery();
      state();
    }
  });
for (const id of [
  "planner-task-title",
  "planner-task-type",
  "planner-task-course",
  "planner-task-due",
  "planner-task-done",
])
  on(
    id,
    id === "planner-task-done" || id.includes("type") || id.includes("course")
      ? "change"
      : "input",
    () => {
      if (taskId) change();
      else {
        recovery();
        state();
      }
    },
  );
on("planner-course-new", "click", async () => {
  if (!(await saveEdits())) return;
  if (
    !courseId &&
    ($("#planner-course-title").value.trim() || sessions.length) &&
    !uiConfirm(uiMsg("Discard this unadded course?"))
  )
    return;
  fillCourse();
  recovery();
  state();
  $("#planner-course-title").focus();
});
on("planner-task-new", "click", async () => {
  if (!(await saveEdits())) return;
  if (
    !taskId &&
    $("#planner-task-title").value.trim() &&
    !uiConfirm(uiMsg("Discard this unadded task?"))
  )
    return;
  fillTask();
  recovery();
  state();
  $("#planner-task-title").focus();
});
on("planner-session-add", "click", () => {
  if (sessions.length >= 14)
    throw Error("A course supports up to 14 weekly class times.");
  const session = {
    id: crypto.randomUUID(),
    day: Number($("#planner-session-day").value),
    start: $("#planner-session-start").value,
    end: $("#planner-session-end").value,
  };
  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(session.start) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(session.end) ||
    session.start >= session.end
  )
    throw Error("Choose a start and later end time on the same day.");
  sessions.push(session);
  renderSessions();
  if (courseId) change();
  else {
    recovery();
    state();
  }
});
on("planner-course-save", "click", async () => {
  if (courseId) {
    if (await saveEdits()) status(uiMsg("Course saved."));
    return;
  }
  const data = readEdits(),
    course = { id: crypto.randomUUID(), ...courseFields() };
  data.courses.push(course);
  plan.data = validatePlanner(data);
  fillCourse(course);
  courseChoices();
  change({ schedule: false });
  await saveEdits();
  renderCalendar();
  renderItems();
});
on("planner-task-save", "click", async () => {
  if (taskId) {
    if (await saveEdits()) status(uiMsg("Task saved."));
    return;
  }
  const data = readEdits(),
    task = { id: crypto.randomUUID(), ...taskFields() };
  data.tasks.push(task);
  plan.data = validatePlanner(data);
  fillTask(task);
  change({ schedule: false });
  await saveEdits();
  renderCalendar();
  renderItems();
});
on("planner-course-delete", "click", async () => {
  if (
    !courseId ||
    !uiConfirm(
      uiMsg(
        "Delete this course and its weekly class times? Linked assignments and exams will remain without a course.",
      ),
    )
  )
    return;
  const data = readEdits(),
    deleted = courseId;
  data.courses = data.courses.filter((c) => c.id !== deleted);
  data.tasks = data.tasks.map((t) =>
    t.courseId === deleted ? { ...t, courseId: null } : t,
  );
  plan.data = validatePlanner(data);
  fillCourse();
  courseChoices();
  if (taskId) fillTask(plan.data.tasks.find((t) => t.id === taskId));
  change({ schedule: false });
  await saveEdits();
  renderCalendar();
  renderItems();
});
on("planner-task-delete", "click", async () => {
  if (!taskId || !uiConfirm(uiMsg("Delete this assignment or exam?"))) return;
  const data = readEdits();
  data.tasks = data.tasks.filter((t) => t.id !== taskId);
  plan.data = validatePlanner(data);
  fillTask();
  change({ schedule: false });
  await saveEdits();
  renderCalendar();
  renderItems();
});
on("planner-task-filter", "change", renderItems);
for (const [id, days] of [
  ["planner-prev", -7],
  ["planner-next", 7],
])
  on(id, "click", () => {
    week = addDays(week, days);
    renderCalendar();
  });
on("planner-today", "click", () => {
  week = monday(today(currentData().timeZone));
  renderCalendar();
});
on("planner-export", "click", async () => {
  await saveEdits();
  const data =
    dirty || hasUnadded() ? snapshot() : validatePlanner(readEdits());
  downloadText(
    JSON.stringify(data, null, 2),
    (plan.data.name || "study-plan") +
      (dirty || hasUnadded() ? "-recovery.json" : ".json"),
    "application/json;charset=utf-8",
  );
  status(
    dirty || hasUnadded()
      ? uiMsg(
          "Recovery backup exported, including the editor fields that have not been saved. Import it to restore those edits.",
        )
      : uiMsg("Study plan exported."),
  );
});
on("planner-import", "change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file || !(await leaveEditor())) return;
  if (file.size > 1000000)
    throw Error("Choose a JSON backup no larger than 1 MB.");
  const expected = owner(),
    text = await file.text();
  if (owner() !== expected) return;
  let input;
  try {
    input = JSON.parse(text);
  } catch {
    throw Error("This file is not valid JSON. Choose a Study Planner backup.");
  }
  const data = validatePlanner(input.plan || input),
    row = { id: crypto.randomUUID(), revision: 0, data };
  fillPlan(row);
  change({ schedule: false });
  await saveEdits();
  if (owner() !== expected) return;
  if (input.format === "kensei-planner-backup") restoreEditing(input);
  status(
    uiJoin([
      uiMsg("Imported as a new plan."),
      input.editing
        ? uiMsg(
            " Recovery editor fields restored; invalid fields remain available to correct.",
          )
        : "",
    ]),
  );
});
on("planner-delete", "click", async () => {
  if (
    !plan ||
    !uiConfirm(
      uiMsg(
        "Delete this study plan? Unexported edits in this plan will also be removed.",
      ),
    )
  )
    return;
  const expected = scope,
    id = plan.id;
  clearTimeout(timer);
  await store.remove(id, expected);
  if (owner() !== expected) return;
  forgetRecovery();
  clearEditor();
  renderList();
  status(uiMsg("Study plan deleted."));
});
on("planner-clear", "click", async () => {
  if (
    !uiConfirm(
      uiMsg(
        "Clear all study plans in the current account? This also deletes synced plans in this account. Export anything you want to keep first.",
      ),
    )
  )
    return;
  const expected = scope;
  clearTimeout(timer);
  await store.clear(expected);
  if (owner() !== expected) return;
  forgetRecovery();
  clearEditor();
  renderList();
  status(uiMsg("Study plans cleared."));
});
on("planner-more", "click", async () => {
  await store.load();
  renderList();
});
on("planner-retry", "click", async () => {
  if (!(await saveEdits())) return;
  await store.flush();
  await store.load(true);
  renderList();
  state();
});
on("planner-copy-account", "click", async () => {
  const expected = owner();
  if (expected === "guest" || !(await leaveEditor())) return;
  const id = $("#planner-guest-plan").value,
    rows = await store.guestRows();
  if (owner() !== expected) return;
  const guest = rows.find((r) => r.id === id);
  if (!guest) throw Error("This guest plan is unavailable.");
  const row = await store.put(
    validatePlanner(guest.data),
    crypto.randomUUID(),
    expected,
  );
  if (owner() !== expected) return;
  fillPlan(row);
  status(
    uiMsg(
      "A private copy was added to this account. The guest original remains on this device.",
    ),
  );
});

async function initialize() {
  const token = ++initializing,
    expected = owner();
  if (scope !== expected) {
    // 旧账号的草稿只留在自己的恢复区，绝不交给新账号的同步队列。
    clearTimeout(timer);
    scope = expected;
    clearEditor();
    $("#planner-guest-plan").replaceChildren();
    $("#planner-guest-copy").hidden = true;
  }
  try {
    await store.ready();
    if (token !== initializing || owner() !== expected) return;
    renderList();
    await store.flush();
    await store.load(true);
    if (token !== initializing || owner() !== expected) return;
    renderList();
    await guestCopies();
    if (plan) return;
    let saved;
    try {
      saved = JSON.parse(sessionStorage.getItem(recoveryKey()) || "null");
    } catch {
      /* Ignore malformed tab recovery data. */
    }
    if (saved && (!requested || requested === saved.id)) {
      try {
        const data = validatePlanner(saved.plan),
          existing = saved.id ? await store.get(saved.id) : null;
        if (owner() !== expected || token !== initializing) return;
        const sameRevision = existing && existing.revision === saved.revision;
        fillPlan({
          ...(sameRevision
            ? existing
            : { id: crypto.randomUUID(), revision: 0 }),
          data,
        });
        restoreEditing(saved);
        status(
          sameRevision
            ? uiMsg(
                "Unsaved edits restored from this tab. Valid changes will save automatically.",
              )
            : uiMsg(
                "Unsaved edits restored as a separate copy, preserving any newer saved plan.",
              ),
        );
        requested = null;
        return;
      } catch {
        status(
          uiMsg(
            "A recovery backup could not be restored. Your saved plans are still available.",
          ),
          true,
        );
      }
    }
    const id = requested || store.rows()[0]?.id;
    requested = null;
    if (id) await open(id);
  } catch (error) {
    status(uiError(error), true);
    state();
  }
}
store.subscribe(() => {
  if (owner() !== scope) return;
  renderList();
  if (plan) {
    const row = store.rows().find((r) => r.id === plan.id);
    if (row && recordSignature(row.data) === lastPersistedSignature) {
      // 同一份本机内容的云端确认只推进版本，不能覆盖仍在表单里的编辑。
      plan.revision = row.revision;
      plan.updated_at = row.updated_at;
    } else if (row && !dirty && !saving && !hasUnadded()) {
      const selectedCourse = courseId,
        selectedTask = taskId,
        currentWeek = week;
      fillPlan(row);
      week = currentWeek;
      if (selectedCourse)
        fillCourse(plan.data.courses.find((c) => c.id === selectedCourse));
      if (selectedTask)
        fillTask(plan.data.tasks.find((t) => t.id === selectedTask));
      renderCalendar();
    }
  }
});
window.addEventListener("workspace-ready", initialize);
window.addEventListener("record-conflict", (event) => {
  if (
    event.detail.kind === "planner" &&
    plan?.id === event.detail.from &&
    owner() === scope
  ) {
    plan.id = event.detail.to;
    plan.revision =
      store.rows().find((row) => row.id === plan.id)?.revision || 0;
    setAddress(plan.id);
    recovery();
    status(
      uiMsg(
        "Another device changed this plan. Your edits were kept in a conflict copy.",
      ),
    );
    renderList();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) saveEdits();
  else if (plan) {
    renderCalendar();
    renderItems();
  }
});
window.addEventListener("beforeunload", (event) => {
  if (dirty || saving || hasUnadded()) {
    recovery();
    event.preventDefault();
    event.returnValue = "";
  }
});
const zones = [
  ...new Set([
    "UTC",
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...(Intl.supportedValuesOf
      ? Intl.supportedValuesOf("timeZone")
      : ["Asia/Kuala_Lumpur", "Europe/London", "America/New_York"]),
  ]),
];
for (const zone of zones.filter(Boolean))
  $("#planner-zones").append(new Option(zone, zone));
setInterval(() => {
  if (!document.hidden && plan) {
    renderCalendar();
    renderItems();
  }
}, 60000);
initialize();

export { store };
