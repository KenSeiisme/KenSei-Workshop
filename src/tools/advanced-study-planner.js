import { uiMsg, uiText, uiOption, uiJoin } from "../site/ui.js";
import { $, downloadText } from "./common.js";
import { el, panel, row, button, field, select } from "./advanced-ui.js";
import { calendar, plannerEvents } from "./calendar-export.js";
import { dueEpoch, today, addDays } from "./planner-core.js";
export function init() {
  const ctx = window.KenseiAdvancedContexts["study-planner"],
    p = panel("Plan overview", $("#planner-tasks").closest(".panel"));
  const course = select([["", "All courses"]]),
    deadline = select([
      ["all", "All deadlines"],
      ["week", "Next seven days"],
      ["overdue", "Overdue"],
    ]),
    out = el("div");
  p.append(
    row(field("Course", course), field("Deadline", deadline)),
    out,
    button("Export calendar (.ics)", async () => {
      await ctx.saveEdits();
      if (!ctx.plan) throw Error("Create or open a plan first.");
      downloadText(
        calendar(plannerEvents(ctx.plan.data)),
        "kensei-study-plan.ics",
        "text/calendar;charset=utf-8",
      );
    }),
  );
  function render() {
    const plan = ctx.plan?.data;
    out.replaceChildren();
    if (!plan) return;
    const prior = course.value;
    course.replaceChildren(uiOption(uiMsg("All courses"), ""));
    for (const c of plan.courses) course.add(new Option(c.title, c.id));
    course.value = prior;
    const now = Date.now(),
      end = dueEpoch(
        addDays(today(plan.timeZone), 7) + "T23:59",
        plan.timeZone,
      );
    for (const task of plan.tasks
      .filter((t) => !t.done && (!course.value || t.courseId === course.value))
      .sort((a, b) => a.due.localeCompare(b.due))) {
      const epoch = dueEpoch(task.due, plan.timeZone);
      if (deadline.value === "week" && (epoch < now || epoch > end)) continue;
      if (deadline.value === "overdue" && epoch >= now) continue;
      const line = el("p");
      uiText(
        line,
        uiJoin([
          task.title + " · " + task.due.replace("T", " ") + " · ",
          task.type === "exam"
            ? uiMsg("{0} days", [Math.ceil((epoch - now) / 86400000)])
            : "",
        ]),
      );
      out.append(line);
    }
    if (!out.children.length) out.append(el("p", "No tasks in this view."));
  }
  course.onchange = deadline.onchange = render;
  let scheduled;
  new MutationObserver(() => {
    clearTimeout(scheduled);
    scheduled = setTimeout(render, 100);
  }).observe($("#planner-tasks"), { childList: true });
  ctx.store.subscribe(render);
  window.addEventListener("workspace-ready", render);
  render();
}
