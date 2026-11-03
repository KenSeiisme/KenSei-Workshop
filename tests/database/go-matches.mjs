import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import fixture from "../support/db-fixture.cjs";
import {
  createGo,
  applyGo,
  compactGo,
  validateGoSave,
} from "../../src/games/go-engine.js";
const db = new PGlite();
await db.exec(fixture.bootstrap);
for (const name of (await fs.readdir("supabase/migrations")).sort()) {
  try {
    await db.exec(await fs.readFile(`supabase/migrations/${name}`, "utf8"));
  } catch (e) {
    console.error(name, e.message, e.detail, e.position);
    process.exit(1);
  }
}
const users = Array.from({ length: 5 }, () => crypto.randomUUID()),
  clients = users.map(() => crypto.randomUUID());
for (let i = 0; i < users.length; i++) {
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
    [users[i], { name: `Go Tester ${i}` }],
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    users[i],
  ]);
  await db.query("select public.ensure_my_profile($1)", [users[i]]);
  await db.exec("reset role");
}
async function call(i, action, body = {}) {
  const result = (
    await db.query("select public.board_admin($1,$2,$3) value", [
      action,
      users[i],
      { client_id: clients[i], ...body },
    ])
  ).rows[0].value;
  if (result?.error) throw Object.assign(Error(result.error), { result });
  return result;
}
const c = createGo();
const a = await call(0, "create", { config: c.config, state: c, ranked: true });
assert.equal(a.status, "waiting");
let b = await call(1, "join", { code: a.code });
assert.equal(b.status, "ready");
await assert.rejects(call(2, "join", { code: a.code }), /unavailable|full/);
await assert.rejects(call(2, "get", { match_id: a.id }), /not available/);
await call(0, "ready", { match_id: a.id });
b = await call(1, "ready", { match_id: a.id });
assert.equal(b.status, "playing");
let current = await call(0, "get", { match_id: a.id });
const actorIndex = current.color === 1 ? 0 : 1,
  request = crypto.randomUUID(),
  action = { type: "move", index: 40 };
let p = await call(actorIndex, "prepare", {
  match_id: a.id,
  expected_version: current.revision,
  request_id: request,
  action,
});
let n = await call(actorIndex, "commit", {
  match_id: a.id,
  expected_version: p.revision,
  request_id: request,
  action,
  state: applyGo(p.state, action, p.color),
});
assert.equal(n.state.board[40], 1);
const duplicate = await call(actorIndex, "prepare", {
  match_id: a.id,
  expected_version: p.revision,
  request_id: request,
  action,
});
assert.equal(duplicate.duplicate, true);
await assert.rejects(
  call(actorIndex, "prepare", {
    match_id: a.id,
    expected_version: p.revision,
    request_id: crypto.randomUUID(),
    action,
  }),
  /board changed/,
);
await assert.rejects(
  call(1 - actorIndex, "prepare", {
    match_id: a.id,
    expected_version: n.revision,
    request_id: request,
    action,
  }),
  /another action/,
);
const secondTab = (
  await db.query("select public.board_admin('get',$1,$2) value", [
    users[actorIndex],
    { client_id: crypto.randomUUID(), match_id: a.id },
  ])
).rows[0].value;
assert.equal(secondTab.controller, false);
await call(actorIndex, "leave", { match_id: a.id });
await call(actorIndex, "leave", { match_id: a.id });
assert.equal(
  (
    await db.query(
      "select count(*) n from workshop_private.board_settlements where match_id=$1",
      [a.id],
    )
  ).rows[0].n,
  1,
);
assert.equal(
  (
    await db.query(
      "select sum(wins) w,sum(losses) l from workshop_private.board_stats",
    )
  ).rows[0].w,
  1,
);
const board = (
  await db.query("select public.get_board_game_leaderboard() value")
).rows[0].value;
assert.equal(board.top.length, 2);
assert.equal(board.top[0].wins, 1);
assert.equal(Object.hasOwn(board.top[0], "user_id"), false);
assert.equal(
  (
    await db.query(
      "select public.get_board_game_leaderboard(sort_by=>'rate') value",
    )
  ).rows[0].value.top.length,
  0,
);
const wait = await call(2, "queue", {
  config: c.config,
  state: c,
  ranked: true,
});
assert.equal(wait.waiting, true);
const matched = await call(3, "queue", {
  config: c.config,
  state: c,
  ranked: true,
});
assert.equal(matched.origin, "random");
assert.equal((await call(2, "get")).id, matched.id);
await db.query(
  "update workshop_private.board_matches set ready_deadline=clock_timestamp()-interval '1 second' where id=$1",
  [matched.id],
);
await db.exec("select workshop_private.board_sweep()");
assert.equal((await call(2, "get", { match_id: matched.id })).status, "closed");
assert.equal(
  (await db.query("select count(*) n from workshop_private.board_stats"))
    .rows[0].n,
  2,
);
await db.exec("set role authenticated");
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
  users[0],
]);
await assert.rejects(
  db.query("select public.board_admin('get',$1,'{}')", [users[0]]),
  /permission denied/,
);
await assert.rejects(
  db.query("select * from workshop_private.board_matches"),
  /permission denied/,
);
await db.exec("reset role");
async function playing(i = 0, j = 1, config = {}) {
  const s = createGo(config),
    created = await call(i, "create", {
      config: s.config,
      state: s,
      ranked: !config.training && !config.handicap,
    });
  await call(j, "join", { code: created.code });
  await call(i, "ready", {
    match_id: created.id,
    accept_training: !!config.training,
  });
  return call(j, "ready", {
    match_id: created.id,
    accept_training: !!config.training,
  });
}
let timed = await playing();
await db.query(
  "update workshop_private.board_matches set clock=jsonb_set(jsonb_set(clock,'{anchor}',to_jsonb(floor(extract(epoch from clock_timestamp())*1000)-1000)),'{remaining}', '{\"1\":0,\"-1\":0}'),state=jsonb_set(state,'{turn}','1') where id=$1",
  [timed.id],
);
await db.query(
  "update workshop_private.board_matches set clock=jsonb_set(clock,'{periods}','{\"1\":0,\"-1\":0}') where id=$1",
  [timed.id],
);
await db.exec("select workshop_private.board_sweep()");
let ended = await call(0, "get", { match_id: timed.id });
assert.equal(ended.state.result.reason, "timeout");
assert.equal(ended.state.result.winner, -1);
timed = await playing();
await db.query(
  "update workshop_private.board_members set last_seen=clock_timestamp()-interval '121 seconds' where match_id=$1 and user_id=$2",
  [timed.id, users[0]],
);
await db.exec("select workshop_private.board_sweep()");
ended = await call(0, "get", { match_id: timed.id });
assert.equal(ended.state.result.reason, "disconnect");
assert.equal(ended.state.result.winner, -ended.color);
timed = await playing();
await db.query(
  "update workshop_private.board_members set last_seen=clock_timestamp()-interval '121 seconds' where match_id=$1",
  [timed.id],
);
await db.exec("select workshop_private.board_sweep()");
ended = await call(0, "get", { match_id: timed.id });
assert.equal(ended.status, "interrupted");
assert.equal(ended.state.result.winner, null);
const totalBefore = (
  await db.query(
    "select sum(wins+losses+draws) n from workshop_private.board_stats",
  )
).rows[0].n;
timed = await playing(0, 1, { training: true });
assert.equal(timed.ranked, false);
const peekAction = { type: "peek" },
  peekRequest = crypto.randomUUID(),
  peekBefore = await call(0, "get", { match_id: timed.id });
