import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import fixture from "../support/db-fixture.cjs";
import {
  createXiangqi,
  applyXiangqi,
  compactXiangqi,
} from "../../src/games/xiangqi-engine.js";
import { createChess } from "../../src/games/chess-engine.js";
const db = new PGlite();
await db.exec(fixture.bootstrap);
for (const file of (await fs.readdir("supabase/migrations")).sort())
  await db.exec(await fs.readFile(`supabase/migrations/${file}`, "utf8"));
const users = Array.from({ length: 5 }, () => crypto.randomUUID()),
  clients = users.map(() => crypto.randomUUID());
for (let i = 0; i < users.length; i++) {
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
    [users[i], { name: `Xiangqi Fixture ${i}` }],
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    users[i],
  ]);
  await db.query("select public.ensure_my_profile($1)", [users[i]]);
  await db.exec("reset role");
}
async function call(i, action, body = {}) {
  const data = (
    await db.query("select public.board_admin($1,$2,$3) value", [
      action,
      users[i],
      { game: "xiangqi", client_id: clients[i], ...body },
    ])
  ).rows[0].value;
  if (data?.error) throw Object.assign(Error(data.error), { data });
  return data;
}
const initial = (clock = "10+5") => {
  const state = createXiangqi({ clock });
  return { config: state.config, state, ranked: true };
};
async function match(a = 0, b = 1, clock = "10+5", color = 1) {
  const r = await call(a, "create", {
    ...initial(clock),
    preferred_color: color,
  });
  assert.equal(r.color, color);
  const joined = await call(b, "join", { code: r.code });
  assert.equal(joined.color, -color);
  await call(a, "ready", { match_id: r.id });
  await call(b, "ready", { match_id: r.id });
  return call(a, "get", { match_id: r.id });
}
async function command(i, room, action, id = crypto.randomUUID()) {
  const body = {
    match_id: room.id,
    expected_version: room.revision,
    request_id: id,
    action,
  };
  const prepared = await call(i, "prepare", body);
  if (prepared.duplicate) return prepared.snapshot;
  const state = applyXiangqi(prepared.state, action, prepared.color);
  return call(i, "commit", { ...body, state });
}
let room = await match();
assert.equal(room.game, "xiangqi");
assert.equal(room.config.height, 10);
assert.equal(room.state.pieces.length, 90);
await assert.rejects(call(2, "get", { match_id: room.id }), /not available/);
await assert.rejects(call(2, "join", { code: room.code }), /full|unavailable/);
await assert.rejects(
  call(0, "get", { game: "chess", match_id: room.id }),
  /another board game/,
);
const oldRevision = room.revision,
  request = crypto.randomUUID();
room = await command(0, room, { type: "move", uci: "e3e4" }, request);
assert.equal(room.state.turn, -1);
assert.ok(
  room.clock.remaining[1] > 604000 && room.clock.remaining[1] <= 605000,
);
const duplicate = await call(0, "prepare", {
  match_id: room.id,
  expected_version: oldRevision,
  request_id: request,
  action: { type: "move", uci: "e3e4" },
});
assert.equal(duplicate.duplicate, true);
assert.equal(duplicate.snapshot.clock.remaining[1], room.clock.remaining[1]);
await assert.rejects(
  call(1, "prepare", {
    match_id: room.id,
    expected_version: oldRevision,
    request_id: crypto.randomUUID(),
    action: { type: "move", uci: "e6e5" },
  }),
  /changed/,
);
const before = room.clock.remaining[-1];
room = await command(1, room, { type: "move", uci: "e6e5" });
assert.ok(room.clock.remaining[-1] > before + 4000);
room = await command(0, room, { type: "offer-draw" });
room = await command(1, room, { type: "accept-draw" });
assert.equal(room.status, "finished");
assert.equal(room.state.result.winner, 0);
let stats = (
  await db.query(
    "select * from workshop_private.board_stats where user_id=$1 and game='xiangqi'",
    [users[0]],
  )
).rows;
assert.equal(stats.length, 1);
assert.equal(stats[0].draws, 1);
assert.equal(stats[0].time_control, "10+5");
await call(0, "get", { match_id: room.id });
assert.equal(
  (
    await db.query(
      "select count(*) n from workshop_private.board_settlements where match_id=$1",
      [room.id],
    )
  ).rows[0].n,
  1,
);

room = await match(0, 1, "5+3", -1);
assert.equal(room.state.turn, 1);
room = await command(1, room, { type: "move", uci: "a3a4" });
assert.ok(
  room.clock.remaining[1] > 302000 && room.clock.remaining[1] <= 303000,
);
await db.query(
  "update workshop_private.board_matches set clock=jsonb_set(clock,'{anchor}',to_jsonb((extract(epoch from clock_timestamp())*1000-900000)::bigint)) where id=$1",
  [room.id],
);
await db.query(
  "update workshop_private.board_members set last_seen=clock_timestamp() where match_id=$1",
  [room.id],
);
room = await call(0, "get", { match_id: room.id });
assert.equal(room.status, "finished");
assert.equal(room.state.result.reason, "timeout");
assert.equal(room.state.result.winner, 1);
assert.equal(
  (
    await db.query(
      "select count(*) n from workshop_private.board_stats where user_id=$1 and game='xiangqi'",
      [users[0]],
    )
  ).rows[0].n,
  2,
);

