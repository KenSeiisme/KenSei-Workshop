import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import fixture from "../support/db-fixture.cjs";
import {
  createChess,
  applyChess,
  compactChess,
} from "../../src/games/chess-engine.js";
import { timeoutVerdicts } from "../../src/games/chess-adjudication.js";
const db = new PGlite();
await db.exec(fixture.bootstrap);
for (const file of (await fs.readdir("supabase/migrations")).sort())
  await db.exec(await fs.readFile(`supabase/migrations/${file}`, "utf8"));
const users = Array.from({ length: 5 }, () => crypto.randomUUID()),
  clients = users.map(() => crypto.randomUUID());
for (let i = 0; i < users.length; i++) {
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
    [users[i], { name: `Chess Tester ${i}` }],
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    users[i],
  ]);
  await db.query("select public.ensure_my_profile($1)", [users[i]]);
  await db.exec("reset role");
}
async function call(i, action, body = {}) {
  const value = (
    await db.query("select public.board_admin($1,$2,$3) value", [
      action,
      users[i],
      { game: "chess", client_id: clients[i], ...body },
    ])
  ).rows[0].value;
  if (value?.error) throw Object.assign(Error(value.error), { value });
  return value;
}
function initial(preset = "10+5") {
  const s = createChess({ clock: preset });
  s.timeout = timeoutVerdicts(s);
  return { config: s.config, state: s, ranked: true };
}
async function match(a, b, preset = "10+5") {
  const first = await call(a, "create", {
    ...initial(preset),
    preferred_color: 1,
  });
  await call(b, "join", { code: first.code });
  await call(a, "ready", { match_id: first.id });
  await call(b, "ready", { match_id: first.id });
  return call(a, "get", { match_id: first.id });
}
async function command(i, room, action, request = crypto.randomUUID()) {
  const payload = {
    match_id: room.id,
    expected_version: room.revision,
    request_id: request,
    action,
  };
  const p = await call(i, "prepare", payload);
  if (p.duplicate) return p.snapshot;
  const state = applyChess(p.state, action, p.color);
  state.timeout =
    action.type === "move" ? timeoutVerdicts(state) : p.state.timeout;
  return call(i, "commit", { ...payload, state });
}
let r = await match(0, 1);
assert.equal(r.game, "chess");
assert.equal(r.color, 1);
assert.equal(r.clock.remaining[1], 600000);
await assert.rejects(call(2, "get", { match_id: r.id }), /not available/);
await assert.rejects(call(2, "join", { code: r.code }), /unavailable|full/);
await assert.rejects(
  call(0, "get", { game: "go", match_id: r.id }),
  /another board game/,
);
let rid = crypto.randomUUID(),
  oldRevision = r.revision;
r = await command(0, r, { type: "move", uci: "e2e4" }, rid);
assert.match(r.state.fen, /4P3/);
assert.ok(r.clock.remaining[1] > 604000 && r.clock.remaining[1] <= 605000);
const again = await call(0, "prepare", {
  match_id: r.id,
  expected_version: oldRevision,
  request_id: rid,
  action: { type: "move", uci: "e2e4" },
});
assert.equal(again.duplicate, true);
assert.equal(again.snapshot.clock.remaining[1], r.clock.remaining[1]);
await assert.rejects(
  call(1, "prepare", {
    match_id: r.id,
    expected_version: r.revision,
    request_id: rid,
    action: { type: "move", uci: "e7e5" },
  }),
  /another action/,
);
await assert.rejects(command(0, r, { type: "move", uci: "d2d4" }), /turn/);
await assert.rejects(
  call(1, "prepare", {
    match_id: r.id,
    expected_version: oldRevision,
    request_id: crypto.randomUUID(),
    action: { type: "move", uci: "e7e5" },
  }),
  /board changed/,
);
let whiteRemain = r.clock.remaining[1];
r = await command(0, r, { type: "offer-draw" });
assert.equal(r.clock.remaining[1], whiteRemain);
assert.ok(r.clock.remaining[-1] <= 600000);
r = await command(1, r, { type: "decline-draw" });
r = await command(1, r, { type: "move", uci: "e7e5" });
assert.ok(r.clock.remaining[-1] > 604000);
const otherTab = await call(0, "get", {
  match_id: r.id,
  client_id: crypto.randomUUID(),
});
assert.equal(otherTab.controller, false);
r = await command(0, r, { type: "resign" });
assert.equal(r.status, "finished");
await call(0, "leave", { match_id: r.id });
assert.equal(
  (
    await db.query(
      "select count(*)::int n from workshop_private.board_settlements where match_id=$1",
      [r.id],
    )
  ).rows[0].n,
  1,
);
let board = (await db.query("select public.get_chess_leaderboard() value"))
  .rows[0].value;
