# Tool experience release

This release retains the 28 tools, English interface, dark pink/purple palette, existing routes, data formats and private synchronization APIs. No Supabase migration or dependency upgrade is required.

## Implementation

- Shared headings and per-tool limits/privacy help are generated from a common view. Tool-only CSS preserves the homepage, project and account layouts.
- Generic disclosure, keyboard-accessible tabs, action groups and summaries live separately from the 28 tool adapters and state controller. Editors and media elements are moved, never recreated during tab changes.
- Existing processing functions, native capture lifecycle and limits remain in place. Image results summarize actual source/output sizes. QR revisions reject late stale outputs; calculator and checksum results invalidate affected actions when inputs change.
- Seven editor adapters provide optional local recovery using a separate IndexedDB. Recovery is off by default, keyed by identity/tool/editing session, and limited to three 2 MB copies. Text fields are explicitly whitelisted; subtitle recovery serializes editable cues. Media and sensitive ephemeral inputs are excluded.
- Recovery restores detached unsaved copies. Original Workspace records and revision checks remain intact. Preference changes and snapshot writes share a transaction so a late write cannot recreate copies after recovery is disabled.

## Acceptance evidence

The four staged UI checks cover all tools at 320, 360, 768 and 1440 CSS pixels, help focus/escape, mobile tab navigation and no automatic measurement/capture/upload requests. The final suite reruns these checks after integration.

The existing unit, PostgreSQL and browser suites cover calculations, date zones, private sync, profiles, rankings, actual image/ZIP/PDF output, four-language local OCR, audio/video recording and downloads. Tests use the disclosure controls where advanced settings or history are now collapsed and assert the clearer local-save wording.

New browser checks cover default-off recovery, all seven adapters, explicit restoration, concurrent tabs, the three-copy cap, clearing/disabling, guest/account isolation, full-text preservation above 2 MB, unavailable storage, injected quota failure, and recovery from an existing draft without overwriting its original ID. No recovery upload requests occur; cloud saves remain explicit.

Feedback tests cover protected examples, accurate unsaved labels, Chinese composition, one calculation per keyboard shortcut, adjacent validation feedback, QR input changes during a delayed engine load and checksum algorithm changes.

Run `pnpm test:experience` with the local preview active. Full checks use `pnpm test:all`; the structure check builds into an empty output folder. Detailed logs and captures remain in ignored `_qa/`.

Automated browser coverage uses desktop Edge with emulated viewport sizes and synthetic media sources. It does not reproduce a human Google consent flow, a physical mobile soft keyboard or the operating system's screen-source chooser. Network fixtures exercise the pinned engine with controlled responses, without consuming a real full-test traffic budget.

Publish by pushing the existing GitHub branch. Confirm Vercel deployment status and check the canonical URL, every tool route, changed assets and representative real downloads after deployment.
