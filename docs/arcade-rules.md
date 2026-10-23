# Arcade rules · version 1

`arcade-engine.js` is shared by the browser and Edge. It has no DOM, wall-clock or network dependency. Keep the v1 catalog, seeded xorshift32 stream and fixed-point rules stable when adding future versions.

## Block Puzzle

- 8×8, 25 fixed-direction shapes. `SHAPES` order is part of the rules. Each new hand independently chooses three uniformly distributed catalog entries using the game's seeded stream.
- `hand` contains three catalog indexes, or `null` after placement. `{type:'place',slot,index,t}` anchors a shape's top-left at `index`. All its cells must fit the board and be empty. There is no manual rotation.
- Each placed cell earns one point. Full rows and columns are detected together; each complete line earns ten points, and crossing cells are removed once. `lastClear` is the unique cleared-cell list; `lastLines` and cumulative `cleared` count lines.
- Refill only after all three shapes have been used. A run ends when none of its remaining shapes can fit. `canPlace` and `availablePlacements` support click, keyboard and drag previews using these same rules.

## Brick Breaker

- World: 640×480, ball radius 6; three original finite brick patterns, three lives shared across all stages, ten points per brick. Completing all three stages wins; losing all lives or reaching tick 18,000 ends the run. Later stages increase ball speed; no powerups or infinite levels.
- The engine advances at exactly 60 steps per second. Ball positions and velocities use integer fixed-point units (`BRICK.scale = 1024`). Collision detection sweeps a ball center against radius-expanded brick/paddle bounds and wall planes. Corner ties reflect both axes; a removed brick scores once. Rendering can run at any refresh rate without changing these steps.
- `paddle` is normalized 0–1024, constrained so the entire paddle stays in the world. `apply(state,{type:'paddle',tick,x})` changes position, at most once per two ticks and 9,000 changes per run. `apply(state,{type:'launch',tick})` launches an attached ball; repeated launch is rejected. A new stage or a lost life requires another launch.
- `advanceBrick(state,targetTick)` advances from the existing tick; it stops at the natural terminal tick. The client must use game elapsed time (excluding private pauses) rather than animation callback count. Public replay rejects final ticks after a terminal event.

## Compact public replay

`events_format: 'paddle-v1'` uses pairs `[tick,x]` for a paddle change and `[tick,-1]` for launch. `tick` is an integer, nondecreasing, from 0 to 18,000; `x` is an integer from 0 to 1,024. Launch is exempt from the two-tick paddle interval but must correspond to an attached ball.

`replayBrick(difficulty,seed,events,finalTick,durationMs,format)` recreates the initial state, validates and replays every input, advances to `finalTick`, then requires a natural completed game. It rejects unsupported formats, unfinished games, more than 20,000 events, impossible speed (60Hz plus the existing 250ms allowance), invalid paddle coordinates and actions after termination. The Edge layer additionally retains its 512KB request limit, authenticated ownership, session expiry and idempotent settlement. Returned score is always recomputed; client-supplied score is ignored.

Local `arcade-games.mjs` checks all three stage transitions, corner collisions, life loss, render grouping, bounds and forged replay attempts. Its worst-path 18,000-step physics fixture leaves every brick in the collision search for the entire run; final deployment must additionally verify the actual Edge CPU duration.

## Temporary Edge runtime benchmark

Run `node scripts/benchmark-games-edge.mjs` to create the ignored `_qa/games-session/benchmark.ts`. The helper bundles the actual canonical handler and game engines, removing only the handler's original listener before adding the temporary wrapper. It reads no keys, generates no secret and never deploys.

The deployment operator must replace the single token placeholder **in memory** with a random token of at least 32 characters, retain gateway `verify_jwt: true`, and invoke `POST /games-session/__bounded_replay_check` with a valid project JWT and the matching `x-replay-check` header. An unreplaced placeholder cannot enable the benchmark. Other paths and unmatched requests use the unchanged normal handler.

The bounded route generates a legitimate seeded three-stage game, replays it through the canonical public dispatcher, and optionally measures all 18,000 fixed steps with every brick retained as a collision candidate. It returns only the score, win status, counts, payload byte size and timing summaries. Generation checks a 900ms budget; optional steps stop at a 1,500ms total budget. No state, event sequence, token or account data is returned. Timing values are wall-clock measurements; platform CPU logs provide the independent CPU evidence.

Immediately after the check, rebuild with `node scripts/build-games-edge.mjs` and restore the normal `_qa/games-session/index.ts` deployment with JWT checks enabled. Confirm the temporary path is no longer available and normal unauthenticated requests remain rejected. Never commit generated benchmark bundles or credentials.

## Block Drop

`block-drop-engine.js` uses a 10×20 visible grid plus four hidden spawn rows. The seven-piece catalog order and seeded xorshift32 7-bag stream are versioned rules. SRS has distinct I and JLSTZ kick tables; O does not shift during rotation. Hold is allowed once until a piece locks. The ghost and three previews read state without consuming randomness.

Logic runs at 60Hz. Gravity increases with level; each ten cleared lines advances one level. Lock delay is 30 ticks, with at most 15 grounded movement/rotation resets. Held horizontal input uses ten-tick initial delay and three-tick repeat, independent of operating-system key repeats. Soft drop earns one point per cell; hard drop earns two. Clearing 1/2/3/4 rows earns 100/300/500/800 times the level at lock. There are no combo, spin or back-to-back bonuses.

Classic ends at blocked spawn/top-out. Sprint wins when at least 40 lines have cleared; earlier top-out is a loss and cannot rank. The browser writes compact `block-drop-v1` pairs `[tick,inputIndex]`; replay validates monotonic tick bounds and legal inputs and requires the natural terminal tick. Public has a 432,000-tick ceiling within the existing two-hour session, 20,000-action and 512KB limits. Reaching a client Public cap changes eligibility to Private and retains playable state. Animation, current effects mode and rendering refresh rate never enter the replay or affect scoring.
