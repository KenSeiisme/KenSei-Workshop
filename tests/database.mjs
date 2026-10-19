import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(
  `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`,
);
for (const file of (
  await fs.readdir(new URL("../supabase/migrations/", import.meta.url))
).sort())
  await db.exec(
    await fs.readFile(
      new URL("../supabase/migrations/" + file, import.meta.url),
      "utf8",
    ),
  );
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
await db.query("insert into auth.users values($1),($2)", [a, b]);
const as = async (role, id, fn) => {
  await db.exec(
    `set role ${role};select set_config('request.jwt.claim.sub','${id || ""}',false);`,
  );
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
  }
};
const q = async (sql, params = []) => {
  sql = sql.replace(
    /public\.(save_private_record|clear_private_records|get_private_records)\((.*)\) value/,
    (_, fn, args) => "public." + fn + "(" + args + ",auth.uid()) value",
  );
  const r = await db.query(sql, params);
  return r.rows[0]?.value;
};
const op = () => crypto.randomUUID();
const scheme = {
  name: "Lunch",
  mode: "draw",
  options: ["A", "B", "C"],
  noRepeat: true,
  groupCount: 2,
};
const record = op(),
  operation = op();
let first, conflict;
first = await as("authenticated", a, () =>
  q("select public.save_private_record($1,$2,$3,0,$4,false) value", [
    "decision",
    record,
    scheme,
    operation,
  ]),
);
assert.equal(first.revision, 1);
assert.equal(
  (
    await as("authenticated", a, () =>
      q("select public.save_private_record($1,$2,$3,0,$4,false) value", [
        "decision",
        record,
        scheme,
        operation,
      ]),
    )
  ).revision,
  1,
  "retry must be idempotent",
);
await as("authenticated", a, () =>
  q("select public.save_private_record($1,$2,$3,1,$4,false) value", [
    "decision",
    record,
    { ...scheme, name: "Device A" },
    op(),
  ]),
);
conflict = await as("authenticated", a, () =>
  q("select public.save_private_record($1,$2,$3,1,$4,false) value", [
    "decision",
    record,
    { ...scheme, name: "Device B" },
    op(),
  ]),
);
assert(conflict.conflict);
assert.match(conflict.data.name, /conflict copy/);
assert.equal(
  (
    await as("authenticated", b, () =>
      db.query("select * from public.decision_schemes"),
    )
  ).rows.length,
  0,
);
await as("anon", null, async () => {
  await assert.rejects(
    () => db.query("select * from public.decision_schemes"),
    /permission/,
  );
  await assert.rejects(
    () => q("select public.start_typing_test('en') value"),
    /permission/,
  );
});
await as("authenticated", a, async () => {
  await assert.rejects(
    () =>
      db.query(
        "insert into public.typing_results values(null,null,null,1,1000,100,now())",
      ),
    /permission/,
  );
});
const answer = await as("authenticated", a, () =>
  q("select public.save_private_record($1,$2,$3,0,$4,false) value", [
    "answer",
    op(),
    {
      en: "A small step.",
      zh: "一小步。",
      drawnAt: new Date().toISOString(),
      question: "SECRET",
    },
    op(),
  ]),
);
assert(!("question" in answer.data));
assert(
  (
    await db.query(
      "select result from public.workshop_mutations where user_id=$1",
      [a],
    )
  ).rows.every((x) => !("data" in x.result)),
  "retry receipts must not retain private record content",
);
await as("authenticated", a, () =>
  assert.rejects(
    () =>
      db.query("select public.save_private_record($1,$2,$3,0,$4,false,$5)", [
        "decision",
        op(),
        scheme,
        op(),
        b,
      ]),
    /Account changed/,
  ),
);
await as("authenticated", a, () =>
  assert.rejects(
    () =>
      q("select public.save_private_record($1,$2,$3,0,$4,false) value", [
        "decision",
        op(),
        {},
        op(),
      ]),
    /Invalid scheme/,
  ),
);
await as("authenticated", a, () =>
  q("select public.set_typing_nickname('Runner_A') value"),
);
await as("authenticated", b, () =>
  assert.rejects(
    () => q("select public.set_typing_nickname('runner_a') value"),
    /already taken/,
  ),
);
let test = await as("authenticated", a, () =>
  q("select public.start_typing_test('en') value"),
);
await as("authenticated", a, () =>
  assert.rejects(
    () =>
      q("select public.finish_typing_test($1,$2) value", [
        test.sessionId,
        test.text.slice(0, 50),
      ]),
    /too early/,
  ),
);
await as("authenticated", b, () =>
  assert.rejects(
    () =>
      q("select public.finish_typing_test($1,$2) value", [test.sessionId, "x"]),
    /Invalid test session/,
  ),
);
await as("authenticated", a, () =>
  assert.rejects(
    () => q("select public.start_typing_test('en') value"),
    /wait/,
  ),
);
await db.query(
  "update public.typing_test_sessions set started_at=clock_timestamp()-interval '61 seconds' where id=$1",
  [test.sessionId],
);
let result = await as("authenticated", a, () =>
  q("select public.finish_typing_test($1,$2) value", [
    test.sessionId,
    test.text.slice(0, 100),
  ]),
);
assert.deepEqual(
  {
    speed: result.speed,
    accuracy: result.accuracy,
    qualified: result.qualified,
  },
  { speed: 20, accuracy: 100, qualified: true },
);
await as("authenticated", a, () =>
  assert.rejects(
    () =>
      q("select public.finish_typing_test($1,$2) value", [test.sessionId, "x"]),
    /already finished/,
  ),
);
const board = await as("anon", null, () =>
  q("select public.get_typing_leaderboard('en') value"),
);
assert.equal(board.top[0].nickname, "Runner_A");
assert.deepEqual(Object.keys(board.top[0]).sort(), [
  "accuracy",
  "achieved_at",
  "nickname",
  "rank",
  "speed",
]);
assert.equal(board.me, null);
await db.query(
  "update public.typing_test_sessions set started_at=clock_timestamp()-interval '66 seconds' where id=$1",
  [test.sessionId],
);
test = await as("authenticated", a, () =>
  q("select public.start_typing_test('zh') value"),
);
await db.query(
  "update public.typing_test_sessions set started_at=clock_timestamp()-interval '61 seconds' where id=$1",
  [test.sessionId],
);
result = await as("authenticated", a, () =>
  q("select public.finish_typing_test($1,$2) value", [
    test.sessionId,
    test.text.slice(0, 80),
  ]),
);
assert.equal(result.speed, 80);
// The public list is capped at 50, and a lower-ranked account still receives its own rank.
for (let i = 0; i < 55; i++) {
  const user = op(),
    session = op();
  await db.query("insert into auth.users values($1)", [user]);
  await db.query(
    "insert into public.typing_profiles(user_id,nickname) values($1,$2)",
    [user, "Tester_" + i],
  );
  await db.query(
    "insert into public.typing_test_sessions(id,user_id,language,version) values($1,$2,'en',1)",
    [session, user],
  );
  await db.query(
    "insert into public.typing_results values($1,$2,'en',1,$3,100,$4)",
    [
      session,
      user,
      100 + i,
      new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    ],
  );
}
const many = await as("authenticated", a, () =>
  q("select public.get_typing_leaderboard('en') value"),
);
assert.equal(many.top.length, 50);
assert.equal(many.me.rank, 56);
assert.equal(many.top[0].speed, 154);
await db.query(
  "update public.typing_test_sessions set started_at=clock_timestamp()-interval '66 seconds' where user_id=$1",
  [a],
);
test = await as("authenticated", a, () =>
  q("select public.start_typing_test('en') value"),
);
await db.query(
  "update public.typing_test_sessions set started_at=clock_timestamp()-interval '61 seconds' where id=$1",
  [test.sessionId],
);
result = await as("authenticated", a, () =>
  q("select public.finish_typing_test($1,$2) value", [
    test.sessionId,
    "xxxxxxxxxx" + test.text.slice(10, 100),
  ]),
);
assert.equal(result.qualified, false);
assert.equal(
  (
    await as("authenticated", a, () =>
      q("select public.get_typing_leaderboard('en') value"),
    )
  ).me.speed,
  20,
);
await as("authenticated", a, () =>
  q("select public.clear_private_records($1,$2) value", ["decision", op()]),
);
assert.equal(
  (
    await as("authenticated", a, () =>
      q("select public.get_private_records('decision',null,null,25) value"),
    )
  ).filter((x) => !x.deleted).length,
  0,
);
// Safe API surface and version isolation are checked against a real PostgreSQL engine.
await db.exec(
  "insert into public.typing_passages values('en',2,repeat('Version two original passage. ',100),false);update public.typing_passages set active=false where language='en' and version=1;update public.typing_passages set active=true where language='en' and version=2;",
);
assert.equal(
  (
    await as("anon", null, () =>
      q("select public.get_typing_leaderboard('en') value"),
    )
  ).top.length,
  0,
);
await db.close();
console.log(
  "PASS PostgreSQL migration, RLS, privacy, conflict copies, idempotency, nickname, timing, replay, scoring and versioned boards",
);
