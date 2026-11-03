# Game audio release acceptance

Run summary: **31/31 unit groups** and **5/5 audio acceptance groups** passed, alongside the existing game-experience, Go and two-context Pong fixture checks. Chromium and Firefox produced nonzero real audio output. WebKit's capability fallback is a separate result, not a playback pass.

This release covers thirteen games without changing rules, saves, rankings, backend APIs or the tool catalog. Production publication uses the existing GitHub branch and automatic Vercel deployment.

## Automated evidence

| Area                                                           | Evidence                                                             | Result                                                                                                                                                   |
| -------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source rights, hashes, trim, peaks, loop endpoints and budgets | `scripts/prepare-game-audio.py --check`; `docs/game-audio-assets.md` | Passed quantitative checks; no subjective listening claim                                                                                                |
| Default settings and migration                                 | `game-audio-upgrade.mjs`, `game-audio-lifecycle.mjs`                 | 35% SFX / 12% music; existing mute preserved, independent JSON recovery                                                                                  |
| Game events and results                                        | Pure event fixtures                                                  | Effective actions only, three pickups, neutral local result and player-relative win / loss                                                               |
| Lifecycle and racing requests                                  | Lifecycle fixtures                                                   | First gesture after BFCache works; obsolete fetches and focus claims cannot override current state                                                       |
| Chromium / Firefox                                             | `tests/browser/game-audio.cjs`                                       | Real AudioContext, decoded samples and nonzero measured audio graph; twelve starts plus all thirteen entry pages                                         |
| WebKit on this Windows host                                    | Same browser suite                                                   | This build exposes neither AudioContext nor webkitAudioContext; silent gameplay and explicit capability fallback passed; actual Safari sound is untested |
| Pong                                                           | `tests/browser/arcade-next.cjs`                                      | Two browser contexts with local database / simulated Realtime: Ready starts music, controls and pause / resume remain functional                         |
| Go countdown                                                   | `tests/browser/go-audio-clock.cjs`                                   | Real Web Audio with mocked authoritative clock: own final-five-second cue; no read-only or opponent cue                                                  |
| General regression                                             | All unit groups and existing game-experience / Go browser suites     | Report exact run results under ignored `_qa/game-audio/`                                                                                                 |

The audio browser suite additionally checks separate volume controls, remembered mute, failed music retry, synthesis fallback, one-tab ownership, bilingual and Effects switching without changing the turn, and settings at 320 / 360 / 768 / 1440px. UI tests do not replace physical-device checks. No production test identities or game scores are created by these checks.

## Manual listening still required

- Headphones and desktop speakers: check repeated placements, loudness differences, musical loop feel and long-session fatigue.
- Android Chrome: Start, background / return, Pause / Continue, independent sliders, mute / reload and speaker playback.
- Physical Safari: actual codec playback, gesture recovery and interruption behavior; Windows WebKit fallback is not a Safari playback certificate.

The source manifest records CC0 licensing, edits, hashes and measured budgets. Music, settings and sound variation do not enter replay logs or account records. Music is not fetched or played merely by entering a game, opening the directory, searching or hovering a card.

Production follow-up checks the deployed JS / CSS / audio hashes, all thirteen entry pages, real anonymous music playback, mute and an actual Go move. Use the formal URL `https://kensei-workshop.vercel.app/games/`; do not publish a second Site.
