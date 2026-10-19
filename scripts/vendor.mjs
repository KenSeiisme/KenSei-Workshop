// 固定依赖复制到本站，运行时不依赖第三方 CDN。
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { gzipSync, gunzipSync } from "node:zlib";
import crypto from "node:crypto";
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, ".."),
  out = path.join(root, "vendor");
await fs.mkdir(out, { recursive: true });
const resolveRoot = (name) => {
  let p = path.dirname(require.resolve(name));
  while (
    path.basename(p) !== name &&
    !p.endsWith(path.sep + name.replace("/", path.sep))
  )
    p = path.dirname(p);
  return p;
};
async function cp(pkg, source, target) {
  await fs.cp(path.join(resolveRoot(pkg), source), path.join(out, target), {
    recursive: true,
  });
}
await cp("pica", "dist/pica.min.js", "pica.js");
await cp("fflate", "umd/index.js", "fflate.js");
await cp("qr-code-styling", "lib/qr-code-styling.js", "qr-code-styling.js");
await cp("pdf-lib", "dist/pdf-lib.min.js", "pdf-lib.js");
await cp(
  "markdown-it",
  "dist/browser/markdown-it.umd.min.js",
  "markdown-it.js",
);
await cp("diff", "libesm", "diff");
await cp("spin-wheel", "dist/spin-wheel-esm.js", "spin-wheel.js");
const pdfRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
for (const folder of ["build", "cmaps", "standard_fonts", "wasm"])
  await fs.cp(path.join(pdfRoot, folder), path.join(out, "pdfjs", folder), {
    recursive: true,
    filter: (p) => !p.endsWith(".map"),
  });
await cp("tesseract.js", "dist/tesseract.min.js", "tesseract/tesseract.min.js");
await cp("tesseract.js", "dist/worker.min.js", "tesseract/worker.min.js");
const tRequire = createRequire(require.resolve("tesseract.js"));
const core = path.dirname(tRequire.resolve("tesseract.js-core/package.json"));
await fs.mkdir(path.join(out, "tesseract/core"), { recursive: true });
for (const name of await fs.readdir(core))
  if (/\.wasm(?:\.js)?$/.test(name))
    await fs.copyFile(
      path.join(core, name),
      path.join(out, "tesseract/core", name),
    );
const modelLockPath = path.join(root, "model-lock.json");
let modelLock = {};
try {
  modelLock = JSON.parse(await fs.readFile(modelLockPath, "utf8"));
} catch {}
await fs.mkdir(path.join(out, "tesseract/lang"), { recursive: true });
for (const lang of ["eng", "chi_sim", "chi_tra", "msa"]) {
  const destination = path.join(
    out,
    "tesseract/lang",
    lang + ".traineddata.gz",
  );
  try {
    const bytes = gunzipSync(await fs.readFile(destination));
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    if (!modelLock[lang] || modelLock[lang] !== hash)
      throw new Error("Model checksum mismatch: " + lang);
  } catch {
    if (!modelLock.ref) {
      const r = await fetch(
        "https://api.github.com/repos/tesseract-ocr/tessdata_fast/commits/main",
        { headers: { "User-Agent": "KenSei-Workshop-vendor" } },
      );
      if (!r.ok) throw new Error("Cannot pin OCR model source: " + r.status);
      modelLock.ref = (await r.json()).sha;
    }
    const r = await fetch(
      `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${modelLock.ref}/${lang}.traineddata`,
    );
    if (!r.ok) throw new Error("Model download failed: " + lang);
    const data = Buffer.from(await r.arrayBuffer()),
      hash = crypto.createHash("sha256").update(data).digest("hex");
    if (modelLock[lang] && modelLock[lang] !== hash)
      throw new Error("Model checksum mismatch: " + lang);
    modelLock[lang] = hash;
    await fs.writeFile(destination, gzipSync(data));
  }
}
await fs.writeFile(modelLockPath, JSON.stringify(modelLock, null, 2) + "\n");
const credits = [];
for (const pkg of [
  "pica",
  "fflate",
  "qr-code-styling",
  "pdf-lib",
  "pdfjs-dist",
  "markdown-it",
  "diff",
  "tesseract.js",
  "spin-wheel",
]) {
  const dir = pkg === "pdfjs-dist" ? pdfRoot : resolveRoot(pkg),
    manifest = JSON.parse(
      await fs.readFile(path.join(dir, "package.json"), "utf8"),
    );
  const license = (await fs.readdir(dir)).find((n) =>
    /^licen[sc]e(?:\.md|\.txt)?$/i.test(n),
  );
  if (!license) throw new Error("Missing license: " + pkg);
  await fs.mkdir(path.join(out, "licenses"), { recursive: true });
  await fs.copyFile(
    path.join(dir, license),
    path.join(out, "licenses", pkg + ".txt"),
  );
  credits.push({
    name: pkg,
    version: manifest.version,
    license: manifest.license,
  });
}
await fs.copyFile(
  path.join(core, "LICENSE"),
  path.join(out, "licenses/tesseract.js-core.txt"),
);
const licenseResponse = await fetch(
  `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${modelLock.ref}/LICENSE`,
);
if (!licenseResponse.ok) throw new Error("Cannot download model license");
await fs.writeFile(
  path.join(out, "licenses/tessdata-fast.txt"),
  await licenseResponse.text(),
);
await fs.writeFile(
  path.join(out, "credits.json"),
  JSON.stringify(credits, null, 2),
);
// 保留打包进浏览器资源的依赖及 worker 的版权声明。
const notices = [],
  visited = new Set();
async function notice(dir) {
  const real = await fs.realpath(dir);
  if (visited.has(real)) return;
  visited.add(real);
  let manifest;
  try {
    manifest = JSON.parse(
      await fs.readFile(path.join(real, "package.json"), "utf8"),
    );
  } catch {
    return;
  }
  const names = await fs.readdir(real);
  const files = names.filter((n) =>
    /^(licen[sc]e|notice|copying)(?:\.|$)/i.test(n),
  );
  if (!files.length && names.includes("README.md")) files.push("README.md");
  for (const file of files) {
    if (!(await fs.stat(path.join(real, file))).isFile()) continue;
    notices.push(
      `\n--- ${manifest.name} ${manifest.version} / ${file} ---\n` +
        (await fs.readFile(path.join(real, file), "utf8")),
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
      for (const scoped of await fs.readdir(path.join(modules, child)))
        await notice(path.join(modules, child, scoped));
    } else await notice(path.join(modules, child));
  }
}
for (const f of ["tesseract.min.js.LICENSE.txt", "worker.min.js.LICENSE.txt"])
  notices.push(
    await fs.readFile(
      path.join(resolveRoot("tesseract.js"), "dist", f),
      "utf8",
    ),
  );
await fs.writeFile(
  path.join(out, "licenses/bundled-notices.txt"),
  notices.join("\n"),
);
console.log(
  "Prepared local browser libraries and four pinned OCR language packs.",
);
