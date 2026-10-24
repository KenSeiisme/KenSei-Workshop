# Twelve-game experience upgrade · 2026-10-23

## Delivered

- Twelve games and 28 tools retained. Board-first layout, shared original Web Audio cues, on/35% gesture-unlocked defaults, persisted mute/volume, folded information and visible save summary.
- Brick Breaker v2: three seeded power bricks per stage, falling pickups, up to three balls, 12-second wide paddle, eight-second slow balls, last-ball life loss and clean stage transitions. Direct pointer/touch/keyboard and mobile buttons replace the slider.
- Per-game version dispatch. New Brick runs use v2/paddle-v2; old saves and in-flight v1 sessions keep the original engine. Other eleven games remain v1. Save slots/local bests, current/archive boards and Profile Previous rules stay separated.
- Migration `20261023150554_workshop_game_experience_v2` applied before frontend release. Canonical `games-session` deployed with JWT verification enabled. No new score/save tables and no deletion or rewriting of existing results, saves or unlock dates.

## Local verification

- All 19 unit suites and 11 database suites passed, including updated per-game-version expectations. New tests cover seeded drops, repeated buffs, three-ball cap, simultaneous hits, life/stage cleanup, v1/v2 saves and replay, ownership, old sessions, stale clients and achievement idempotency.
- A natural seeded v2 game clears all three stages at 980 points; canonical replay returns identical score/moves. Synthetic worst case retains all 40 brick collision candidates and three balls for 18,000 steps: about 82–100ms in local Node. This is a local measurement, not a production Edge CPU measurement.
- Grouping fixed logic steps at 30/60/120/144Hz produces identical canonical states. Full/Off rapid input, stable nodes, AI cancellation, Memory's original mismatch window, Snake interpolation and cleanup passed browser regressions.
- Real Edge browser: all twelve ready/active pages fit 320/360/768/1440px. Audio creates no context on load, activates on Start, caps voices at eight, stops on pause and remembers mute across pages. Valid Private fixtures verify simultaneous Multiball/Wide/Slow and Legacy restore/archive/Profile.
- Existing game browser suites pass offline save/retry, lost acknowledgments, conflicts, account isolation, completed Public outbox, rejected duplicate/forged submissions, actual Sudoku/Nonogram replay and board games. Block Drop/Pong integration passes two independent simulated rooms, actual natural match completion and achievement receipt behavior.
- Existing Auth/Profile browser regressions and all 28 tool layout/help/keyboard checks passed. No tool runtime or tool routes were changed.
- Fixed-view actual interaction recording: `_qa/neon-animation-demo.webm` (2048, matching/mismatching cards, Connect Four win); sampled frames inspected. Layout screenshots and test evidence remain ignored under `_qa`.

## Production backend verification

- Current Brick leaderboard reports v2, archive v1; Snake remains v1. Anonymous users cannot call the internal settlement function. Existing counts immediately before/after migration: 13 results, eight achievement unlocks, 29 saves.
- Actual Auth + normal Edge requests: unauthenticated start 401, stale Brick client 409, current Brick start v2, wrong-format finish 400, another game's start v1; created sessions explicitly abandoned without scores.
- Four explicitly approved disposable Auth users exercised real private Realtime channels. Nonmembers cannot subscribe; role RLS rejects opposite-direction publishing. Two active rooms measured 77.97 send/delivery events/s over six seconds, below the current 100/s service ceiling. Mutual Ready, pause/resume and sub-frame clock ordering passed.
- Test users, profiles, rooms, members, sessions and results all verified absent after guarded cleanup. No emails sent and no test scores published.
- Security/performance advisor findings are unchanged from the pre-migration baseline; intentional public read functions remain constrained to public fields. Existing unrelated Auth/typing advisories were not changed.

## Approved production Edge performance check

The user explicitly authorized the temporary endpoint after the initial automatic approval rejection. On 2026-10-23T15:37:16.161Z, `games-session` version 8 briefly added the bounded benchmark wrapper with the gateway JWT check retained, a random 256-bit header secret and a five-minute hard expiry. Other routes delegated to the canonical handler. The benchmark creates no account, score, save or database fixture.

| Measurement                                        | Production result                                         |
| -------------------------------------------------- | --------------------------------------------------------- |
| Natural three-stage game                           | 980 points, won after 16,715 ticks                        |
| Compact replay                                     | 7,200 events, 81,283 bytes; canonical score/moves matched |
| Fixture generation                                 | 64.215ms elapsed                                          |
| Canonical replay                                   | 28.641ms elapsed                                          |
| Three balls, 40 collision candidates, 18,000 steps | 147.579ms elapsed, no steps skipped                       |
| Combined bounded computation                       | 241.094ms elapsed                                         |
| Platform-reported isolate CPU                      | 258ms; Shutdown reason EarlyDrop, not CPUTime             |

CPU evidence belongs to the version-8 execution `5ed1bb9a-283f-49a1-8f6e-7f8dbba23b10`. The 258ms platform value includes isolate overhead and is separate from individual `performance.now()` elapsed timings. This one bounded measurement fits the documented 2,000ms CPU budget; it is not a guarantee for every future workload or concurrent load.

The original source was immediately restored as canonical version 9. A fresh API read confirmed ACTIVE, `verify_jwt: true` and byte-for-byte equality with the pre-test production file. The former endpoint with its correct secret now returns 401 through normal anonymous-account checks instead of running the benchmark. No temporary route or secret remains in the deployed source.

At 2026-10-23T15:39:29.502Z, an additional unmocked production browser regression passed all twelve game pages, 28 tool routes, seven resource hashes, v2 control/restore, v1 archive, sound preference, public Profile and responsive layouts. It recorded no mutations or uncaught errors. Nonsecret benchmark/restoration evidence is retained locally under `_qa`; the random header secret was never written to disk or Git.

## Frontend release

- Code commit `f7956d86a2a550774b986c4831368640ccb1488b` pushed to the existing `KenSei-Workshop` branch. The connected Vercel check reports success: [deployment](https://vercel.com/kenseiismes-projects/kensei-workshop/A2wgZ16ZX88q6g3ZrfkLU4JSHcbZ).
- At 2026-10-23T15:30:28.085Z, the canonical `https://kensei-workshop.vercel.app/` served all twelve ready game pages and all 28 tool routes. Seven changed runtime assets matched local SHA-256 values exactly.
- Unmocked production browser checks passed v2 launch/direct controls, pause and explicit restore, v1 archived leaderboard, remembered mute, public Profile with nine ranked cards, 320/360/768/1440px layout, guest Continue playing and actual computer-worker matches. No account mutations or uncaught errors occurred.
- Production `games-session` was initially published as canonical version 7 and, after the explicitly authorized bounded measurement, restored with identical source as version 9. JWT checks remain enabled; the temporary benchmark route is removed.
- Four disposable QA users and their profiles, rooms, memberships, sessions and results were all verified removed. The original independent car project was unchanged.
