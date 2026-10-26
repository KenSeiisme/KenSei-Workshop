import { textReceiver } from "./handoff.js";
import { el, button, panel, row } from "./advanced-ui.js";
export function init() {
  textReceiver("markdown-studio", "#markdown-input");
  const input = document.querySelector("#markdown-input"),
    preview = document.querySelector("#markdown-preview");
  const p = panel("Writing tools", input.closest(".panel")),
    outline = el("nav", "", { "aria-label": "Document outline" });
  function headings() {
    return [...input.value.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((m) => ({
      level: m[1].length,
      text: m[2],
      index: m.index,
    }));
  }
  function update() {
    outline.replaceChildren();
    for (const [index, h] of headings().entries()) {
      const b = button("", () => {
        input.focus();
        input.setSelectionRange(h.index, h.index + h.text.length + h.level + 1);
        const target = [...preview.querySelectorAll("h1,h2,h3,h4,h5,h6")][
          index
        ];
        target?.scrollIntoView({ block: "nearest" });
      });
      b.textContent = h.text;
      b.style.marginInlineStart = (h.level - 1) * 10 + "px";
      outline.append(b);
    }
  }
  function insert(before, after = "") {
    const start = input.selectionStart,
      end = input.selectionEnd;
    if (input.value.length + before.length + after.length > 100000)
      throw Error("Use at most 100,000 characters.");
    input.setRangeText(
      before + input.value.slice(start, end) + after,
      start,
      end,
      "select",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }
  p.append(
    row(
      button("Bold", () => insert("**", "**")),
      button("Italic", () => insert("*", "*")),
      button("Heading", () => insert("\n## ")),
      button("List", () => insert("\n- ")),
      button("Code", () => insert("`", "`")),
      button("Insert contents", () =>
        insert(
          "\n" +
            headings()
              .map((h) => "  ".repeat(h.level - 1) + "- " + h.text)
              .join("\n") +
            "\n",
        ),
      ),
      button("Print / Save as PDF", () => window.print()),
    ),
    outline,
  );
  input.addEventListener("input", () => setTimeout(update, 150));
  update();
}