assert.equal(board.top[0].wins, 1);
assert.equal(Object.hasOwn(board.top[0], "user_id"), false);
assert.equal(
  (await db.query("select public.get_board_game_leaderboard() value")).rows[0]
    .value.top.length,
  0,
);
assert.equal(
  (
    await db.query(
      "select public.get_board_game_leaderboard('chess','fide',8) value",
    )
  ).rows[0].value.top.length,
  0,
);
const profile = (
  await db.query(
    "select public.get_public_profile((select public_id from public.typing_profiles where user_id=$1)) value",
    [users[1]],
  )
).rows[0].value;
assert.equal(profile.chess_stats.length, 1);
assert.equal(profile.board_game_stats.length, 0);
assert.equal(
  (await db.query("select public.get_chess_leaderboard(sort_by=>'rate') value"))
    .rows[0].value.top.length,
  0,
);
let q = await call(2, "queue", initial("5+3"));
assert.equal(q.waiting, true);
let different = await call(3, "queue", initial("15+10"));
assert.equal(different.waiting, true);
let paired = await call(4, "queue", initial("5+3"));
assert.equal(paired.origin, "random");
assert.equal(paired.config.clock, "5+3");
await db.query(
  "update workshop_private.board_matches set ready_deadline=clock_timestamp()-interval '1 second' where id=$1",
  [paired.id],
);
await db.exec("select workshop_private.board_sweep()");
assert.equal((await call(2, "get", { match_id: paired.id })).status, "closed");
await call(3, "cancel");
r = await match(0, 1, "5+3");
await db.query(
  "update workshop_private.board_matches set clock=jsonb_set(clock,'{anchor}',to_jsonb((extract(epoch from clock_timestamp())*1000-300001)::bigint)) where id=$1",
  [r.id],
);
r = await call(0, "get", { match_id: r.id });
assert.equal(r.state.result.reason, "timeout");
assert.equal(r.state.result.winner, -1);
r = await match(0, 1);
await db.query(
  "update workshop_private.board_matches set state=jsonb_set(state,'{timeout,1}', '{\"winner\":null,\"reason\":\"unresolved\"}'::jsonb),clock=jsonb_set(clock,'{anchor}',to_jsonb((extract(epoch from clock_timestamp())*1000-600001)::bigint)) where id=$1",
  [r.id],
);
r = await call(0, "get", { match_id: r.id });
assert.equal(r.status, "unresolved");
assert.equal(
  (
    await db.query(
      "select count(*)::int n from workshop_private.board_settlements where match_id=$1",
      [r.id],
    )
  ).rows[0].n,
  0,
);
assert.equal(
  (await db.query("select workshop_private.board_live_count() n")).rows[0].n,
  0,
);
await assert.rejects(
  command(0, r, { type: "move", uci: "d2d4" }),
  /mutual draw/,
);
r = await command(0, r, { type: "offer-draw" });
r = await command(1, r, { type: "accept-draw" });
assert.equal(r.state.result.winner, 0);
assert.equal(r.status, "finished");
const winsBefore = (
  await db.query("select sum(wins)::int n from workshop_private.board_stats")
).rows[0].n;
r = await match(0, 1);
await db.query(
  "update workshop_private.board_members set last_seen=clock_timestamp()-interval '121 seconds' where match_id=$1",
  [r.id],
);
r = await call(0, "get", { match_id: r.id });
assert.equal(r.state.result.reason, "interrupted");
assert.equal(
  (await db.query("select sum(wins)::int n from workshop_private.board_stats"))
    .rows[0].n,
  winsBefore,
);
for (let i = 0; i < 8; i++) {
  const fixtureMatch = await match(0, 1);
  await command(0, fixtureMatch, { type: "resign" });
  const rate = (
    await db.query("select public.get_chess_leaderboard(sort_by=>'rate') value")
  ).rows[0].value;
  assert.equal(rate.top.length, i === 7 ? 2 : 0);
}
const rate = (
  await db.query("select public.get_chess_leaderboard(sort_by=>'rate') value")
).rows[0].value;
assert.equal(rate.top[0].played, 10);
assert.equal(rate.top[0].wins, 9);
assert.equal(Number(rate.top[0].win_rate), 0.9);
const recordId = crypto.randomUUID(),
  payload = {
    game: "chess",
    difficulty: "none",
    name: "西洋棋測試",
    state: compactChess(createChess()),
    mode: "ai",
    human: 1,
    level: 2,
    clock: null,
    best: null,
  };
await db.exec("set role authenticated");
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
  users[0],
]);
const saved = (
  await db.query(
    "select public.save_game_save('game',$1,$2,0,$3,false,$4) value",
    [recordId, payload, crypto.randomUUID(), users[0]],
  )
).rows[0].value;
assert.deepEqual(saved.data, payload);
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
  users[1],
]);
assert.equal(
  (
    await db.query("select public.get_game_save('game',$1,$2) value", [
      recordId,
      users[1],
    ])
  ).rows[0].value,
  null,
);
await db.exec("reset role");
await db.exec("set role anon");
assert.ok(
  (await db.query("select public.get_chess_leaderboard() value")).rows[0].value
    .top,
);
await assert.rejects(
  db.query("select * from workshop_private.board_matches"),
  /permission denied/,
);
await assert.rejects(
  db.query("select public.board_admin('get',$1,$2)", [
    users[0],
    { client_id: clients[0], game: "chess" },
  ]),
  /permission denied/,
);
await db.exec("reset role");
await db.close();
console.log(
  "Chess database: ownership, game isolation, Fischer clocks, idempotency, queues, timeouts, unresolved agreement, statistics, profile and permissions passed.",
);
