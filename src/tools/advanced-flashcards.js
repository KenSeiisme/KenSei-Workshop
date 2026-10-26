import { uiMsg, uiText, uiError, uiRender } from "../site/ui.js";
import { $, library } from "./common.js";
import { el, panel, field, select, button, row } from "./advanced-ui.js";
import { receiveHandoff } from "./handoff.js";
export function init() {
  const ctx = window.KenseiAdvancedContexts.flashcards;
  const p = panel("Import column mapping", $(".flash-layout"));
  const input = el("input", "", { type: "file", accept: ".csv" }),
    front = select([]),
    back = select([]),
    note = el(
      "p",
      "Choose CSV columns for the front and back. Nothing is saved until import.",
    );
  let table = null;
  const load = async (file) => {
    if (file.size > 1000000) throw Error("Import files up to 1 MB.");
    const Papa = await library("papaparse.js", "Papa");
    const parsed = Papa.parse(await file.text(), {
      skipEmptyLines: "greedy",
      dynamicTyping: false,
    });
    if (parsed.errors.some((e) => e.code !== "UndetectableDelimiter"))
      throw Error("Use valid CSV rows.");
    if (parsed.data.length < 2 || parsed.data.length > 201)
      throw Error("Use a header and up to 200 cards.");
    table = parsed.data;
    for (const n of [front, back]) {
      n.replaceChildren();
      table[0].forEach((h, i) => n.add(new Option(h, String(i))));
    }
    back.selectedIndex = Math.min(1, back.length - 1);
  };
  input.onchange = () =>
    load(input.files[0]).catch((e) => uiText(note, uiError(e)));
  p.append(
    input,
    row(field("Front column", front), field("Back column", back)),
    button("Import as new deck", async () => {
      if (!table) throw Error("Choose a CSV file first.");
      if (front.value === back.value)
        throw Error("Choose different front and back columns.");
      await ctx.importDeck({
        name: uiRender(uiMsg("Imported deck")),
        cards: table
          .slice(1)
          .map((r) => ({
            id: crypto.randomUUID(),
            front: r[+front.value] || "",
            back: r[+back.value] || "",
            known: false,
          })),
      });
      table = null;
    }),
    note,
  );
  receiveHandoff(
    "flashcards",
    async (payload) => load(payload.files[0]),
    () => !!table,
  );
}
