# Sixth batch validation

The catalog contains 28 tools. This release adds Study Planner, Whiteboard and Screen Recorder, and upgrades QR Studio scanning and Audio Studio recording. Games and the independent 3A3D project are unchanged.

## Database and private synchronization

- Applied `20261021181122_workshop_sixth_batch` and `20261022024630_workshop_sixth_retry_revision` to the existing Supabase project.
- In-memory PostgreSQL tests verify owner access, cross-account RLS, anonymous and direct-write denial, account guards, pagination, validation, deletion tombstones, idempotent retries and conflict copies.
- `supabase/checks/verify-sixth.sql` also verifies actual production permissions inside a rolled-back transaction. No test accounts or records remain from that check.
- Browser tests connect mocked authentication to the real SQL migrations running in PGlite. They exercise two devices, IndexedDB refresh, disconnected retries, simultaneous tabs, account switching, and a server commit whose acknowledgement is lost before another device edits the record.
- Real editor integration tests verify idle remote refresh, dirty-edit conflict copies, and explicit guest Copy to account controls for both new private tools.
- Record comparisons ignore JSON property order, preventing JSONB responses from repeatedly remounting and saving the whiteboard.
- Security advisor counts match the pre-release baseline; neither new table nor private helper introduces a new finding.

## Browser tools

- Study Planner: Chinese/English content, repeated classes and date ranges, assignment/exam deadlines, completion and overdue states, fixed zones and DST cases, real JSON import/export, recovery backups, reload and direct links.
- Whiteboard: real rectangle drawing and Chinese text, PNG/SVG/editable downloads, IndexedDB reload, vector-only import, rejected linked/image content and file drops. Engine assets and fonts are served locally; existing site interface fonts still use Google Fonts.
- Capture: actual synthetic canvas/audio tracks recorded by the browser's native MediaRecorder; video and RIFF/WAV downloads, mixing, pause/resume, source ending, denied/late permissions, background behavior, timing/byte limits, unsaved-result prompts and track cleanup.
- QR: a generated PNG is scanned back, camera frames are decoded, dangerous schemes remain plain text, and hiding/stopping releases the camera.
- Processing checks observed no file, camera-frame or recording uploads. Only private text/vector records use the explicitly tested account synchronization endpoint.
- New and upgraded pages pass 360/768/1440 layout checks. Screenshots and detailed logs are in the ignored `_qa/sixth-release/` and `_qa/sixth-planner/` directories.

## Regression and reproduction

The full original-tool suites cover image batch/editor downloads and restricted-canvas compatibility, PDF operations, OCR language loading/lifecycle, text tools, ZIP limits, network controls/dashboard, timers, private histories, flashcards, login, Profile, typing scores and Workspace. Catalog/filter expectations were updated for the three new entries. Responsive tests wait for resize observers before measuring wheel layout.

Run a preview with `python scripts/serve.py 8799`, set `TEST_BASE_URL=http://127.0.0.1:8799`, then run `pnpm run test:sixth`. The existing `test`, `test:second-batch`, `test:profiles`, `test:daily`, `test:fourth` and `test:fifth` scripts remain available.

Automated browser checks use desktop Edge at phone/tablet/desktop viewport sizes. Actual mobile Safari/Android device capture and the human Google consent/native operating-system source chooser are not automated. Unsupported screen capture or formats are detected at runtime; shared audio is offered only when the browser supplies it.

Deployment uses a push to the existing GitHub branch and the existing Vercel integration. Verify the canonical URL, all catalog routes and changed assets after that deployment completes.
