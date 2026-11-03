import { build } from "esbuild";
import assert from "node:assert/strict";
import { createChess } from "../../src/games/chess-engine.js";
import { timeoutVerdicts } from "../../src/games/chess-adjudication.js";
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
  s = createChess({ clock: "10+5" });
s.timeout = timeoutVerdicts(s);
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
              snapshot: { id: match, game: "chess", revision: 8 },
            }
          : {
              id: match,
              game: "chess",
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
      body: JSON.stringify({ game: "chess", client_id: client, ...body }),
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
assert.equal(start.data.state.game, "chess");
assert.equal(start.data.state.result, null);
assert.equal(start.data.preferred_color, -1);
const moved = await request("command", {
  match_id: match,
  expected_version: 3,
  request_id: crypto.randomUUID(),
  action: { type: "move", uci: "e2e4" },
  state: { winner: 1 },
});
assert.equal(moved.status, 200);
assert.equal(moved.data.state.turn, -1);
assert.equal(moved.data.state.result, null);
assert.ok(moved.data.state.timeout);
assert.equal(moved.data.game, "chess");
const before = calls.length;
assert.equal(
  (
    await request("command", {
      match_id: match,
      expected_version: 3,
      request_id: crypto.randomUUID(),
      action: { type: "move", uci: "e2e5" },
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
  action: { type: "move", uci: "e2e4" },
});
assert.equal(retry.data.revision, 8);
console.log(
  "Chess Edge: JWT, versions, standard clocks, canonical state, illegal moves/claims and duplicate receipt passed.",
);
