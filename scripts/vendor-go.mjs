import { build } from "esbuild";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const entry = require.resolve("@sabaki/go-board");
await build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  outfile: "src/vendor/sabaki-go.js",
  legalComments: "eof",
});
await fs.copyFile(
  path.resolve(path.dirname(entry), "../LICENSE"),
  "src/vendor/licenses/sabaki-go-MIT.txt",
);
