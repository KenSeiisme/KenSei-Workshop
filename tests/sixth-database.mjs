import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  db = new PGlite();
await db.exec(require("./db-fixture.cjs").bootstrap);
for (const f of fs.readdirSync("supabase/migrations").sort())
  await db.exec(fs.readFileSync("supabase/migrations/" + f, "utf8"));
if (fs.existsSync("supabase/sixth-batch.sql"))
  await db.exec(fs.readFileSync("supabase/sixth-batch.sql", "utf8"));
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

for (const kind of ["planner", "whiteboard"]) {
  const payload =
    kind === "planner"
      ? {
          version: 1,
          name: "课程 Study",
          timeZone: "Asia/Kuala_Lumpur",
          courses: [],
          tasks: [],
        }
      : {
          version: 1,
          name: "白板 Board",
          elements: [],
          appState: { viewBackgroundColor: "#111015", gridSize: null },
        };
  const id = crypto.randomUUID(),
    args = {
      kind,
      record_id: id,
      payload,
      base_revision: 0,
      operation_id: crypto.randomUUID(),
      remove_record: false,
      expected_user: a,
    };
  const first = await as("authenticated", a, () =>
    rpc("save_private_record", args),
  );
  assert.equal(first.revision, 1);
  assert.equal(first.data.name, payload.name);
  assert.equal(
    (await as("authenticated", a, () => rpc("save_private_record", args)))
      .revision,
    1,
  );
  const revised = await as("authenticated", a, () =>
    rpc("save_private_record", {
      ...args,
      payload: { ...payload, name: "Latest" },
      base_revision: 1,
      operation_id: crypto.randomUUID(),
    }),
  );
  assert.equal(revised.revision, 2);
  const conflict = await as("authenticated", a, () =>
    rpc("save_private_record", {
      ...args,
      payload: { ...payload, name: "Second device" },
      base_revision: 1,
      operation_id: crypto.randomUUID(),
    }),
  );
  assert.equal(conflict.conflict, true);
  assert.notEqual(conflict.id, id);
  assert.match(conflict.data.name, /conflict copy/);
  assert.equal(
    (
      await as("authenticated", a, () =>
        rpc("get_private_record", { kind, record_id: id, expected_user: a }),
      )
    ).data.name,
    "Latest",
  );
  assert.equal(
    await as("authenticated", b, () =>
      rpc("get_private_record", { kind, record_id: id, expected_user: b }),
    ),
    null,
  );
  assert.equal(
    (
      await as("authenticated", b, () =>
        rpc("get_private_records", {
          kind,
          before_time: null,
          before_id: null,
          page_size: 25,
          expected_user: b,
        }),
      )
    ).length,
    0,
  );
  await assert.rejects(
    () => as("authenticated", b, () => rpc("save_private_record", args)),
    /Account changed/,
  );
  await assert.rejects(
    () => as("anon", null, () => rpc("save_private_record", args)),
    /permission denied/,
  );
  await assert.rejects(
    () =>
      as("authenticated", a, () =>
        db.query(
          "insert into public." +
            (kind === "planner" ? "study_planners" : "whiteboards") +
            "(user_id,id,data) values($1,$2,$3)",
          [a, crypto.randomUUID(), payload],
        ),
      ),
    /permission denied/,
  );
  await assert.rejects(
    () =>
      as("authenticated", a, () =>
        db.exec(
          "select workshop_private.study_record('planner','list',null,null,null,null,null)",
        ),
      ),
    /permission denied/,
  );
  const rows = await as("authenticated", a, () =>
    rpc("get_private_records", {
      kind,
      before_time: null,
      before_id: null,
      page_size: 1,
      expected_user: a,
    }),
  );
  assert.equal(rows.length, 1);
  const next = await as("authenticated", a, () =>
    rpc("get_private_records", {
      kind,
      before_time: rows[0].created_at,
      before_id: rows[0].id,
      page_size: 1,
      expected_user: a,
    }),
  );
  assert.equal(next.length, 1);
  assert.notEqual(next[0].id, rows[0].id);
  await assert.rejects(
    () =>
      as("authenticated", a, () =>
        rpc("save_private_record", {
          ...args,
          payload: { ...payload, name: "" },
          operation_id: crypto.randomUUID(),
        }),
      ),
    /valid name/,
  );
  const invalid =
    kind === "planner"
      ? {
          ...payload,
          tasks: [
            {
              id: crypto.randomUUID(),
              title: "Invalid",
              courseId: null,
              type: "exam",
              due: "2026-02-30T12:00",
              done: false,
            },
          ],
        }
      : { ...payload, elements: [{ type: "image", fileId: "private" }] };
  await assert.rejects(() =>
    as("authenticated", a, () =>
      rpc("save_private_record", {
        ...args,
        payload: invalid,
        operation_id: crypto.randomUUID(),
      }),
    ),
  );
  const clear = { kind, operation_id: crypto.randomUUID(), expected_user: a };
  await as("authenticated", a, () => rpc("clear_private_records", clear));
  await as("authenticated", a, () => rpc("clear_private_records", clear));
  const deleted = await as("authenticated", a, () =>
    rpc("get_private_record", { kind, record_id: id, expected_user: a }),
  );
  assert.equal(deleted.deleted, true);
  assert.deepEqual(deleted.data, {});
  console.log(
    "PASS " +
      kind +
      " schema, private access, account guards, idempotency, pagination, conflict copies, validation and deletion",
  );
}
await db.close();
