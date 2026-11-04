import { build } from "esbuild";
import assert from "node:assert/strict";
import { createXiangqi } from "../../src/games/xiangqi-engine.js";
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
  s = createXiangqi({ clock: "10+5" });
let duplicate = false,
  calls = [];
const handler = makeHandler(
  (k) => (k === "SUPABASE_URL" ? "https://unit.invalid" : "server-only"),
  async (url, options) => {
    if (url.endsWith("/auth/v1/user"))
      return Response.json({ id, is_anonymous: false });
    const body = JSON.parse(options.body);
    calls.push(body);
    if (body.action === "prepare")
      return Response.json(
        duplicate
          ? {
              duplicate: true,
              snapshot: { id: match, game: "xiangqi", revision: 8 },
            }
          : {
              id: match,
              game: "xiangqi",
              rules_version: 1,
              color: 1,
              state: s,
              config: s.config,
              revision: 3,
            },
      );
    return Response.json(body.body);
  },
);
async function request(action, body = {}, auth = true) {
  const response = await handler(
    new Request(`https://unit.invalid/board-match/${action}`, {
      method: "POST",
      headers: {
        ...(auth ? { Authorization: "Bearer abc.def.ghi" } : {}),
        Origin: "https://kensei-workshop.vercel.app",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ game: "xiangqi", client_id: client, ...body }),
    }),
  );
  return { status: response.status, data: await response.json() };
}
assert.equal((await request("get", {}, false)).status, 401);
assert.equal(
  (await request("create", { rules_version: 2, config: { clock: "10+5" } }))
    .status,
  409,
);
assert.equal(
  (await request("create", { rules_version: 1, config: { clock: "none" } }))
    .status,
  400,
);
const start = await request("create", {
  rules_version: 1,
  config: { clock: "10+5" },
  state: { winner: 1 },
  preferred_color: -1,
});
assert.equal(start.data.state.game, "xiangqi");
assert.equal(start.data.state.result, null);
assert.equal(start.data.preferred_color, -1);
const moved = await request("command", {
  match_id: match,
  expected_version: 3,
  request_id: crypto.randomUUID(),
  action: { type: "move", uci: "e3e4" },
  state: { winner: 1 },
});
assert.equal(moved.status, 200);
assert.equal(moved.data.state.turn, -1);
assert.equal(moved.data.state.result, null);
assert.equal(moved.data.state.timeout, undefined);
assert.equal(moved.data.game, "xiangqi");
const before = calls.length;
assert.equal(
  (
    await request("command", {
      match_id: match,
      expected_version: 3,
      request_id: crypto.randomUUID(),
      action: { type: "move", uci: "e3e6" },
    })
  ).status,
  400,
);
assert.equal(calls.length, before + 1);
assert.equal(
  (
    await request("command", {
      match_id: match,
      expected_version: 3,
      request_id: crypto.randomUUID(),
      action: { type: "claim-draw" },
    })
  ).status,
  400,
);
duplicate = true;
const retry = await request("command", {
  match_id: match,
  expected_version: 3,
  request_id: crypto.randomUUID(),
  action: { type: "move", uci: "e3e4" },
});
assert.equal(retry.data.revision, 8);
console.log(
  "Xiangqi Edge: JWT, versions, standard clocks, canonical state, illegal moves/claims and duplicate receipt passed.",
);
