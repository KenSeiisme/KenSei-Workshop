# Games

Games have an independent catalog (`data/games.json`), native modules (`src/games`) and generated `/games/` routes. There are **12 games, 9 with Public rankings, and 28 separate tools**. Game search and Continue playing belong to Games; tool search and Workspace remain for tools.

## Games and rules

| Game          | Modes                                                           | Public result                                 |
| ------------- | --------------------------------------------------------------- | --------------------------------------------- |
| 2048          | Classic 4×4                                                     | Score, then largest tile                      |
| Minesweeper   | Beginner / Intermediate / Expert                                | Winning completion time                       |
| Snake         | Slow / Normal / Fast                                            | Score within speed mode                       |
| Memory Match  | 6 / 8 / 12 pairs                                                | Attempts, then completion time                |
| Sudoku        | Easy / Normal / Hard                                            | Winning completion time                       |
| Nonogram      | 5×5 / 10×10 / 15×15                                             | Winning completion time                       |
| Block Puzzle  | Classic 8×8                                                     | Score at a natural terminal position          |
| Brick Breaker | Three stages, three shared lives, five-minute active-play limit | Score, then completion time                   |
| Connect Four  | Three computer levels / same-device two players                 | Private only                                  |
| Reversi       | Three computer levels / same-device two players                 | Private only                                  |
| Block Drop    | Classic / 40-line Sprint                                        | Classic score, lines / winning Sprint time    |
| Pong          | Two-account online invitation room                              | Private only, no persistent saves or rankings |

The static build copies game modules to `/game-scripts/`. `engine.js` delegates to pure versioned rules modules shared by the browser and Edge verifier. Those rules do not access DOM, clocks or network. Existing four-game rule version 1, identifiers and saves remain compatible; adding games does not rewrite old scores. Snake and Brick Breaker advance by fixed logical ticks, independent of rendering frame rate.

The original puzzle bank contains **180 uniquely solvable puzzles**, 30 per Sudoku difficulty and 30 per Nonogram size. Generation is development-only; session seeds select published puzzles deterministically. Sudoku difficulty is classified by explicit solver thresholds, not clue count alone. See [puzzle generation and limitations](puzzle-generation.md). Sudoku, Nonogram, arcade and board rules are native original implementations; the retained original 2048 MIT reference notice remains applicable.

Board computer search runs in a cancellable browser Worker. First/second-player selection, turn-level undo against the computer and single-move undo in same-device play remain Private. Board games are rejected by the Public session API and excluded from public Profile results.

## Progress and Public sessions

Private progress uses the revision-aware IndexedDB queue under the `game` kind, with its own database and save RPCs. Account and guest scopes remain separate. Autosave runs at most every 500 ms during continuous play; server conflicts retain a distinct copy. Guest progress requires explicit Copy to account. Public session IDs are never included in resumable progress.

Guests default to Private. Signed-in players default to Public for new ranked-capable games; existing or restored games remain Private. Pausing, backgrounding, refreshing or restoring a Public run removes its Public eligibility. Sudoku notes do not enter ranked action logs; hints and undo are Private only. Board games always remain Private.

`games-session` exposes `/start`, `/finish` and `/abandon`. JWT verification remains enabled, and the handler additionally checks the current user with Supabase Auth. Only server credentials can call `games_admin`; clients cannot write ranked scores. Each account has one active Public session, 12 starts per minute, a two-hour expiry, a 20,000-action replay limit and a 512 KB request limit. Replays are verified transiently, not stored in the database. Completed responses are idempotent. These casual boards do not prevent automated solving.

Rule versions are selected per game: Brick Breaker now starts at v2; every other game remains v1. Start requests send `rules_version`; outdated Brick clients receive a refresh response before a session is created. Finish always replays the stored session version. Brick Breaker uses `paddle-v2` for new runs and retains `paddle-v1` for old in-flight sessions, with compact `[tick, x]` controls (normalized position 0–1024, `-1` for launch) and `final_tick`. Both cap simulation at 18,000 ticks. See [versioned arcade rules](arcade-rules.md).

`get_game_leaderboard(game, difficulty)` keeps its signature and returns current-version Top 50 plus the caller's rank. `get_game_leaderboard_history(game,difficulty,rules_version)` exposes the read-only archive. Profile retains typing `best_scores` and current `game_best_scores`, adding `game_legacy_best_scores` under Previous rules. Counts deduplicate game identifiers across both versions. Old scores, unlock dates and cumulative verified counts remain intact. Legacy saves retain v1 and separate save slots, without silent conversion. Private progress and room membership never appear publicly.

## Block Drop and milestones

`block-drop-engine.js` implements a seeded 7-bag, SRS rotation, Hold once per landed piece, ghost and three-piece preview. The fixed 60Hz engine owns key-repeat timing, gravity and locking. Classic ranks score then lines; Sprint ranks only a completed 40-line run by time. See [the rules](arcade-rules.md). `block-drop-v1` compact `[tick,input]` replay is bounded to 432,000 ticks, 20,000 events and the existing 512KB request limit. Crossing the Public limit converts the current game to Private without discarding it.

