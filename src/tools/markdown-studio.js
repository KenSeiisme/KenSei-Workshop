import {
  configureMarkdown,
  renderRich,
  exportStyles,
} from "./markdown-rich.js";
import {
  $,
  toast,
  library,
  esc,
  draftEditor,
  downloadText,
  filename,
  status,
} from "./common.js";
import { uiMsg, uiJoin, uiError, uiHtml } from "../site/ui.js";

const input = $("#markdown-input");
let parser = null,
  rendered = "",
  documentHeadings = [],
  debounce;
let renderGeneration = 0;
async function render() {
  if (!parser) return;
  const token = ++renderGeneration,
    source = input.value;
  documentHeadings = [];
  let next;
  try {
    next = await renderRich(parser, source);
  } catch (e) {
    status(uiError(e), true);
    return;
  }
  if (token !== renderGeneration) return { html: next, source };
  rendered = next;
  $("#markdown-preview").innerHTML = rendered;
  window.dispatchEvent(new Event("markdown-rendered"));
  return { html: next, source };
}
const changed = draftEditor("markdown-studio", input, () => {
  clearTimeout(debounce);
  debounce = setTimeout(render, 120);
});
async function initialize() {
  try {
    const make = await library("markdown-it.js", "markdownit");
    parser = make({ html: false, linkify: true, typographer: false });
    parser.renderer.rules.heading_open = (tokens, i, options, env, self) => {
      const text = (tokens[i + 1]?.children || [])
        .filter((t) => ["text", "code_inline"].includes(t.type))
        .map((t) => t.content)
        .join("");
      const slug =
        text
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s-]/gu, "")
          .trim()
          .replace(/\s+/g, "-") || "section";
      env.headingIds ||= new Map();
      const count = env.headingIds.get(slug) || 0;
      env.headingIds.set(slug, count + 1);
      const id = slug + (count ? "-" + count : "");
      tokens[i].attrSet("id", id);
      documentHeadings.push({
        text,
        id,
        level: Number(tokens[i].tag.slice(1)),
      });
      return self.renderToken(tokens, i, options);
    };
    // 不在预览或导出 HTML 中自动请求远程图片。
    parser.renderer.rules.image = (tokens, i) =>
      uiHtml`<span class="blocked-image">[Image: ${esc(tokens[i].content || "remote resource blocked")}]</span>`;
    const linkOpen =
      parser.renderer.rules.link_open ||
      ((tokens, i, options, env, self) => self.renderToken(tokens, i, options));
    parser.renderer.rules.link_open = (tokens, i, options, env, self) => {
      tokens[i].attrSet("rel", "noopener noreferrer");
      if (!tokens[i].attrGet("href")?.startsWith("#"))
        tokens[i].attrSet("target", "_blank");
      return linkOpen(tokens, i, options, env, self);
    };
    await configureMarkdown(parser);
    await render();
    status(uiMsg("Ready. Remote images and raw HTML are disabled."));
  } catch (e) {
    status(uiJoin([uiError(e), uiMsg(" Reload to retry.")]), true);
  }
}
initialize();
$("#markdown-import").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > 200000)
    return status(uiMsg("Choose a Markdown file up to 200 KB."), true);
  try {
    const text = await f.text();
    if (text.length > 100000)
      throw new Error("Use at most 100,000 characters.");
    input.value = text;
    changed();
    render();
  } catch (e) {
    status(uiError(e), true);
  }
};
$("#markdown-md").onclick = () =>
  downloadText(
    input.value,
    filename($("#draft-name").value || "kensei-document") + ".md",
    "text/markdown;charset=utf-8",
  );
$("#markdown-html").onclick = async () => {
  try {
    if (!parser) return toast(uiMsg("Preview is still loading."));
    const compiled = await render();
    if (!compiled || compiled.source !== input.value)
      throw Error("The input changed. Export the updated document again.");
    const exportCSS = await exportStyles();
    downloadText(
      `<!doctype html><html lang="${document.documentElement.lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc($("#draft-name").value || "Document")}</title><style>${exportCSS}</style><body>${compiled.html}</body></html>`,
      filename($("#draft-name").value || "kensei-document") + ".html",
      "text/html;charset=utf-8",
    );
  } catch (e) {
    status(uiError(e), true);
  }
};

window.KenseiAdvancedContexts ||= {};
window.KenseiAdvancedContexts["markdown-studio"] = {
  render,
  get headings() {
    return documentHeadings;
  },
};
