import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
process.on("uncaughtException", (e) => {
  console.error(e.message, e.where, e.position);
  process.exit(1);
});
const db = new PGlite();
await db.exec((await import("../support/db-fixture.cjs")).bootstrap);
for (const f of (await fs.readdir("supabase/migrations")).sort())
  await db.exec(await fs.readFile("supabase/migrations/" + f, "utf8"));
const users = Array.from({ length: 5 }, () => crypto.randomUUID());
for (const id of users)
  await db.query("insert into auth.users(id) values($1)", [id]);
async function as(id, fn) {
  await db.exec(
    `set role ${id ? "authenticated" : "anon"};select set_config('request.jwt.claim.sub','${id || ""}',false)`,
  );
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
const clients = users.map(() => crypto.randomUUID());
async function call(i, action, body = {}) {
  return as(users[i], async () => {
    const r = (
      await db.query("select public.whiteboard_room($1,$2) value", [
        action,
        { client_id: clients[i], ...body },
      ])
    ).rows[0].value;
    if (r?.error) throw Error(r.error);
    return r;
  });
}
for (let i = 0; i < 5; i++)
  await as(users[i], () =>
    db.query("select public.ensure_my_profile($1)", [users[i]]),
  );
const el = (id, v = 1, n = 10) => ({
  id,
  type: "rectangle",
  version: v,
  versionNonce: n,
  index: "a" + id,
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  angle: 0,
  isDeleted: false,
});
const room = await call(0, "create", { name: "共同 Whiteboard", elements: [] });
const body = { room_id: room.id };
const invite = await call(0, "invite", body);
for (let i = 1; i < 4; i++) await call(i, "join", { token: invite.token });
await assert.rejects(() => call(4, "join", { code: invite.code }), /four/);
await assert.rejects(() => call(4, "get", body), /unavailable/);
for (let i = 0; i < 4; i++) assert((await call(i, "activate", body)).editing);
const save = async (i, e, op = crypto.randomUUID()) =>
  call(i, "save", {
    ...body,
    channel_key: room.channel_key,
    elements: e,
    operation_id: op,
  });
const op = crypto.randomUUID();
await save(0, [el("0")], op);
await save(0, [el("0")], op);
await save(1, [el("1")]);
await save(2, [el("0", 2, 20)]);
let out = await save(3, [el("0", 2, 5)]);
assert.equal(out.elements.length, 2);
assert.equal(out.elements.find((x) => x.id === "0").versionNonce, 5);
await save(0, [{ ...el("0", 3), isDeleted: true }]);
out = await save(1, [el("0", 1)]);
assert(out.elements.find((x) => x.id === "0").isDeleted);
await assert.rejects(() => call(1, "delete", body), /Only the owner/);
const tab = await as(
  users[1],
  async () =>
    (
      await db.query("select public.whiteboard_room($1,$2) value", [
        "activate",
        { ...body, client_id: crypto.randomUUID() },
      ])
    ).rows[0].value,
);
assert(!tab.editing);
await call(0, "reset_invite", body);
await assert.rejects(() => call(4, "join", { code: invite.code }), /invalid/);
await call(0, "remove", { ...body, user_id: users[3] });
await assert.rejects(() => call(3, "get", body), /unavailable/);
await assert.rejects(() => save(3, [el("x")]), /unavailable/);
await as(null, () =>
  assert.rejects(
    () => db.query("select public.whiteboard_room($1,$2)", ["list", {}]),
    /permission|Sign in/,
  ),
);
await as(users[1], () =>
  assert.rejects(
    () => db.query("select * from workshop_private.shared_whiteboard_elements"),
    /permission/,
  ),
);

const room2 = await call(4, "create", { name: "Second shared board" });
assert((await call(4, "activate", { room_id: room2.id })).editing);
const pong = async (i) =>
  as(
    users[i],
    async () =>
      (
        await db.query("select public.pong_room('create',$1) value", [
          { client_id: clients[i] },
        ])
      ).rows[0].value,
  );
assert((await pong(3)).error.includes("capacity"));
for (let i = 0; i < 3; i++) await call(i, "release", body);
const pongRoom = await pong(3);
assert(pongRoom.id);
assert((await pong(2)).error.includes("capacity"));
await assert.rejects(
  () =>
    call(0, "activate", body).then((x) => {
      if (!x.editing) throw Error("capacity");
    }),
  /capacity/,
);
await as(users[3], () =>
  db.query("select public.pong_room('leave',$1)", [
    { client_id: clients[3], room_id: pongRoom.id },
  ]),
);
assert((await call(0, "activate", body)).editing);
const before = (await call(0, "get", body)).revision;
const currentKey = (await call(0, "get", body)).channel_key;
await assert.rejects(
  () =>
    call(0, "save", {
      ...body,
      channel_key: currentKey,
      elements: [{ ...el("oversize"), text: "a".repeat(2000000) }],
      operation_id: crypto.randomUUID(),
    }),
  /2 MB/,
);
assert.equal((await call(0, "get", body)).revision, before);
console.log(
  "PASS shared capacity: two boards block Pong, one board plus Pong fills capacity, release frees a slot; oversized merge rolls back.",
);
console.log(
  "PASS shared boards: 4 members, ownership, same-tab lease, merge/nonce, tombstones, idempotence, reset and removal.",
);
await db.close();
