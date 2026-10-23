# Neon games validation — 2026-10-23

## Release behavior

- Redesigned the Games directory and ten game pages with a dedicated neon stage, compact setup, live HUD, control deck, pause/result panels and responsive side panels. Home, Tools, shared navigation and the personal Profile editor retain their existing presentation.
- Added real 2048 tile movement, persistent two-sided Memory cards, Mines reveal/flag feedback, Snake render interpolation, Sudoku digit/note feedback, Nonogram fill/mark/clue effects, Block placement/line effects, Brick trails/impacts, Connect Four drops/winning lines and Reversi disc flips.
- Effects are visual only. The shared game engines, puzzle bank, AI, rule version, save store, Public client/server, authentication and tool catalog exactly match the pre-release source. This release requires no database migration or Edge redeployment.
- `Effects: Auto / Reduced / Off` is shared locally across Games and public Profile. Auto follows the system preference. Changing preferences cancels active decorative effects; it does not submit or replace a game. Full particles are bounded at 120 desktop / 60 mobile and their canvas pixel ratio is capped at 2.
- Public Profile keeps eight ranked game cards, current difficulty-specific results and typing records. Private board games stay excluded. Alternative game modes expand separately; missing results are identified explicitly.
- Result panels distinguish Private, verifying, verified, failed and unqualified submissions. Private results do not claim successful storage; the existing save status remains authoritative.

## Implementation and regression checks

- Added `game-motion.mjs`: 1,000 2048 presentation mappings checked against the canonical engine; Sudoku unit completion, Nonogram clue matching, winning-line detection and interpolation checks; identical Snake/Brick states under 30/60/120/144Hz frame grouping.
- Original game browser regression passed including server-verified Public results, offline writes, lost acknowledgments, outbox retry, conflict copies, separate accounts, explicit guest copying and unavailable IndexedDB.
- Six-game integrated regression passed: Public Sudoku/Nonogram completed through the real UI and bundled verifier; Private puzzle editing/restore, Block pointer drag, Brick controls, complete local board games, AI first/second-player starts and stale Worker cancellation.
- Responsive/public Profile visual suite passed, covering reduced motion, correct result units, alternative difficulties, empty records, long Chinese names, safe text and repeat rendering.
- Animation-specific browser checks cover persistent nodes, actual moving/flip/drop elements, rapid input without backlog, equal Full/Off states, pause cleanup, fractional Snake rendering, local preference restoration, media preference changes, cross-tab preferences and zero guest save/Public uploads.
- Ten active game layouts are checked at 320, 360, 768 and 1440px. Browser emulation is not physical-device testing. Frame sampling is environment-specific; `_qa/neon-frame-stats.json` records the measured callback timings rather than a universal frame-rate claim.
- Fixed an observed fast Nonogram drag failure: inherited document smooth scrolling continued after focus positioning, moving the board under the pointer. Games use immediate document positioning; the integrated drag now asserts stable document scroll as well as complete painted cells.

## Reproduce and inspect

Build and start a preview, set `TEST_BASE_URL`, then run `pnpm test:game-neon`, `pnpm test:games` and `pnpm test:games-expansion`. The animation suite records video only when `RECORD_GAME_VIDEO=1`; install Playwright's encoder with `pnpm exec playwright install ffmpeg` when needed.

Use `pnpm games:record` for a separate fixed-viewport, three-game demonstration without layout-test viewport changes.

Representative artifacts remain ignored local files: `_qa/neon-animation-demo.webm`, `_qa/game-neon-demo.webm`, `_qa/neon-memory-mid-flip.png`, `_qa/neon-connect-mid-drop.png`, `_qa/neon-*-360.png`, `_qa/neon-*-1440.png` and `_qa/profile-games-populated-*.png`. Inspect the video/mid-transition frames for motion and the static captures for layout. No demonstration media is uploaded by the website.

## Publication

Pending final source push and Vercel automatic deployment. Production acceptance runs the real anonymous game suites, checks exact new asset hashes and inspects the canonical Games/public Profile pages. Local passes alone do not establish that the new visuals are live.
