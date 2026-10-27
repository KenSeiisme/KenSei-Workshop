import { recipeControls } from "./studio-recipes.js";
import { renderOptions, validateMarkdownRecipe } from "./markdown-rich.js";
import { textReceiver } from "./handoff.js";
import { el, button, panel, row, field, select } from "./advanced-ui.js";
export function init() {
  textReceiver("markdown-studio", "#markdown-input");
  const input = document.querySelector("#markdown-input"),
    preview = document.querySelector("#markdown-preview");
  const p = panel("Writing tools", input.closest(".panel")),
    outline = el("nav", "", { "aria-label": "Document outline" });
  p.className = "markdown-writing-tools";
  input.before(p);
  const ctx = window.KenseiAdvancedContexts["markdown-studio"];
  const rendering = el("details");
  rendering.append(el("summary", "Render options"));
  const renderInputs = {};
  for (const [key, label] of [
    ["math", "Render mathematics"],
    ["diagrams", "Render diagrams"],
    ["footnotes", "Render footnotes"],
  ]) {
    const n = el("input", "", {
      type: "checkbox",
      checked: renderOptions[key],
    });
    renderInputs[key] = n;
    n.onchange = () => {
      renderOptions[key] = n.checked;
      ctx.render();
    };
    rendering.append(field(label, n));
  }
  const paper = select(
      [
        ["A4", "A4"],
        ["Letter", "Letter"],
      ],
      renderOptions.page,
    ),
    printStyle = document.createElement("style");
  document.head.append(printStyle);
  function paperStyle() {
    printStyle.textContent =
      "@media print{@page{size:" + renderOptions.page + ";margin:18mm}}";
  }
  paper.onchange = () => {
    renderOptions.page = paper.value;
    paperStyle();
  };
  rendering.append(field("Print paper", paper));
  p.append(rendering);
  paperStyle();

  function headings() {
    return ctx.headings;
  }
  function update() {
    outline.replaceChildren();
    for (const [index, h] of headings().entries()) {
      const b = button("", () => {
        document.getElementById(h.id)?.scrollIntoView({ block: "nearest" });
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
              .map(
                (h) =>
                  "  ".repeat(h.level - 1) +
                  "- [" +
                  h.text.replace(/[\[\]]/g, "") +
                  "](#" +
                  encodeURIComponent(h.id) +
                  ")",
              )
              .join("\n") +
            "\n",
        ),
      ),
      button("Inline math", () => insert("$", "$")),
      button("Display math", () => insert("\n$$\n", "\n$$\n")),
      button("Footnote", () => insert("[^note]\n\n[^note]: ")),
      button("Diagram", () =>
        insert("\n```mermaid\nflowchart LR\n  A[Start] --> B[Finish]\n```\n"),
      ),
      button("Print / Save as PDF", async () => {
        await ctx.render();
        await document.fonts.ready;
        window.print();
      }),
    ),
    outline,
  );
  window.addEventListener("markdown-rendered", update);
  update();
  recipeControls(
    p,
    "markdown-studio",
    () => ({ ...renderOptions }),
    (s) => {
      Object.assign(renderOptions, s);
      for (const [key, n] of Object.entries(renderInputs)) n.checked = s[key];
      paper.value = s.page;
      paperStyle();
      ctx.render();
    },
    validateMarkdownRecipe,
  );
}
