import { $, copy } from "./common.js";
import { Temporal as T } from "/vendor/temporal.js";
import { moments, dateDays } from "./time-core.js";
import { uiMsg, uiJoin, uiError, uiText, uiAttr } from "../site/ui.js";

const deviceZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kuala_Lumpur",
  key = "kensei-time-studio-v1";
const zoneValid = (zone) => {
  try {
    new Intl.DateTimeFormat(globalThis.KenseiI18n?.getLocale() || "en", {
      timeZone: zone,
    }).format();
    return true;
  } catch {
    return false;
  }
};
let data = {
    zones: [
      ...new Set([
        deviceZone,
        "Asia/Kuala_Lumpur",
        "Europe/London",
        "America/New_York",
        "Asia/Tokyo",
      ]),
    ],
    format: "24",
    countdowns: [],
  },
  choices = [];
try {
  const saved = JSON.parse(localStorage.getItem(key));
  if (saved) {
    data.zones = Array.isArray(saved.zones)
      ? saved.zones.filter(zoneValid).slice(0, 8)
      : data.zones;
    data.format = saved.format === "12" ? "12" : "24";
    data.countdowns = Array.isArray(saved.countdowns)
      ? saved.countdowns
          .filter(
            (x) =>
              x &&
              typeof x.id === "string" &&
              typeof x.name === "string" &&
              Number.isFinite(x.target) &&
              zoneValid(x.zone),
          )
          .slice(0, 20)
      : [];
  }
} catch {}
function save() {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    uiText(
      $("#time-notice"),
      uiMsg(
        "This browser could not save settings. Your current page still works.",
      ),
    );
  }
}
const zones = Intl.supportedValuesOf
  ? Intl.supportedValuesOf("timeZone")
  : [
      deviceZone,
      "Asia/Kuala_Lumpur",
      "Europe/London",
      "America/New_York",
      "Asia/Tokyo",
      "UTC",
    ];
for (const name of [...new Set(["UTC", ...zones])])
  $("#time-zones").append(new Option(name, name));
$("#clock-zone").value = $("#time-from").value = deviceZone;
$("#time-format").value = data.format;
const now = T.Now.zonedDateTimeISO(deviceZone);
$("#time-date").value = $("#date-start").value = now.toPlainDate().toString();
$("#date-end").value = now.toPlainDate().add({ days: 1 }).toString();
$("#time-value").value = now.toPlainTime().toString({ smallestUnit: "second" });
function clock() {
  const container = $("#world-clocks"),
    signature = data.zones.join("|");
  if (container.dataset.zones === signature) {
    data.zones.forEach((zone, i) => {
      const card = container.children[i];
      uiText(
        card.querySelector("strong"),
        new Intl.DateTimeFormat(
          globalThis.KenseiI18n?.getLocale() === "zh-Hant"
            ? "zh-Hant"
            : "en-GB",
          {
            timeZone: zone,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: data.format === "12",
          },
        ).format(new Date()),
      );
      uiText(
        card.querySelector("small"),
        new Intl.DateTimeFormat(
          globalThis.KenseiI18n?.getLocale() === "zh-Hant"
            ? "zh-Hant"
            : "en-GB",
          {
            timeZone: zone,
            weekday: "short",
            day: "numeric",
            month: "short",
            year: "numeric",
          },
        ).format(new Date()),
      );
    });
    return;
  }
  container.dataset.zones = signature;
  container.replaceChildren();
  for (const zone of data.zones) {
    const card = document.createElement("div");
    card.className = "metric-card";
    const name = document.createElement("span"),
      time = document.createElement("strong"),
      day = document.createElement("small"),
      remove = document.createElement("button");
    uiText(name, zone);
    uiText(
      time,
      new Intl.DateTimeFormat(
        globalThis.KenseiI18n?.getLocale() === "zh-Hant" ? "zh-Hant" : "en-GB",
        {
          timeZone: zone,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: data.format === "12",
        },
      ).format(new Date()),
    );
    uiText(
      day,
      new Intl.DateTimeFormat(
        globalThis.KenseiI18n?.getLocale() === "zh-Hant" ? "zh-Hant" : "en-GB",
        {
          timeZone: zone,
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
        },
      ).format(new Date()),
    );
    remove.className = "text-link";
    uiText(remove, uiMsg("Remove"));
    uiAttr(remove, "aria-label", uiJoin([uiMsg("Remove"), zone]));
    remove.onclick = () => {
      data.zones = data.zones.filter((x) => x !== zone);
      save();
      clock();
    };
    card.append(name, time, day, remove);
    container.append(card);
  }
}
function countdownText(record) {
  const seconds = Math.max(0, Math.floor((record.target - Date.now()) / 1000)),
    days = Math.floor(seconds / 86400),
    hours = Math.floor((seconds % 86400) / 3600),
    minutes = Math.floor((seconds % 3600) / 60);
  return (
    (seconds
      ? days + "d " + hours + "h " + minutes + "m " + (seconds % 60) + "s"
      : "Reached") +
    " · " +
    new Intl.DateTimeFormat(
      globalThis.KenseiI18n?.getLocale() === "zh-Hant" ? "zh-Hant" : "en-GB",
      {
        timeZone: record.zone,
        dateStyle: "medium",
        timeStyle: "short",
      },
    ).format(record.target) +
    " · " +
    record.zone
  );
}
function count() {
  const out = $("#countdowns"),
    signature = data.countdowns.map((x) => x.id).join("|");
  if (data.countdowns.length && out.dataset.records === signature) {
    data.countdowns.forEach((record, i) =>
      uiText(out.children[i].querySelector("p"), countdownText(record)),
    );
    return;
  }
  out.dataset.records = signature;
  out.replaceChildren();
  if (!data.countdowns.length) {
    uiText(out, uiMsg("No countdowns saved on this device."));
    return;
  }
  for (const record of data.countdowns) {
    const row = document.createElement("div");
    row.className = "saved-row";
    const content = document.createElement("div"),
      title = document.createElement("strong"),
      value = document.createElement("p"),
      remove = document.createElement("button");
    uiText(title, record.name);
    uiText(value, countdownText(record));
    uiText(remove, uiMsg("Delete"));
    remove.className = "text-link";
    remove.onclick = () => {
      data.countdowns = data.countdowns.filter((x) => x.id !== record.id);
      save();
      count();
    };
    content.append(title, value);
    row.append(content, remove);
    out.append(row);
  }
}
function convert() {
  try {
    const from = $("#time-from").value.trim(),
      to = $("#time-to").value.trim();
    if (!zoneValid(from) || !zoneValid(to))
      throw Error("Choose a valid IANA time zone, such as Asia/Kuala_Lumpur.");
    const previous = $("#time-offset").value;
    choices = moments(T, $("#time-date").value, $("#time-value").value, from);
    $("#time-offset").replaceChildren();
    choices.forEach((c) =>
      $("#time-offset").add(new Option("UTC" + c.offset, String(c.epoch))),
    );
    if (choices.some((c) => String(c.epoch) === previous))
      $("#time-offset").value = previous;
    $("#time-offset-label").hidden = choices.length < 2;
    // 遇到重复时间先要求用户明确选择，不暗中采用某个偏移。
    if (
      choices.length > 1 &&
      !choices.some((c) => String(c.epoch) === previous)
    ) {
      $("#time-offset").selectedIndex = -1;
      throw Error(
        "This local time occurs twice. Choose the UTC offset before converting or saving.",
      );
    }
    const epoch = Number($("#time-offset").value),
      z = T.Instant.fromEpochMilliseconds(epoch).toZonedDateTimeISO(to);
    $("#time-output").value =
      z.toPlainDateTime().toString({ smallestUnit: "second" }) +
      " · " +
      to +
      " · UTC" +
      z.offset;
    uiText($("#time-state"), "");
    $("#time-copy").disabled = false;
    $("#countdown-add").disabled = false;
    return epoch;
  } catch (e) {
    $("#time-output").value = "";
    uiText($("#time-state"), uiError(e));
    $("#time-copy").disabled = true;
    $("#countdown-add").disabled = true;
    return null;
  }
}
for (const id of ["time-date", "time-value", "time-from", "time-to"])
  $("#" + id).addEventListener("input", convert);
