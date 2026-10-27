import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec((await import("../support/db-fixture.cjs")).bootstrap);
await db.exec(
  await fs.readFile(
    new URL("../../supabase/schema.sql", import.meta.url),
    "utf8",
  ),
);
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
await db.query("insert into auth.users(id) values($1),($2)", [a, b]);
async function as(role, id, fn) {
  await db.exec(
    `set role ${role};select set_config('request.jwt.claim.sub','${id}',false);`,
  );
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
  }
}
const tools = [
  "image-studio",
  "pdf-toolkit",
  "data-studio",
  "image-to-text",
  "markdown-studio",
  "audio-studio",
];
for (const tool of tools)
  await as("authenticated", a, () =>
    db.query(
      "insert into public.workspace_items(user_id,id,type,data) values($1,$2,'preset',$3)",
      [
        a,
        tool,
        JSON.stringify({
          tool,
          name: "Recipe",
          recipe: { version: 1, settings: { localOnly: true } },
        }),
      ],
    ),
  );
await as("authenticated", a, () =>
  db.query(
    "insert into public.workspace_items(user_id,id,type,data) values($1,'legacy','preset',$2)",
    [
      a,
      JSON.stringify({
        name: "Old image",
        width: 320,
        format: "image/webp",
        quality: 80,
      }),
    ],
  ),
);
assert.equal(
  (
    await as("authenticated", a, () =>
      db.query("select * from public.workspace_items"),
    )
  ).rows.length,
  7,
);
assert.equal(
  (
    await as("authenticated", b, () =>
      db.query("select * from public.workspace_items"),
    )
  ).rows.length,
  0,
);
await assert.rejects(
  () =>
    as("authenticated", b, () =>
      db.query(
        "insert into public.workspace_items(user_id,id,type,data) values($1,'forged','preset','{}')",
        [a],
      ),
    ),
  /policy|security|permission/i,
);
assert.equal(
  (
    await as("authenticated", b, () =>
      db.query(
        "update public.workspace_items set data='{}' where user_id=$1 returning id",
        [a],
      ),
    )
  ).rows.length,
  0,
);
await assert.rejects(
  () => as("anon", "", () => db.query("select * from public.workspace_items")),
  /permission/i,
);
const old = (
  await as("authenticated", a, () =>
    db.query("select data from public.workspace_items where id='legacy'"),
  )
).rows[0].data;
assert.equal(old.width, 320);
assert.equal(old.quality, 80);
await db.close();
console.log(
  "PASS six recipe types, unchanged legacy image fields, anonymous rejection and cross-account preset RLS",
);
