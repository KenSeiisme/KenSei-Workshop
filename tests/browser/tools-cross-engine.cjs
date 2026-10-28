const fs = require("node:fs"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
const output = process.env.TOOLS_AUDIT_OUTPUT || "_qa/tools-cross-engine";
fs.mkdirSync(output, { recursive: true });
const checks = [];
for (const browser of ["firefox", "webkit"])
  for (const suite of [
    "tools",
    "studios-stage1",
    "studios-stage2",
    "studios-stage3",
  ]) {
    const logName = `outputs-${browser}-${suite}.log`;
    const log = fs.openSync(path.join(output, logName), "w");
    const result = spawnSync(process.execPath, [`tests/browser/${suite}.cjs`], {
      stdio: ["ignore", log, log],
      timeout: 5 * 60 * 1000,
      env: { ...process.env, WORKSHOP_BROWSER_ENGINE: browser },
    });
    fs.closeSync(log);
    const status = result.status === 0 && !result.error ? "pass" : "fail";
    checks.push({
      browser,
      suite,
      status,
      limitations: fs
        .readFileSync(path.join(output, logName), "utf8")
        .split(/\r?\n/)
        .filter((line) => /^(MANUAL|UNSUPPORTED)/.test(line)),
      evidence: logName,
      scope:
        "Same file/output assertions as Edge; guest fixture. Browser Save as PDF remains manual outside Chromium.",
    });
    console.log(status.toUpperCase(), browser, suite, "actual tool outputs");
    fs.writeFileSync(
      path.join(output, "cross-engine-outputs.json"),
      JSON.stringify({ checks }, null, 2),
    );
  }
fs.writeFileSync(
  path.join(output, "cross-engine-outputs.json"),
  JSON.stringify({ checks }, null, 2),
);
process.exitCode = checks.every((x) => x.status === "pass") ? 0 : 1;
