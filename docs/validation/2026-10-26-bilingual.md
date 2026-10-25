# 2026-10-26 bilingual interface validation

Scope: 28 existing tools, 12 existing games, English and Traditional Chinese URLs. No Supabase schema/RPC/Edge changes, no new tools or games, and no edits to independent personal/3A3D projects.

## Verified locally

- Clean standard-library build: 106 localized route pages plus the root 404 document; 98 unique public sitemap URLs.
- All public pages have localized titles/descriptions, self canonical, English/Traditional Chinese/x-default alternates, Search Console ownership tag and a valid 1200×630 PNG. Account, authentication and error pages are crawlable with `noindex, follow` and excluded from Sitemap.
- All locale keys have both languages and matching positional placeholders. Each emitted page pack has the same English/Traditional Chinese key set. Public search contains exactly 43 records: 28 tools, 12 games and three projects.
- Nineteen deterministic unit suites passed, including all game engines, server replay compatibility, Brick Breaker v2, frame-rate invariance, conversion, planner, whiteboard and capture limits.
- Existing browser regression passed for actual image/ZIP/QR/PDF outputs, English/simplified/traditional/Malay WASM OCR, Markdown/diff, conversion/color/password/network, time/renaming/audio/data, calculator/hash/flashcards/subtitles, study planner, Excalidraw import/export, private recovery, Profile and mocked Google callback handling.
- Dedicated language tests preserve editor text/selection, original `File` identity, opaque Markdown preview, unit values/identifiers and the same Excalidraw canvas/vector scene. Failed pack loading preserves the current language and work; rapid switching uses the last request.
- Every game retains its board node, score, session and ranked eligibility across language changes. Pong creates no room and does not become Ready on page load or language changes.
- Actual synthetic MediaRecorder audio/video tracks remain active during language changes. OCR keeps its Worker and edited text; network testing keeps the same isolated runner. Existing cancel/retry/budget/background/resource-release checks passed. These are browser-controlled fixtures, not real Google consent or a new live two-account Pong match.
- Layout checks covered Traditional Chinese home/catalog/tool/game/Profile at 320, 360, 768, 1024, 1366 and 1440 px, with no horizontal page overflow. Existing twelve-game responsive/ranking checks passed. Representative mobile screenshots were inspected.
- User-authored content remains raw: names, files, editor values, Markdown, differences, QR payloads, answers, study cards and typing passages are not automatically translated. Local-only tests detected no file/media/recovery uploads.

## Resource comparison

Same local source assets, before → after stylesheet bytes (including the self-hosted font stylesheet):

| Page         |  Before |        After |
| ------------ | ------: | -----------: |
| Home         |  76,288 |  about 52 KB |
| Image Studio |  84,827 |  about 83 KB |
| Minesweeper  | 199,301 | about 155 KB |
| Profile      | 132,619 | about 109 KB |

Home and directories no longer load tool editor/planner/whiteboard/media styles. Unneeded game-family styles are excluded from individual games. Two Latin font preloads total 59,220 bytes; other subsets are conditional and no external Google Fonts CSS is requested. Language dictionaries add HTML bytes, so these measurements do not claim a universal load-time improvement or a Lighthouse score.

## Release workflow

Reviewed changes are copied to the existing `KenSei-Workshop` branch, built and checked, then pushed to GitHub for the existing Vercel integration. Production verification is recorded separately from these local results; local preview alone is not deployment confirmation.
