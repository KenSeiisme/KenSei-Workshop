import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const root = path.resolve(import.meta.dirname, ".."),
  manifest = JSON.parse(
    await fs.readFile(
      path.join(root, "src/vendor/stockfish/manifest.json"),
      "utf8",
    ),
  );
const files = [
  ...manifest.files,
  {
    path: "/vendor/chess.js",
    source: "https://unpkg.com/chess.js@1.4.0/dist/esm/chess.js",
    sha256: "76c7c34f0e2e9ab076521a5d6fe786a9cce537bb1b6f29d32a9c9970b5b232d2",
  },
];
for (const item of files) {
  const target = path.join(root, "src", item.path.replace(/^\//, ""));
  let data = await fs.readFile(target).catch(() => null);
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  if (!data || digest(data) !== item.sha256) {
    const response = await fetch(item.source);
    if (!response.ok)
      throw Error(`Dependency download failed: ${response.status}`);
    data = Buffer.from(await response.arrayBuffer());
    if (digest(data) !== item.sha256)
      throw Error(`Dependency checksum mismatch: ${item.path}`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  }
  console.log(`Verified ${item.path}`);
}
