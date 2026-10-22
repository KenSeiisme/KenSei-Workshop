# Games

Games use their own catalog (`data/games.json`), native modules (`src/games`) and generated `/games/` routes. The tools catalog remains 28 entries. Add a game to both its catalog and the shared versioned engine; do not add it to tool search or Workspace.

The static build copies game modules to `/game-scripts/`. `engine.js` contains no browser or network dependencies and is the only rules implementation used by the browser and the Edge verifier. Snake advances by fixed ticks, not render frames.

Private progress uses the existing revision-aware IndexedDB queue under the new `game` kind, with its own database and game save RPCs. Account and guest scopes stay separate. Autosave runs at most every 500 ms during continuous play. Keep the record revision when editing; server conflicts return a distinct copy. Public session IDs are never included in resumable progress.

`games-session` exposes `/start`, `/finish` and `/abandon`. JWT verification remains enabled, and the handler additionally asks Supabase Auth for the current user. Only its server credentials can call `games_admin`; the browser cannot write ranked scores. Each account has one active Public session, 12 starts per minute, a two-hour expiry, a 20,000-action replay limit and a 512 KB request limit. Replays are verified transiently, not stored in the database. Completed responses are idempotent. These are casual boards and do not prevent automated solving.

`get_game_leaderboard(game, difficulty)` is anonymous-safe and returns current-version Top 50 plus the caller's own best rank. Profile retains `best_scores` and adds `game_best_scores`. Public boards resolve current profile names and avatars; private progress is never returned.

Run `pnpm test:games` against a local preview. The Edge tests bundle the real handler and exercise it against a separate PostgreSQL fixture; browser tests exercise full UI sessions against that verifier. They do not use production user accounts.

Build the Edge deployment artifact with esbuild from `supabase/functions/games-session/index.ts`, `bundle: true`, `format: esm`, target `es2022`. This includes the canonical engine without maintaining a second copy. Apply and verify the database migration before deploying `games-session`, then publish the static site through the existing GitHub/Vercel integration. Never place server credentials in static files.
