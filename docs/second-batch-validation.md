# Second batch validation

The migration is additive. Existing `workspace_items` data and the separate automotive project are untouched.

## Database boundary

- Private records use owner checks, account-scoped expected-user checks, revision conflicts and persistent operation receipts. Receipts retain metadata without record contents. Deletion clears record contents and retains a tombstone.
- Direct writes to typing scores, passages, sessions and operation receipts are revoked for both API roles. These tables have RLS enabled and intentionally have no direct-access policies.
- Privileged RPCs set an empty search path and check `auth.uid()`. Only the sanitised leaderboard RPC is executable anonymously. It exposes nickname, score, accuracy and date, plus rank. It never returns account IDs or raw input.
- Local PostgreSQL tests exercise account isolation, idempotency, conflict copies, nickname uniqueness, early/repeated submissions, client-score rejection, language/version isolation, Top 50 and own rank, and the 95% threshold. `verify-second-batch.sql` repeats the critical checks in production in a rolled-back transaction.

Supabase's advisory notices for [RLS without a policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), the [anonymous privileged leaderboard RPC](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), and [authenticated privileged RPCs](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) correspond to these deliberate boundaries. Do not add table grants or permissive policies to silence them. The existing [password-protection notice](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) concerns Auth password settings; this release uses the existing Google provider and does not change those settings.

## Browser boundary

Browser integration tests use actual local PostgreSQL RPC logic with a mocked authentication boundary, then validate the real production anonymous REST interface separately. They cover 360/768/1440 layouts, all 12 catalog cards, favorites, bilingual answers without saved questions, autosave, offline retry, two-device conflict copies, no-repeat draws, balanced groups, wheel animation alignment, IME commitment, time and score calculation, and device-listener cleanup.

Existing suites cover actual QR decoding, image/ZIP downloads and dimensions, Markdown safety and drafts, diff exports, PDF page operations and image exports, four-language OCR, cancellation/retry, old workspace data, auth error paths and Image Studio's restricted-canvas fallback. They also inspect file processing for upload requests.

These automated checks do not substitute for a human Google consent flow or testing every physical keyboard, display or mouse. Ranked is a casual leaderboard: server checks prevent direct score writes and simple replay/timing errors, but cannot prove that a person typed every character.
