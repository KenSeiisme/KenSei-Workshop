import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const manifest = require("@supabase/supabase-js/package.json");
const source = path.dirname(
  require.resolve("@supabase/supabase-js/package.json"),
);
const target = path.resolve(import.meta.dirname, "../src/vendor");
const sdk = await fs.readFile(
  path.join(source, "dist/umd/supabase.js"),
  "utf8",
);

await fs.mkdir(path.join(target, "licenses"), { recursive: true });
await fs.copyFile(
  path.join(source, "LICENSE"),
  path.join(target, "licenses/supabase-js.txt"),
);
await fs.writeFile(
  path.join(target, `supabase-${manifest.version}.js`),
  `/* Supabase JS ${manifest.version} | MIT | /vendor/licenses/supabase-js.txt */\n${sdk}\nexport const { createClient } = supabase;\n`,
);