$("#time-offset").onchange = convert;
function dates() {
  try {
    const days = dateDays(
      T,
      $("#date-start").value,
      $("#date-end").value,
      $("#date-inclusive").checked,
    );
    uiText($("#date-result"), uiJoin([days, uiMsg(" days")]));
  } catch {
    uiText($("#date-result"), uiMsg("Choose two valid dates."));
  }
}
for (const id of ["date-start", "date-end", "date-inclusive"])
  $("#" + id).addEventListener("input", dates);
$("#clock-add").onclick = () => {
  const zone = $("#clock-zone").value.trim();
  if (!zoneValid(zone)) {
    uiText($("#time-notice"), uiMsg("Choose a valid IANA time zone."));
    return;
  }
  if (data.zones.includes(zone)) return;
  if (data.zones.length >= 8) {
    uiText($("#time-notice"), uiMsg("Keep up to eight clocks on this page."));
    return;
  }
  data.zones.push(zone);
  save();
  clock();
};
$("#time-format").onchange = () => {
  data.format = $("#time-format").value;
  save();
  clock();
};
$("#time-copy").onclick = () => copy($("#time-output"));
$("#countdown-add").onclick = () => {
  const target = convert(),
    name = $("#countdown-name").value.trim();
  if (target === null) return;
  if (!name) {
    uiText($("#time-notice"), uiMsg("Give this countdown a name."));
    return;
  }
  if (target <= Date.now()) {
    uiText(
      $("#time-notice"),
      uiMsg("Choose a future moment for your countdown."),
    );
    return;
  }
  if (data.countdowns.length >= 20) {
    uiText(
      $("#time-notice"),
      uiMsg("Delete a countdown before adding another (20 maximum)."),
    );
    return;
  }
  data.countdowns.push({
    id: crypto.randomUUID(),
    name: name.slice(0, 80),
    target,
    zone: $("#time-from").value.trim(),
  });
  save();
  count();
  uiText($("#time-notice"), uiMsg("Countdown saved on this device."));
};
let timer = setInterval(() => {
  clock();
  count();
}, 1000);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearInterval(timer);
    timer = null;
  } else {
    clock();
    count();
    timer = setInterval(() => {
      clock();
      count();
    }, 1000);
  }
});
window.addEventListener("pagehide", () => clearInterval(timer));
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    clearInterval(timer);
    clock();
    count();
    if (!document.hidden)
      timer = setInterval(() => {
        clock();
        count();
      }, 1000);
  }
});
clock();
count();
convert();
dates();
