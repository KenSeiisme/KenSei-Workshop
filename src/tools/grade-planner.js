import { $, api, downloadText, status } from "./common.js";
import { button, el, field, row } from "./advanced-ui.js";
import { createRecordStore, recordSignature } from "./record-store.js";
import { validatePlanner } from "./planner-core.js";
import {
  courseGoal,
  gradeAssessment,
  gradeBook,
  gradeCourse,
  gradeTerm,
  validateGradePlan,
  weightedGrade,
} from "./grade-planner-core.js";
import {
  uiConfirm,
  uiError,
  uiFrom,
  uiMsg,
  uiOption,
  uiText,
} from "../site/ui.js";

const store = createRecordStore("grade", validateGradePlan);
const study = createRecordStore("planner", validatePlanner);
const owner = () => api.user?.id || "guest";
let opened = null,
  draft = null,
  termId = null,
  courseId = null,
  dirty = false,
  saving = false;
let scope = owner(),
  readSequence = 0,
  studySequence = 0;
const terms = $("#grade-term"),
  section = $("#grade-course-editor");
const currentTerm = () => draft?.terms.find((term) => term.id === termId);
const currentCourse = () =>
  currentTerm()?.courses.find((course) => course.id === courseId);

function number(value, callback, min = 0, max = 100) {
  const input = el("input", "", {
    type: "number",
    min,
    max,
    step: "any",
    value: value ?? "",
  });
  input.oninput = () => {
    callback(input.value === "" ? null : input.valueAsNumber);
    change();
  };
  return input;
}
function text(value, callback, max = 100) {
  const input = el("input", "", { type: "text", value, maxLength: max });
  input.oninput = () => {
    callback(input.value);
    change();
  };
  return input;
}
function check(value, callback) {
  const input = el("input", "", { type: "checkbox", checked: value });
  input.onchange = () => {
    callback(input.checked);
    change();
  };
  return input;
}
function change() {
  dirty = true;
  uiText($("#grade-sync"), uiMsg("Unsaved changes"));
  renderSummary();
}
function stableNumber(value) {
  return Number.isFinite(value) ? value.toFixed(2).replace(/\.?0+$/, "") : "—";
}
function average(score) {
  return score.gpa === null ? "—" : score.gpa.toFixed(2);
}
function renderSummary() {
  if (!draft) return;
  const current = currentTerm()?.courses || [];
  const all = draft.terms.flatMap((x) => x.courses);
  const items = [
    uiMsg("Semester GPA: {0}", [average(weightedGrade(current, draft.scale))]),
    uiMsg("Cumulative CGPA: {0}", [average(weightedGrade(all, draft.scale))]),
    uiMsg("Projected semester GPA: {0}", [
      average(weightedGrade(current, draft.scale, true)),
    ]),
    uiMsg("Projected CGPA: {0}", [
      average(weightedGrade(all, draft.scale, true)),
    ]),
  ];
  $("#grade-summary").replaceChildren(
    ...items.map((s) => {
      const p = el("p");
      uiText(p, s);
      return p;
    }),
  );
  const goal = $("#grade-goal"),
    course = currentCourse();
  if (!goal || !course) return;
  const result = courseGoal(course);
  uiText(
    goal,
    uiMsg(
      "Earned {0} weighted points · {1}% still available · {2}% allocated",
      [
        stableNumber(result.earned),
        stableNumber(result.remaining),
        stableNumber(result.weights),
      ],
    ),
  );
  const outcome = {
    overweight: () => uiMsg("Total assessment weights exceed 100%."),
    unallocated: () =>
      uiMsg("Allocate assessment weights to 100% to calculate the target."),
    reached: () => uiMsg("The target is already reached."),
    unreachable: () =>
      uiMsg("This target cannot be reached with the remaining weight."),
    needed: () =>
      uiMsg("Average needed on remaining assessments: {0}%", [
        stableNumber(result.required),
      ]),
  };
  uiText($("#grade-outcome"), outcome[result.state]());
}
function drawScale() {
  const panel = $("#grade-scale");
  panel.replaceChildren();
  for (const band of draft.scale) {
    panel.append(
      row(
        field(
          "Minimum score (%)",
          number(band.minimum, (v) => (band.minimum = v)),
        ),
        field(
          "Grade points",
          number(band.points, (v) => (band.points = v), 0, 10),
        ),
        button("Remove grade band", () => {
          draft.scale = draft.scale.filter((x) => x !== band);
          change();
          drawScale();
        }),
      ),
    );
  }
}
function drawCourse() {
  section.replaceChildren();
  const course = currentCourse();
  if (!course) return;
  section.append(
    row(
      field(
        "Course name",
        text(course.name, (v) => (course.name = v)),
      ),
      field(
        "Credits",
        number(course.credits, (v) => (course.credits = v), 0.01),
      ),
      field(
        "Target score (%)",
        number(course.target, (v) => (course.target = v)),
      ),
    ),
    row(
      field(
        "Confirmed final score (%)",
        number(course.confirmed, (v) => (course.confirmed = v)),
      ),
      field(
        "Projected final score (%)",
        number(course.forecast, (v) => (course.forecast = v)),
      ),
    ),
    field(
      "Exclude this course from GPA and CGPA",
      check(course.excluded, (v) => (course.excluded = v)),
    ),
    el("p", "", { id: "grade-goal", class: "muted small" }),
    el("p", "", { id: "grade-outcome", role: "status" }),
    el("h3", "Assessments"),
  );
  course.items.forEach((item) => {
    const box = el("div", "", { class: "grade-assessment" });
    const score = number(item.score, (v) => (item.score = v), 0, 100000);
    score.disabled = item.absent;
    const absence = check(item.absent, (v) => {
      item.absent = v;
      score.disabled = v;
    });
    box.append(
      field(
        "Assessment name",
        text(item.name, (v) => (item.name = v), 200),
      ),
      row(
        field(
          "Weight (%)",
          number(item.weight, (v) => (item.weight = v)),
        ),
        field(
          "Maximum score",
          number(item.max, (v) => (item.max = v), 0.01, 100000),
        ),
        field("Score earned", score),
      ),
      field("Absent (counts as zero)", absence),
      button("Remove assessment", () => {
        course.items = course.items.filter((x) => x !== item);
        change();
        drawCourse();
      }),
    );
    section.append(box);
  });
  section.append(
    row(
      button("Add assessment", () => {
        if (course.items.length >= 30)
          throw Error("Keep up to 30 assessments per course.");
        course.items.push(gradeAssessment());
        change();
        drawCourse();
      }),
      button("Remove course", () => {
        const term = currentTerm();
        if (!uiConfirm(uiMsg("Delete {0}?", [course.name]))) return;
        term.courses = term.courses.filter((x) => x !== course);
        courseId = term.courses[0]?.id;
        change();
        drawTerm();
      }),
    ),
  );
  renderSummary();
}

