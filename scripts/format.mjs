import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as prettier from "prettier";

const root = path.resolve(import.meta.dirname, ".."),
  write = process.argv.includes("--write"),
  folders = ["src", "scripts", "tests", "docs", "data", "supabase/functions"],
  extensions = new Set([
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".css",
    ".json",
    ".html",
    ".md",
  ]),
  files = [];
process.chdir(root);

async function collect(folder) {
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name),
      relative = file.replaceAll(path.sep, "/");
    if (entry.isDirectory()) {
      if (["__pycache__", "node_modules"].includes(entry.name)) continue;
      if (relative === "src/vendor" || relative === "src/assets") continue;
      await collect(file);
    } else if (entry.isFile() && extensions.has(path.extname(file)))
      files.push(file);
  }
}
for (const folder of folders) await collect(folder);
for (const entry of await fs.readdir(root, { withFileTypes: true })) {
  if (entry.isFile() && extensions.has(path.extname(entry.name)))
    files.push(entry.name);
}

let failed = 0,
  changed = 0;
for (const file of files.sort()) {
  const source = await fs.readFile(file, "utf8"),
    options = await prettier.resolveConfig(file),
    formatted = await prettier.format(source, { ...options, filepath: file });
  if (source === formatted) continue;
  changed++;
  if (write) await fs.writeFile(file, formatted);
  else {
    failed++;
    console.error(`Needs formatting: ${file}`);
  }
}
console.log(
  `${files.length} web/source files checked; ${changed} ${write ? "formatted" : "need formatting"}.`,
);

const python = process.env.WORKSHOP_PYTHON || "python",
  args = ["scripts/format_python.py", write ? "--write" : "--check"],
  result = spawnSync(python, args, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      BLACK_CACHE_DIR: path.join(root, "_qa/black-cache"),
    },
  });
if (result.error || result.status !== 0) {
  failed++;
  console.error(
    "Python formatting requires: python -m pip install -r requirements-dev.txt",
  );
}
process.exitCode = failed ? 1 : 0;