`achievement-catalog.js` contains the 30 stable presentation definitions. The database independently derives unlocks from verified result summaries in the same transaction as score settlement. A unique user/achievement key and the original completion receipt make retries idempotent. Private runs, interrupted runs and failed submissions cannot unlock achievements. Historical backfill uses only provable fields and the earliest qualifying date; it does not infer missing lines or stage completions. `get_my_game_progress()` exposes the current account's verified counts and locked progress; `get_public_profile()` adds unlocked badge IDs/dates only. Existing return fields are preserved.

## Temporary online Pong rooms

`pong.js` is a separate ephemeral client, not an engine registered with resumable saves. Both accounts join through the controlled `pong_room(action, body)` RPC. PostgreSQL atomically enforces two open rooms globally, two players per room, one active room per account, create/join rate limits and tab ownership. Waiting rooms expire after 15 minutes; pauses after 60 seconds. Dead leases are cleaned on room activity; closed metadata is purged after a day when the service is next used.

Paddle/ball state travels through two **private** Realtime Broadcast topics, one owned by each role. Both room members may receive either direction; a player may publish only their own direction. RLS on `realtime.messages` checks actual membership, room expiry, role and an unguessable channel key. No per-frame database writes or public room directory exists. Position streams are at most 10Hz per player while playing and 1Hz idle, plus immediate control/score events. Two rooms therefore target about 80 billable send/delivery events per second, leaving control headroom under the current 100/s service limit. Validate actual traffic before release; do not automatically upgrade the service plan.

The host advances native 120Hz physics; the peer interpolates received snapshots. Score first to seven or the ten-minute score comparison determines a casual result. Backgrounding pauses the match; both Ready to continue. The client allows 15 seconds to reconnect, then marks the room Interrupted. A disconnected game cannot silently continue. Round numbers and monotonic sequences reject old rematch packets. Neither player is trusted for a ranked score: Pong deliberately has no Public score, achievement or durable match record.

`node scripts/verify-pong-online.cjs` accepts exactly four explicitly approved disposable Auth credentials on stdin. It uses real Supabase Auth and WebSockets, never prints tokens or payloads, verifies nonmember and opposite-direction publishing denial and measures two-room traffic. Credentials and accounts must be created/removed by the authorized operator; this command does not create users. Nonsecret evidence is written to ignored `_qa/pong-real-acceptance.json`.

## Verification and release

Run `pnpm test:games`, `pnpm test:games-expansion` and `pnpm test:arcade-next` against a local preview. Unit/database tests cover deterministic rules, replay, ownership, milestones and rank ordering. Automated browser fixtures exercise actual controls and the bundled Edge handler with isolated PostgreSQL; their Broadcast bridge is separate from real-service verification. The production operator additionally runs the explicitly approved real-WebSocket check above without creating public scores. See the [Block Drop/Pong validation record](validation/2026-10-23-arcade-next.md).

Build the Edge artifact from `supabase/functions/games-session/index.ts` with esbuild, `bundle: true`, `format: esm`, target `es2022`; the canonical rules are bundled once. Apply and verify migrations before deploying `games-session`, then push the existing GitHub branch and verify the Vercel production URL. Never place server credentials in static files. A successful push alone does not verify the live website.

## Board-first experience and sound

`game-experience.css` centers the stable board and keeps HUD/active controls together. Saved progress, Milestones, leaderboards and Help start folded below; save state remains visible in the progress summary. Brick Breaker has direct pointer/touch movement, focused keyboard controls and mobile buttons, without a paddle slider. V2 shows ball count, falling powerups and timed buffs.

`audio.js` synthesizes Web Audio cues independently of rules and Effects. Defaults are on at 35%, unlocked only by Start, Ready, resume or sound controls. `kensei-game-audio-v1` remembers mute/volume across games and tabs. Import, previews and page load stay silent; pause, navigation and hidden pages stop voices. At most eight voices and per-cue cooldowns bound collision noise. No audio assets or music are fetched. Result/verification updates never wait for decorative effects.

Run `pnpm test:game-experience` for versioned replay, audio, database and browser regression. See the [experience validation record](validation/2026-10-23-game-experience.md).

## Neon presentation

The game stage and public game record use `game-neon.css`. The client-only presenter keeps before/after snapshots and transient visual mappings separate from canonical state. DOM reconciliation retains cells, cards, focus and scroll; canvas interpolation reads the fixed-step state and never advances it. Timers, scoring, session replays and save formats remain authoritative and unchanged.

`Effects: Auto / Reduced / Off` uses the local key `kensei-game-effects-v1`, shared across game/Profile pages and browser tabs. Auto follows the system reduced-motion preference. Pause, restart, undo, navigation, backgrounding and preference changes cancel decorative animation. A restored game does not replay old celebration effects.

Run `pnpm test:game-neon` in addition to game regressions. Set `RECORD_GAME_VIDEO=1` to produce an ignored demonstration video after installing Playwright's optional FFmpeg encoder. See the [neon validation record](validation/2026-10-23-neon-games.md) for coverage and evidence.
