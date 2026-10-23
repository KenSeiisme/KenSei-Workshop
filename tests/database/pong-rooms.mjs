import assert from "node:assert/strict";
import { gameDatabase } from "../support/games-fixture.mjs";
const {
  db,
  users: [a, b],
  rpc,
  as,
  value,
} = await gameDatabase();
const c = "33333333-3333-4333-8333-333333333333",
  d = "44444444-4444-4444-8444-444444444444";
for (const id of [c, d]) {
  await db.query("insert into auth.users values($1,'{}')", [id]);
  await rpc("ensure_my_profile", { expected_user: id }, "authenticated", id);
}
const clients = new Map([a, b, c, d].map((id) => [id, crypto.randomUUID()]));
const call = (user, action, body = {}) =>
  rpc(
    "pong_room",
    { action, body: { client_id: clients.get(user), ...body } },
    "authenticated",
    user,
  );
await assert.rejects(() =>
  rpc(
    "pong_room",
    { action: "create", body: { client_id: clients.get(a) } },
    "anon",
    null,
  ),
);
const room = await call(a, "create");
assert.equal(room.status, "waiting");
assert.equal(room.players.length, 1);
assert.equal(room.role, "host");
assert.match((await call(a, "create")).error, /already/);
const joined = await call(b, "join", { code: room.code });
assert.equal(joined.players.length, 2);
assert.equal(joined.role, "guest");
assert.match((await call(c, "join", { code: room.code })).error, /two players/);
assert.match(
  (await call(a, "join", { code: room.code, client_id: crypto.randomUUID() }))
    .error,
  /another tab/,
);
await assert.rejects(() => call(c, "get", { room_id: room.id }));
const topic = (role) => `pong:${room.id}:${room.channel_key}:${role}`;
for (const [user, role] of [
  [a, "host"],
  [b, "guest"],
]) {
  for (const direction of ["host", "guest"]) {
    const allowed = await as("authenticated", user, () =>
      value("select workshop_private.pong_channel_access($1,true) as value", [
        topic(direction),
      ]),
    );
    assert.equal(allowed, role === direction);
  }
}
assert.equal(
  await as("authenticated", c, () =>
    value("select workshop_private.pong_channel_access($1,false) as value", [
      topic("host"),
    ]),
  ),
  false,
);
const r2 = await call(c, "create");
assert.ok(r2.id);
assert.match((await call(d, "create")).error, /occupied/);
const ready = (body) => ({ room_id: room.id, round: 0, ...body });
assert.equal((await call(a, "ready", ready())).status, "waiting");
let started = await call(b, "ready", ready());
assert.equal(started.status, "playing");
assert.equal(started.round, 1);
let paused = await call(b, "pause", { room_id: room.id, round: 1 });
assert.equal(paused.status, "paused");
assert.ok(paused.players.every((p) => !p.ready));
await call(a, "ready", { room_id: room.id, round: 1 });
assert.equal((await call(b, "ready", { room_id: room.id, round: 1 })).round, 1);
await assert.rejects(() => call(b, "finish", { room_id: room.id, round: 1 }));
assert.equal(
  (await call(a, "finish", { room_id: room.id, round: 1 })).status,
  "finished",
);
await call(a, "ready", { room_id: room.id, round: 1 });
started = await call(b, "ready", { room_id: room.id, round: 1 });
assert.equal(started.round, 2);
assert.match(
  (await call(a, "pause", { room_id: room.id, round: 1 })).error,
  /changed/,
);
assert.equal((await call(b, "leave", { room_id: room.id })).status, "closed");
assert.equal(
  await as("authenticated", a, () =>
    value("select workshop_private.pong_channel_access($1,false) as value", [
      topic("host"),
    ]),
  ),
  false,
);
await db.query(
  "update workshop_private.pong_rooms set expires_at=now()-interval '1 second' where id=$1",
  [r2.id],
);
assert.equal((await call(c, "get", { room_id: r2.id })).status, "closed");
for (let i = 0; i < 11; i++) await call(d, "join", { code: "BADCODE0" });
assert.match((await call(d, "join", { code: room.code })).error, /Too many/);
assert.equal(
  await value(
    "select count(*)::int as value from workshop_private.game_results",
  ),
  0,
  "Pong never adds Public results.",
);
await db.close();
console.log(
  "PASS Pong: authenticated invite rooms, atomic two-player/capacity limits, directional topic permissions, readiness, pause/rematch, stale round rejection, expiry and failed-join rate limiting.",
);
