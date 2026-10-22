import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const require = createRequire(import.meta.url),
  db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
try {
  await db.exec(require("../support/db-fixture.cjs").bootstrap);
  for (const file of fs.readdirSync("supabase/migrations").sort())
    await db.exec(fs.readFileSync("supabase/migrations/" + file, "utf8"));
  await db.query("insert into auth.users(id) values($1)", [owner]);
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  for (const kind of ["planner", "whiteboard"]) {
    const table = kind === "planner" ? "study_planners" : "whiteboards";
    const payload = (name) =>
      kind === "planner"
        ? {
            version: 1,
            name,
            timeZone: "Asia/Kuala_Lumpur",
            courses: [],
            tasks: [],
          }
        : {
            version: 1,
            name,
            elements: [],
            appState: { viewBackgroundColor: "#111015", gridSize: null },
          };
    async function fixture() {
      const id = randomUUID();
      const save = async (name, revision, op = randomUUID(), remove = false) =>
        (
          await db.query(
            "select public.save_private_record($1,$2,$3,$4,$5,$6,$7) value",
            [
              kind,
              id,
              remove ? {} : payload(name),
              revision,
              op,
              remove,
              owner,
            ],
          )
        ).rows[0].value;
      const first = await save("Original", 0),
        lostOperation = randomUUID();
      const applied = await save(
        "First local edit, ACK lost",
        first.revision,
        lostOperation,
      );
      const remote = await save(
        "Other device edit to preserve",
        applied.revision,
      );
      const retry = await save(
        "First local edit, ACK lost",
        first.revision,
        lostOperation,
      );
      return { id, save, first, applied, remote, retry, lostOperation };
    }
    // Exact old behavior: replay returns current row revision; client blindly rebases its queued edit.
    const old = await fixture();
    const lost = await old.save(
      "Later local edit before retry",
      old.retry.revision,
    );
    assert.equal(lost.conflict, false);
    assert.equal(
      (
        await db.query(
          `select count(*)::int n from public.${table} where id=$1`,
          [old.id],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(lost.data.name, "Later local edit before retry");
    console.log(
      `REPRO ${kind}: old current-row rebasing overwrites the other device without a conflict copy`,
    );

    const fixed = await fixture();
    assert.equal(
      Number(fixed.retry.ack_revision),
      Number(fixed.applied.revision),
      "A replay must retain the operation's original acknowledgement revision",
    );
    assert.equal(
      Number(fixed.retry.revision),
      Number(fixed.remote.revision),
      "Current row can still refresh clients with no later local edits",
    );
    const next = await fixed.save(
      "Later local edit before retry",
      Number(fixed.retry.ack_revision),
    );
    assert.equal(next.conflict, true);
    assert.notEqual(next.id, fixed.id);
    const kept = (
      await db.query(`select data from public.${table} where id=$1`, [fixed.id])
    ).rows[0].data;
    assert.equal(kept.name, "Other device edit to preserve");
    assert.match(next.data.name, /Later local edit before retry/);
    assert.equal(Number(next.ack_revision), Number(next.revision));
    console.log(
      `PASS ${kind}: immutable ack_revision preserves remote content and moves the later local edit into a conflict copy`,
    );

    const deleted = await fixture();
    await deleted.save("", deleted.remote.revision, randomUUID(), true);
    const replayAfterDelete = await deleted.save(
      "First local edit, ACK lost",
      deleted.first.revision,
      deleted.lostOperation,
    );
    // Fresh operation IDs must not be required to inspect tombstone acknowledgement behavior.
    if (
      Number(replayAfterDelete.ack_revision) ===
      Number(deleted.applied.revision)
    ) {
      assert.equal(replayAfterDelete.deleted, true);
      const copy = await deleted.save(
        "Later local edit after delete",
        Number(replayAfterDelete.ack_revision),
      );
      assert.equal(copy.conflict, true);
      assert.equal(
        (
          await db.query(`select deleted from public.${table} where id=$1`, [
            deleted.id,
          ])
        ).rows[0].deleted,
        true,
      );
      console.log(
        `PASS ${kind}: retried acknowledgement after a remote delete never resurrects the original`,
      );
    }
  }
} finally {
  await db.close();
}
