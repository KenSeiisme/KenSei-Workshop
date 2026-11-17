import assert from "node:assert/strict";
import { gameDatabase } from "../support/games-fixture.mjs";

const {
  db,
  users: [one, two],
  as,
  rpc,
} = await gameDatabase();
const three = crypto.randomUUID();
try {
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
    [three, { name: "Outside Player" }],
  );
  await rpc(
    "ensure_my_profile",
    { expected_user: three },
    "authenticated",
    three,
  );
  const call = (owner, name, args = {}) =>
    rpc(name, { expected_user: owner, ...args }, "authenticated", owner);
  const profiles = new Map();
  for (const user of [one, two, three])
    profiles.set(user, (await call(user, "ensure_my_profile")).public_id);
  const change = (actor, peer, action, request = null) =>
    call(actor, "change_friendship", {
      target_profile: profiles.get(peer),
      action,
      request,
    });
  const notices = (owner, before_id = null) =>
    call(owner, "get_site_notifications", { before_id });
  const open = (owner, invitation) =>
    call(owner, "open_friend_game_invite", { invitation });

  const search = await call(one, "search_friend_profiles", {
    query: "game player",
  });
  assert.deepEqual(
    search.map((p) => p.public_id),
    [profiles.get(two)],
  );
  assert(!search[0].user_id && !search[0].email && !search[0].bio);
  await assert.rejects(
    rpc("list_friendships", { expected_user: two }, "authenticated", three),
  );
  await assert.rejects(
    rpc(
      "get_site_notifications",
      { expected_user: one, before_id: null },
      "anon",
      null,
    ),
  );
  await assert.rejects(
    as("authenticated", three, () =>
      db.query("select * from workshop_private.friendships"),
    ),
  );
  await assert.rejects(
    as("authenticated", three, () =>
      db.query("select workshop_private.friend_room('go',null,null)"),
    ),
  );

  const request = await change(one, two, "request");
  assert.equal(request.state, "outgoing");
  assert.deepEqual(await change(one, two, "request"), request);
  assert.deepEqual(await change(two, one, "request"), {
    id: request.id,
    state: "incoming",
  });
  assert.equal(
    (await change(one, two, "accept", request.id)).state,
    "outgoing",
  );
  assert.equal((await change(two, one, "accept", request.id)).state, "friend");
  assert.equal((await change(two, one, "accept", request.id)).state, "friend");
  assert.equal(
    (await notices(one)).rows.filter((r) => r.kind === "friend_accepted")
      .length,
    1,
  );
  assert.equal((await notices(two)).unread, 0);
  assert.deepEqual(await call(three, "list_friendships"), []);
  assert.equal((await call(one, "list_friendships"))[0].state, "friend");

  const invitations = [];
  for (const game of ["go", "chess", "xiangqi", "pong"]) {
    const id = crypto.randomUUID();
    if (game === "pong") {
      await db.query(
        "insert into workshop_private.pong_rooms(id,code,host_id) values($1,$2,$3)",
        [id, "PONG1234", one],
      );
      await db.query(
        "insert into workshop_private.pong_room_members(room_id,user_id,role,client_id) values($1,$2,'host',gen_random_uuid())",
        [id, one],
      );
    } else {
      await db.query(
        "insert into workshop_private.board_matches(id,game,config,state,origin) values($1,$2,'{}','{}','invite')",
        [id, game],
      );
      await db.query(
        "insert into workshop_private.board_members(match_id,user_id,color,client_id) values($1,$2,1,gen_random_uuid())",
        [id, one],
      );
    }
    const args = {
      target_profile: profiles.get(two),
      game_key: game,
      target_room: id,
    };
    assert.equal(
      (await call(three, "send_friend_game_invite", args)).status,
      "unavailable",
    );
    assert.equal(
      (await call(one, "send_friend_game_invite", args)).status,
      "sent",
    );
    assert.equal(
      (await call(one, "send_friend_game_invite", args)).status,
      "sent",
    );
    const mine = (await notices(two)).rows.filter(
      (row) => row.kind === "game_invite" && row.payload.game === game,
    );
    assert.equal(mine.length, 1);
    assert(!mine[0].payload.code && !mine[0].actor.user_id);
    const invite = mine[0].payload.id;
    assert.equal((await open(two, invite)).status, "available");
    assert.equal((await open(two, invite)).game, game);
    assert.equal((await open(three, invite)).status, "unavailable");
    assert.equal((await open(one, invite)).status, "unavailable");
    invitations.push({ game, id, invite });
  }
  await db.query(
    "update workshop_private.board_matches set expires_at=now()-interval '1 second' where id=$1",
    [invitations[0].id],
  );
  await db.query(
    "update workshop_private.board_matches set status='closed' where id=$1",
    [invitations[1].id],
  );
  await db.query(
    "insert into workshop_private.board_members(match_id,user_id,color,client_id) values($1,$2,-1,gen_random_uuid())",
    [invitations[2].id, three],
  );
  assert.equal((await open(two, invitations[0].invite)).status, "expired");
  assert.equal((await open(two, invitations[1].invite)).status, "closed");
  assert.equal((await open(two, invitations[2].invite)).status, "full");
  assert.equal((await change(two, one, "block")).state, "blocked");
  for (const { invite } of invitations)
    assert.equal((await open(two, invite)).status, "unavailable");
  assert.deepEqual(
    await call(one, "search_friend_profiles", { query: "game player" }),
    [],
  );
  assert.equal((await change(one, two, "request")).state, "unavailable");
  assert.equal((await change(two, one, "unblock")).state, "none");
  const next = await change(two, one, "request");
  assert.equal(next.state, "outgoing");
  assert.equal(
    (await change(one, two, "decline", request.id)).state,
    "incoming",
  );
  assert.equal((await change(two, one, "cancel", next.id)).state, "none");

  await db.query(
    `insert into workshop_private.hub_ledger values
    ($1,'day:2026-11-17:one','2026-11-17',10),($1,'run:one','2026-11-17',5) on conflict do nothing`,
    [one],
  );
  await db.query(
    `insert into workshop_private.hub_ledger values
    ($1,'day:2026-11-17:one','2026-11-17',10) on conflict do nothing`,
    [one],
  );
  await db.query(
    "insert into workshop_private.hub_badges(user_id,badge) values($1,'first-finish') on conflict do nothing",
    [one],
  );
  await db.query(
    `insert into workshop_private.game_achievement_unlocks(user_id,achievement_id,unlocked_at)
    select $1,id,now() from workshop_private.game_achievement_rules order by id limit 1`,
    [one],
  );
  const feed = await notices(one);
  assert.equal(feed.rows.filter((r) => r.kind === "reward").length, 3);
  const unread = feed.rows.find((r) => !r.read_at);
  assert.equal((await notices(three, unread.id)).rows.length, 0);
  await call(three, "read_site_notifications", {
    notification: unread.id,
    read_all: false,
  });
  assert.equal((await notices(one)).unread, feed.unread);
  await call(one, "read_site_notifications", {
    notification: unread.id,
    read_all: false,
  });
  assert.equal((await notices(one)).unread, feed.unread - 1);
  assert.equal(
    await call(one, "read_site_notifications", {
      notification: null,
      read_all: true,
    }),
    0,
  );
  assert((await notices(one)).rows.every((row) => row.read_at));
  assert(
    (await notices(one, feed.rows[0].id)).rows.length === feed.rows.length - 1,
  );
  console.log(
    "PASS social permissions, friendship transitions, invitations in all four games, expiry/full/close, inbox ownership, daily rewards and milestones",
  );
} finally {
  await db.close();
}
