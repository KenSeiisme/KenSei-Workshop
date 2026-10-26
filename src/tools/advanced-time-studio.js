import { uiMsg, uiRender } from "../site/ui.js";
import { $, downloadText } from "./common.js";
import { Temporal as T } from "../vendor/temporal.js";
import { calendar } from "./calendar-export.js";
import { el, panel, row, button, field, renderTable } from "./advanced-ui.js";
export function init() {
  const ctx = window.KenseiAdvancedContexts["time-studio"],
    p = panel("Meeting planner", $("#time-date").closest("section"));
  const date = el("input", "", {
      type: "datetime-local",
      value: new Date().toISOString().slice(0, 16),
    }),
    zone = el("input", "", {
      value: Intl.DateTimeFormat().resolvedOptions().timeZone,
      list: "time-zones",
    }),
    name = el("input", "", { value: uiRender(uiMsg("Meeting")) }),
    minutes = el("input", "", { type: "number", min: 5, max: 1440, value: 60 }),
    out = el("div");
  let windows = new Map();
  p.append(
    row(
      field("Meeting time", date),
      field("Source time zone", zone),
      field("Duration (minutes)", minutes),
      field("Event name", name),
    ),
    out,
    button("Update timeline", render),
    button("Export event (.ics)", () => {
      const start = epoch();
      downloadText(
        calendar([
          {
            id: crypto.randomUUID(),
            title: name.value || uiRender(uiMsg("Meeting")),
            start,
            end: start + duration() * 60000,
          },
        ]),
        "kensei-meeting.ics",
        "text/calendar",
      );
    }),
  );
  function duration() {
    const n = Number(minutes.value);
    if (!Number.isInteger(n) || n < 5 || n > 1440)
      throw Error("Choose 5–1,440 minutes.");
    return n;
  }
  function epoch() {
    const plain = T.PlainDateTime.from(date.value),
      z = plain.toZonedDateTime(zone.value, { disambiguation: "reject" });
    return Number(z.epochMilliseconds);
  }
  function render() {
    const instant = epoch(),
      length = duration();
    out.replaceChildren();
    let all = true;
    for (const z of ctx.zones) {
      const win = windows.get(z) || ["09:00", "17:00"];
      windows.set(z, win);
      const start = el("input", "", { type: "time", value: win[0] }),
        end = el("input", "", { type: "time", value: win[1] });
      start.onchange = () => {
        win[0] = start.value;
        render();
      };
      end.onchange = () => {
        win[1] = end.value;
        render();
      };
      const a = T.Instant.fromEpochMilliseconds(instant).toZonedDateTimeISO(z),
        b = T.Instant.fromEpochMilliseconds(
          instant + length * 60000,
        ).toZonedDateTimeISO(z),
        at = a.toPlainTime().toString().slice(0, 5),
        bt = b.toPlainTime().toString().slice(0, 5),
        fits =
          win[0] < win[1] &&
          a.toPlainDate().equals(b.toPlainDate()) &&
          at >= win[0] &&
          bt <= win[1];
      all &&= fits;
      const title = el("strong");
      title.textContent =
        z + " · " + String(a.toPlainDate()) + " " + at + "–" + bt;
      out.append(
        row(
          title,
          field("Work starts", start),
          field("Work ends", end),
          el("span", fits ? "Within work hours" : "Outside work hours"),
        ),
      );
      const bar = el("div", "", { class: "meeting-timeline", "aria-label": z });
      for (let h = 0; h < 24; h++) {
        const tick = el("span");
        tick.textContent = String(h);
        tick.classList.toggle(
          "available",
          h >= Number(win[0].slice(0, 2)) && h < Number(win[1].slice(0, 2)),
        );
        tick.classList.toggle("selected", h === a.hour);
        bar.append(tick);
      }
      out.append(bar);
    }
    out.prepend(
      el(
        "p",
        all
          ? "All time zones overlap within work hours."
          : "No full overlap for the selected time.",
      ),
    );
  }
  render();
}
