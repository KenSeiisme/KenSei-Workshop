import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, ".."),
  batches = JSON.parse(
    fs.readFileSync(path.join(root, "scripts/test-suites.json"), "utf8"),
  ),
  group = process.argv[2] || "base";
process.chdir(root);

function discover(category) {
  return fs
    .readdirSync(path.join(root, "tests", category))
    .filter((name) => /\.(?:cjs|mjs)$/.test(name) && !name.startsWith("live-"))
    .sort()
    .flatMap((name) => {
      const file = `tests/${category}/${name}`;
      return ["sixth-sync.cjs", "sixth-pages-sync.cjs"].includes(name)
        ? [
            [file, "planner"],
            [file, "whiteboard"],
          ]
        : [[file]];
    });
}

const categories = ["unit", "database", "browser"],
  suites =
    group === "all"
      ? categories.flatMap(discover)
      : categories.includes(group)
        ? discover(group)
        : batches[group];
if (!suites) {
  console.error(
    "Choose: all, unit, database, browser, " + Object.keys(batches).join(", "),
  );
  process.exit(2);
}
let failed = 0;
for (const args of suites) {
  console.log(`\nRunning ${args.join(" ")}`);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      TEST_BASE_URL: process.env.TEST_BASE_URL || "http://127.0.0.1:8769",
    },
  });
  if (result.error || result.status !== 0) {
    failed++;
    console.error(result.error?.message || `Failed: ${args.join(" ")}`);
  }
}
console.log(`\n${suites.length - failed}/${suites.length} suites passed.`);
process.exitCode = failed ? 1 : 0;
