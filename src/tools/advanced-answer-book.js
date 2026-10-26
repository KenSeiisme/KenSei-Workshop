import { $, downloadText } from "./common.js";
import * as store from "./personal-store.js";
import { el, panel, row, button, field } from "./advanced-ui.js";
import { uiMsg, uiText } from "../site/ui.js";
export function init() {
  const p = panel("Filter loaded answer history", $("#answer-history")),
    search = el("input", "", { type: "search", placeholder: "Search answers" }),
    from = el("input", "", { type: "date" }),
    to = el("input", "", { type: "date" }),
    star = el("input", "", { type: "checkbox" }),
    label = el("label", "Favorites only");
  label.prepend(star);
  const filter = (rows) =>
    rows.filter((r) => {
      const d = (r.data.drawnAt || r.created_at).slice(0, 10),
        text = (r.data.en + " " + r.data.zh).toLocaleLowerCase();
      return (
        (!search.value || text.includes(search.value.toLocaleLowerCase())) &&
        (!from.value || d >= from.value) &&
        (!to.value || d <= to.value) &&
        (!star.checked || r.data.favorite === true)
      );
    });
  window.KenseiAnswerFilter = filter;
  for (const n of [search, from, to, star])
    n.oninput = () => window.dispatchEvent(new Event("answer-filter-change"));
  p.append(
    el(
      "p",
      "Filters apply to history already loaded on this device. Load more to include older answers.",
    ),
    row(
      field("Keyword", search),
      field("From date", from),
      field("To date", to),
      label,
    ),
    button("Export filtered TXT", () =>
      downloadText(
        filter(store.records("answer"))
          .map(
            (r) =>
              (r.data.drawnAt || r.created_at) +
              "\n" +
              r.data.en +
              "\n" +
              r.data.zh,
          )
          .join("\n\n"),
        "filtered-answers.txt",
      ),
    ),
    button("Favorite current answer", () => {
      const id = window.KenseiCurrentAnswerId,
        row = store.records("answer").find((r) => r.id === id);
      if (!row) return;
      store.put(
        "answer",
        { ...row.data, favorite: !row.data.favorite },
        row.id,
      );
    }),
  );
  window.addEventListener("workspace-ready", () => {
    search.value = from.value = to.value = "";
    star.checked = false;
    window.dispatchEvent(new Event("answer-filter-change"));
  });
}
