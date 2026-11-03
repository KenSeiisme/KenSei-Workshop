import { build } from "esbuild";
import assert from "node:assert/strict";
import { createGo, applyGo } from "../../src/games/go-engine.js";
const built = await build({
  entryPoints: ["supabase/functions/board-match/index.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  target: "es2022",
});
const { makeHandler } = await import(
  "data:text/javascript;base64," +
    Buffer.from(built.outputFiles[0].text).toString("base64")
);
const id = crypto.randomUUID(),
  client = crypto.randomUUID(),
  match = crypto.randomUUID(),
  initial = createGo();
let mode = "normal",
  calls = [];
const snapshot = {
  id: match,
  rules_version: 1,
  color: 1,
  state: initial,
  revision: 3,
  config: initial.config,
};
const handler = makeHandler(
  (k) => (k === "SUPABASE_URL" ? "https://unit.invalid" : "private-test-key"),
  async (url, options) => {
    if (url.endsWith("/auth/v1/user"))
      return Response.json({ id, is_anonymous: false });
    const body = JSON.parse(options.body);
    calls.push(body);
    if (body.action === "prepare")
      return Response.json(
        mode === "duplicate"
          ? { duplicate: true, snapshot: { ...snapshot, revision: 4 } }
          : { ...snapshot, color: mode === "opponent" ? -1 : 1 },
      );
    return Response.json(body.body);
  },
);
async function request(
  action,
  body = {},
  auth = true,
  origin = "https://kensei-workshop.vercel.app",
) {
  const response = await handler(
    new Request(`https://unit.invalid/board-match/${action}`, {
      method: "POST",
      headers: {
        ...(auth ? { Authorization: "Bearer abc.def.ghi" } : {}),
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ client_id: client, ...body }),
    }),
  );
  return { status: response.status, data: await response.json() };
}
assert.equal((await request("get", {}, false)).status, 401);
assert.equal(
  (await request("get", {}, true, "https://evil.invalid")).status,
  403,
);
assert.equal(
  (await request("create", { rules_version: 1, config: { size: 10 } })).status,
  400,
);
const local = await request("create", {
  rules_version: 1,
  config: { training: true },
  ranked: true,
  state: { winner: 1 },
});
assert.equal(local.data.ranked, false);
assert.deepEqual(local.data.state, createGo({ training: true }));
const payload = {
  match_id: match,
  expected_version: 3,
  request_id: crypto.randomUUID(),
  action: { type: "move", index: 40 },
  state: { score: 999, winner: 1 },
};
const move = await request("command", payload);
assert.equal(move.status, 200);
assert.deepEqual(move.data.state, applyGo(initial, payload.action));
assert.equal(calls.at(-1).owner, id);
mode = "opponent";
const denied = await request("command", payload);
assert.equal(denied.status, 400);
assert.match(denied.data.error, /turn/);
mode = "duplicate";
const duplicate = await request("command", payload);
assert.equal(duplicate.data.revision, 4);
mode = "normal";
assert.equal(
  (
    await request("command", {
      ...payload,
      action: { type: "move", index: 40, score: 100 },
    })
  ).status,
  400,
);
assert.equal(
  (await request("get", { padding: "x".repeat(17000) })).status,
  413,
);
assert.equal(
  (
    await request("queue", {
      rules_version: 1,
      config: { rule: "aga", handicap: 2 },
    })
  ).status,
  400,
);
console.log(
  "PASS Go Edge JWT verification, origin/body limits, canonical transitions, anti-forged state, ownership, idempotent retry and unranked training.",
);
