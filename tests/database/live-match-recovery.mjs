import assert from "node:assert/strict";
import { gameDatabase } from "../support/games-fixture.mjs";

const {
  db,
  users: [a, b],
  rpc,
  as,
  value,
} = await gameDatabase();
const stranger = "33333333-3333-4333-8333-333333333333";
await db.query("insert into auth.users values ($1,'{}')", [stranger]);
await rpc(
  "ensure_my_profile",
  { expected_user: stranger },
  "authenticated",
  stranger,
);
const clients = new Map(
  [a, b, stranger].map((id) => [id, crypto.randomUUID()]),
);
const pong = (user, action, body = {}) =>
  rpc(
    "pong_room",
    {
      action,
      body: { client_id: clients.get(user), protocol_version: 2, ...body },
    },
    "authenticated",
    user,
  );
const live = (user) => rpc("get_my_live_games", {}, "authenticated", user);
const sweep = () => db.exec("select workshop_private.sweep_live_games()");
const room = await pong(a, "create");
assert.equal(room.protocol_version, 2);
assert.equal(room.status, "waiting");
assert.match(
  (await pong(b, "join", { code: room.code, protocol_version: 1 })).error,
  /Refresh Pong/,
);
await pong(b, "join", { code: room.code });

const rawBoard = await db.query(
  "insert into workshop_private.board_matches (game,config,state,origin) values ('chess',$1,'{}','invite') returning id",
  [{ rule: "standard", clock: "10+5", size: 8 }],
);
const board = rawBoard.rows[0].id;
await db.query(
  "insert into workshop_private.board_members (match_id,user_id,color,client_id) values ($1,$2,1,$3)",
  [board, a, clients.get(a)],
);
let found = (await live(a)).matches;
assert.deepEqual(
  new Set(found.map((row) => row.id)),
  new Set([room.id, board]),
);
assert.equal(found.find((row) => row.id === board).clock, "10+5");
assert.deepEqual(Object.keys(found.find((row) => row.id === room.id)).sort(), [
  "deadline",
  "game",
  "id",
  "score",
  "status",
]);
assert.deepEqual((await live(stranger)).matches, []);
await assert.rejects(rpc("get_my_live_games", {}, "anon", null));
await assert.rejects(pong(stranger, "get", { room_id: room.id }));
assert.match((await pong(stranger, "create")).error, /capacity/);

const request = (game, extra = {}) => ({
  room_id: game.id,
  round: game.round,
  generation: game.generation,
  ...extra,
});
await pong(a, "ready", request(room));
let playing = await pong(b, "ready", request(room));
assert.equal(playing.status, "playing");
assert.notEqual(playing.channel_key, room.channel_key);
assert.equal(playing.round, 1);
assert.deepEqual(playing.score, [0, 0]);
await assert.rejects(
  pong(
    b,
    "checkpoint",
    request(playing, { ticks: 800, score_host: 1, score_guest: 0 }),
  ),
  /Only the room host/,
);
assert.match(
  (
    await pong(
      a,
      "checkpoint",
      request(playing, { ticks: 800, score_host: 2, score_guest: 0 }),
    )
  ).error,
  /Invalid Pong/,
);
const score = request(playing, { ticks: 800, score_host: 1, score_guest: 0 });
const first = await pong(a, "checkpoint", score);
const duplicate = await pong(a, "checkpoint", score);
assert.equal(first.revision, duplicate.revision);
assert.deepEqual(duplicate.score, [1, 0]);
assert.equal(duplicate.ticks, 800);
await pong(a, "heartbeat", request(playing, { ticks: 1400 }));
assert.deepEqual((await live(b)).matches[0].score, [1, 0]);

const oldClient = clients.get(a),
  newClient = crypto.randomUUID();
const readonly = await pong(a, "get", {
  room_id: room.id,
  client_id: newClient,
});
assert.equal(readonly.controller, false);
assert.equal(readonly.channel_key, undefined);
assert.equal(readonly.code, undefined);
await assert.rejects(
  pong(a, "pause", request(playing, { client_id: newClient })),
  /Take control/,
);
const taken = await pong(
  a,
  "takeover",
  request(playing, { client_id: newClient }),
);
clients.set(a, newClient);
assert.equal(taken.controller, true);
assert.equal(taken.status, "paused");
assert.equal(taken.restart_serve, true);
assert.ok(taken.resume_until);
assert.equal(taken.ticks, 1400);
assert.deepEqual(taken.score, [1, 0]);
assert.notEqual(taken.channel_key, playing.channel_key);
assert.equal(
  (await pong(a, "heartbeat", request(playing, { client_id: oldClient })))
    .controller,
  false,
);
assert.match(
  (await pong(a, "leave", request(playing, { client_id: oldClient }))).error,
  /changed/,
);
assert.equal(
  await as("authenticated", a, () =>
    value("select workshop_private.pong_channel_access($1,true) as value", [
      `pong:${room.id}:${playing.channel_key}:host`,
    ]),
  ),
  false,
);
assert.equal((await pong(a, "ready", request(taken))).status, "paused");
playing = await pong(b, "ready", request(taken));
assert.equal(playing.status, "playing");
assert.equal(playing.round, taken.round);
assert.deepEqual(playing.score, [1, 0]);
assert.equal(playing.ticks, 1400);
const paused = await pong(a, "pause", request(playing, { ticks: 1500 }));
assert.equal(paused.restart_serve, false);
assert.equal(paused.ticks, 1500);
await pong(a, "ready", request(paused));
playing = await pong(b, "ready", request(paused));
assert.equal(playing.restart_serve, false);

const frozen = await value(
  "select last_seen as value from workshop_private.pong_room_members where room_id=$1 and user_id=$2",
  [room.id, a],
);
await live(a);
await pong(a, "get", { room_id: room.id });
assert.equal(
  (
    await value(
      "select last_seen as value from workshop_private.pong_room_members where room_id=$1 and user_id=$2",
      [room.id, a],
    )
  ).getTime(),
  frozen.getTime(),
);
await db.query(
  "update workshop_private.pong_room_members set last_seen=now()-interval '55 seconds' where room_id=$1",
  [room.id],
);
await sweep();
const reconnect = await pong(a, "get", { room_id: room.id });
assert.equal(reconnect.status, "paused");
assert.equal(reconnect.restart_serve, true);
assert.match((await pong(stranger, "create")).error, /capacity/);
await db.query(
  "update workshop_private.pong_rooms set paused_at=now()-interval '61 seconds' where id=$1",
  [room.id],
);
assert.deepEqual((await live(b)).matches, []);
await sweep();
assert.equal(
  (await pong(a, "get", { room_id: room.id })).status,
  "interrupted",
);
assert.ok((await pong(stranger, "create")).id);

assert.equal(
  await value(
    "select count(*)::int as value from workshop_private.game_results",
  ),
  0,
);
await db.close();
console.log(
  "PASS live matches: member-only discovery and metadata, score idempotency, control takeover, readiness, passive recovery and shared room expiry.",
);
