# Games expansion validation — 2026-10-23

## Implementation and compatibility

- Added Sudoku, Nonogram, Block Puzzle, Brick Breaker, Connect Four and Reversi: 10 independent Games entries; the separate tools catalog remains 28 entries.
- Eight games support ranked sessions. Connect Four and Reversi provide three computer levels and same-device play, remain Private, and do not appear as public Profile score cards.
- Shared pure rules preserve original four-game version-1 behavior, save identifiers and legacy event formats. New puzzle, arcade and board modules are used by both browser rules and the bundled verifier.
- Published 180 original, uniquely solvable puzzles: 30 per Sudoku difficulty and 30 per Nonogram size. Sudoku labels use documented naked/hidden-single solver thresholds; they are not a standard human difficulty rating.
- Fixed-step Brick Breaker uses quantized compact controls, a 60 Hz simulation, three stages, three shared lives and an 18,000-tick active-play limit. Board AI uses cancellable Workers.
- Existing account/guest isolation, revision checks, conflict copies, explicit guest import and Public result retry behavior remain in place. A restored Public run remains Private.

## Local automated verification

- All six expansion suites passed: puzzle rules/bank uniqueness, arcade rules, board rules/AI, real Edge handler integration, database permissions/rankings and the integrated six-game browser suite.
- Existing game rules, Edge, database, browser and visual regression suites passed. Profile, authentication and representative existing tool regression suites also passed; this release does not claim a fresh full output test of all 28 tools.
- Puzzle tests independently solve and uniqueness-check every bank entry, then verify deterministic seeds, corrections, immutable givens/clues, notes, completion, replay and malformed-save rejection.
- Integrated browser tests complete Public Sudoku and Nonogram using actual UI interactions; the real Edge handler recomputes results against an isolated PostgreSQL fixture. Verified rankings, note-free Public logs, disabled Public hints/undo and eight ranked-only Profile cards with game links.
- Private UI coverage includes Sudoku notes/hint/undo and explicit restore; Nonogram keyboard, fast interpolated pointer painting and preserved scrolling; Block Puzzle tap/drag, illegal-placement feedback, score and reload recovery; Brick Breaker painted canvas, launch, quantized paddle control, advancing clock and pause/resume.
- Board UI coverage includes AI first/second-player starts, human-turn undo, a complete same-device Connect Four win, a complete Reversi game with legal moves and automatic pass, keyboard input, and cancelled Worker tasks that cannot alter paused or replacement games. The cancellation test delays dispatch to the real native Worker; it does not fabricate computer moves.
- All six new game pages passed at 320, 360, 768 and 1440px without horizontal page overflow or uncaught browser errors. Final desktop/mobile screenshots and the populated eight-card Profile were visually inspected. Puzzle controls use the existing branded button styles.

Representative artifacts are `_qa/games-expansion-{sudoku,connect-four}-1440.png`, `_qa/games-expansion-<game>-360.png`, `_qa/games-expansion-brick.png` and `_qa/games-expansion-profile.png`. Browser layout checks emulate screen sizes; physical-device testing and a human Google consent flow are not claimed. Full Public test accounts and scores exist only in isolated fixtures.

## Supabase rollout and runtime verification

- Applied and verified `20261022173434_workshop_six_more_games.sql`; six existing production game results remained present.
- Final `games-session` deployment is version 4, ACTIVE, with `verify_jwt: true` and explicit Auth user verification. The final unauthenticated endpoint returned HTTP 401.
- A temporary protected benchmark measured real replay durations inside the deployed Edge runtime across three runs. A legitimate three-stage Brick Breaker replay scored 980 points using 17,038 ticks, 7,241 events and an 81,452-byte request; replay duration was **22.6–31.7 ms**. An 18,000-tick worst-limit sample took **56.5–67 ms**.
- These are wall-clock/runtime measurements, not independent CPU usage measurements or a guarantee under every deployment condition. The temporary benchmark route was removed before the final function deployment.
- No production test accounts or ranked scores were written during this verification.

## Static publication status

- Pushed implementation commit `42e9898d86c5f9fb552520220c30c8ebbfa5ab30` to the existing `KenSei-Workshop` branch. Vercel's automatic deployment reported success; acceptance used `https://kensei-workshop.vercel.app/`.
- Both `tests/browser/live-games.cjs` and `tests/browser/live-games-expansion.cjs` passed against the canonical site with real anonymous sessions and APIs. The former also matched the deployed game modules, styles, Profile, shared save modules and retained 2048 notice to local SHA-256 hashes.
- Verified all ten game pages, actual guest play in all six new games, explicit reload recovery, real AI Worker output, local two-player moves, Continue playing and an existing public Profile with eight ranked-game cards. The original four games also passed play and restore checks.
- Read-only production checks passed for all eight public leaderboards and rejected leaderboard requests for the two Private board games. An unauthenticated Public start returned HTTP 401. Guest play generated no save uploads or Public submissions, and public RPCs returned no private save, seed, replay or email fields.
- All 28 existing tool routes returned HTTP 200. Home remains tools-first; Games has a separate catalog and search. Production mobile layout checks passed, including the existing public Profile at 320px.
- Visually inspected production directory, game and Profile captures in `_qa/expansion-production-*.png`. A final copy-only polish replaces duplicate board-card mode badges with the computer difficulty count; gameplay and service code are unchanged.
- Publication verification did not create production accounts or scores or claim a human Google consent flow.
