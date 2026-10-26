import { $, api } from "./common.js";
import { createRecordStore } from "./record-store.js";
import { validatePlanner } from "./planner-core.js";
import { el, panel, row, button, field, select } from "./advanced-ui.js";
import { uiMsg, uiText, uiOption } from "../site/ui.js";
export function init() {
  const store = createRecordStore("planner", validatePlanner),
    p = panel("Focus task and weekly progress", $(".timer-panel")),
    task = select([["", "No task label"]]),
    summary = el("p"),
    done = button("Mark selected task complete", async () => {
      const tag = completedTag;
      if (!tag || tag.owner !== (api.user?.id || "guest")) return;
      const plan = await store.get(tag.planId);
      if (tag.owner !== (api.user?.id || "guest")) return;
      if (!plan) throw Error("This plan is unavailable.");
      await store.put(
        {
          ...plan.data,
          tasks: plan.data.tasks.map((t) =>
            t.id === tag.taskId ? { ...t, done: true } : t,
          ),
        },
        plan.id,
        tag.owner,
      );
      done.hidden = true;
      await refresh();
    });
  let completedTag = null,
    available = new Map(),
    gen = 0;
  done.hidden = true;
  p.append(
    field("Task for this focus session", task),
    summary,
    done,
    button("Refresh plans", () => refresh()),
  );
  task.onchange = () => {
    window.KenseiFocusTag = available.get(task.value) || null;
  };
  async function refresh() {
    const token = ++gen,
      owner = api.user?.id || "guest";
    await store.ready();
    await store.load(true);
    if (token !== gen || owner !== (api.user?.id || "guest")) return;
    available.clear();
    const prev = task.value;
    task.replaceChildren(uiOption(uiMsg("No task label"), ""));
    for (const plan of store.rows())
      for (const t of plan.data.tasks.filter((t) => !t.done)) {
        const key = plan.id + ":" + t.id;
        available.set(key, {
          owner,
          planId: plan.id,
          taskId: t.id,
          title: t.title,
        });
        task.add(new Option(plan.data.name + " · " + t.title, key));
      }
    task.value = available.has(prev) ? prev : "";
    task.onchange();
    const start = new Date();
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    start.setHours(0, 0, 0, 0);
    const minutes = api
      .items("session")
      .filter((s) => Date.parse(s.data.completedAt) >= +start)
      .reduce((n, s) => n + Number(s.data.minutes || 0), 0);
    uiText(summary, uiMsg("{0} minutes completed this week", [minutes]));
  }
  window.addEventListener("focus-completed", (e) => {
    completedTag = e.detail.task;
    done.hidden = !completedTag;
    refresh().catch(() => {});
  });
  window.addEventListener("workspace-ready", () => {
    completedTag = null;
    done.hidden = true;
    window.KenseiFocusTag = null;
    refresh().catch(() => {});
  });
  refresh().catch(() => {
    uiText(summary, uiMsg("Plans could not load. Retry when connected."));
  });
}
