import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const manifest = JSON.parse(
  fs.readFileSync("src/vendor/fairy-stockfish/manifest.json", "utf8"),
);
for (const file of manifest.files) {
  const source = fs.readFileSync("src" + file.path);
  assert.equal(hash(source), file.sha256, file.path);
  assert.deepEqual(
    fs.readFileSync("dist" + file.path),
    source,
    file.path + " built bytes",
  );
}
assert.ok(
  fs.statSync("dist/vendor/sources/fairy-stockfish-1.1.12-source.tar.gz").size >
    300000,
);
const config = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
const isolated = config.headers.filter((x) =>
  x.headers.some((h) => h.key === "Cross-Origin-Embedder-Policy"),
);
assert.deepEqual(
  isolated.map((x) => x.source),
  [
    "/games/xiangqi/:path*",
    "/zh-hant/games/xiangqi/:path*",
    "/vendor/fairy-stockfish/:path*",
  ],
);
for (const prefix of ["", "zh-hant/"]) {
  const html = fs.readFileSync(
    "dist/" + prefix + "games/xiangqi/index.html",
    "utf8",
  );
  assert.match(html, /data-xiangqi/);
  assert.match(html, /xiangqi-start/);
  assert.match(html, /google-site-verification/);
  assert.match(html, /hreflang="zh-Hant"/);
  assert.match(html, /xiangqi\.css/);
}
for (const file of [".gitignore", ".vercelignore"])
  assert.match(
    fs.readFileSync(file, "utf8"),
    /!(?:\/src|\*\*)\/vendor\/sources\/fairy-stockfish-1\.1\.12-source\.tar\.gz/,
  );
console.log(
  "PASS exact vendored/built Xiangqi hashes, source archive inclusion, route-scoped isolation and bilingual static metadata.",
);
