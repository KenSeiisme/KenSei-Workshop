import { $ } from "./common.js";
import { el, row, field, select, button } from "./advanced-ui.js";
import { uiMsg, uiText } from "../site/ui.js";
export function init() {
  const duration = select(
      [
        ["15", "15 seconds"],
        ["30", "30 seconds"],
        ["60", "60 seconds"],
        ["120", "120 seconds"],
      ],
      "60",
    ),
    text = el("textarea", "", {
      rows: 3,
      maxLength: 15000,
      placeholder: "Optional custom practice text",
    }),
    wrap = el("details"),
    summary = el("summary", "Practice settings"),
    trend = el("div"),
    error = button("Practice mistakes from this run", () => {
      text.value = lastErrors;
      window.KenseiPractice.text = lastErrors;
      $("#typing-mode").value = "practice";
      $("#typing-mode").dispatchEvent(new Event("change"));
      wrap.open = true;
    });
  let lastErrors = "";
  error.hidden = true;
  wrap.append(summary, row(field("Practice duration", duration)), text);
  $("#typing-setup").append(wrap);
  $("#typing-practice-history").before(error, trend);
  window.KenseiPractice = { duration: 60, text: "" };
  duration.onchange = () => (window.KenseiPractice.duration = +duration.value);
  text.oninput = () => (window.KenseiPractice.text = text.value);
  function plot() {
    trend.replaceChildren();
    try {
      const rows =
        JSON.parse(
          localStorage.getItem(
            "kensei-workshop:typing:v1:" +
              (window.KenseiWorkspace.user?.id || "guest"),
          ),
        ) || [];
      const lang = $("#typing-language").value,
        points = rows
          .filter((r) => r.language === lang)
          .slice(0, 20)
          .reverse();
      if (!points.length) return;
      const canvas = el("canvas", "", {
          width: 600,
          height: 120,
          role: "img",
          "aria-label": "Local practice speed trend",
        }),
        x = canvas.getContext("2d"),
        max = Math.max(1, ...points.map((r) => r.speed));
      canvas.style.width = "100%";
      x.strokeStyle = "#d6b6ec";
      x.beginPath();
      points.forEach((r, i) => {
        const a = 10 + (i * 580) / Math.max(1, points.length - 1),
          b = 110 - (r.speed / max) * 100;
        i ? x.lineTo(a, b) : x.moveTo(a, b);
      });
      x.stroke();
      trend.append(canvas);
    } catch {}
  }
  function setup() {
    const practice = $("#typing-mode").value === "practice";
    wrap.hidden = !practice;
    duration.disabled = text.disabled =
      $("[data-tool]").dataset.typingState === "running";
  }
  $("#typing-mode").addEventListener("change", setup);
  new MutationObserver(setup).observe($("[data-tool]"), {
    attributes: true,
    attributeFilter: ["data-typing-state"],
  });
  window.addEventListener("practice-completed", (e) => {
    const { source, typed, score } = e.detail,
      a = [...source],
      b = [...typed];
    lastErrors = [
      ...new Set(a.filter((c, i) => i < b.length && c !== b[i])),
    ].join(" ");
    error.hidden = !lastErrors;
    trend.append(
      (() => {
        const n = el("p");
        uiText(
          n,
          uiMsg("Practice result: {0} · {1}%", [score.speed, score.accuracy]),
        );
        return n;
      })(),
    );
  });
  new MutationObserver(plot).observe($("#typing-practice-history"), {
    childList: true,
  });
  $("#typing-language").addEventListener("change", plot);
  plot();
  window.addEventListener("workspace-ready", () => {
    lastErrors = "";
    text.value = "";
    window.KenseiPractice.text = "";
    trend.replaceChildren();
    error.hidden = true;
  });
  setup();
}
