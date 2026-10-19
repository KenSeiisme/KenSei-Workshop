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
const input = $("#markdown-input");
let parser = null,
  rendered = "",
  debounce;
function render() {
  if (!parser) return;
  rendered = parser.render(input.value);
  $("#markdown-preview").innerHTML = rendered;
}
const changed = draftEditor("markdown-studio", input, () => {
  clearTimeout(debounce);
  debounce = setTimeout(render, 120);
});
async function initialize() {
  try {
    const make = await library("markdown-it.js", "markdownit");
    parser = make({ html: false, linkify: true, typographer: false });
    // 不在预览或导出 HTML 中自动请求远程图片。
    parser.renderer.rules.image = (tokens, i) =>
      `<span class="blocked-image">[Image: ${esc(tokens[i].content || "remote resource blocked")}]</span>`;
    const linkOpen =
      parser.renderer.rules.link_open ||
      ((tokens, i, options, env, self) => self.renderToken(tokens, i, options));
    parser.renderer.rules.link_open = (tokens, i, options, env, self) => {
      tokens[i].attrSet("rel", "noopener noreferrer");
      tokens[i].attrSet("target", "_blank");
      return linkOpen(tokens, i, options, env, self);
    };
    render();
    status("Ready. Remote images and raw HTML are disabled.");
  } catch (e) {
    status(e.message + " Reload to retry.", true);
  }
}
initialize();
$("#markdown-import").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > 200000)
    return status("Choose a Markdown file up to 200 KB.", true);
  try {
    const text = await f.text();
    if (text.length > 100000)
      throw new Error("Use at most 100,000 characters.");
    input.value = text;
    changed();
    render();
  } catch (e) {
    status(e.message, true);
  }
};
$("#markdown-md").onclick = () =>
  downloadText(
    input.value,
    filename($("#draft-name").value || "kensei-document") + ".md",
    "text/markdown;charset=utf-8",
  );
$("#markdown-html").onclick = () => {
  if (!parser) return toast("Preview is still loading.");
  render();
  downloadText(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc($("#draft-name").value || "Document")}</title><style>body{max-width:800px;margin:40px auto;padding:0 20px;font:16px/1.7 system-ui}pre{overflow:auto;padding:16px;background:#f4f4f4}table{border-collapse:collapse}td,th{padding:6px 12px;border:1px solid #ccc}img{max-width:100%}</style><body>${rendered}</body></html>`,
    filename($("#draft-name").value || "kensei-document") + ".html",
    "text/html;charset=utf-8",
  );
};
