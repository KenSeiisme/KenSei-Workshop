import assert from "node:assert/strict";
import { build } from "esbuild";
import { gameDatabase } from "../support/games-fixture.mjs";
import {
  create,
  apply,
  GAMES,
  metrics,
  replay,
  advanceBrick,
} from "../../src/games/engine.js";
import { solution } from "../../src/games/puzzle-engine.js";
import {
  availablePlacements,
  SHAPES,
  BRICK,
} from "../../src/games/arcade-engine.js";

await build({
  entryPoints: ["supabase/functions/games-session/index.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  outfile: "_qa/games-expansion-edge-test.mjs",
});
const { makeHandler } = await import("../../_qa/games-expansion-edge-test.mjs");
const {
  db,
  users: [a, b],
  admin,
  rpc,
} = await gameDatabase();
const tokens = new Map([
  ["aaa.userA.ccc", a],
  ["aaa.userB.ccc", b],
]);
const handler = makeHandler(
  (key) =>
    ({
      SUPABASE_URL: "https://backend.test",
      SUPABASE_SERVICE_ROLE_KEY: "fixture-server-key",
    })[key],
  async (url, options) => {
    if (url.endsWith("/auth/v1/user")) {
      const id = tokens.get(
        options.headers.Authorization.replace("Bearer ", ""),
      );
      return Response.json(id ? { id } : { error: "invalid" }, {
        status: id ? 200 : 401,
      });
    }
    assert.equal(options.headers.apikey, "fixture-server-key");
    const body = JSON.parse(options.body);
    try {
      return Response.json(await admin(body.action, body.owner, body.body));
    } catch (error) {
      return Response.json({ message: error.message }, { status: 400 });
    }
  },
);
const call = async (action, body, token = "aaa.userA.ccc") => {
  const response = await handler(
    new Request("https://backend.test/functions/v1/games-session/" + action, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: "https://kensei-workshop.vercel.app",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, data: await response.json() };
};
const start = async (game, difficulty = GAMES[game].default) => {
  await db.query(
    "update workshop_private.game_sessions set started_at=clock_timestamp()-interval '2 minutes' where status<>'active'",
  );
  const response = await call("start", {
    game,
    difficulty,
    rules_version: game === "brick-breaker" ? 2 : 1,
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data;
};
const age = (session, duration) =>
  db.query(
    "update workshop_private.game_sessions set started_at=clock_timestamp()-($1::integer*interval '1 millisecond') where id=$2",
    [duration, session.id],
  );

for (const game of ["connect-four", "reversi"])
  for (const difficulty of Object.keys(GAMES[game].modes)) {
    const response = await call("start", {
      game,
      difficulty,
      rules_version: game === "brick-breaker" ? 2 : 1,
    });
    assert.equal(response.status, 400);
    assert.match(response.data.error, /Private/);
  }
assert.equal(
  (
    await call(
      "start",
      { game: "sudoku", difficulty: "easy" },
      "aaa.invalid.ccc",
    )
  ).status,
  401,
);

for (const game of ["sudoku", "nonogram"]) {
  for (const difficulty of ["easy", "normal", "hard"]) {
    const session = await start(game, difficulty);
    assert.equal(
      (
        await call("finish", {
          session_id: session.id,
          events: [],
          score: 99999,
        })
      ).status,
      400,
    );
    const state = create(game, difficulty, Number(session.seed)),
      answer = solution(state),
      events = [];
    for (
      let index = 0;
      index < answer.length && state.status === "playing";
      index++
    ) {
      if (game === "sudoku" ? state.givens[index] : !answer[index]) continue;
      const event = {
        type: game === "sudoku" ? "digit" : "cell",
        index,
        value: answer[index],
        t: events.length + 1,
      };
      assert.ok(apply(state, event));
      events.push(event);
    }
    assert.equal(state.status, "won");
    await age(session, 5000);
    const response = await call("finish", {
      session_id: session.id,
      events,
      score: 99999,
      won: false,
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.qualified, true);
    assert.equal(response.data.won, true);
    assert.equal(response.data.moves, state.moves);
    assert.equal(response.data.score, 0);
    assert.deepEqual(
      (
        await call("finish", {
          session_id: session.id,
          events: [],
          score: 999999,
        })
      ).data,
      response.data,
    );
  }
}

let session = await start("block-puzzle"),
  state = create("block-puzzle", "classic", Number(session.seed)),
  events = [],
  expectedScore = 0;
assert.equal(
  (await call("finish", { session_id: session.id, events: [] })).status,
  400,
);
while (state.status === "playing") {
  const slot = [0, 1, 2].find(
    (index) => availablePlacements(state, index).length,
  );
  assert.notEqual(slot, undefined);
  const index = availablePlacements(state, slot)[0];
  const cells = SHAPES[state.hand[slot]].cells.length;
  const event = { type: "place", slot, index, t: events.length + 1 };
  assert.ok(apply(state, event));
  events.push(event);
  expectedScore += cells + state.lastLines * 10;
  assert.ok(events.length < 20000);
}
assert.equal(state.status, "lost");
assert.equal(state.score, expectedScore);
await age(session, Math.max(5000, events.length + 1000));
let response = await call("finish", {
  session_id: session.id,
  events,
  score: 2147483647,
  moves: 0,
  won: true,
});
assert.equal(response.status, 200, JSON.stringify(response.data));
assert.equal(response.data.score, expectedScore);
assert.equal(response.data.moves, state.moves);
assert.equal(response.data.qualified, true);

session = await start("brick-breaker");
assert.equal(
  (
    await call("finish", {
      session_id: session.id,
      events: [[0, -1]],
      final_tick: BRICK.maxTicks,
      events_format: "paddle-v2",
    })
  ).status,
  400,
  "Cannot claim five minutes after an immediate start.",
);
await age(session, 300500);
assert.equal(
  (
    await call("finish", {
      session_id: session.id,
      events: [],
      final_tick: BRICK.maxTicks,
    })
  ).status,
  400,
  "Compact replay format is explicit.",
);
for (const bad of [
  { events: [[0, 1025]], final_tick: BRICK.maxTicks },
  {
    events: [
      [0, 0],
      [1, 1024],
    ],
    final_tick: BRICK.maxTicks,
  },
  { events: [], final_tick: BRICK.maxTicks + 1 },
  { events: [[0, -1]], final_tick: 1 },
])
  assert.equal(
    (
      await call("finish", {
        session_id: session.id,
        events_format: "paddle-v2",
        ...bad,
      })
    ).status,
    400,
  );
assert.equal(
  (
    await call(
      "finish",
      {
        session_id: session.id,
        events: [[0, -1]],
        final_tick: BRICK.maxTicks,
        events_format: "paddle-v2",
      },
      "aaa.userB.ccc",
    )
  ).status,
  400,
);
state = create("brick-breaker", "classic", Number(session.seed));
assert.ok(apply(state, { type: "launch", tick: 0 }));
advanceBrick(state, BRICK.maxTicks);
assert.equal(state.status, "lost");
assert.equal(state.reason, "timeout");
const began = performance.now();
response = await call("finish", {
  session_id: session.id,
  events: [[0, -1]],
  final_tick: BRICK.maxTicks,
  events_format: "paddle-v2",
  score: 99999999,
  won: true,
});
const elapsed = performance.now() - began;
assert.equal(response.status, 200, JSON.stringify(response.data));
assert.equal(response.data.score, state.score);
assert.equal(response.data.won, false);
assert.equal(response.data.qualified, true);
assert.equal(response.data.moves, metrics(state).moves);
assert.deepEqual(
  (
    await call("finish", {
      session_id: session.id,
      events: [],
      final_tick: 0,
      events_format: "paddle-v2",
      score: 99999999,
    })
  ).data,
  response.data,
);
assert.ok(
  elapsed < 2000,
  `Full duration Edge verification exceeded 2s locally: ${elapsed.toFixed(0)}ms`,
);
assert.throws(
  () =>
    replay(
      "brick-breaker",
      "classic",
      Number(session.seed),
      Array.from({ length: 20001 }, () => [0, -1]),
      18000,
      300000,
      "paddle-v2",
    ),
  /replay|limits/i,
);
assert.equal(
  (await call("finish", { session_id: session.id, events: "x".repeat(530000) }))
    .status,
  413,
);

// All four new public games reach the same guarded board and profile endpoints.
const seen = new Set();
let profileId;
for (const game of ["sudoku", "nonogram", "block-puzzle", "brick-breaker"]) {
  const board = await rpc(
    "get_game_leaderboard",
    {
      game,
      difficulty: ["sudoku", "nonogram"].includes(game) ? "easy" : "classic",
    },
    "authenticated",
    a,
  );
  assert.ok(board.me);
  profileId = board.me.public_id;
  seen.add(game);
  assert.ok(
    !JSON.stringify(board).match(/"(user_id|state|seed|events|email)":/),
  );
}
const profile = await rpc(
  "get_public_profile",
  { profile_id: profileId },
  "anon",
  null,
);
for (const game of seen)
  assert.ok(profile.game_best_scores.some((entry) => entry.game === game));
assert.ok(
  !profile.game_best_scores.some((entry) =>
    ["connect-four", "reversi"].includes(entry.game),
  ),
);
console.log(
  `PASS expansion Edge: private-only boards, authenticated puzzle wins for all difficulties, Block score replay, compact Brick format/time/limits/forgery/idempotence, public profiles. Full-duration Brick verification ${elapsed.toFixed(0)}ms.`,
);
await db.close();
