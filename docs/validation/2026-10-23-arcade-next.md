# Block Drop, online Pong and verified milestones

## Scope

- 12 independent games, 9 ranked games, 28 unchanged tools.
- Block Drop Classic and 40-line Sprint with canonical browser/Edge replay.
- Two-account invitation Pong with private directional Broadcast, no ranked scores or persistent saves.
- 30 server-derived achievements, owner-only progress and public unlocked badges.
- Existing routes, rule versions, saved progress, typing scores and Google Profile behavior preserved.

## Local validation

- Block Drop unit tests: seeded bags, SRS kicks, Hold, ghost, exact scoring, Sprint, held-key repeat, strict saves and equivalent 30/60/120/144Hz results.
- Pong unit tests: fixed 120Hz physics, swept collision, serves, first-to-seven, ten-minute time/draw and received snapshot validation.
- Bundled Edge with isolated PostgreSQL: recomputed result, ignored forged score, foreign-session denial, unsupported replay rejection, transaction-safe award and duplicate completion receipt.
- Database tests: all 30 definitions agree with the presentation catalog, thresholds, verified-only eligibility, earliest historical dates, no guessed missing metrics, account isolation, nine ranked games and anonymous-safe public fields.
- Room SQL tests: authenticated membership, atomic two-player/two-room limits, account/tab occupancy, role/topic access, ready, pause, rematch, stale rounds, expiry and failed-join rate limits.
- Browser integration: actual Block Drop terminal Public game, lost acknowledgment then idempotent retry, single score/award, own progress; two Pong pairs, natural seven-point finish, rematch, controls, pause/resume, hidden-page pause, offline/retry and clean close. The isolated Broadcast bridge checks the same SQL policy helper; it is not presented as real WebSocket evidence.
- The integration test pauses its first rematch while setting up a second browser pair. This avoids a legitimate seven-point finish racing the later background-pause assertion.
- Existing core, puzzle, arcade, board, Edge and database regressions passed. Existing ten-game browser play and neon animation regressions passed, including reduced motion and Off modes. Existing auth, Profile/avatar and saved-game regressions passed.
- All 28 tool layouts/Help/keyboard checked at 320, 360, 768 and 1440px; no automatic capture, uploads or measurement. Clean build emits 53 pages and preserves vendor resources/private-source exclusion.

## Production backend and real transport

Applied migrations, in order:

1. `20261023100812_workshop_arcade_achievements.sql`
2. `20261023101817_workshop_pong_tables.sql`
3. `20261023101938_workshop_pong_lifecycle.sql`
4. `20261023102011_workshop_pong_channels.sql`
5. `20261023132015_workshop_arcade_foreign_key_indexes.sql`

The final performance review identified two new unindexed foreign keys. The fifth migration covers achievement-rule lookup and room-host deletion; existing unrelated advisor items are unchanged.

The native Supabase migration history matches these filenames. `games-session` version 5 was deployed with JWT verification enabled and the canonical Block Drop engine bundled. The nine pre-existing game result rows remain; five historical badges were provable and backfilled. The five new internal tables all have RLS and no direct client grants. Internal tables intentionally expose data through controlled RPCs only; no permissive policies were added to silence informational advisor findings. Existing Profile/typing SECURITY DEFINER and leaked-password-protection warnings were not changed by this release.

After explicit permission, four disposable Auth users were created solely for live acceptance. Their credentials/tokens were held in memory, never committed. Real Edge browser contexts used the actual Auth and Supabase WebSocket service. Verified:

- Real two-player room subscription and ready/start.
- Nonmember private-topic subscription denied.
- Publishing the other role's topic did not deliver; publishing the player's own topic did.
- Two actual simultaneously running rooms: 234 outgoing and 228 incoming WebSocket frames in 6.003 seconds, **76.96 total frames/second**, including control traffic. No additional result reporting or database frame writes were introduced. This bounded sample is acceptance evidence, not a monthly quota forecast.
- Pause and mutual Ready resume.
- Production authenticated Block Drop start and abandon, with no public score created.
- No uncaught browser errors in the completed run.

Real-service evidence is kept in ignored `_qa/pong-real-acceptance.json`. Cleanup targets only the four exact generated UUIDs with the matching test-run marker, cascading their temporary records. Production members and their scores are excluded from cleanup.

## Release acceptance

The local new pages were also checked against actual anonymous production RPCs: both Block Drop boards, owner-only progress denial, anonymous room creation denial and a real existing public Profile. Nine game cards and all five historical badges rendered correctly, with no private fields. Guest Block Drop play and explicit Private restore passed. All game module hashes matched the generated build.

Publication uses the existing `KenSei-Workshop` GitHub branch and Vercel integration. `tests/browser/live-arcade-next.cjs` checks all twelve production game routes, actual public badges, scripts, mobile widths, anonymous access and Private restore after deployment. `scripts/verify-pong-online.cjs` supports repeating actual authenticated transport acceptance against the canonical production site before temporary identities are removed. A push alone is not production acceptance.