const peekResult = await call(0, "commit", {
  match_id: timed.id,
  expected_version: peekBefore.revision,
  request_id: peekRequest,
  action: peekAction,
  state: applyGo(peekBefore.state, peekAction, peekBefore.color),
});
assert.equal(peekResult.state.peeks[peekBefore.color], 1);
assert.deepEqual(peekResult.clock, peekBefore.clock);
await call(0, "leave", { match_id: timed.id });
assert.equal(
  (
    await db.query(
      "select sum(wins+losses+draws) n from workshop_private.board_stats",
    )
  ).rows[0].n,
  totalBefore,
);
const r1 = await call(0, "create", {
    config: c.config,
    state: c,
    ranked: true,
  }),
  r2 = await call(2, "create", { config: c.config, state: c, ranked: true });
await assert.rejects(
  call(4, "create", { config: c.config, state: c, ranked: true }),
  /capacity/,
);
const queuedCapacity = await call(4, "queue", {
  config: c.config,
  state: c,
  ranked: true,
});
assert.equal(queuedCapacity.capacity, true);
await call(4, "cancel");
assert.equal(
  (await db.query("select count(*) n from workshop_private.board_queue"))
    .rows[0].n,
  0,
);
await call(0, "leave", { match_id: r1.id });
await call(2, "leave", { match_id: r2.id });
await db.query(
  "update workshop_private.board_stats set wins=9,losses=1,draws=0 where user_id=$1",
  [users[0]],
);
assert.equal(
  (
    await db.query(
      "select public.get_board_game_leaderboard(sort_by=>'rate') value",
    )
  ).rows[0].value.top.length,
  1,
);
const profile = (
  await db.query(
    "select public.get_public_profile(public_id) value from public.typing_profiles where user_id=$1",
    [users[0]],
  )
).rows[0].value;
assert.equal(profile.board_game_stats[0].played, 10);
assert.ok(Array.isArray(profile.best_scores));
assert.ok(Array.isArray(profile.game_best_scores));
assert.equal(JSON.stringify(profile).includes(users[0]), false);
await db.exec("set role authenticated");
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
  users[0],
]);
const topic = `board:${r1.id}:${r1.channel_key}`;
await db.query("select set_config('realtime.topic',$1,false)", [topic]);
await assert.rejects(
  db.query(
    "insert into realtime.messages(topic,extension,payload) values($1,'broadcast','{}')",
    [topic],
  ),
  /row-level security/,
);
await db.exec("reset role");
console.log(
  "Go database: invites, ownership, CAS, idempotency, read-only tabs, queue, ready expiry, statistics and permissions passed.",
);
const saveId = crypto.randomUUID(),
  saveOp = crypto.randomUUID(),
  payload = validateGoSave({
    game: "go",
    name: "Go private save",
    state: compactGo(createGo({ training: true })),
    mode: "ai",
    level: 2,
    human: -1,
    practice_clock: { 1: 500, "-1": 1200 },
  });
await db.exec("set role authenticated");
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
  users[0],
]);
const saved = (
  await db.query(
    "select public.save_game_save('game',$1,$2,0,$3,false,$4) value",
    [saveId, payload, saveOp, users[0]],
  )
).rows[0].value;
assert.deepEqual(saved.data, payload);
assert.equal(saved.data.elapsed, 1700);
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
  users[1],
]);
assert.equal(
  (
    await db.query("select public.get_game_save('game',$1,$2) value", [
      saveId,
      users[1],
    ])
  ).rows[0].value,
  null,
);
await db.exec("reset role");
console.log(
  "Go private save: mode, AI options, memory, per-player clocks and account isolation passed.",
);
await db.close();
