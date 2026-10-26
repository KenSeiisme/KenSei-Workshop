# Dynamic feedback, network scales and shared whiteboards

Implemented on 2026-10-26. The site keeps 28 tools, 12 games, English and Traditional Chinese.

## Behavior

- Focus Timer draws an SVG track and clockwise-depleting ring from the same deadline as the displayed time. Pauses retain millisecond precision; stage changes reset the ring. Hidden pages stop decorative animation, and account/session restoration stays isolated.
- Answer Book selects once, exits for 180 ms, replaces/saves at the midpoint, then enters for 370 ms. Reduced motion uses an 80 ms fade. Generation/identity guards cancel stale callbacks; questions are not stored.
- Network Test uses 26 ticks across five equal intervals, six numeric labels and a nonshrinking 1/2/5 scale. Mbps and MB/s share raw measurements. Chart axes/legends retain units and real gaps. The IP value and Show/Copy actions stay on one row, including long IPv6 at 320 px. Existing traffic limits and disabled extra reporting remain unchanged.
- Whiteboard keeps Personal data separate from Shared. Sharing creates a copy. Rooms persist with four authenticated members; only the owner manages invitations, members and deletion. The canvas supports online cursors, independent view/selection, private copies and PNG/SVG/editable exports.

## Synchronization and permissions

The private schema stores scenes, memberships, element versions, idempotent mutation receipts and rate counters. Browser roles cannot read raw tables. Only authenticated controlled RPCs and member-scoped private Realtime channels are exposed. Element versions win first, then lower versionNonce; deletion tombstones retain no deleted text/path content. Removed members lose RPC access; channel and invitation credentials rotate.

The local recovery store is separate from personal boards and isolated by account/room. A second tab is read only and cannot overwrite the active editor's recovery. Edits checkpoint after 2 seconds idle or 5 seconds continuous work. Drawing/cursor/revision packets coalesce about every 650 ms (below two per second). Database saves do not send duplicate room-wide scene notifications; membership changes still notify existing channels. Heartbeats also discover missed durable revisions.

A global advisory lock atomically limits Whiteboard plus Pong to two active rooms. Saved offline boards use no live slot. Leases expire after 35 seconds and renew every 10 seconds. Refresh uses a small authenticated keepalive release; failed release falls back to expiry. No Pong game rule, paid plan, Edge Function or file-processing service changes.

## Verification

- Unit: five exact gauge intervals, endpoints, unit conversion and monotonic nice ranges.
- Local PostgreSQL: four-member capacity, ownership, duplicate-tab leases, version/nonce conflicts, tombstones, idempotent retries, invitation reset, member removal, anonymous/raw-table rejection, oversized rollback and combined Pong capacity.
- Browser fixtures: timer half/full/end, exact pause/refresh/resume; Answer Book double-click/reveal/language/no-question persistence; actual native four-canvas convergence and Undo; real pinned speedtest engine fixtures, gauge ratios/units, chart fallback, long IPv6, IP-free exports/history; existing private Whiteboard drawing, Chinese text, exports and imports.
- Actual production Supabase: four approved disposable Auth accounts, private WebSockets, nonmember subscription denial, directional publishing, concurrent native drawing, local Undo/Redo, lost-save retry, offline reconnect, second-tab read only, shared exports, bilingual switching, refresh and membership revocation. No public scores or emails were created.
- Combined live stress: one four-editor whiteboard plus an actually playing two-client Pong match, 10 seconds, 266 sent / 388 received wire frames; maximum rolling one-second count 93. This conservatively includes wire control frames. The organization remains on Free and was not upgraded.
- Layout: shared board and network/IP at 320/360/768/1440 px. Existing localization/input preservation regression passed.

Run `pnpm test:tool-motion-shared` against a local preview. `scripts/verify-shared-whiteboard-online.cjs` is an explicit opt-in real-backend check: exactly four previously approved disposable credentials arrive on hidden stdin, stay in memory, and are never committed. `QA_SMOKE=1` runs the release smoke subset. Test-owned rooms are cleaned in finally; the caller deletes the disposable Auth users after the final production check.

## Migrations and deployment

Source migrations match production history: shared schema, helpers, room API, access policies, combined capacity and coalesced save notifications. The intermediate revision migration recreates the compatible room handler; the following coalesced-saves migration removes duplicate save broadcasts. Browser dependencies remain pinned; only the Excalidraw export facade changed, retaining its existing notices/fonts.

Security advisories were reviewed. RPC-only tables deliberately have RLS without direct policies, and the authenticated SECURITY DEFINER endpoint checks identity/ownership itself. Existing public-profile/typing RPC and password-protection notices predate this change; no unrelated configuration was changed. Performance advisories report no new unindexed shared-board foreign keys. See https://supabase.com/docs/guides/database/database-linter for the advisory definitions.
