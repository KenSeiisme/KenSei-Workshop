import assert from "node:assert/strict";
import { gameDatabase } from "../support/games-fixture.mjs";

const {
  db,
  users: [owner, opponent],
  rpc,
} = await gameDatabase();
const outsider = crypto.randomUUID();
try {
  await db.query("insert into auth.users(id) values($1)", [outsider]);
  await db.query(
    `
    insert into public.workspace_items(user_id,id,type,data,updated_at)
    select $1,'draft-'||i,'draft',jsonb_build_object('name','Draft '||i,'text','private body'),
      '2026-11-16'::timestamptz + i*interval '1 second'
    from generate_series(1,25) i
  `,
    [owner],
  );
  await db.query(
    "insert into public.workspace_items(user_id,id,type,data) values($1,'private','preset',$2)",
    [
      opponent,
      { name: "Secret", tool: "data-studio", recipe: { settings: {} } },
    ],
  );
  const whiteboard = crypto.randomUUID();
  await db.query(
    "insert into public.whiteboards(user_id,id,data,updated_at) values($1,$2,$3,'2026-11-15')",
    [owner, whiteboard, { name: "Flowchart", elements: [], appState: {} }],
  );
  await db.query(
    "insert into public.whiteboards(user_id,id,data,deleted) values($1,$2,$3,true)",
    [owner, crypto.randomUUID(), { name: "Removed" }],
  );
  const index = (args = {}, user = owner) =>
    rpc("get_workspace_index", args, "authenticated", user);
  const first = await index();
  assert.equal(first.length, 21);
  assert.equal(first[0].name, "Draft 25");
  assert.deepEqual(Object.keys(first[0]).sort(), [
    "id",
    "kind",
    "name",
    "tool",
    "updated_at",
  ]);
  const cursor = first[19];
  const second = await index({
    before_time: cursor.updated_at,
    before_kind: cursor.kind,
    before_id: cursor.id,
  });
  assert.equal(second.length, 6);
  assert.equal(second.at(-1).id, whiteboard);
  assert.equal(
    (await index({ search_text: "Draft 1", record_kind: "draft" })).length,
    11,
  );
  assert.equal(
    (await index({ search_text: "白板", tool_ids: ["whiteboard"] }))[0].id,
    whiteboard,
  );
  assert.deepEqual(await index({ search_text: "private body" }), []);
  assert.deepEqual(await index({ search_text: "Secret" }), []);
  assert.equal((await index({}, opponent))[0].name, "Secret");
  await assert.rejects(rpc("get_workspace_index", {}, "anon", null));

  const ids = [];
  for (const [game, status, reason, winner] of [
    ["go", "finished", "resignation", 1],
    ["chess", "finished", "timeout", -1],
    ["xiangqi", "interrupted", "interrupted", null],
    ["chess", "unresolved", "unresolved", null],
    ["chess", "closed", "cancelled", null],
  ]) {
    const id = crypto.randomUUID();
    ids.push(id);
    const config =
      game === "go"
        ? { rule: "chinese", size: 9, clock: "standard" }
        : { clock: "10+5" };
    const result = { reason, winner };
    await db.query(
      `
      insert into workshop_private.board_matches (id,game,config,state,origin,status,started_at,ended_at)
      values($1,$2,$3,$4,'invite',$5,case when $5='closed' then null else now() end,now())
    `,
      [id, game, config, { config, log: [], result }, status],
    );
    await db.query(
      "insert into workshop_private.board_settlements(match_id,result,ranked,settled_at) values($1,$2,false,now())",
      [id, result],
    );
    await db.query(
      "insert into workshop_private.board_members(match_id,user_id,color,client_id) values($1,$2,1,$4),($1,$3,-1,$4)",
      [id, owner, opponent, crypto.randomUUID()],
    );
  }
  const history = (args = {}, user = owner) =>
    rpc("get_my_board_match_history", args, "authenticated", user);
  const review = (id, user = owner) =>
    rpc("get_my_board_match_review", { match_id: id }, "authenticated", user);
  const matches = await history();
  assert.equal(matches.length, 4);
  assert.equal(
    (await history({ game_filter: "xiangqi" }))[0].status,
    "interrupted",
  );
  assert(
    matches.every((row) => !row.state && !row.channel_key && !row.user_id),
  );
  assert.deepEqual(await history({}, outsider), []);
  assert.equal(await review(ids[0], outsider), null);
  assert.equal(await review(ids[4]), null);
  assert.equal((await review(ids[0], opponent)).color, -1);
  assert.equal((await review(ids[1])).state.result.reason, "timeout");
  assert.equal((await review(ids[3])).status, "unresolved");
  await assert.rejects(
    rpc("get_my_board_match_review", { match_id: ids[0] }, "anon", null),
  );
  console.log(
    "Workspace metadata pagination and archived board permissions passed.",
  );
} finally {
  await db.close();
}
