import assert from "node:assert/strict";
import { gameDatabase } from "../support/games-fixture.mjs";
const {
  db,
  users: [one, two],
  rpc,
  as,
} = await gameDatabase();
const call = (owner, name, args = {}) =>
  rpc(name, { expected_user: owner, ...args }, "authenticated", owner);
try {
  const a = await call(one, "ensure_my_profile"),
    b = await call(two, "ensure_my_profile");
  const change = (owner, target, action, request = null) =>
    call(owner, "change_friendship", {
      target_profile: target,
      action,
      request,
    });
  const pending = await change(one, b.public_id, "request");
  const inbox = await call(two, "get_site_notifications_page", {
    before_id: null,
    category: "social",
  });
  assert.equal(inbox.rows[0].payload.relationship.id, pending.id);
  await change(two, a.public_id, "accept", pending.id);
  const c1 = crypto.randomUUID(),
    c2 = crypto.randomUUID();
  const touch = (id, game, active = true) =>
    call(one, "touch_social_activity", {
      client_id: id,
      game_key: game,
      active,
    });
  const presence = async () =>
    (await call(two, "get_friendship", { target_profile: a.public_id }))
      .presence;
  await touch(c1, "chess");
  await touch(c2, null);
  assert.equal((await presence()).game, "chess");
  await touch(c1, null, false);
  assert.equal((await presence()).status, "online");
  await call(one, "set_social_visibility", { visible: false });
  assert.equal((await presence()).status, "offline");
  assert.equal((await call(one, "get_social_preferences")).visible, false);
  await touch(c1, "go");
  assert.equal((await presence()).status, "offline");
  await call(one, "set_social_visibility", { visible: true });
  assert.equal((await presence()).game, "go");
  await db.query(
    "update workshop_private.social_activity set seen_at=now()-interval '121 seconds' where user_id=$1",
    [one],
  );
  assert.equal((await presence()).status, "offline");
  await assert.rejects(
    call(two, "touch_social_activity", {
      expected_user: one,
      client_id: c1,
      game_key: "chess",
      active: true,
    }),
  );
  await assert.rejects(
    as("authenticated", two, () =>
      db.query("select * from workshop_private.social_activity"),
    ),
  );

  const earned = (
    await db.query(
      "select id from workshop_private.game_achievement_rules order by id limit 3",
    )
  ).rows.map((r) => r.id);
  await db.query(
    "insert into workshop_private.game_achievement_unlocks(user_id,achievement_id,unlocked_at) select $1,unnest($2::text[]),now()",
    [one, earned],
  );
  const look = { cover: "aurora", accent: "ice", featured: earned };
  const saved = await call(one, "update_my_profile", {
    patch: { appearance: look },
  });
  assert.deepEqual(saved.appearance, look);
  const legacy = await call(one, "update_my_profile", {
    patch: { bio: "Existing clients keep the appearance" },
  });
  assert.deepEqual(legacy.appearance, look);
  assert.deepEqual(
    (await rpc("get_public_profile", { profile_id: a.public_id }, "anon", null))
      .appearance,
    look,
  );
  for (const appearance of [
    { ...look, cover: "external-url" },
    { ...look, featured: [earned[0], earned[0]] },
    { ...look, featured: ["fake"] },
    { ...look, featured: [...earned, "fake"] },
  ])
    await assert.rejects(
      call(one, "update_my_profile", {
        patch: { nickname: "Should roll back", appearance },
      }),
    );
  assert.equal((await call(one, "ensure_my_profile")).nickname, a.nickname);
  await assert.rejects(
    call(two, "update_my_profile", { patch: { appearance: look } }),
  );
  const social = await call(one, "get_site_notifications_page", {
    before_id: null,
    category: "social",
  });
  const rewards = await call(one, "get_site_notifications_page", {
    before_id: null,
    category: "rewards",
  });
  assert(social.rows.every((r) => r.kind !== "reward"));
  assert.equal(rewards.rows.length, 3);
  assert(rewards.rows.every((r) => r.kind === "reward"));
  await db.query(
    "insert into workshop_private.hub_ledger values($1,'day:2026-11-18:warm-up','2026-11-18',10)",
    [one],
  );
  const daily = (
    await call(one, "get_site_notifications_page", {
      before_id: null,
      category: "rewards",
    })
  ).rows.find((r) => r.payload.type === "daily");
  assert.equal(daily.payload.task_id, "warm-up");
  assert.equal(daily.payload.task_day, "2026-11-18");
  const page = (
    await call(one, "get_site_notifications_page", {
      before_id: null,
      category: "all",
    })
  ).rows;
  await db.query(
    "update workshop_private.site_notifications set created_at='2026-11-18T00:00:00Z' where owner_id=$1",
    [one],
  );
  const equalTime = (
    await call(one, "get_site_notifications_page", {
      before_id: null,
      category: "all",
    })
  ).rows;
  const next = (
    await call(one, "get_site_notifications_page", {
      before_id: equalTime[0].id,
      category: "all",
    })
  ).rows;
  assert.equal(next.length, equalTime.length - 1);
  assert(!next.some((r) => r.id === equalTime[0].id));
  assert.equal(
    (
      await call(two, "get_site_notifications_page", {
        before_id: page[0].id,
        category: "all",
      })
    ).rows.length,
    0,
  );
  for (const game of ["go", "chess", "xiangqi", "pong"]) {
    const room = crypto.randomUUID();
    if (game === "pong") {
      await db.query(
        "insert into workshop_private.pong_rooms(id,code,host_id) values($1,'ABCD5678',$2)",
        [room, one],
      );
      await db.query(
        "insert into workshop_private.pong_room_members(room_id,user_id,role,client_id) values($1,$2,'host',gen_random_uuid())",
        [room, one],
      );
    } else {
      await db.query(
        "insert into workshop_private.board_matches(id,game,config,state,origin) values($1,$2,'{}','{}','invite')",
        [room, game],
      );
      await db.query(
        "insert into workshop_private.board_members(match_id,user_id,color,client_id) values($1,$2,1,gen_random_uuid())",
        [room, one],
      );
    }
    const args = {
      target_profile: b.public_id,
      game_key: game,
      target_room: room,
    };
    const invite = await call(one, "send_friend_game_invite", args);
    assert.equal(invite.status, "sent");
    assert.equal(
      (await call(one, "send_friend_game_invite", args)).id,
      invite.id,
    );
    assert.equal(
      (
        await call(two, "change_friend_game_invite", {
          invitation: invite.id,
          action: "revoke",
        })
      ).status,
      "unavailable",
    );
    const action = game === "pong" ? "ignore" : "revoke",
      actor = game === "pong" ? two : one;
    const changed = await call(actor, "change_friend_game_invite", {
      invitation: invite.id,
      action,
    });
    assert.equal(changed.status, action === "ignore" ? "ignored" : "revoked");
    assert.deepEqual(
      await call(actor, "change_friend_game_invite", {
        invitation: invite.id,
        action,
      }),
      changed,
    );
    assert.equal(
      (await call(two, "open_friend_game_invite", { invitation: invite.id }))
        .status,
      changed.status,
    );
    assert.equal(
      (await call(one, "send_friend_game_invite", args)).status,
      changed.status,
    );
  }
  await touch(c1, "chess");
  await change(two, a.public_id, "block");
  assert.equal(
    (await call(two, "get_friendship", { target_profile: a.public_id })).state,
    "blocked",
  );
  assert.equal(
    (await call(one, "get_friendship", { target_profile: b.public_id }))
      .presence,
    undefined,
  );
  console.log(
    "PASS profile appearance, transaction rollback, ownership, friend-only presence, hidden/multi-tab/expiry, actionable notices, stable cursors and invitation withdrawal",
  );
} finally {
  await db.close();
}
