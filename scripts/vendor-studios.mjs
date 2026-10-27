import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
const root = path.resolve(import.meta.dirname, ".."),
  out = path.join(root, "src/vendor");
const pkg = (n) => path.join(root, "node_modules", n);
await fs.mkdir(path.join(out, "data-analysis"), { recursive: true });
await build({
  stdin: {
    contents:
      'export * from "@duckdb/duckdb-wasm"; export {Table,vectorFromArray,Utf8} from "apache-arrow";',
    resolveDir: root,
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "eof",
  outfile: path.join(out, "data-analysis/engine.js"),
});
for (const n of ["duckdb-eh.wasm", "duckdb-browser-eh.worker.js"])
  await fs.copyFile(
    path.join(pkg("@duckdb/duckdb-wasm"), "dist", n),
    path.join(out, "data-analysis", n),
  );
await fs.mkdir(path.join(out, "katex/fonts"), { recursive: true });
for (const n of ["katex.min.js", "katex.min.css"])
  await fs.copyFile(
    path.join(pkg("katex"), "dist", n),
    path.join(out, "katex", n),
  );
for (const n of await fs.readdir(path.join(pkg("katex"), "dist/fonts")))
  if (n.endsWith(".woff2"))
    await fs.copyFile(
      path.join(pkg("katex"), "dist/fonts", n),
      path.join(out, "katex/fonts", n),
    );
await build({
  entryPoints: [path.join(pkg("markdown-it-footnote"), "index.mjs")],
  bundle: true,
  format: "iife",
  globalName: "markdownFootnote",
  minify: true,
  legalComments: "eof",
  outfile: path.join(out, "markdown-footnote.js"),
});
const seen = new Set();
async function mermaid(relative) {
  if (seen.has(relative)) return;
  seen.add(relative);
  const from = path.join(pkg("mermaid"), "dist", relative),
    dest = path.join(out, "mermaid", relative),
    source = await fs.readFile(from, "utf8");
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, source);
  for (const m of source.matchAll(
    /(?:from\s*|import\s*\()\s*["'](\.[^"']+\.mjs)["']/g,
  ))
    await mermaid(path.normalize(path.join(path.dirname(relative), m[1])));
}
await mermaid("mermaid.esm.min.mjs");
const notices = [];
for (const name of [
  "@duckdb/duckdb-wasm",
  "apache-arrow",
  "katex",
  "mermaid",
  "markdown-it-footnote",
]) {
  const folder = pkg(name),
    manifest = JSON.parse(
      await fs.readFile(path.join(folder, "package.json"), "utf8"),
    );
  notices.push(`${name} ${manifest.version} · ${manifest.license}`);
  for (const f of await fs.readdir(folder))
    if (/^(license|notice|copying)(\.|$)/i.test(f)) {
      const bytes = await fs.readFile(path.join(folder, f));
      const dest = path.join(
        out,
        "licenses/studios",
        name.replace("/", "-") + "-" + f,
      );
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, bytes);
    }
}
await fs.writeFile(
  path.join(out, "licenses/studios/versions.txt"),
  notices.join("\n") + "\n",
);
console.log(
  "Self-hosted professional studio dependencies: " + notices.join(", "),
);

// Include licenses of the bundled transitive dependencies as well.
const fullNotices = [],
  visited = new Set();
async function notice(folder) {
  let real;
  try {
    real = await fs.realpath(folder);
  } catch {
    return;
  }
  if (visited.has(real)) return;
  visited.add(real);
  let m;
  try {
    m = JSON.parse(await fs.readFile(path.join(real, "package.json"), "utf8"));
  } catch {
    return;
  }
  for (const name of await fs.readdir(real)) {
    if (!/^(license|notice|copying)(\.|$)/i.test(name)) continue;
    const file = path.join(real, name);
    if ((await fs.stat(file)).isFile())
      fullNotices.push(
        `--- ${m.name} ${m.version} / ${name} ---\n` +
          (await fs.readFile(file, "utf8")),
      );
  }
}
const store = path.join(root, "node_modules/.pnpm");
for (const entry of await fs.readdir(store)) {
  const modules = path.join(store, entry, "node_modules");
  let children;
  try {
    children = await fs.readdir(modules);
  } catch {
    continue;
  }
  for (const child of children) {
    if (child.startsWith(".")) continue;
    if (child.startsWith("@")) {
      for (const name of await fs.readdir(path.join(modules, child)))
        await notice(path.join(modules, child, name));
    } else await notice(path.join(modules, child));
  }
}
await fs.writeFile(
  path.join(out, "licenses/studios/dependency-notices.txt"),
  fullNotices.join("\n\n"),
);