room = await match(0, 1, "15+10");
room = await command(0, room, { type: "move", uci: "c3c4" });
assert.ok(
  room.clock.remaining[1] > 909000 && room.clock.remaining[1] <= 910000,
);
await db.query(
  "update workshop_private.board_members set last_seen=clock_timestamp()-interval '121 seconds' where match_id=$1 and user_id=$2",
  [room.id, users[0]],
);
room = await call(1, "get", { match_id: room.id });
assert.equal(room.state.result.reason, "disconnect");
assert.equal(room.state.result.winner, -1);
room = await match();
await db.query(
  "update workshop_private.board_members set last_seen=clock_timestamp()-interval '121 seconds' where match_id=$1",
  [room.id],
);
room = await call(0, "get", { match_id: room.id });
assert.equal(room.state.result.reason, "interrupted");
assert.equal(room.state.result.winner, null);

const q0 = await call(0, "queue", initial("5+3"));
assert.equal(q0.waiting, true);
const q1 = await call(1, "queue", initial("10+5"));
assert.equal(q1.waiting, true);
const paired = await call(2, "queue", initial("5+3"));
assert.equal(paired.origin, "random");
assert.equal(paired.config.clock, "5+3");
await call(2, "cancel");
await call(1, "cancel");
const chess = createChess({ clock: "10+5" });
const cr = await call(0, "create", {
  game: "chess",
  config: chess.config,
  state: chess,
  preferred_color: 1,
});
await assert.rejects(call(0, "create", initial()), /Another board game/);
await call(0, "leave", { game: "chess", match_id: cr.id });
const first = await call(0, "create", initial()),
  second = await call(1, "create", initial());
await assert.rejects(call(2, "create", initial()), /capacity/);
await call(0, "leave", { match_id: first.id });
await call(1, "leave", { match_id: second.id });

const privatePayload = {
  game: "xiangqi",
  name: "My board",
  mode: "local",
  level: 2,
  human: 1,
  state: compactXiangqi(createXiangqi()),
};
assert.equal(
  (
    await db.query(
      "select workshop_private.validate_game_save('game',$1) value",
      [privatePayload],
    )
  ).rows[0].value.game,
  "xiangqi",
);
for (const bad of [
  { ...privatePayload, mode: undefined },
  { ...privatePayload, level: undefined },
  {
    ...privatePayload,
    state: {
      ...privatePayload.state,
      config: { ...privatePayload.state.config, height: 9 },
    },
  },
  { ...privatePayload, mode: "online" },
])
  await assert.rejects(
    db.query("select workshop_private.validate_game_save('game',$1)", [bad]),
    /Invalid Xiangqi/,
  );
await db.exec("set role anon");
await assert.rejects(
  db.query("select public.board_admin('get',$1,$2)", [users[0], {}]),
  /permission/,
);
const board = (
  await db.query("select public.get_xiangqi_leaderboard('10+5','wins',1) value")
).rows[0].value;
assert.ok(Array.isArray(board.top));
assert.equal(board.top[0].user_id, undefined);
const go = (
  await db.query(
    "select public.get_board_game_leaderboard('xiangqi','wxf2018',9,'wins',1) value",
  )
).rows[0].value;
assert.equal(go.top.length, 0);
const chessBoard = (
  await db.query("select public.get_chess_leaderboard('10+5','wins',1) value")
).rows[0].value;
assert.equal(chessBoard.top.length, 0);
await db.exec("reset role");
await db.query(
  "update workshop_private.board_stats set wins=9,losses=0,draws=0 where user_id=$1 and game='xiangqi' and time_control='10+5'",
  [users[0]],
);
assert.equal(
  (
    await db.query(
      "select public.get_xiangqi_leaderboard('10+5','rate',1) value",
    )
  ).rows[0].value.top.length,
  0,
);
await db.query(
  "update workshop_private.board_stats set wins=10 where user_id=$1 and game='xiangqi' and time_control='10+5'",
  [users[0]],
);
assert.equal(
  (
    await db.query(
      "select public.get_xiangqi_leaderboard('10+5','rate',1) value",
    )
  ).rows[0].value.top.length,
  1,
);
const publicId = (
  await db.query(
    "select public_id from public.typing_profiles where user_id=$1",
    [users[0]],
  )
).rows[0].public_id;
const profile = (
  await db.query("select public.get_public_profile($1) value", [publicId])
).rows[0].value;
assert.ok(
  Array.isArray(profile.chess_stats) &&
    Array.isArray(profile.xiangqi_stats) &&
    Array.isArray(profile.board_game_stats),
);
assert.equal(profile.xiangqi_stats.length, 3);
assert.equal(profile.chess_stats.length, 0);
assert.equal(profile.board_game_stats.length, 0);
await db.close();
console.log(
  "PASS Xiangqi migration, ownership, CAS, receipts, colors, three clocks, timeouts, queue/capacity, private saves, public partitions and profile",
);
