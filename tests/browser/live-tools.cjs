// live- 前缀让普通 test:all 自动排除真实后端检查。
// 正式检查只使用公开配置和匿名权限；不会创建成绩、房间或修改用户资料。
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const base = process.env.TEST_BASE_URL || "https://kensei-workshop.vercel.app",
  output = process.env.TOOLS_AUDIT_OUTPUT || "_qa/tools-live";
fs.mkdirSync(output, { recursive: true });
(async () => {
  const configResponse = await fetch(base + "/config.js"),
    scope = { window: {} },
    checks = [];
  assert.equal(configResponse.status, 200);
  vm.runInNewContext(await configResponse.text(), scope);
  const config = scope.window.KENSEI_CONFIG;
  assert.equal(
    new URL(config.supabaseUrl).hostname,
    "psikamavostoyeuccxqr.supabase.co",
  );
  const headers = {
    apikey: config.supabasePublishableKey,
    "Content-Type": "application/json",
  };
  async function rpc(name, data) {
    const response = await fetch(config.supabaseUrl + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(20000),
    });
    return { status: response.status, data: await response.json() };
  }
  for (const [name, data] of [
    ["start_typing_test", { language: "en" }],
    ["get_private_records", { kind: "planner" }],
    ["whiteboard_room", { action: "list", body: {} }],
  ]) {
    const result = await rpc(name, data);
    assert(
      [401, 403].includes(result.status),
      `${name}: anonymous request must be denied, got ${result.status}`,
    );
    checks.push({
      id: name,
      status: "pass",
      evidence: "actual anonymous backend denial",
      http: result.status,
    });
  }
  const privateRows = await fetch(
    config.supabaseUrl + "/rest/v1/workspace_items?select=id&limit=1",
    { headers, signal: AbortSignal.timeout(20000) },
  );
  assert([200, 401, 403].includes(privateRows.status));
  if (privateRows.status === 200)
    assert.deepEqual(
      await privateRows.json(),
      [],
      "Anonymous clients must not see private Workspace rows",
    );
  checks.push({
    id: "workspace-private-rows",
    status: "pass",
    http: privateRows.status,
  });
  for (const language of ["en", "zh"]) {
    const result = await rpc("get_typing_leaderboard", { language });
    assert.equal(result.status, 200);
    const banned = new Set([
      "email",
      "user_id",
      "typed_text",
      "typedText",
      "passage",
      "password",
      "raw_user_meta_data",
      "drafts",
    ]);
    const visit = (value) => {
      if (value && typeof value === "object")
        for (const [key, child] of Object.entries(value)) {
          assert(
            !banned.has(key),
            `Public leaderboard exposes private key ${key}`,
          );
          visit(child);
        }
    };
    visit(result.data);
    checks.push({
      id: `public-typing-${language}`,
      status: "pass",
      evidence:
        "actual anonymous response; public field audit, contents omitted",
    });
  }
  fs.writeFileSync(
    path.join(output, "live-backend.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        checks,
        realGoogleOAuth: "pending",
        fourAuthenticatedMembers: "pending",
        physicalDevices: "pending",
        networkFullTest: "pending",
      },
      null,
      2,
    ),
  );
  for (const item of checks) console.log("PASS", item.id, "actual backend");
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
