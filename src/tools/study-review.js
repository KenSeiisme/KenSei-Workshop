import { $, api, status } from "./common.js";
import { button, el, field, panel, row } from "./advanced-ui.js";
import { uiError, uiMsg, uiOption, uiText } from "../site/ui.js";
import * as decks from "./flashcard-store.js";
import { cardDue } from "./flashcard-core.js";
import { addDays, today, dueEpoch } from "./planner-core.js";
import { distributeReview } from "./review-plan-core.js";

const identity = () => api.user?.id || "guest";
const localePath = (path) => window.KenseiI18n?.localePath(path) || path;
const weekdays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export function initReview(ctx) {
  const todayPanel = panel(
    "Review today",
    $(".planner-layout") || $("#planner-tasks").closest(".panel"),
  );
  const todayItems = el("div"),
    todayNote = el("p", "", { role: "status", class: "muted small" });
  todayPanel.append(todayNote, todayItems);
  const planner = panel("Schedule revision", todayPanel);
  const exam = el("select"),
    topics = el("textarea", "", { rows: 4, maxLength: 5000 });
  const limit = el("input", "", { type: "number", min: 1, max: 6, value: "2" });
  const slots = row(
    ...weekdays.map((name, i) =>
      field(name, el("input", "", { type: "checkbox", checked: i < 5 })),
    ),
  );
  const planOutput = el("div"),
    note = el("p", "", { role: "status", class: "muted small" });
  const preview = button("Preview schedule", previewSchedule, true);
  const add = button("Add review sessions", confirmSchedule, true);
  add.hidden = true;
  planner.append(
    field("Exam to prepare for", exam),
    field("Review topics, one per line", topics),
    field("Maximum sessions per day", limit),
    el("p", "Available weekdays"),
    slots,
    row(preview, add),
    note,
    planOutput,
  );
  const dayInputs = [...slots.querySelectorAll("input")];
  let batch = null,
    lastContext = null,
    examSignature = "",
    generation = 0,
    loading = false;
  const weekdayValues = () =>
    dayInputs.flatMap((x, i) => (x.checked ? [i + 1] : []));
  const clearPreview = () => {
    batch = null;
    add.hidden = true;
    planOutput.replaceChildren();
    uiText(note, "");
  };
  for (const input of [topics, limit, exam, ...dayInputs])
    input.addEventListener("input", clearPreview);
  function currentExams() {
    return (
      ctx.plan?.data.tasks.filter((t) => t.type === "exam" && !t.done) || []
    );
  }
  function updateExams() {
    const key = identity() + ":" + (ctx.plan?.id || "");
    if (lastContext !== key) {
      lastContext = key;
      clearPreview();
      topics.value = "";
    }
    const before = exam.value;
    const exams = currentExams();
    const signature = JSON.stringify([key, exams]);
    preview.disabled = !exams.length;
    if (examSignature === signature) return;
    examSignature = signature;
    exam.replaceChildren(uiOption(uiMsg("Choose an exam"), ""));
    for (const task of exams)
      exam.add(
        new Option(task.title + " · " + task.due.replace("T", " "), task.id),
      );
    if (exams.some((t) => t.id === before)) exam.value = before;
    preview.disabled = !exams.length;
  }
  async function previewSchedule() {
    if (!(await ctx.saveEdits())) return;
    const active = ctx.plan;
    const selected = currentExams().find((t) => t.id === exam.value);
    if (!active || !selected) throw Error("Choose an unfinished exam.");
    const zone = active.data.timeZone,
      now = Date.now(),
      start = today(zone, now);
    const examDay = selected.due.slice(0, 10);
    if (examDay > addDays(start, 366))
      throw Error("Choose an exam within the next 366 days.");
    const available = weekdayValues(),
      max = Number(limit.value);
    if (!available.length || !Number.isInteger(max) || max < 1 || max > 6)
      throw Error("Select available weekdays and use 1 to 6 sessions per day.");
    const items = topics.value
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (
      !items.length ||
      items.length > 60 ||
      items.some((x) => [...x].length > 200)
    )
      throw Error("Enter 1 to 60 topics, up to 200 characters each.");
    clearPreview();
    const eveningTimes = [
      "18:00",
      "19:00",
      "20:00",
      "21:00",
      "22:00",
      "23:00",
      "23:59",
    ];
    const firstTime = eveningTimes.find((time) => {
      try {
        return dueEpoch(start + "T" + time, zone) > now;
      } catch {
        return false;
      }
    });
    const first = firstTime ? start : addDays(start, 1);
    const result = distributeReview(items, first, examDay, available, max);
    const entries = result.scheduled.map(({ title, day }) => {
      const input = el("input", "", {
        type: "datetime-local",
        value: day + "T" + (day === start ? firstTime : "18:00"),
      });
      const entry = el("label"),
        name = el("span");
      name.textContent = title;
      entry.append(name, input);
      planOutput.append(entry);
      return { id: crypto.randomUUID(), title, input };
    });
    if (result.unscheduled.length) {
      const missing = el("ul");
      for (const title of result.unscheduled) {
        const item = el("li");
        item.textContent = title;
        missing.append(item);
      }
      planOutput.append(
        el("p", "Topics without an available session"),
        missing,
      );
    }
    uiText(
      note,
      uiMsg("{0} scheduled · {1} unscheduled · {2}", [
        entries.length,
        result.unscheduled.length,
        zone,
      ]),
    );
    batch = {
      owner: identity(),
      planId: active.id,
      examId: selected.id,
      zone,
      examDue: selected.due,
      weekdays: available,
      limit: max,
      entries,
    };
    add.hidden = !entries.length;
  }
  async function confirmSchedule() {
    const current = batch;
    if (!current || add.disabled) return;
    add.disabled = preview.disabled = true;
    try {
      const entries = current.entries.map(({ id, title, input }) => ({
        id,
        title,
        due: input.value,
      }));
      await ctx.addReviewTasks(current, entries);
      if (current === batch) {
        clearPreview();
        uiText(note, uiMsg("{0} review sessions added.", [entries.length]));
      }
    } finally {
      add.disabled = false;
      updateExams();
      renderToday();
    }
  }
  function link(label, path) {
    const a = el("a", "", {
      href: localePath(path),
      class: "button secondary",
    });
    uiText(a, label);
    return a;
  }
  function todayRow(title, detail, action) {
    const group = row(),
      name = el("strong"),
      meta = el("small");
    name.textContent = title;
    uiText(meta, detail);
    group.classList.add("review-today-row");
    const copy = el("div");
    copy.append(name, meta);
    group.append(copy, action);
    return group;
  }
  function renderToday() {
    if (!api.ready) return;
    const now = Date.now(),
      plans = new Map(ctx.store.rows().map((p) => [p.id, p]));
    if (ctx.plan) plans.set(ctx.plan.id, ctx.plan);
    const next = document.createDocumentFragment();
    const tasks = [...plans.values()]
      .flatMap((p) => {
        const day = today(p.data.timeZone, now);
        return p.data.tasks
          .filter((t) => !t.done && t.due.slice(0, 10) <= day)
          .map((task) => ({
            p,
            task,
            epoch: dueEpoch(task.due, p.data.timeZone),
          }));
      })
      .sort((a, b) => a.epoch - b.epoch);
    if (tasks.length) next.append(el("h3", "Due and overdue tasks"));
    for (const { p, task } of tasks) {
      const query = new URLSearchParams({ plan: p.id, task: task.id });
      next.append(
        todayRow(
          task.title,
          p.data.name +
            " · " +
            task.due.replace("T", " ") +
            " · " +
            p.data.timeZone,
          link(uiMsg("Open Focus Timer"), "/tools/focus-timer/?" + query),
        ),
      );
    }
    const dueDecks = decks
      .rows()
      .map((d) => ({
        d,
        count: d.data.cards.filter((c) => cardDue(c, now)).length,
      }))
      .filter((x) => x.count);
    if (dueDecks.length) next.append(el("h3", "Flashcards due"));
    for (const { d, count } of dueDecks) {
      const query = new URLSearchParams({ deck: d.id, review: "due" });
      next.append(
        todayRow(
          d.data.name,
          uiMsg("{0} cards due", [count]),
          link(uiMsg("Open review queue"), "/tools/flashcards/?" + query),
        ),
      );
    }
    if (!next.children.length)
      next.append(el("p", "No tasks or flashcards are due."));
    todayItems.replaceChildren(next);
  }
  async function reload() {
    const token = ++generation,
      owner = identity();
    loading = true;
    todayItems.replaceChildren();
    updateExams();
    uiText(todayNote, uiMsg("Loading today’s review…"));
    const result = await Promise.allSettled([
      ctx.store.exportRows(),
      decks.exportRows(),
    ]);
    if (token !== generation || owner !== identity()) return;
    loading = false;
    renderToday();
    uiText(
      todayNote,
      result.some((x) => x.status === "rejected")
        ? uiMsg("Showing records available on this device.")
        : "",
    );
  }
  const refreshToday = () => {
    if (!loading) renderToday();
  };
  ctx.store.subscribe(() => {
    updateExams();
    refreshToday();
  });
  decks.subscribe(refreshToday);
  const observer = new MutationObserver(() => {
    updateExams();
    refreshToday();
  });
  observer.observe($("#planner-tasks"), { childList: true });
  window.addEventListener("workspace-ready", reload);
  window.addEventListener("online", reload);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshToday();
  });
  setInterval(() => {
    if (!document.hidden) refreshToday();
  }, 60000);
  reload().catch((error) => status(uiError(error), true));
}
