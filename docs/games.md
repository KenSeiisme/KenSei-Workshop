# Games

Games have an independent catalog (`data/games.json`), native modules (`src/games`) and generated `/games/` routes. There are **10 games, 8 with Public rankings, and 28 separate tools**. Game search and Continue playing belong to Games; tool search and Workspace remain for tools.

## Games and rules

| Game          | Modes                                                           | Public result                        |
| ------------- | --------------------------------------------------------------- | ------------------------------------ |
| 2048          | Classic 4×4                                                     | Score, then largest tile             |
| Minesweeper   | Beginner / Intermediate / Expert                                | Winning completion time              |
| Snake         | Slow / Normal / Fast                                            | Score within speed mode              |
| Memory Match  | 6 / 8 / 12 pairs                                                | Attempts, then completion time       |
| Sudoku        | Easy / Normal / Hard                                            | Winning completion time              |
| Nonogram      | 5×5 / 10×10 / 15×15                                             | Winning completion time              |
| Block Puzzle  | Classic 8×8                                                     | Score at a natural terminal position |
| Brick Breaker | Three stages, three shared lives, five-minute active-play limit | Score, then completion time          |
| Connect Four  | Three computer levels / same-device two players                 | Private only                         |
| Reversi       | Three computer levels / same-device two players                 | Private only                         |

The static build copies game modules to `/game-scripts/`. `engine.js` delegates to pure versioned rules modules shared by the browser and Edge verifier. Those rules do not access DOM, clocks or network. Existing four-game rule version 1, identifiers and saves remain compatible; adding games does not rewrite old scores. Snake and Brick Breaker advance by fixed logical ticks, independent of rendering frame rate.

The original puzzle bank contains **180 uniquely solvable puzzles**, 30 per Sudoku difficulty and 30 per Nonogram size. Generation is development-only; session seeds select published puzzles deterministically. Sudoku difficulty is classified by explicit solver thresholds, not clue count alone. See [puzzle generation and limitations](puzzle-generation.md). Sudoku, Nonogram, arcade and board rules are native original implementations; the retained original 2048 MIT reference notice remains applicable.

Board computer search runs in a cancellable browser Worker. First/second-player selection, turn-level undo against the computer and single-move undo in same-device play remain Private. Board games are rejected by the Public session API and excluded from public Profile results.

## Progress and Public sessions

Private progress uses the revision-aware IndexedDB queue under the `game` kind, with its own database and save RPCs. Account and guest scopes remain separate. Autosave runs at most every 500 ms during continuous play; server conflicts retain a distinct copy. Guest progress requires explicit Copy to account. Public session IDs are never included in resumable progress.

Guests default to Private. Signed-in players default to Public for new ranked-capable games; existing or restored games remain Private. Pausing, backgrounding, refreshing or restoring a Public run removes its Public eligibility. Sudoku notes do not enter ranked action logs; hints and undo are Private only. Board games always remain Private.

`games-session` exposes `/start`, `/finish` and `/abandon`. JWT verification remains enabled, and the handler additionally checks the current user with Supabase Auth. Only server credentials can call `games_admin`; clients cannot write ranked scores. Each account has one active Public session, 12 starts per minute, a two-hour expiry, a 20,000-action replay limit and a 512 KB request limit. Replays are verified transiently, not stored in the database. Completed responses are idempotent. These casual boards do not prevent automated solving.

Existing request formats remain compatible. Brick Breaker uses `events_format: "paddle-v1"`, compact `[tick, x]` controls (quantized paddle position 0–1024, `-1` for launch) and `final_tick`. Its verifier caps simulation at 18,000 ticks, corresponding to five minutes at 60 Hz. Public timing is server-verified.

`get_game_leaderboard(game, difficulty)` is anonymous-safe and returns current-version Top 50 plus the caller's own best rank. Profile retains typing `best_scores` and returns `game_best_scores` for eight ranked games. Results resolve current profile names and avatars; private progress and board matches are never returned publicly.

## Verification and release

Run `pnpm test:games` and `pnpm test:games-expansion` against a local preview. The unit and database tests cover deterministic rules, replay, ownership and rank ordering. Browser tests exercise actual controls and Public sessions against the real bundled Edge handler with isolated PostgreSQL fixtures; they do not use production members or create production scores. See the [2026-10-23 validation record](validation/2026-10-23-games-expansion.md).

Build the Edge artifact from `supabase/functions/games-session/index.ts` with esbuild, `bundle: true`, `format: esm`, target `es2022`; the canonical rules are bundled once. Apply and verify migrations before deploying `games-session`, then push the existing GitHub branch and verify the Vercel production URL. Never place server credentials in static files. A successful push alone does not verify the live website.
