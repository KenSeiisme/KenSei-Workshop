import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  db = new PGlite();
await db.exec(require("../support/db-fixture.cjs").bootstrap);
for (const f of fs.readdirSync("supabase/migrations").sort())
  await db.exec(fs.readFileSync("supabase/migrations/" + f, "utf8"));
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
await db.query("insert into auth.users(id) values($1),($2)", [a, b]);
async function as(role, id, fn) {
  await db.exec("set role " + role);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id || "",
  ]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
const rpc = async (name, args) => {
  const names = Object.keys(args);
  return (
    await db.query(
      "select public." +
        name +
        "(" +
        names.map((n, i) => n + "=>$" + (i + 1)).join(",") +
        ") value",
      Object.values(args),
    )
  ).rows[0].value;
};
const card = {
    id: crypto.randomUUID(),
    front: "问题",
    back: "Answer",
    known: false,
  },
  id = crypto.randomUUID(),
  op = crypto.randomUUID(),
  args = {
    kind: "flashcard",
    record_id: id,
    payload: { name: "Deck", cards: [card] },
    base_revision: 0,
    operation_id: op,
    remove_record: false,
    expected_user: a,
  };
const first = await as("authenticated", a, () =>
  rpc("save_private_record", args),
);
assert.equal(first.data.cards[0].back, "Answer");
assert.equal(first.revision, 1);
assert.equal(
  (await as("authenticated", a, () => rpc("save_private_record", args)))
    .revision,
  1,
);
const second = await as("authenticated", a, () =>
  rpc("save_private_record", {
    ...args,
    base_revision: 1,
    operation_id: crypto.randomUUID(),
    payload: { name: "Device one", cards: [{ ...card, known: true }] },
  }),
);
assert.equal(second.revision, 2);
const conflict = await as("authenticated", a, () =>
  rpc("save_private_record", {
    ...args,
    base_revision: 1,
    operation_id: crypto.randomUUID(),
    payload: { name: "Device two", cards: [card] },
  }),
);
assert.equal(conflict.conflict, true);
assert.notEqual(conflict.id, id);
assert.equal(
  await as("authenticated", b, () =>
    rpc("get_private_record", {
      kind: "flashcard",
      record_id: id,
      expected_user: b,
    }),
  ),
  null,
);
assert.equal(
  (
    await as("authenticated", b, () =>
      db.query("select * from public.flashcard_decks"),
    )
  ).rows.length,
  0,
);
await assert.rejects(
  () => as("authenticated", b, () => rpc("save_private_record", args)),
  /Account changed/,
);
await assert.rejects(
  () =>
    as("anon", null, () =>
      rpc("get_private_record", {
        kind: "flashcard",
        record_id: id,
        expected_user: a,
      }),
    ),
  /permission denied/,
);
await assert.rejects(
  () =>
    as("authenticated", a, () =>
      db.query("update public.flashcard_decks set data='{}'"),
    ),
  /permission denied/,
);
await assert.rejects(
  () =>
    as("authenticated", a, () =>
      rpc("save_private_record", {
        ...args,
        operation_id: crypto.randomUUID(),
        payload: { name: "bad", cards: [{ ...card, known: "yes" }] },
      }),
    ),
  /Invalid card/,
);
await assert.rejects(
  () =>
    as("authenticated", a, () =>
      rpc("save_private_record", {
        ...args,
        operation_id: crypto.randomUUID(),
        payload: {
          name: "bad",
          cards: Array.from({ length: 201 }, () => ({
            ...card,
            id: crypto.randomUUID(),
          })),
        },
      }),
    ),
  /200/,
);
const cleared = crypto.randomUUID();
await as("authenticated", a, () =>
  rpc("clear_private_records", {
    kind: "flashcard",
    operation_id: cleared,
    expected_user: a,
  }),
);
await as("authenticated", a, () =>
  rpc("clear_private_records", {
    kind: "flashcard",
    operation_id: cleared,
    expected_user: a,
  }),
);
const rows = await as("authenticated", a, () =>
  rpc("get_private_records", {
    kind: "flashcard",
    before_time: null,
    before_id: null,
    page_size: 25,
    expected_user: a,
  }),
);
assert.ok(rows.every((r) => r.deleted && JSON.stringify(r.data) === "{}"));
assert.ok(
  !(
    await db.query("select result::text from public.workshop_mutations")
  ).rows.some((x) => x.result.includes("Answer")),
);
console.log(
  "PASS flashcard RLS, account guards, server validation, revision conflicts, idempotency, tombstones and content-free receipts",
);
await db.close();
