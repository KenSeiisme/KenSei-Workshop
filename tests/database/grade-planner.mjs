import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  gradeBook,
  gradeCourse,
  gradeAssessment,
} from "../../src/tools/grade-planner-core.js";
const require = createRequire(import.meta.url);
const db = new PGlite();
const owner = randomUUID(),
  other = randomUUID(),
  id = randomUUID();
try {
  await db.exec(require("../support/db-fixture.cjs").bootstrap);
  for (const file of fs.readdirSync("supabase/migrations").sort())
    await db.exec(fs.readFileSync("supabase/migrations/" + file, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2)", [owner, other]);
  await db.exec("set role authenticated");
  const login = (user) =>
    db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await login(owner);
  const book = gradeBook("Private grade plan");
  const course = gradeCourse("Data");
  course.items.push({ ...gradeAssessment("Test"), score: 90, weight: 30 });
  book.terms[0].courses.push(course);
  const save = async (
    base,
    operation = randomUUID(),
    payload = book,
    ownerId = owner,
  ) =>
    (
      await db.query(
        "select public.save_private_record('grade',$1,$2,$3,$4,false,$5) as result",
        [id, payload, base, operation, ownerId],
      )
    ).rows[0].result;
  const operation = randomUUID();
  assert.equal((await save(0, operation)).revision, 1);
  assert.equal((await save(0, operation)).revision, 1);
  const second = await save(1, randomUUID(), {
    ...book,
    name: "Edit from other device",
  });
  assert.equal(second.revision, 2);
  const conflict = await save(1, randomUUID(), {
    ...book,
    name: "Offline edit",
  });
  assert.equal(conflict.conflict, true);
  assert.notEqual(conflict.id, id);
  const row = (
    await db.query("select public.get_private_record('grade',$1,$2) value", [
      id,
      owner,
    ])
  ).rows[0].value;
  assert.equal(row.data.name, "Edit from other device");
  assert.equal(row.data.terms[0].courses[0].items[0].score, 90);
  const profile = (
    await db.query(
      "select public.get_workspace_index(record_kind=>'grade') value",
    )
  ).rows[0].value;
  assert.equal(profile.length, 2);
  assert.ok(profile.every((x) => x.tool === "grade-planner"));
  await assert.rejects(
    save(2, randomUUID(), { ...book, scale: [{ minimum: 70, points: 4 }] }),
    /thresholds/,
  );
  await login(other);
  assert.equal(
    (
      await db.query("select public.get_private_record('grade',$1,$2) value", [
        id,
        other,
      ])
    ).rows[0].value,
    null,
  );
  await assert.rejects(save(2), /Account changed/);
  assert.equal(
    (await db.query("select count(*)::int count from public.grade_plans"))
      .rows[0].count,
    0,
  );
  await db.exec("set role anon");
  await assert.rejects(
    db.query("select * from public.grade_plans"),
    /permission denied/,
  );
  console.log(
    "PASS grade record validation, concurrent revision conflict, idempotent retry, Workspace and private ownership",
  );
} finally {
  await db.close();
}
