import { Temporal as T } from "../vendor/temporal.js";
export const icsEscape = (s) =>
  String(s)
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
export function stamp(epoch) {
  return new Date(epoch)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}
export function calendar(events) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//KenSei Workshop//Calendar//EN",
    "CALSCALE:GREGORIAN",
    ...events.flatMap((e) => [
      "BEGIN:VEVENT",
      "UID:" + e.id + "@kensei-workshop",
      "DTSTAMP:" + stamp(Date.now()),
      "DTSTART:" + stamp(e.start),
      "DTEND:" + stamp(e.end),
      "SUMMARY:" + icsEscape(e.title),
      ...(e.description ? ["DESCRIPTION:" + icsEscape(e.description)] : []),
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ];
  // 每行按 UTF-8 字节折行，不能切断中文字元。
  return (
    lines
      .map((line) => {
        let out = "",
          n = 0;
        for (const c of line) {
          const bytes = new TextEncoder().encode(c).length;
          if (n + bytes > 73) {
            out += "\r\n ";
            n = 1;
          }
          out += c;
          n += bytes;
        }
        return out;
      })
      .join("\r\n") + "\r\n"
  );
}
export function plannerEvents(plan) {
  const out = [],
    zone = plan.timeZone;
  for (const c of plan.courses)
    for (const s of c.sessions) {
      let day = T.PlainDate.from(c.startDate),
        end = T.PlainDate.from(c.endDate);
      day = day.add({ days: (s.day - day.dayOfWeek + 7) % 7 });
      // 使用各次当地日期解析，跨夏令时仍维持课程的当地时间。
      for (; T.PlainDate.compare(day, end) <= 0; day = day.add({ days: 7 })) {
        const at = (time) =>
          Number(
            T.PlainDateTime.from(String(day) + "T" + time).toZonedDateTime(
              zone,
              { disambiguation: "compatible" },
            ).epochMilliseconds,
          );
        out.push({
          id: s.id + "-" + String(day),
          start: at(s.start),
          end: at(s.end),
          title: c.title,
          description: zone,
        });
        if (out.length > 20000)
          throw Error(
            "Calendar export is too large. Shorten the course date range.",
          );
      }
    }
  for (const task of plan.tasks) {
    const start = Number(
      T.PlainDateTime.from(task.due).toZonedDateTime(zone, {
        disambiguation: "earlier",
      }).epochMilliseconds,
    );
    out.push({
      id: task.id,
      start,
      end: start + 900000,
      title: task.title,
      description: task.type + " · " + zone,
    });
  }
  return out;
}
