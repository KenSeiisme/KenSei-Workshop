# Account content and notification audio — 2026-11-18

## Scope

Frontend upgrade for notifications, Friends, My Profile, Public Profile and Workspace. Existing account fields, manual profile saving, three featured milestones, friendship/invitation RPCs and private record isolation remain in use. No database migration, test account creation or game-rule change.

- Static templates and runtime controls share `src/views/icons.py`, emitted as `/assets/ui-icons.svg`.
- Small Go/Chess/Xiangqi/Pong covers reuse the site's board illustrations and chess pieces. Game icons now have a lightweight module, keeping the engine out of notification content imports.
- Notification rows show actors, game covers, achievement medals or coins; state and action labels remain visible. Friend game choices use the same cover-card renderer in both Friends and Public Profile.
- Profile appearance uses six gradient choices, five accent swatches and earned-milestone cards. Failed saves retain edits; selection remains limited to three.
- Board records show games, wins, losses, draws and win rate with actual rule/time-control summaries. Workspace rows distinguish tool, record type and save status; overview counts use existing records.
- Regression exposed a Workspace pagination race: a background refresh discarded loaded older pages. Refresh now re-reads the expanded range and replaces the list atomically; search/identity changes still reset it. The existing record deep-link/review regression explicitly verifies the older row survives a background refresh.

## Audio and range control

The master gain is `0.30 * (volume / 100) ** 1.3`. Six sine-based cues have rounded attacks/tails, a shared low-pass filter and compressor, and at most two active cue groups. Repeated previews replace the previous preview. Real-event IndexedDB sound claims and account checks remain separate from preview playback.

`KenseiNoticeSettings.volume`, `set()` and `preview()` remain callable. `begin()`, `adjust()`, `commit()` and `toggleMute()` support live changes, one persistent write per gesture and the last nonzero volume. A setting received from another tab cannot interrupt the current gesture; the local final value wins. Preview awaits audio-context resume and reports muted, unsupported or blocked playback in the settings panel.

## Local evidence

| Check                         | Result and evidence level                                                                                                                                                                                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests                    | 38/38 suites passed.                                                                                                                                                                                                                                                                    |
| Isolated database regressions | 23/23 suites passed; existing schema only, no production mutation.                                                                                                                                                                                                                      |
| Content workflows             | `tests/browser/social-account.cjs` passed in Chromium, Firefox and WebKit using the isolated SDK fixture. Covers invitation actions, read races, toast priority/focus, manual/failed profile saves, three-milestone limit, old Workspace records and guest/invalid profiles.            |
| Content visuals and layouts   | `tests/browser/account-content.cjs` passed in all three engines: EN/zh-Hant, dark/light, 320/390/768/1440px, four game covers, broken avatar fallback, expired invitations, actual board-stat values and record/status icons. These are simulated viewports, not physical phones.       |
| Volume and sound              | `tests/browser/notice-audio.cjs` passed in Chromium and Firefox with real OfflineAudioContext output. Also covers delayed first resume, blocked playback/retry, immediate input updates, real mouse drag, touch tap, cross-tab changes, keyboard endpoints and mute/reload restoration. |
| Fullscreen                    | Toast placement and dismissal passed in Chromium, Firefox and WebKit using a real headless Fullscreen API surface.                                                                                                                                                                      |
| Games regression              | `tests/browser/game-ui-upgrade.cjs` passed: 15 launch panels, return navigation, paused carousel, settings focus, invitations and mobile layout.                                                                                                                                        |

Representative Chromium measured peak amplitudes, rendered through the production audio graph:

| Volume | RMS      | Peak     |
| ------ | -------- | -------- |
| 0      | 0        | 0        |
| 25     | 0.004535 | 0.037533 |
| 50     | 0.011167 | 0.092418 |
| 75     | 0.018917 | 0.156558 |
| 100    | 0.027497 | 0.227560 |

Repeated rapid previews remain below clipping. JSON measurements and screenshots are written under `_qa/notice-audio` and `_qa/account-content`; CI uses the existing browser-artifact directory. Both new regression suites run in the Chromium browser-smoke job.

## Limits and remaining real-device checks

- This Windows Playwright WebKit build exposes neither AudioContext nor OfflineAudioContext. Its unsupported-audio message and native volume controls passed; waveform rendering is explicitly unavailable, not reported as a passing audio render.
- Headphone, physical computer-speaker and Android-speaker listening are pending. Automated output measurements cannot establish subjective loudness, harshness or real-device permission behavior.
- Account data in these browser checks is a deterministic fixture. No new claim is made about live multi-account social permissions; this frontend batch does not alter them.
- Release gate: formatting, full build, localization and clean-build structure checks, then preview CI/Vercel and same-tree production verification. Live pages and deployed module hashes must be checked separately from a successful push.
