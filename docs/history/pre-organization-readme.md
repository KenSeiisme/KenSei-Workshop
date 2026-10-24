# KenSei Workshop

> Historical project notes retained for reference. For the current folder layout and commands, see [README](../../README.md) and [project structure](../project-structure.md).

This workspace root is the main KenSei tools platform. The secondary car website lives in projects/3A3D/ as an independent Git repository. Legacy personal-homepage source is no longer kept in this workspace; About Me still links to the existing online homepage.

## Build and preview

```powershell
python build.py
python scripts/serve.py 8768
```

Open [http://127.0.0.1:8768](http://127.0.0.1:8768). This workspace root is the main project root. Deploy only `dist/`, or select this root folder for the main Vercel project. The car website has its own deployment root: `projects/3A3D/`. The included Vercel build needs Python 3; alternatively build locally and deploy the generated `dist` directly.

## Pages and assets

- `build.py`: content, shared layout and page generation.
- `styles.css`: responsive visual system.
- `app.js`: image tool, text editor, focus timer, workspace and optional cloud integration.
- `config.js`: independent homepage/project links and optional Supabase public configuration.
- `assets/mazda.png`: a copied vehicle illustration from 3A3D. Original assets are unchanged.

Project covers are graphic compositions, labeled on detail pages; they are not claimed to be app screenshots. Salon functionality is described conservatively because its source repository has not been audited in this checkout.

## Google login and cloud sync

Local tools, favorites, drafts, image presets and focus history work without credentials. The production Supabase URL and public key are configured. The setup below documents the required project settings; secrets stay outside this repository.

1. Create a separate Supabase project for this new site and run `supabase/schema.sql`.
2. Create a Google OAuth web client. Use Supabase's displayed callback URL as Google's authorized redirect URI, then enter the client ID and secret in Supabase's Google provider settings. Never put the Google secret or Supabase service-role key in this repository.
3. Set the site's actual origin as Supabase Site URL and allow `https://YOUR-ORIGIN/auth/callback/` as a redirect URL. Add a separate localhost callback for development if needed.
4. Put the Supabase project URL and **publishable / anon key** in `config.js`, then rebuild. That public key is safe only with the included row-level policies enabled.
5. Test real Google login, logout, cross-device saves and two-account isolation before announcing cloud support. Configure the Google OAuth audience for the intended users.

Cloud items: favorites, manually saved text drafts, image presets, timer settings and completed sessions. File-tool inputs are never uploaded; avatar uploads are explicit profile saves. Local guest text is never automatically uploaded on login. The active timer is device/tab-local; completed records can sync. Workspace data can be exported as JSON.

Draft updates detect previously saved remote changes and create a conflict copy. The first version does not support simultaneous collaborative editing. Settings use last successful save. Keep a local export before clearing browser storage.

## Secondary project and external links

The default About Me URL comes from the link already present in 3A3D. Edit `personalUrl` in this new project's `config.js` if a different homepage address is intended. It does not modify the destination. The old homepage files were moved out of this workspace. The complete car source remains in `projects/3A3D/`, excluded from main-site commits and build output. Use the car folder's own Git repository for car changes.

## Production deployment

The primary production URL is https://kensei-workshop.vercel.app/. Publish future updates to the existing Vercel project, not the earlier Sites copy. Supabase must allow this origin and `/auth/callback/`. The checked-in `dist/` includes the current public Supabase configuration. `.vercelignore` excludes the separate car project, QA artifacts, repository metadata and tests from CLI uploads. Vercel local project linking is excluded from Git.

## Browser tool collection

Twenty-five tools share `tools.json`: Image Studio, QR Studio, PDF Toolkit, Text Toolkit, Markdown Studio, Text Compare, Image to Text, Focus Timer, Answer Book, Decision Studio, Typing Sprint, Device Check, Network Test, ZIP Studio, Color Studio, Unit Converter, Password Generator, Time Studio, File Renamer, Audio Studio, Data Studio, Flashcards, Calculator Studio, File Check and Subtitle Studio. Page interfaces are in the tool-view Python modules; processing is split into lazy-loaded `tool-scripts/` modules.

All file processing runs in the browser. Existing tools use explicit workspace saves. Answer Book and Decision Studio automatically save new or edited signed-in records privately to Supabase. Their guest history is never automatically uploaded. QR presets exclude content, credentials and logos. Existing untyped drafts and presets stay compatible. Apply the SQL files in `supabase/migrations/` in filename order; they do not alter existing workspace items. `supabase/checks/verify-second-batch.sql` exercises the production permission and scoring surface inside a rolled-back transaction.

`vendor/` contains the pinned browser libraries, workers, WASM and four OCR models, so production builds need only `python3 build.py`. To regenerate dependencies, run `pnpm install --frozen-lockfile --ignore-scripts` and `node scripts/vendor.mjs`. `model-lock.json` pins the OCR model commit and SHA-256 hashes. Licenses are included and linked from `/credits/`.

Limits: image batches 20 files / 100 MB, 20 MB and 40 MP per image; PDFs 50 MB / 200 pages; OCR one image, with selected English, Simplified Chinese, Traditional Chinese and Malay models. PDF splitting accepts `1-3;4-5` groups, or creates one PDF per selected page when blank. PDF arrangement and extraction use the current displayed page order.

Validation: run `python scripts/serve.py 8769`, then run `node tests/browser/verify.cjs`, `node tests/browser/tools.cjs` and `node tests/browser/auth.cjs`. New tool tests use real PDF/QR/image outputs and actual local OCR models.

Publish by pushing branch `KenSei-Workshop` to GitHub. The existing Vercel GitHub integration deploys it automatically; no manual Vercel deployment is needed.

## Second-batch data and leaderboard

`personal-store.js` keeps account-specific local records and a persistent idempotent retry queue. Every new private RPC includes an expected account ID; an in-flight request cannot save an old account's content to a new account. Schemes save after 500ms of editing. Save conflicts create a copy, whose ID becomes the next edit target. Records use private `answer_history` and `decision_schemes` tables; paginated reads include deletion tombstones so old caches cannot resurrect records. Existing workspace data is unchanged.

Answer Book includes 64 original bilingual answers. Optional questions never enter saved records. Decision options use rejection-sampled cryptographic random indexes and Fisher-Yates grouping. Wheel results are selected before animation; reduced-motion and unavailable-canvas paths still return text results.

Ranked uses server-assigned versioned passages and 60-second sessions. `finish_typing_test` accepts committed typed text rather than a score, checks ownership/time/replay/length, and calculates positional accuracy and WPM/CPM. Scores below 95% accuracy are excluded. RPCs expose the best score per account/current language version, Top 50, and an authenticated personal rank. Public output has no Auth account IDs, emails or raw input. Public names now initialize from Google and can be edited in Profile. Start requests are limited to one per 65 seconds and 30 per hour. This is a casual board, not strong anti-cheat; scripts and automated input cannot be fully excluded by browser code.

Device checks attach temporary event listeners only while active. Leaving a panel, losing test focus or hiding the page stops detection. The mouse test consumes scrolling only inside its active test area.

Run `node tests/database/database.mjs` for PostgreSQL security/scoring tests and `node tests/browser/second-batch.cjs` against the preview for browser/database integration. The latter uses a local PostgreSQL engine with a mocked auth boundary; real production RPC permissions are separately verified by the rolled-back SQL smoke test. The default new-tool preview URL is port 8793; use `TEST_BASE_URL` to override. Original regression suites cover all eight existing tools and the canvas privacy fallback.

Network speed testing now uses a bounded, explicitly started Cloudflare test. See `docs/research/network-speedtest-feasibility.md` for traffic, compatibility and Cloudflare reporting considerations.

## Public typing and profiles

Typing Sprint opens in Public · Ranked mode. Guests can select Practice · Private without signing in. A Public start opens Google sign-in and returns to the typing page without starting the timer automatically. OAuth keeps the existing callback URL and accepts only allowlisted same-origin return paths.

`typing_profiles` now backs the account profile as well as rankings. Initialization reads the authenticated account's Google display name and avatar metadata once. Existing chosen names and subsequent edits are retained. Names support 2–32 characters including spaces; initial collisions receive a random four-character suffix. Profile edits are manual and only changed fields are submitted. Best scores retain their account link when a name changes. The public profile URL uses a separate stable public UUID, never the Auth user UUID.

The `avatars` bucket is public for display and accepts WebP files up to 2 MB. Avatar inputs accept JPG/PNG/WebP up to 5 MB and 40 MP, are center-cropped to 512×512 WebP in the browser, and upload only on Save. Paths are namespaced by public profile ID; Storage RLS checks the authenticated owner. Failed saves retain the prepared avatar and reuse any uploaded path when retried. A previous uploaded avatar is deleted only after a successful profile update. Google avatar load failures use an initial-letter fallback. Profile names, avatars, biographies and current-version qualifying best scores are public; emails, tool files and private workspace records remain private.

Run `node tests/database/profiles-database.mjs` and `node tests/browser/profiles.cjs` (with `TEST_BASE_URL` pointing to the preview). Browser integration uses an actual local PostgreSQL engine and Storage RLS, with mocked authentication and file transport. `supabase/checks/verify-profiles.sql` verifies production permissions and profile RPCs inside a rollback. The personal Google consent flow requires the user's own interaction and is not automated.

## Daily tools and future games

The five daily tools use the existing catalog and lazy modules. Answer Book and Decision Studio are Utilities; Typing Sprint stays Text. Future games belong to a separate catalog, /games/<slug>/ routes and game scripts. No empty Games page or navigation is shipped before the first game. Games must not be added to tools.json or tool search.

Network Test pins @cloudflare/speedtest 1.14.2. An isolated same-origin iframe runs the engine, with no auto-start, no measurement/result logging, no cookies and no packet-loss/TURN testing. Its fetch guard permits one optional Cloudflare /meta request (five-second timeout), plus __down/__up. It validates payload sizes and debits every measurement attempt against 500,000,000 bytes. The adaptive schedule sums to 488,900,000 bytes; metadata and HTTP overhead are extra. Hide, leave, cancel and 120-second timeout stop the engine and destroy the runner. Only completed usable tests enter the device-only last-20 history. No Supabase schema change.

ZIP processing uses a terminable worker and fflate 0.8.3. Archive metadata is checked before streaming decompression validates actual expanded bytes, size and CRC. Input is capped at 100 MB; packs at 100 files; reads at 2,000 entries and 500 MB expanded. Encryption, ZIP64, multi-volume, unsafe paths and unsupported methods are rejected with a reselection path. UI lists filenames as text.

Colors, unit inputs and passwords are not saved. Password generation uses unbiased cryptographic samples and rejection sampling to ensure selected categories; clipboard failures select the visible output for manual copy. Run test:daily and existing regression suites before pushing the GitHub deployment branch.

## Visual measurements and fourth-batch tools

Network Test shows an SVG live-speed gauge, real request-sample speed and latency charts, final P90 versus observed peak, latency minimum/median/P95/maximum/jitter, loaded-latency changes, request counts, attempted and completed payloads. Mbps and MB/s are display options. The latency chart uses sample numbers because the pinned engine exposes loaded-latency values without timestamps; it does not invent a time series. Statistics and sample tables stay available when charts cannot draw. History supports two-test comparisons and text/PNG/CSV/JSON reports; old summaries remain readable without manufactured samples.

Connection information is approximate and identifies the Cloudflare metadata edge, not every measurement route. Full IP is masked by default and only held in the current page. Explicit Show/Copy controls do not add it to history or reports. Persisted/exported data uses an explicit field whitelist, excluding IP, coordinates and postal codes. Metadata failures do not prevent measurements.

- **Time Studio:** up to eight IANA world clocks, 12/24-hour format, zone conversion, date intervals and up to 20 device-local countdowns. Temporal rejects missing DST times and asks the user to choose between repeated offsets. Countdowns store absolute instants and recompute after reload/backgrounding; there are no background alarms.
- **File Renamer:** preview literal replacements, case, prefix/suffix, numbering, ordering and final-name overrides. Up to 100 files / 100 MB. Portable-name checks and case-insensitive NFC conflicts block export. A ZIP contains renamed copies; source file contents and original filesystem names are untouched.
- **Audio Studio:** one browser-decodable audio file, 50 MB / five minutes / mono or stereo / 128 MB decoded PCM. Waveform regions and exact second fields select the clip; volume is 0–200%. Exports are 44.1 kHz 16-bit WAV or MP3 at 128/192/320 kbps (default 192). Encoding runs in a terminable worker; failed encoding retains the selection, with WAV available as a retry. Inputs depend on browser decoding support.
- **Data Studio:** UTF-8 JSON (5 MB) and CSV (10 MB), up to 50,000 rows / 200 columns, 50-row table pages. JSON formatting/minification, CSV previews, flat-object-array JSON/CSV conversion and downloads run in a worker. CSV values remain strings, preserving leading zeros; formula-like output cells get a leading apostrophe. Nested values are rejected for CSV conversion. Cancel terminates the worker and retains inputs.

These four tools do not upload content or create database tables. Time settings/countdowns are local; tool favorites use the existing workspace sync. The new Audio category is separate from future Games.

Pinned Temporal, uPlot, WaveSurfer, Papa Parse and Mediabunny bundles are served locally. Mediabunny's MP3 extension embeds LAME; licenses, the matching source archives and build references are linked from Open-source credits. Regenerate with `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm rebuild esbuild`, then `node scripts/vendor.mjs`. The checked-in vendor files keep the production build Python-only.

Run `test:fourth` and `node tests/browser/fourth-boundaries.cjs` with `TEST_BASE_URL` pointing to the local preview. See [fourth-batch validation](docs/validation/fourth-batch-validation.md) for the checks and their boundaries.

## Fifth batch: learning and local files

Flashcards supports named private decks, front/back text, shuffled or unmastered-only reviews and manual Known / Need practice markers. Each deck has up to 200 cards and 1 MB; each side allows 1,000 characters. Editing card text resets only that card's mastery. CSV uses front,back columns; JSON preserves mastery and exact text. Imports create new decks. CSV export escapes formula-like cells with a protective apostrophe.

Decks and retry queues live in IndexedDB under separate guest/account scopes. Signed-in edits save locally before automatic cloud sync; guests are never automatically uploaded. The migration adds flashcard_decks with owner RLS and extends the existing account-guarded private-record RPCs; get_private_record reads one fresh record. The privileged implementation is in an unexposed schema. Clients cannot directly write the table. Empty tombstones prevent stale devices from reviving deletions. Revision conflicts preserve a complete copy.

IndexedDB read/write transactions preserve simultaneous-tab changes. Unsent updates to the same deck coalesce; once an operation has been sent, its ID and payload remain immutable for retries. Operations use persistent IDs and minimal content-free server receipts. Offline failures retain queues, retry after 15 seconds or reconnection, and expose pending/failure states. Text edits debounce for 500 ms; new cards are committed with Add / update. Workspace adds a separate card-deck list, backup export and deletion controls, preserving previous workspace exports.

Calculator Studio uses math.js 15.2.0 with a whitelisted scalar AST evaluator in a worker. DEG is default; RAD is available. % means divide by 100, never a business-calculator percentage rule. BigNumber arithmetic uses 64-digit precision; decimal output shows up to 34 significant digits and marks approximations. Fraction display is a rational approximation. Inputs are capped at 1,000 characters, computations at two seconds after library initialization (15-second load timeout). Assignments, properties, arbitrary functions and matrices are rejected. Last 50 successful calculations remain local.

File Check uses worker-side Web Crypto, sequential file reads and SHA-256 / SHA-512. It accepts up to 20 files, 100 MB each and 200 MB total. Duplicate hints compare size and SHA-256 only among the selected files. The JSON manifest contains filenames, sizes and hashes. Checksums are not a malware scan; no files are removed or uploaded.

Subtitle Studio handles plain SRT and basic WebVTT, UTF-8/BOM, up to 5 MB / 5,000 cues. It edits text and millisecond timing, rejects negative/reversed times, warns about overlap and exports SRT/VTT. Cue lists page in groups of 50 and render text literally. STYLE/REGION/layout settings are rejected, not silently discarded. Optional local videos up to 500 MB play through object URLs; browser codec support determines availability. Subtitles and videos are not saved or uploaded. Download edits before leaving.

Image Studio retains its batch interface and canvas-read fallback. A separate single-image editor uses Cropper.js 2.3.1 for ratio/free crops, quarter turns and flips, with local text watermarks and JPG/PNG/WebP output previews. Edit content is excluded from saved presets. The original 20 MB / 40 MP limits remain.

PDF Toolkit adds single-PDF page-number/watermark and information-cleanup operations, preserving its existing operations and 50 MB / 200-page limits. Actual output previews can be downloaded. Stamps affect selected pages, follow displayed order and account for rotation; unselected pages remain in the output. Information cleanup removes the standard Info object and document/page XMP references and streams. Other annotations, attachments and embedded objects are outside its scope. Stamping preserves original document information.

Apply migrations in order and run supabase/checks/verify-flashcards.sql in a rolled-back transaction to verify production permissions without retaining test records. Run test:fifth with TEST_BASE_URL pointed at the preview, then the original suites. See [fifth-batch validation](docs/validation/fifth-batch-validation.md). Publish through the existing GitHub branch and Vercel integration.

## Sixth batch: planning, whiteboards and capture

The shared catalog now contains 28 tools. Study Planner and Whiteboard are Productivity tools; Screen Recorder is a Utility. QR Studio adds a local image/camera Scan tab and Audio Studio adds microphone recording. Games remain separate.

Study plans use a fixed IANA time zone, dated weekly courses, assignment/exam deadlines and JSON backups. Whiteboard embeds pinned Excalidraw 0.18.1 with React/ReactDOM 19.3.1 in a lazy module, including local font files and license notices. Only vector drawings/text are supported; images, links, external embeds, collaboration and AI features are disabled. PNG, SVG and editable .excalidraw exports run locally.

Both tools save to IndexedDB before syncing private account records. Guest records require an explicit Copy to account action. New private tables and existing RPC kinds `planner` / `whiteboard` use account guards, revision checks, conflict copies, empty deletion tombstones and idempotent operation IDs. Retry receipts preserve the original acknowledgement revision without retaining record content, so an acknowledgement lost after commit cannot silently overwrite subsequent remote edits. Workspace opens, renames, deletes, clears and exports both record types. Plan records are limited to 1 MB and boards to 2 MB; unfinished edits remain recoverable and exportable locally.

Screen Recorder uses the browser's native MediaRecorder format with optional shared audio and microphone mixing. It requests up to 1080p/30fps and displays actual settings; active recording stops at 10 minutes or 250 MB. Switching windows does not stop screen capture. Microphone recording keeps Audio Studio's five-minute/50 MB/128 MB decoded PCM limits. Capture starts only after user action, releases tracks on exit, and never uploads or automatically stores recordings. QR scanning uses pinned jsQR 1.4.0 and only opens HTTP(S) results after a click.

Build with `python build.py`; preview on Windows with `python scripts/serve.py 8799` so ES modules/WASM get correct MIME types. Set `TEST_BASE_URL=http://127.0.0.1:8799` and run `pnpm run test:sixth`. Full release evidence and browser limitations are recorded in `docs/validation/sixth-batch-validation.md`. Push the existing GitHub branch to deploy through the existing Vercel integration.