function drawTerm() {
  const box = $("#grade-term-editor");
  box.replaceChildren();
  terms.replaceChildren(
    ...draft.terms.map((term) => new Option(term.name, term.id)),
  );
  terms.value = termId || "";
  const term = currentTerm();
  $("#grade-study-panel").hidden = !term;
  section.replaceChildren();
  if (!term) {
    renderSummary();
    return;
  }
  const courseSelect = el("select");
  courseSelect.append(
    ...term.courses.map((course) => new Option(course.name, course.id)),
  );
  courseSelect.value = courseId || "";
  courseSelect.onchange = () => {
    courseId = courseSelect.value;
    drawCourse();
  };
  box.append(
    row(
      field(
        "Semester name",
        text(term.name, (v) => (term.name = v)),
      ),
      field("Course", courseSelect),
      button("Add course", () => {
        if (term.courses.length >= 40)
          throw Error("Keep up to 40 courses per semester.");
        const course = gradeCourse();
        term.courses.push(course);
        courseId = course.id;
        change();
        drawTerm();
      }),
      button("Remove semester", () => {
        if (!uiConfirm(uiMsg("Delete {0}?", [term.name]))) return;
        draft.terms = draft.terms.filter((x) => x !== term);
        termId = draft.terms[0]?.id;
        courseId = draft.terms[0]?.courses[0]?.id;
        change();
        drawTerm();
      }),
    ),
  );
  drawCourse();
  renderSummary();
}
const savedName = () => opened?.data?.name;
function paintEditor() {
  $("#grade-editor").hidden = !draft;
  if (!draft) return;
  $("#grade-name").value = draft.name;
  $("#grade-delete").hidden = !opened;
  drawScale();
  drawTerm();
}
function open(row) {
  const url = new URL(location.href);
  url.searchParams.set("id", row.id);
  history.replaceState(null, "", url);
  opened = row;
  draft = structuredClone(row.data);
  termId = draft.terms.find((t) => t.id === termId)?.id || draft.terms[0]?.id;
  courseId =
    currentTerm()?.courses.find((c) => c.id === courseId)?.id ||
    currentTerm()?.courses[0]?.id;
  dirty = false;
  $("#grade-study-panel").open = false;
  paintEditor();
  uiText($("#grade-sync"), uiFrom(store.saveState()));
}
function canReplace() {
  return (
    !saving && (!dirty || uiConfirm(uiMsg("Discard unsaved grade changes?")))
  );
}
function report(error) {
  status(uiError(error), true);
}
function run(selector, handler) {
  $(selector).onclick = () => Promise.resolve().then(handler).catch(report);
}
function listRecords() {
  const records = store.rows();
  const latest = records.find((record) => record.id === opened?.id);
  if (!saving && opened && draft && latest?.revision > opened.revision) {
    if (recordSignature(latest.data) === recordSignature(opened.data))
      opened = latest;
    else if (!dirty) open(latest);
  }
  const list = $("#grade-saved");
  list.replaceChildren();
  for (const record of records) {
    const b = button("", () => {
      if (canReplace()) open(record);
    });
    b.textContent = record.data.name;
    list.append(b);
  }
  if (!dirty) uiText($("#grade-sync"), uiFrom(store.saveState()));
  $("#grade-more").hidden = !store.hasMore();
}
run("#grade-new", () => {
  if (!canReplace()) return;
  opened = null;
  draft = gradeBook();
  termId = draft.terms[0].id;
  courseId = null;
  change();
  paintEditor();
});
run("#grade-save", async () => {
  if (!draft || saving) return;
  const id = opened?.id,
    expected = owner(),
    current = draft;
  const data = validateGradePlan(current);
  const signature = JSON.stringify(current);
  saving = true;
  $("#grade-save").disabled = true;
  try {
    const next = await store.put(data, id, expected, opened?.revision);
    if (expected !== owner() || draft !== current) return;
    if (JSON.stringify(current) === signature) open(next);
    else opened = next;
    history.replaceState(
      null,
      "",
      location.pathname + "?id=" + encodeURIComponent(next.id),
    );
    status(uiMsg("Grade plan saved."));
  } finally {
    saving = false;
    $("#grade-save").disabled = false;
  }
});
run("#grade-delete", async () => {
  if (!opened || saving || !uiConfirm(uiMsg("Delete {0}?", [savedName()])))
    return;
  const identity = owner(),
    id = opened.id;
  await store.remove(id, identity);
  if (owner() === identity && opened?.id === id) {
    opened = draft = null;
    dirty = false;
    paintEditor();
    history.replaceState(null, "", location.pathname);
  }
});
run("#grade-export", () => {
  downloadText(
    JSON.stringify(validateGradePlan(draft)),
    "kensei-grade-plan.json",
    "application/json",
  );
});
$("#grade-name").oninput = () => {
  draft.name = $("#grade-name").value;
  change();
};
terms.onchange = () => {
  termId = terms.value;
  courseId = currentTerm()?.courses[0]?.id;
  drawTerm();
};
run("#grade-term-add", () => {
  if (draft.terms.length >= 24)
    throw Error("Keep up to 24 semesters in a grade plan.");
  const term = gradeTerm("Semester " + (draft.terms.length + 1));
  draft.terms.push(term);
  termId = term.id;
  courseId = null;
  change();
  drawTerm();
});
run("#grade-scale-add", () => {
  if (draft.scale.length >= 30) throw Error("Keep up to 30 grade bands.");
  const minimum = Array.from({ length: 101 }, (_, i) => i).find(
    (x) => !draft.scale.some((row) => row.minimum === x),
  );
  draft.scale.push({ minimum, points: 0 });
  change();
  drawScale();
});
$("#grade-import").onchange = async ({ target }) => {
  const file = target.files[0];
  target.value = "";
  if (!file || !canReplace()) return;
  const identity = owner();
  try {
    if (file.size > 500000) throw Error("Grade plans may use up to 500 KB.");
    const parsed = validateGradePlan(JSON.parse(await file.text()));
    if (identity !== owner()) return;
    opened = null;
    draft = parsed;
    termId = draft.terms[0]?.id;
    courseId = draft.terms[0]?.courses[0]?.id;
    change();
    paintEditor();
  } catch (error) {
    report(error);
  }
};
$("#grade-copy").ontoggle = async () => {
  const host = $("#grade-guest-list"),
    identity = owner();
  if (!$("#grade-copy").open || identity === "guest") return;
  try {
    const rows = await store.guestRows();
    if (identity !== owner()) return;
    host.replaceChildren();
    for (const record of rows) {
      const b = button("", async () => {
        if (
          identity !== owner() ||
          !canReplace() ||
          !uiConfirm(uiMsg("Copy {0} to your account?", [record.data.name]))
        )
          return;
        const copied = await store.put(record.data, undefined, identity);
        if (identity === owner()) open(copied);
      });
      b.textContent = record.data.name;
      host.append(b);
    }
    if (!rows.length) uiText(host, uiMsg("No guest grade plans."));
  } catch (error) {
    report(error);
  }
};

