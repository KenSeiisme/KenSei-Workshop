# Fifth-batch verification

The catalog now has 25 tools. New routes are /tools/flashcards/, /tools/calculator-studio/, /tools/file-check/ and /tools/subtitle-studio/. Image Studio and PDF Toolkit retain their routes and original operations. Games, account profiles and rankings do not receive private card data.

## Automated checks

- fifth-core.mjs: math reference values, expression restrictions, percent/angles, subtitle roundtrips/shifts and deck validation.
- fifth-database.mjs: actual PostgreSQL migration, owner RLS, account guards, invalid payloads, conflicts, replay safety, clear tombstones and content-free mutation receipts.
- fifth-tools.cjs: 25-tool filtering; mobile/tablet/desktop overflow; real browser calculations, hashes and duplicate hints; IndexedDB/mastery/backup/import and Workspace deep links; safe SRT/VTT conversion; actual crop/rotation/watermark pixels and PNG dimensions; PDF preview/export, rotation, original metadata preservation and removal of targeted Info/XMP objects/streams.
- fifth-sync.cjs: actual local PostgreSQL behind mocked authentication/HTTP transport. Two devices, offline reload/retry, stale-version conflicts, guest isolation on login, simultaneous tabs and deletion synchronization.
- fifth-boundaries.cjs: calculation worker timeout/cancel, file-count rejection/reselection/cancel, unsupported subtitle formatting, excessive cues, invalid UTF-8 and disabled IndexedDB recovery.
- Original tool, image privacy fallback, OCR model/lifecycle, typing, profile, authentication, workspace and daily/fourth-batch suites provide regression coverage.

Browser tests assert no uncaught exceptions; local file-tool tests assert no upload requests. Captures at mobile and desktop widths and machine-readable results live in ignored _qa/. Preview/download fixtures are generated synthetic content.

## Database and release

The flashcard migration was generated using the Supabase CLI, then matched to the version returned by production migration history. Production verification uses verify-flashcards.sql inside a rollback and asserts private save/read, idempotent retry, cross-account isolation and denied anonymous/direct writes. Security advisor results are compared before/after; existing unrelated findings are not changed.

Ship only after the new and regression tests pass. Push the current KenSei-Workshop branch; Vercel deploys automatically. Check canonical HTML, asset hashes, all 25 routes and real downloads after deployment. Production browser sync integration retains a controlled authentication boundary; actual anonymous production permissions are checked separately. Human Google consent is not automated.

## Boundaries

Learning uses manual mastery, with no automatic spaced repetition or public decks. CSV exports escape formula-like cells; use JSON for exact text/mastery backups. Calculator fractions are approximations, not a symbolic algebra guarantee. Web Crypto hashing reads each complete file into memory, so the explicit per-file limit applies. Subtitle preview is literal text; complex WebVTT styling and unsupported video codecs are not converted. PDF cleanup covers standard Info and document/page XMP only.
