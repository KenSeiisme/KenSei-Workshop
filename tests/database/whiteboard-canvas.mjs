import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import fixture from "../support/db-fixture.cjs";
const db = new PGlite();
await db.exec(fixture.bootstrap);
for (const file of (await fs.readdir("supabase/migrations")).sort())
  await db.exec(await fs.readFile("supabase/migrations/" + file, "utf8"));
const ids = Array.from({ length: 5 }, () => crypto.randomUUID()),
  clients = ids.map(() => crypto.randomUUID());
for (const id of ids)
  await db.query("insert into auth.users(id) values($1)", [id]);
async function as(i, fn) {
  await db.exec("set role " + (i === null ? "anon" : "authenticated"));
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    ids[i] || "",
  ]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
async function call(i, name, args) {
  return as(i, async () => {
    const keys = Object.keys(args);
    const result = (
      await db.query(
        "select public." +
          name +
          "(" +
          keys.map((k, n) => k + "=>$" + (n + 1)).join(",") +
          ") value",
        Object.values(args),
      )
    ).rows[0].value;
    if (result?.error) throw Error(result.error);
    return result;
  });
}
const paper = { version: 1, type: "graph", spacing: 20 },
  appState = { viewBackgroundColor: "#fff", gridSize: null, paper },
  shape = {
    id: "node",
    type: "rectangle",
    version: 1,
    versionNonce: 10,
    index: "a0",
    x: 10,
    y: 20,
    width: 120,
    height: 60,
    angle: 0,
    isDeleted: false,
  },
  arrow = {
    ...shape,
    id: "arrow",
    type: "arrow",
    index: "a1",
    points: [
      [0, 0],
      [120, 0],
    ],
    startBinding: { elementId: "node", focus: 0, gap: 1 },
    endBinding: null,
    customData: { kenseiPorts: { version: 1, start: 3, end: null } },
  };
const data = {
    version: 1,
    name: "紙張與連接",
    elements: [shape, arrow],
    appState,
  },
  record = crypto.randomUUID();
const save = (payload, revision = 0) =>
  call(0, "save_private_record", {
    kind: "whiteboard",
    record_id: record,
    payload,
    base_revision: revision,
    operation_id: crypto.randomUUID(),
    remove_record: false,
    expected_user: ids[0],
  });
const first = await save(data);
assert.deepEqual(first.data.appState.paper, paper);
assert.deepEqual(first.data.elements[1].customData, arrow.customData);
const legacy = {
  ...data,
  appState: { viewBackgroundColor: "#fff", gridSize: null },
};
await assert.rejects(() => save(legacy, 1), /Refresh Whiteboard/);
const read = () =>
  call(0, "get_private_record", {
    kind: "whiteboard",
    record_id: record,
    expected_user: ids[0],
  });
assert.equal((await read()).revision, 1);
for (const invalid of [
  { ...paper, type: "image" },
  { ...paper, spacing: 5 },
  { ...paper, url: "https://example.com" },
  { ...paper, version: 2 },
])
  await assert.rejects(
    () => save({ ...data, appState: { ...appState, paper: invalid } }, 1),
    /paper/,
  );
for (const customData of [
  { secret: "x" },
  { kenseiPorts: { version: 1, start: 12, end: null } },
  { kenseiPorts: { version: 1, start: 0, end: null, url: "x" } },
])
  await assert.rejects(
    () => save({ ...data, elements: [{ ...arrow, customData }] }, 1),
    /vector/,
  );
await assert.rejects(
  () =>
    save(
      { ...data, elements: [{ ...shape, customData: arrow.customData }] },
      1,
    ),
  /vector/,
);
const roomCall = (i, action, body = {}) =>
  call(i, "whiteboard_room", {
    action,
    body: { client_id: clients[i], client_version: 2, ...body },
  });
for (let i = 0; i < 5; i++)
  await call(i, "ensure_my_profile", { expected_user: ids[i] });
const room = await roomCall(0, "create", {
    name: "Four editors",
    elements: data.elements,
    appState,
  }),
  info = { room_id: room.id };
assert.deepEqual(room.appState.paper, paper);
const invite = await roomCall(0, "invite", info);
for (let i = 1; i < 4; i++) await roomCall(i, "join", { token: invite.token });
await assert.rejects(
  () => roomCall(4, "join", { token: invite.token }),
  /four/,
);
for (let i = 0; i < 4; i++)
  assert((await roomCall(i, "activate", info)).editing);
const op = crypto.randomUUID(),
  saveBody = {
    ...info,
    channel_key: room.channel_key,
    operation_id: op,
    elements: [{ ...arrow, version: 2, versionNonce: 20 }],
    appState: { ...appState, paper: { ...paper, type: "dots" } },
  };
const saved = await roomCall(1, "save", saveBody),
  again = await roomCall(1, "save", saveBody);
assert.equal(saved.revision, again.revision);
assert.equal(saved.appState.paper.type, "dots");
assert.deepEqual(
  saved.elements.find((e) => e.id === "arrow").customData,
  arrow.customData,
);
await assert.rejects(
  () =>
    roomCall(1, "save", {
      ...saveBody,
      operation_id: crypto.randomUUID(),
      client_version: 1,
    }),
  /Refresh Whiteboard/,
);
await assert.rejects(
  () =>
    roomCall(1, "save", {
      ...saveBody,
      operation_id: crypto.randomUUID(),
      appState: legacy.appState,
    }),
  /Refresh Whiteboard/,
);
for (let i = 0; i < 4; i++) {
  const s = await roomCall(i, "get", info);
  assert.equal(s.appState.paper.type, "dots");
  assert.equal(s.elements.length, 2);
}
await assert.rejects(() => roomCall(4, "get", info), /unavailable/);
await roomCall(0, "remove", { ...info, user_id: ids[3] });
await assert.rejects(
  () => roomCall(3, "save", { ...saveBody, operation_id: crypto.randomUUID() }),
  /unavailable/,
);
await as(null, () =>
  assert.rejects(
    () => db.query("select public.whiteboard_room($1,$2)", ["get", info]),
    /permission|Sign in/,
  ),
);
for (const name of [
  "whiteboard_paper",
  "whiteboard_ports_valid",
  "protect_whiteboard_features",
])
  assert.equal(
    (
      await db.query(
        "select has_function_privilege('authenticated',p.oid,'execute') ok from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='workshop_private' and p.proname=$1",
        [name],
      )
    ).rows[0].ok,
    false,
  );
await db.close();
console.log(
  "PASS all migrations: paper/port whitelist, old private and shared writer protection, 4 member snapshots, idempotent save, cross-account/removed/anonymous denial and private helper permissions",
);
