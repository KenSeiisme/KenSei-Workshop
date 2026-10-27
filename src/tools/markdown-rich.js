import { uiMsg, uiRender } from "../site/ui.js";
import { library, esc } from "./common.js";
let katex, mermaid, cssCache;
export const renderOptions = {
  math: true,
  diagrams: true,
  footnotes: true,
  page: "A4",
};
export function validateMarkdownRecipe(s = {}) {
  return {
    math: s.math !== false,
    diagrams: s.diagrams !== false,
    footnotes: s.footnotes !== false,
    page: s.page === "Letter" ? "Letter" : "A4",
  };
}
async function mathEngine() {
  if (!katex) {
    katex = await library("katex/katex.min.js", "katex");
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/vendor/katex/katex.min.css";
    document.head.append(link);
  }
  return katex;
}
function formula(value, display) {
  if (!renderOptions.math)
    return (
      "<code>" +
      esc((display ? "$$" : "$") + value + (display ? "$$" : "$")) +
      "</code>"
    );
  if (value.length > 10000)
    return (
      '<code data-math-limit="true">' +
      esc(uiRender(uiMsg("Formula exceeds 10,000 characters."))) +
      "</code>"
    );
  return katex.renderToString(value, {
    displayMode: display,
    trust: false,
    strict: "warn",
    throwOnError: false,
    maxSize: 10,
    maxExpand: 1000,
    output: "htmlAndMathml",
  });
}
export async function configureMarkdown(parser) {
  const footnote = await library("markdown-footnote.js", "markdownFootnote");
  parser.use(footnote.default || footnote);
  parser.inline.ruler.after("escape", "workshop_math", (state, silent) => {
    const pos = state.pos;
    if (
      state.src[pos] !== "$" ||
      state.src[pos + 1] === "$" ||
      /\s/.test(state.src[pos + 1] || "")
    )
      return false;
    let end = pos + 1;
    while ((end = state.src.indexOf("$", end)) !== -1) {
      if (state.src[end - 1] !== "\\") break;
      end++;
    }
    if (end < 0 || end === pos + 1 || /\s/.test(state.src[end - 1]))
      return false;
    if (!silent) {
      const token = state.push("workshop_math_inline", "math", 0);
      token.content = state.src.slice(pos + 1, end);
    }
    state.pos = end + 1;
    return true;
  });
  parser.block.ruler.before(
    "fence",
    "workshop_math_block",
    (state, start, end, silent) => {
      const from = state.bMarks[start] + state.tShift[start],
        lineEnd = state.eMarks[start];
      if (!state.src.slice(from, lineEnd).startsWith("$$")) return false;
      if (silent) return true;
      let value = state.src.slice(from + 2, lineEnd),
        next = start + 1;
      if (value.includes("$$")) value = value.slice(0, value.indexOf("$$"));
      else {
        let found = false;
        for (; next < end; next++) {
          const line = state.src.slice(state.bMarks[next], state.eMarks[next]),
            close = line.indexOf("$$");
          if (close >= 0) {
            value += "\n" + line.slice(0, close);
            next++;
            found = true;
            break;
          }
          value += "\n" + line;
        }
        if (!found) return false;
      }
      const token = state.push("workshop_math_block", "math", 0);
      token.block = true;
      token.content = value.trim();
      token.map = [start, next];
      state.line = next;
      return true;
    },
    { alt: ["paragraph", "reference", "blockquote", "list"] },
  );
  parser.renderer.rules.workshop_math_inline = (tokens, i) =>
    formula(tokens[i].content, false);
  parser.renderer.rules.workshop_math_block = (tokens, i) =>
    '<div class="math-block">' + formula(tokens[i].content, true) + "</div>";
  const fence = parser.renderer.rules.fence;
  parser.renderer.rules.fence = (tokens, i, ...args) =>
    tokens[i].info.trim() === "mermaid" && renderOptions.diagrams
      ? '<pre class="diagram-source">' + esc(tokens[i].content) + "</pre>"
      : fence(tokens, i, ...args);
}
function cleanDiagram(source) {
  if (source.length > 12000 || source.split("\n").length > 180)
    throw Error("Diagram exceeds the size or complexity limit.");
  if (
    !/^\s*(?:flowchart\b|graph\b|sequenceDiagram\b|classDiagram\b|erDiagram\b)/.test(
      source,
    )
  )
    throw Error("Use flowchart, sequence, class or ER diagrams.");
  if (
    /%%\{|^---|\b(?:click|callback|href|linkStyle)\b|<\/?[a-z]|https?:|data:|@import|url\s*\(/im.test(
      source,
    )
  )
    throw Error(
      "Diagram links, HTML and configuration directives are disabled.",
    );
  if (/^\s*(?:style|classDef)\s/im.test(source))
    throw Error(
      "Diagram links, HTML and configuration directives are disabled.",
    );
  return source;
}
async function diagramEngine() {
  if (!mermaid) {
    mermaid = (await import("/vendor/mermaid/mermaid.esm.min.mjs")).default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      maxTextSize: 12000,
      maxEdges: 200,
      suppressErrorRendering: true,
      theme: "base",
      themeVariables: {
        primaryColor: "#eadcf4",
        primaryBorderColor: "#a855c7",
        primaryTextColor: "#271534",
        lineColor: "#9d669e",
        fontFamily: "system-ui",
      },
    });
  }
  return mermaid;
}
export async function renderRich(parser, text) {
  const method = renderOptions.footnotes ? "enable" : "disable";
  parser.block.ruler[method](["footnote_def"], true);
  parser.inline.ruler[method](["footnote_inline", "footnote_ref"], true);
  parser.core.ruler[method](["footnote_tail"], true);

  if (renderOptions.math && text.includes("$")) await mathEngine();
  const host = document.createElement("div");
  host.innerHTML = parser.render(text);
  for (const node of host.querySelectorAll(".diagram-source")) {
    try {
      const source = cleanDiagram(node.textContent),
        api = await diagramEngine(),
        { svg } = await api.render(
          "diagram_" + crypto.randomUUID().replaceAll("-", ""),
          source,
        );
      const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
      for (const n of parsed.querySelectorAll(
        "script,foreignObject,iframe,image,a",
      ))
        n.remove();
      for (const n of parsed.querySelectorAll("*"))
        for (const attr of [...n.attributes])
          if (
            /^on/i.test(attr.name) ||
            /href$/i.test(attr.name) ||
            (/(?:url\(|https?:|data:)/i.test(attr.value) &&
              !/^url\(#[^)]+\)$/.test(attr.value) &&
              !["xmlns", "xmlns:xlink"].includes(attr.name))
          )
            n.removeAttribute(attr.name);
      const figure = document.createElement("figure");
      figure.className = "markdown-diagram";
      figure.append(document.importNode(parsed.documentElement, true));
      node.replaceWith(figure);
    } catch (e) {
      node.classList.add("error-text");
      node.dataset.diagramError = e.message;
      node.dataset.diagramSource = node.textContent;
      node.textContent = uiRender(uiMsg(e.message)) + "\n\n" + node.textContent;
    }
  }
  return host.innerHTML;
}
export async function exportStyles() {
  let css =
    "body{max-width:850px;margin:32px auto;padding:0 24px;font:16px/1.7 system-ui;color:#18131c;background:white}pre{padding:16px;overflow:auto;background:#f3eff6}table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px 10px}svg{max-width:100%;height:auto}blockquote{border-left:3px solid #b47ad0;padding-left:16px}.math-block{overflow:auto} @page{size:" +
    renderOptions.page +
    ";margin:18mm}";
  if (!katex) return css;
  if (!cssCache) {
    const response = await fetch("/vendor/katex/katex.min.css");
    if (!response.ok) throw Error("Math export styles could not load. Retry.");
    let style = await response.text();
    const faces = [...style.matchAll(/src:([^;]+);/g)];
    for (const face of faces) {
      const match = face[1].match(/url\(([^)]+\.woff2)\)/);
      if (!match) continue;
      const response = await fetch(
        "/vendor/katex/" + match[1].replaceAll(/["']/g, ""),
      );
      if (!response.ok) throw Error("Math export fonts could not load. Retry.");
      const fontBlob = await response.blob();
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(fontBlob);
      });
      style = style.replace(face[0], `src:url(${base64}) format('woff2');`);
    }
    cssCache = style;
  }
  return css + "\n" + cssCache;
}
