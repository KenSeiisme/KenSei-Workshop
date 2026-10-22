import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { bootstrap } from "../support/db-fixture.cjs";
const db = new PGlite();
await db.exec(bootstrap);
for (const name of (await fs.readdir("supabase/migrations")).sort())
  await db.exec(await fs.readFile("supabase/migrations/" + name, "utf8"));
const a = crypto.randomUUID(),
  b = crypto.randomUUID(),
  old = crypto.randomUUID(),
  missing = crypto.randomUUID();
await db.query("insert into auth.users values($1,$2),($3,$2),($4,$5),($6,$7)", [
  a,
  {
    full_name: "王明 Alex Tan",
    avatar_url: "https://lh3.googleusercontent.com/a/photo",
  },
  b,
  old,
  { full_name: "New Google Name" },
  missing,
  {},
]);
await db.query(
  "insert into public.typing_profiles(user_id,nickname) values($1,$2)",
  [old, "My existing name"],
);
const as = async (role, id, fn) => {
  await db.exec(
    `set role ${role};select set_config('request.jwt.claim.sub','${id || ""}',false);`,
  );
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
};
const value = async (sql, args) => (await db.query(sql, args)).rows[0].value;
const ensure = (id) =>
  as("authenticated", id, () =>
    value("select public.ensure_my_profile($1) value", [id]),
  );
const change = (id, patch) =>
  as("authenticated", id, () =>
    value("select public.update_my_profile($1,$2) value", [patch, id]),
  );
const pa = await ensure(a),
  pb = await ensure(b);
assert.equal(pa.nickname, "王明 Alex Tan");
assert.match(pb.nickname, /^王明 Alex Tan_[A-F0-9]{4}$/);
assert.notEqual(pa.public_id, a);
assert.equal((await ensure(a)).public_id, pa.public_id);
assert.equal((await ensure(old)).nickname, "My existing name");
assert.match((await ensure(missing)).nickname, /^Member_/);
await change(a, {
  nickname: "新名字 O'Connor",
  bio: "<script>alert(1)</script> My biography.",
  avatar_kind: "none",
});
await db.query("update auth.users set raw_user_meta_data=$1 where id=$2", [
  {
    full_name: "Google changed again",
    avatar_url: "https://lh3.googleusercontent.com/a/new",
  },
  a,
]);
assert.equal((await ensure(a)).nickname, "新名字 O'Connor");
assert.equal((await ensure(a)).avatar_kind, "none");
await assert.rejects(
  () => change(b, { nickname: "新名字 O'Connor" }),
  /already taken/,
);
await assert.rejects(() => change(a, { bio: "x".repeat(301) }), /300/);
await as("authenticated", b, () =>
  assert.rejects(
    () =>
      value("select public.update_my_profile($1,$2) value", [
        { bio: "wrong account" },
        a,
      ]),
    /Account changed/,
  ),
);
const path = pa.public_id + "/" + crypto.randomUUID() + ".webp";
await as("authenticated", a, () =>
  db.query(
    "insert into storage.objects(bucket_id,name,owner_id) values('avatars',$1,$2)",
    [path, a],
  ),
);
await change(a, { avatar_kind: "upload", avatar_path: path });
await as("authenticated", b, () =>
  assert.rejects(
    () =>
      db.query(
        "insert into storage.objects(bucket_id,name,owner_id) values('avatars',$1,$2)",
        [pa.public_id + "/" + crypto.randomUUID() + ".webp", b],
      ),
    /row-level security/,
  ),
);
await as("authenticated", b, async () => {
  assert.equal(
    (
      await db.query(
        "update storage.objects set name=$1 where name=$2 returning id",
        [pb.public_id + "/" + crypto.randomUUID() + ".webp", path],
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query("delete from storage.objects where name=$1 returning id", [
        path,
      ])
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query("select * from public.typing_profiles where user_id=$1", [
        a,
      ])
    ).rows.length,
    0,
  );
});
await as("authenticated", a, () =>
  assert.rejects(
    () =>
      db.query("update storage.objects set name=$1 where name=$2", [
        pb.public_id + "/" + crypto.randomUUID() + ".webp",
        path,
      ]),
    /row-level security/,
  ),
);
await assert.rejects(
  () => change(b, { avatar_kind: "upload", avatar_path: path }),
  /own profile/,
);
await as("anon", null, async () => {
  const p = await value("select public.get_public_profile($1) value", [
    pa.public_id,
  ]);
  assert.equal(p.nickname, "新名字 O'Connor");
  assert.equal(p.avatar_path, path);
  assert.equal(p.google_avatar_url, null);
  assert(!JSON.stringify(p).includes(a));
  assert(!/user_id|email|raw_user/.test(JSON.stringify(p)));
  await assert.rejects(
    () => value("select public.ensure_my_profile($1) value", [a]),
    /permission/,
  );
});
await change(a, { avatar_kind: "none" });
assert.equal((await ensure(a)).avatar_path, null);
console.log(
  "PASS Google initialization, existing names, collision suffix, edits, avatar RLS, private fields and repeated login",
);
await db.close();
