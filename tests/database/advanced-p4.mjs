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
async function as(id, fn) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
const save = (kind, id, payload, base = 0, op = crypto.randomUUID()) =>
  db
    .query("select public.save_private_record($1,$2,$3,$4,$5,false,$6) value", [
      kind,
      id,
      payload,
      base,
      op,
      a,
    ])
    .then((r) => r.rows[0].value);
const id = crypto.randomUUID(),
  data = {
    name: "Weighted",
    options: ["A", "B", "C"],
    weights: [1, 10, 100],
    mode: "wheel",
    noRepeat: false,
    groupCount: 2,
  },
  op = crypto.randomUUID();
let row = await as(a, () => save("decision", id, data, 0, op));
assert.deepEqual(row.data.weights, [1, 10, 100]);
assert.equal(
  (await as(a, () => save("decision", id, data, 0, op))).revision,
  1,
);
const { weights, ...old } = data;
row = await as(a, () =>
  save("decision", id, { ...old, options: ["C", "A", "D"] }, 1),
);
assert.deepEqual(row.data.weights, [100, 1, 1]);
for (const weights of [[0, 1, 1], [1.5, 1, 1], [101, 1, 1], [1], null])
  await assert.rejects(() =>
    as(a, () => save("decision", id, { ...old, weights }, 2)),
  );
const answer = crypto.randomUUID(),
  payload = {
    en: "Test",
    zh: "測試",
    drawnAt: new Date().toISOString(),
    favorite: true,
    question: "never persist",
  };
row = await as(a, () => save("answer", answer, payload));
assert.equal(row.data.favorite, true);
assert(!Object.hasOwn(row.data, "question"));
const { favorite, ...legacy } = payload;
row = await as(a, () => save("answer", answer, legacy, 1));
assert.equal(row.data.favorite, true);
row = await as(a, () =>
  save("answer", answer, { ...legacy, favorite: false }, 2),
);
assert.equal(row.data.favorite, false);
await assert.rejects(() =>
  as(a, () => save("answer", answer, { ...legacy, favorite: "true" }, 3)),
);
await assert.rejects(() => as(b, () => save("answer", answer, payload, 3)));
assert(
  !(
    await db.query("select result::text from public.workshop_mutations")
  ).rows.some((r) => r.result.includes("never persist")),
);
console.log(
  "PASS optional metadata retention, label-based weights, validation, idempotency and account guards",
);
await db.close();
