import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
process.on("uncaughtException", (e) => {
  console.error(e.message, "position", e.position, "where", e.where);
  if (e.position && e.query)
    console.error(e.query.slice(+e.position - 70, +e.position + 70));
  process.exit(1);
});
const db = new PGlite();
await db.exec((await import("../support/db-fixture.cjs")).bootstrap);
const files = (await fs.readdir("supabase/migrations")).sort();
const migration = files.find((x) =>
  x.endsWith("_workshop_random_typing_sessions.sql"),
);
for (const file of files.filter((x) => x !== migration))
  await db.exec(await fs.readFile("supabase/migrations/" + file, "utf8"));
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
await db.query("insert into auth.users(id) values($1),($2)", [a, b]);
await db.query(
  "insert into public.typing_profiles(user_id,nickname) values($1,'Tester_A'),($2,'Tester_B')",
  [a, b],
);
const legacy = (
  await db.query(
    "insert into public.typing_test_sessions(user_id,language,version,started_at) values($1,'en',1,clock_timestamp()-interval '130 seconds') returning id",
    [a],
  )
).rows[0].id;
await db.exec(await fs.readFile("supabase/migrations/" + migration, "utf8"));
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
const rpc = async (name, args) =>
  (
    await db.query(
      `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) value`,
      args,
    )
  ).rows[0].value;
await as(null, () =>
  assert.rejects(() => rpc("start_typing_test", ["en"]), /permission|Sign in/),
);
await as(b, () =>
  assert.rejects(
    () => rpc("finish_typing_test", [legacy, "Morning"]),
    /Invalid test/,
  ),
);
const old = await as(a, () =>
  rpc("finish_typing_test", [legacy, "Morning light"]),
);
assert.equal(old.accuracy, 100);
assert.equal(old.version, 1);
const initialCount = (
  await db.query("select count(*)::int n from public.typing_results")
).rows[0].n;
for (const lang of ["en", "zh"]) {
  const starts = [];
  for (let i = 0; i < 12; i++) {
    const session = await as(a, () => rpc("start_typing_test", [lang]));
    const saved = (
      await db.query("select * from public.typing_test_sessions where id=$1", [
        session.sessionId,
      ])
    ).rows[0];
    assert.equal(saved.source_text, session.text);
    assert.equal(saved.version, 1);
    assert.equal(saved.source_revision, 1);
    assert(!starts.slice(-10).includes(saved.sentence_ids[0]));
    starts.push(saved.sentence_ids[0]);
    assert.equal(new Set(saved.sentence_ids).size, saved.sentence_ids.length);
    assert(session.text.length >= (lang === "en" ? 3000 : 1800));
    assert(session.text.length <= (lang === "en" ? 4500 : 2500));
    if (i === 0) {
      await as(a, () =>
        assert.rejects(
          () =>
            rpc("finish_typing_test", [
              session.sessionId,
              session.text.slice(0, 80),
            ]),
          /too early/,
        ),
      );
      await as(b, () =>
        assert.rejects(
          () => rpc("finish_typing_test", [session.sessionId, "bad"]),
          /Invalid test/,
        ),
      );
    }
    await db.query(
      "update public.typing_test_sessions set started_at=clock_timestamp()-interval '66 seconds' where id=$1",
      [session.sessionId],
    );
    const input = i === 1 ? "????????" : session.text.slice(0, 80);
    const result = await as(a, () =>
      rpc("finish_typing_test", [session.sessionId, input]),
    );
    assert.equal(result.qualified, i !== 1);
    assert.equal(result.accuracy, i === 1 ? 0 : 100);
    assert.deepEqual(
      await as(a, () => rpc("finish_typing_test", [session.sessionId, input])),
      result,
    );
    await as(a, () =>
      assert.rejects(
        () => rpc("finish_typing_test", [session.sessionId, input + "x"]),
        /already finished/,
      ),
    );
  }
}
await as(a, () =>
  assert.rejects(
    () => db.query("select source_text from public.typing_test_sessions"),
    /permission/,
  ),
);
await as(null, () =>
  assert.rejects(
    () => db.query("select * from public.typing_passages"),
    /permission/,
  ),
);
const board = await as(null, () => rpc("get_typing_leaderboard", ["en"]));
assert.equal(board.version, 1);
assert(board.top.length === 1);
assert(!JSON.stringify(board).includes("sentence_ids"));
assert.equal(
  (await db.query("select count(*)::int n from public.typing_results")).rows[0]
    .n,
  initialCount + 22,
);
await db.close();
console.log(
  "Random typing: 24 distinct sessions; snapshots, same-board legacy scores, permissions, timing, qualification and idempotent retries passed.",
);
