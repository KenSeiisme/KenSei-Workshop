# Chess acceptance

Results are recorded separately for pure tests, simulated browser layouts, real backend and physical devices.

| Area                | Evidence                                                                                                                                                                                | Status  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Rules               | Starting-position perft 8,902; Kiwipete 48/2,039; legality, castling, en passant, promotions, claims, automatic endings                                                                 | Passed  |
| Adjudication        | Two-knight / knight-vs-bishop / opposite-bishop mating witnesses; 512-state blocked-pawn graph; unknown outcomes excluded                                                               | Passed  |
| Database            | PGlite applies all migrations; ownership, CAS, duplicate requests, Fischer increments, queues, expiration, unresolved agreement, profile and RPC permissions                            | Passed  |
| Existing Go         | Original Go database and Edge suites unchanged                                                                                                                                          | Passed  |
| Chromium            | Six simulated viewports, real Stockfish Worker, focus, state-preserving locale switch, moves, undo, draw, PGN, review, refresh recovery                                                 | Passed  |
| Firefox             | Same browser task with the installed Firefox runtime                                                                                                                                    | Passed  |
| WebKit              | Same layout, interaction, promotion, real Worker and recovery task                                                                                                                      | Passed  |
| Production schema   | Two compatible migrations, Edge v15, anonymous leaderboard reads; admin RPC denied to anon/authenticated                                                                                | Passed  |
| Production backend  | Three disposable Auth accounts, real two-browser Ready/moves/draw, 7 private revision broadcasts, ownership/stale-request rejection, refresh/read-only tab, Go/Pong/Whiteboard capacity | Passed  |
| Production site     | Both languages, navigation/search, resources, real engine and download                                                                                                                  | Passed  |
| Android hardware    | Touch confirmation, soft keyboard, downloads, sound and sustained AI use                                                                                                                | Pending |
| Real Google consent | Interactive sign-in/return on the user's real account                                                                                                                                   | Pending |

The bounded timeout verifier is a known product limitation, not an untested claim of complete FIDE adjudication. It can leave ordinary middlegames unresolved; no uncertain timeout win is posted.

Android short checklist: open Chess, start local play, tap a piece and target then Confirm; check promotion; switch language without losing the position; pause/continue and refresh/restore; play a Level 2 computer game; download/open PGN; join an invitation with a second signed-in device, Ready manually and refresh during play. Confirm the online clock continues and only your own turn is playable.

Full local regression: 33/33 unit suites and 18/18 database suites passed. Targeted Chess/Go database suites passed again after leaderboard isolation. Browser checks use actual local engines with a mocked account API; physical Android and real Google consent are separate pending checks.

Live run: 20 instrumented requests, p95 round-trip 1,243ms (network latency, not Edge CPU time), zero public scores. Cleanup verified zero fixture users, sessions, matches, public profiles and statistics. No privileged test endpoint was installed.

Production walk-through found two release defects and supplied targeted fixes: Vercel's archive exclusion hid the required Stockfish source download, and an older Project entry without optional search aliases broke non-empty site searches. The source archive is explicitly included, builds require it, and search accepts older indexes with missing aliases. The bilingual browser regression now deliberately tests such an index, including Minesweeper, QR Studio and Chess searches.

Production verification passed against the actual Vercel domain with no mocked account API: 90 public entry-page requests, 11 resource/hash checks, Traditional Chinese search, Games navigation, anonymous leaderboard, local play, state-preserving language switch, actual PGN download, production Stockfish Worker reply and IndexedDB Continue recovery. No browser page errors occurred. Formal schema tests cover 104 sitemap URLs and 112 localized pages. Simulated touch/viewports remain distinct from physical Android acceptance.
