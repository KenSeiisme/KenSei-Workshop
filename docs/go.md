# Go: rules, matches and release checks

Go is the thirteenth game. It has its own authoritative match lifecycle; it does **not** use the solo-game Public session, background-abandon, score or achievement APIs. The tool catalog remains unchanged.

## Source map

| Area                                                  | Source                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------ |
| Pure rules, scoring proposals, compact replay, SGF    | `src/games/go-engine.js`                                     |
| Bounded introductory computer opponent                | `src/games/go-ai.js`, `go-ai-worker.js`                      |
| Shared clock calculations                             | `src/games/go-clock.js`                                      |
| Tab identity and refresh                              | `src/games/board-identity.js`                                |
| Page controller and canvas                            | `src/games/go.js`                                            |
| Static page and layout                                | `src/templates/games/go.html`, `src/styles/go.css`           |
| English / Traditional Chinese                         | `scripts/localize-go.py`, `src/i18n/catalog/go.json`         |
| Authenticated request handler                         | `supabase/functions/board-match/index.ts`                    |
| Private tables, atomic transitions, queue, statistics | `supabase/migrations/20261102163938_workshop_go_matches.sql` |

The pinned MIT `@sabaki/go-board` 1.4.3 board primitive is bundled by `scripts/vendor-go.mjs`; its default permissive move behavior is never used as the application's legality policy. The wrapper handles suicide, simple ko, positional/situational histories, turns and phases. No AI model or game server is downloaded.

## Rule presets and adjudication

- Chinese: area scoring, 7.5-point even-game komi (3¾ stones), positional repetition prevention. The published exceptional-cycle supplement permits mutual no-result agreement only for a recorded long capture cycle; an immediate ko is not such a cycle.
- Japanese 1989: territory plus prisoners, 6.5-point even-game komi, simple ko, seki exclusions and mutual dead-group agreement. A separate hypothetical confirmation board requires a pass for each particular ko under Article 7.2; threats elsewhere do not clear that restriction. It never changes actual prisoners, territory or moves. Resumption gives the opponent of the requester the first move. A disputed effective move may end as both-lose only with both players' confirmation.
- AGA: situational superko, pass stones and White's last pass. This site explicitly chooses **area scoring** with handicap compensation and the **7.5-point tournament preset**; this is not a claim that the original 1991 text specifies that komi.

Dead stones and seki are agreed by the players, not proven by the introductory AI. Automatic totals are suggestions. Editing a proposal removes both confirmations. Unresolved positions cannot be submitted as wins. Japanese special life/death diagrams are **not certified as fully adjudicated by an automatic solver**; the page makes this limitation visible and provides hypothetical confirmation / dispute / resumption. The app does not implement physical-tournament discipline or replace a referee.

Primary references: [Chinese rules](https://wqwh.weiqi.org.cn/rules/), [Japanese 1989 and commentary](https://www.nihonkiin.or.jp/match/kiyaku/zenbun.htm), [AGA rules](https://www.britgo.org/rules/agarules.html).

## Online authority and privacy

`board-match` verifies the Auth JWT with Supabase before calling service-only `board_admin`. Commands carry a UUID request identifier and expected revision. Edge computes from the stored board; the database checks membership, current tab, revision and deadline again before committing. An accepted request has a persistent receipt; retrying cannot add another move or result. Client-supplied boards, winners, clocks and scores are ignored.

Private Realtime channels carry revision notices. Members read canonical snapshots; no client publishes authoritative game state. Go, Pong and shared Whiteboard capacity checks use the same transaction advisory lock and combined two-room budget. Queue entries do not occupy a room. Matched random games have 30 seconds to Ready; invitation rooms retain their 15-minute invitation window.

The `workshop-board-timeouts` Cron job runs every 15 seconds. Commands and reads also check expiration. Stored effective deadlines, not Cron invocation times, determine settlements. Heartbeat loss has a 120-second reconnect window. Online clocks continue while a page is hidden. Local practice instead pauses and cancels AI work when hidden.

Only standard online human matches contribute to public statistics: played = wins + losses + draws; win rate = wins / played. Void, interrupted, unresolved and unstarted matches are excluded. A both-lose result increments each participant's losses. Rate ranking requires ten completed games. The old nine solo score boards, typing scores and thirty achievements remain separate.

Memory training never changes real ownership. While active, stone paint, last-move color and board accessibility labels do not expose it. Hold-to-reveal is explicit and counted. Restored private records cannot become ranked online games.

## Verification commands

```text
node scripts/vendor-go.mjs
node scripts/build-board-edge.mjs
python build.py
node scripts/test.mjs go
node scripts/test.mjs unit
node scripts/test.mjs database
```

`tests/browser/go.cjs` covers simulated viewports and real browser interactions with a mocked account API. Select Firefox or WebKit using `WORKSHOP_BROWSER_ENGINE`. This does not count as a physical Android test.

`scripts/verify-go-online.cjs` is an explicitly enabled real-backend test. Its provisioning capability arrives through hidden stdin, with no credentials or sessions in files. It uses four authorized disposable users, custom unranked games, and unstarted queue matches; it must not produce public scores. Cleanup closes owned rooms and deletes fixture identities. A temporary privileged fixture handler is never committed and must be replaced by the normal Edge bundle immediately after each test run.

Release evidence is summarized in `docs/go-acceptance.md`. Do not label an unperformed physical-device, real Google OAuth or official special-diagram check as passed.