async function studyChoices() {
  const host = $("#grade-study"),
    seq = ++studySequence,
    identity = owner();
  const target = currentTerm(),
    sourceDraft = draft;
  if (!$("#grade-study-panel").open || !target) return;
  uiText(host, uiMsg("Loading study plans…"));
  await study.ready();
  await study.load(true);
  if (seq !== studySequence || identity !== owner()) return;
  host.replaceChildren();
  const plans = study.rows(),
    plan = el("select"),
    choices = el("div");
  plan.append(...plans.map((p) => new Option(p.data.name, p.id)));
  const pick = () => {
    choices.replaceChildren();
    const data = plans.find((x) => x.id === plan.value)?.data;
    if (!data) return;
    const course = el("select"),
      assessments = el("div");
    course.append(...data.courses.map((c) => new Option(c.title, c.id)));
    const items = [];
    const draw = () => {
      items.length = 0;
      assessments.replaceChildren();
      for (const task of data.tasks.filter(
        (t) => t.courseId === course.value,
      )) {
        const input = el("input", "", { type: "checkbox", checked: true }),
          label = el("label");
        label.append(input, document.createTextNode(task.title));
        items.push({ input, task });
        assessments.append(label);
      }
    };
    course.onchange = draw;
    draw();
    choices.append(
      field("Course to copy", course),
      assessments,
      button("Copy selected course and assessments", () => {
        if (
          identity !== owner() ||
          sourceDraft !== draft ||
          currentTerm() !== target
        )
          return;
        const selected = data.courses.find((c) => c.id === course.value);
        if (!selected) return;
        const allowed = items.filter((x) => x.input.checked);
        if (target.courses.length >= 40 || allowed.length > 30)
          throw Error(
            "Copy into a semester with room for the course and up to 30 assessments.",
          );
        if (
          !uiConfirm(
            uiMsg("Copy {0} and {1} assessments?", [
              selected.title,
              allowed.length,
            ]),
          )
        )
          return;
        const next = gradeCourse(selected.title);
        next.items = allowed.map(({ task }) => gradeAssessment(task.title));
        target.courses.push(next);
        courseId = next.id;
        change();
        drawTerm();
        $("#grade-study-panel").open = false;
      }),
    );
  };
  if (!plans.length) {
    uiText(host, uiMsg("No study plans are available."));
    return;
  }
  plan.onchange = pick;
  pick();
  host.append(
    field("Study plan", plan),
    choices,
    button("Load more study plans", async (b) => {
      if (!study.hasMore()) return;
      await study.load();
      for (const extra of study.rows())
        if (!plans.some((x) => x.id === extra.id)) {
          plans.push(extra);
          plan.add(new Option(extra.data.name, extra.id));
        }
      b.hidden = !study.hasMore();
    }),
  );
  host.lastElementChild.hidden = !study.hasMore();
}
$("#grade-study-panel").ontoggle = () => studyChoices().catch(report);
async function refresh() {
  const next = owner(),
    seq = ++readSequence;
  if (next !== scope) {
    scope = next;
    opened = draft = null;
    dirty = false;
    termId = courseId = null;
    listRecords();
    paintEditor();
    $("#grade-guest-list").replaceChildren();
    $("#grade-copy").open = false;
    $("#grade-study").replaceChildren();
  }
  $("#grade-copy").hidden = next === "guest";
  await store.ready();
  if (seq !== readSequence || owner() !== next) return;
  listRecords();
  await store.load(true);
  if (seq !== readSequence || owner() !== next) return;
  const requested = new URLSearchParams(location.search).get("id");
  if (requested && !draft) {
    const record = await store.get(requested);
    if (seq === readSequence && owner() === next && !draft && record)
      open(record);
  }
}
run("#grade-more", () => store.load());
run("#grade-retry", async () => {
  await store.flush();
  await refresh();
});
store.subscribe(listRecords);
window.addEventListener("workspace-ready", () => refresh().catch(report));
window.addEventListener("record-conflict", ({ detail }) => {
  if (
    detail.kind !== "grade" ||
    opened?.id !== detail.from ||
    scope !== owner()
  )
    return;
  const row = store.rows().find((x) => x.id === detail.to);
  opened = row || { ...opened, id: detail.to };
  history.replaceState(
    null,
    "",
    location.pathname + "?id=" + encodeURIComponent(detail.to),
  );
  uiText(
    $("#grade-sync"),
    uiMsg("A conflicting edit was kept as a separate grade plan."),
  );
  status(uiMsg("A conflicting edit was kept as a separate grade plan."));
});
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
refresh().catch(report);
