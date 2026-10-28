import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  mode = process.argv[2] || "smoke",
  manifest = JSON.parse(
    fs.readFileSync(path.join(root, "tests/acceptance/tools.json"), "utf8"),
  ),
  catalog = JSON.parse(
    fs.readFileSync(path.join(root, "data/tools.json"), "utf8"),
  ),
  batches = JSON.parse(
    fs.readFileSync(path.join(root, "scripts/test-suites.json"), "utf8"),
  );
process.chdir(root);
if (!["smoke", "acceptance", "live"].includes(mode))
  throw Error("Choose smoke, acceptance or live.");
if (
  manifest.tools.length !== 28 ||
  catalog.length !== 28 ||
  catalog.some(([slug]) => !manifest.tools.some((t) => t.slug === slug))
)
  throw Error("Acceptance inventory must match all 28 catalog tools.");

const base = new URL(
    process.env.TEST_BASE_URL ||
      (mode === "live"
        ? "https://kensei-workshop.vercel.app/"
        : "http://127.0.0.1:8769/"),
  ),
  isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
// 真正的线上检查必须显式选择，普通验收不碰正式账号或测速端点。
if (mode !== "live" && !isLocal)
  throw Error("Use test:tools:live for a non-local target.");
const stamp = new Date().toISOString().replace(/[:.]/g, "-"),
  output = path.join(root, "_qa", "tools-acceptance", `${stamp}-${mode}`);
fs.mkdirSync(output, { recursive: true });
const report = {
  version: 1,
  mode,
  base: base.origin,
  startedAt: new Date().toISOString(),
  suites: [],
  tools: [],
  manual: manifest.manual,
  environment: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    browsers: process.env.TOOLS_BROWSERS || "chromium,firefox,webkit",
  },
};
function sourceHash() {
  const hash = createHash("sha256");
  function visit(relative) {
    const absolute = path.join(root, relative);
    if (fs.statSync(absolute).isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) {
        if (["vendor", "assets", "__pycache__"].includes(name)) continue;
        visit(path.join(relative, name));
      }
    } else {
      hash.update(relative.replaceAll(path.sep, "/"));
      hash.update(fs.readFileSync(absolute));
    }
  }
  for (const name of ["src", "data", "package.json", "pnpm-lock.yaml"])
    visit(name);
  return hash.digest("hex");
}
report.sourceHashBefore = sourceHash();
const selected = [...new Set(manifest.tools.flatMap((t) => t.groups))],
  suites =
    mode === "acceptance"
      ? [
          ...selected.flatMap((name) => batches[name]),
          ...batches.profiles,
          ["tests/browser/localization.cjs"],
          ["tests/browser/advanced-locales.cjs"],
          ["tests/browser/advanced-visuals.cjs"],
          ["tests/browser/tools-workflows.cjs"],
          ["tests/browser/tools-audit.cjs"],
          ["tests/browser/tools-cross-engine.cjs"],
        ]
      : mode === "smoke"
        ? [
            ["tests/browser/verify.cjs"],
            ["tests/browser/tools.cjs"],
            ["tests/browser/second-batch.cjs"],
            ["tests/browser/daily-tools.cjs"],
            ["tests/browser/fourth-tools.cjs"],
            ["tests/browser/fifth-tools.cjs"],
            ["tests/browser/sixth-planner.cjs"],
            ["tests/browser/sixth-whiteboard.cjs"],
            ["tests/browser/sixth-media.cjs"],
            ["tests/browser/tools-audit.cjs"],
            ["tests/browser/tools-workflows.cjs"],
          ]
        : [["tests/browser/tools-audit.cjs"], ["tests/browser/live-tools.cjs"]],
  unique = [
    ...new Map(suites.map((args) => [JSON.stringify(args), args])).values(),
  ],
  filter = process.env.TOOLS_ACCEPTANCE_FILTER,
  jobs = filter
    ? unique.filter((args) => args.join(" ").includes(filter))
    : unique;
if (!jobs.length) throw Error("No suites match TOOLS_ACCEPTANCE_FILTER.");
let failed = 0;
for (let i = 0; i < jobs.length; i++) {
  const args = jobs[i],
    id = args.join(" "),
    logName = `${String(i + 1).padStart(2, "0")}-${path.basename(args[0])}.log`,
    started = Date.now(),
    log = fs.openSync(path.join(output, logName), "w");
  console.log(`[${i + 1}/${jobs.length}] ${id}`);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: ["ignore", log, log],
    timeout: 12 * 60 * 1000,
    env: {
      ...process.env,
      TEST_BASE_URL: base.href.replace(/\/$/, ""),
      TOOLS_AUDIT_OUTPUT: output,
      TOOLS_LIVE_READ_ONLY: mode === "live" ? "1" : "0",
    },
  });
  fs.closeSync(log);
  const status = result.status === 0 && !result.error ? "pass" : "fail";
  if (status === "fail") failed++;
  report.suites.push({
    id,
    status,
    elapsedMs: Date.now() - started,
    log: logName,
    ...(result.error ? { error: result.error.code || "execution-failed" } : {}),
  });
  console.log(
    `${status.toUpperCase()} ${id} (${Math.round((Date.now() - started) / 1000)}s)`,
  );
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
}
const byId = new Map(report.suites.map((s) => [s.id, s.status]));
for (const tool of manifest.tools) {
  const required = [
    ...new Set(
      tool.groups
        .flatMap((name) => batches[name])
        .map((args) => args.join(" ")),
    ),
  ];
  report.tools.push({
    slug: tool.slug,
    task: tool.task,
    functional: required.some((id) => byId.get(id) === "fail")
      ? "fail"
      : required.every((id) => byId.get(id) === "pass")
        ? "pass"
        : "pending",
    evidence: required.filter((id) => byId.has(id)),
    realDevice: "pending",
    usability: "developer-review-required",
  });
}
report.finishedAt = new Date().toISOString();
report.sourceHashAfter = sourceHash();
report.sourceChangedDuringRun =
  report.sourceHashAfter !== report.sourceHashBefore;
report.summary = {
  passed: report.suites.filter((s) => s.status === "pass").length,
  failed,
  notRun: unique.length - jobs.length,
};
fs.writeFileSync(
  path.join(output, "report.json"),
  JSON.stringify(report, null, 2),
);
fs.writeFileSync(
  path.join(output, "report.md"),
  [
    `# Tools acceptance — ${mode}`,
    "",
    `Target: ${base.origin}`,
    `Completed: ${report.finishedAt}`,
    "",
    `${report.summary.passed} suites passed; ${failed} failed. Filter: ${filter || "none"}.`,
    "",
    "Automated guest/fixture checks do not certify real OAuth, physical devices or first-time-user understanding.",
    "",
    "| Tool | Functional regression | Evidence suites | Real device |",
    "|---|---|---:|---|",
    ...report.tools.map(
      (t) => `| ${t.slug} | ${t.functional} | ${t.evidence.length} | pending |`,
    ),
    "",
    "## Manual checks",
    "",
    ...report.manual.map((m) => `- [ ] ${m.id}: ${m.task}`),
    "",
  ].join("\n"),
);
console.log(`Report: ${path.relative(root, output)}`);
process.exitCode = failed || report.sourceChangedDuringRun ? 1 : 0;
