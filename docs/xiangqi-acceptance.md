# Xiangqi acceptance

Evidence is separated into pure rules, simulated browser/device layouts, real backend and physical devices. No claim of zero bugs or complete formal verification is made.

| Area                  | Evidence                                                                                                                                                                                                                                     | Status  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Official rulings      | 110 WXF diagrams plus 110 color/board symmetries; immutable replay, warning-before-forfeit and natural-limit checks                                                                                                                          | Passed  |
| Move generation       | Initial 44 legal moves and 1,920 depth-two positions; horse legs, elephant eyes, palace, soldier, cannon and facing-generals handling                                                                                                        | Passed  |
| Formats               | Actual ICCS TXT download, JSON/FEN import, review, result consistency and local-only imports                                                                                                                                                 | Passed  |
| Browser UI            | Chromium, Firefox and WebKit; six simulated viewports, real engine, local moves, undo, pause, focus, language switch preserving nodes, refresh and Continue                                                                                  | Passed  |
| Five-level AI         | Actual 0/4/8/12/16 skill commands and all five search budgets in Chromium, Firefox and WebKit; red/black conversion, cancellation, missing isolation, download failure and retry                                                             | Passed  |
| Avatar/profile        | Synthetic signed-in avatar under isolation; bilingual public Xiangqi records, preserved Chess section, profile links and narrow layout                                                                                                       | Passed  |
| Database              | All 19 database suites passed, including unmodified Go/Chess suites and Xiangqi ownership, CAS, idempotency, clocks, expiration, queue/capacity, statistics, ten-game threshold and private-save permissions                                 | Passed  |
| Unit regression       | 34 of 35 initially passed; the remaining audio test expected 14 games. Updated to 15 and that test passed separately                                                                                                                         | Passed  |
| Production schema     | Compatible migration applied; board-match v16 deployed; anonymous leaderboard read and service-only board-admin privileges checked                                                                                                           | Passed  |
| Real online play      | Three real disposable Auth accounts; two browser players, Ready/moves/draw, refresh/read-only tab, private broadcasts, mixed capacity, random matching, duplicate-move receipt, nonmember channel rejection and actual 120-second disconnect | Passed  |
| Frontend publication  | Existing GitHub branch and automatic Vercel deployment; actual production pages, resources, metadata, search, engine, ICCS download and Continue                                                                                             | Passed  |
| Android hardware      | Touch preview/confirmation, keyboard, sound, downloads and sustained AI                                                                                                                                                                      | Pending |
| Actual Google consent | User's interactive sign-in/return under the isolated route                                                                                                                                                                                   | Pending |

Visual QA found and fixed a specificity override hiding the grid, river and palaces; the browser suite now asserts the board background. Oversized public avatars remain bounded and CORS is explicitly selected on isolated pages. The engine, license, author notice, corresponding source archive, build instructions and bilingual sharing images are included for local/static validation; production hashes remain a post-deployment check.

The production security advisor flags intentionally public SECURITY DEFINER read RPCs and private RLS tables accessed only by controlled functions. Board-admin is not executable by anon or authenticated clients. Existing project-wide password-protection advice is unrelated to this release and was not silently changed.

## Final local checks

- Clean independent build: 28 tools, 15 games, 114 localized pages plus the 404 alias; 106 sitemap URLs, 106 sharing PNGs and 47 search entries.
- Exact vendored/built engine, license and source-archive hashes; isolation limited to Xiangqi routes and engine resources.
- Twelve browser regression tasks passed: three Xiangqi runtimes, Chess, Go, Profile, search/navigation, shared stage/ranking layout, bilingual games, game experience and all-game audio.
- The signed-in avatar/menu matrix checked 56 route/locale/viewport cases, including isolated Xiangqi routes, with synthetic profile/image responses.
- Production cleanup verified zero fixture users, identities, sessions, refresh tokens, profiles, match members, matches, queue entries, public statistics, Pong rooms and shared whiteboards. No privileged test endpoint was installed. The verified source is published through the existing GitHub branch.

## Android short checklist

1. Open Xiangqi; check the entire ready board, setup and Start on a narrow screen.
2. Start local two-player, tap a piece and destination, then Confirm. Flip the board and switch labels.
3. Switch English/繁體中文 during a game; verify the position and selection survive.
4. Undo, pause, refresh and Continue. Export TXT and JSON, open/download them, and import the record.
5. Start a Level 2 AI game; then try Level 5, cancel while it thinks, and check sound/mute.
6. After online acceptance is enabled, sign in, join an invitation, Ready manually, refresh and test a second read-only tab. Confirm background clocks continue.

Simulated touch and WebKit do not count as physical Android or iOS testing. The finite official examples do not guarantee every unseen WXF cycle. The user explicitly authorized three Xiangqi test identities. Both unranked test matches and all identities were removed after acceptance, with zero public result rows. The live invite test observed seven private revision broadcasts across 27 instrumented requests, p95 1,427 ms round trip (network time, not Edge CPU). The random match rejected a nonmember channel and settled a real single-player disconnect after 121,820 ms of observation.

## Production acceptance

The release was pushed to the existing `KenSei-Workshop` branch; Vercel deployed it automatically. Real guest-browser acceptance against `https://kensei-workshop.vercel.app` passed 92 entry-page requests, 15 resource/hash checks, English and Traditional Chinese routes, search aliases, navigation, anonymous records, local play, focus, in-place language changes, an actual ICCS TXT download, a real Fairy-Stockfish response and IndexedDB Continue recovery. No browser page errors occurred.

The first deployment exposed a static directory routing difference: Vercel applied the engine headers but omitted them on the two Xiangqi page roots. The route matchers were corrected, pushed and verified on the actual domain. COOP/COEP now apply to both Xiangqi pages and engine resources, while ordinary tools and other games remain unisolated. Git attributes also preserve exact upstream engine/license bytes rather than normalizing their line endings. Required source and license downloads match their pinned hashes.

Publication completed after the real-backend and cleanup gates passed. Physical Android and interactive Google consent remain explicitly pending; neither simulated touch nor disposable email Auth sessions replaces those checks.
