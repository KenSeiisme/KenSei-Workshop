# Card navigation, decision wheel and Typing Sprint

Released on 2026-10-26. The tool/game counts and existing routes remain unchanged.

## Behavior

- A native stretched link covers catalog cards and Workspace favorites. Favorite/remove buttons remain above the link. Game demo previews remain decorative.
- Decision Studio chooses an equal-probability winner, then a cryptographically random in-sector angle, 2–4 revolutions and a 2600–3400 ms duration. Generation guards and one-shot completion keep canceled callbacks out of later draws.
- Typing Sprint uses a compact arena, HUD, inline setup, automatic focus and a 310 px ranking sidebar from 1100 px. Its timer still runs in background tabs and menus; focus is layout only. Public remains the default.
- The versioned original sentence asset contains 120 English and 120 Simplified Chinese sentences. Each run uses complete, unrepeated sentences; the first sentence avoids the last ten starts for the same language/identity. Practice stores only first-sentence IDs and existing result summaries, never typed input.

## Server compatibility

Migration `20261026065755_workshop_random_typing_sessions.sql` matches the production migration history. The source passage, sentence IDs and corpus revision are recorded per new session. Legacy sessions still use the original fixed content. Both language boards remain version 1, including older results and Profile scores.

A finish receipt and normalized-input fingerprint make identical retries idempotent, including unqualified runs. Changed-input retries, early finishes and cross-account sessions are rejected. Raw source/session/result tables remain inaccessible to browser roles; only the existing controlled RPCs are exposed. No new tables, paid API or Edge Function is needed.

## Verification

- Unit: 160 random compositions and 1200 wheel/pointer combinations, including 1 and 200 options.
- Local PostgreSQL: 24 random sessions, length/uniqueness, recent first-sentence exclusion, snapshots, legacy scoring, current-version board, timing, ownership, qualification and identical/changed retry behavior.
- Browser: full-card navigation, independent favorite/remove, native Ctrl-click and keyboard navigation, animated pointer/result agreement, edit cancellation, canvas/reduced-motion fallback, IME, locale/focus state preservation and lost-receipt retry.
- Layout: 320, 360, 768, 1100 and 1440 px in English and Traditional Chinese, with visible Start and no horizontal overflow.
- Regression: existing second-batch tools/sync/device checks, Profiles/auth/avatars and all 12 game ranking layouts. Bilingual metadata/dictionaries remain valid for 98 public URLs.
- Production database: random-session length and version, early finish, cross-account finish, exact scoring and duplicate receipt were checked inside a rolled-back transaction. Temporary users and scores were rolled back. Security advisor counts are unchanged; existing deliberate RPC-only boundaries remain intact.

Run `pnpm test:typing-experience` against a local preview. Browser fixtures use local PGlite and an intercepted SDK; they do not submit real production scores. Screenshots and transient reports stay in ignored `_qa/`.
