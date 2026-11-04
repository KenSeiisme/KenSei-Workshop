# Xiangqi

The fifteenth game lives at `/games/xiangqi/` and `/zh-hant/games/xiangqi/`. It uses a dedicated WXF 2018 rules-v1 engine, not the Chess repetition or timeout rules. Tools remain at 28.

## Source map

- `src/games/xiangqi-position.js`: rectangular board, physical piece identities, legal moves and FEN validation.
- `src/games/xiangqi-repetition.js`: threats, protection, cycle responsibility and must-vary warnings.
- `src/games/xiangqi-engine.js`: versioned settings, actions, endings, replay, private saves and ICCS/JSON records.
- `src/games/fischer-clock.js`: local Fischer clocks; production clocks remain server-authoritative.
- `src/games/xiangqi-ai.js`: cancellable local Fairy-Stockfish Worker and ICCS/UCI rank conversion.
- `src/games/xiangqi.js`, `src/templates/games/xiangqi.html`, `src/styles/xiangqi.css`: board-first UI, local play, five computer levels, review and online rooms.
- `supabase/functions/board-match/index.ts`: authenticated authoritative move validation, shared by Go, Chess and Xiangqi.
- `supabase/migrations/20261104040132_workshop_xiangqi_matches.sql`: compatible queue, save, clock, leaderboard and Profile changes.

## Rules policy and references

Rules follow the [WXF Chinese original](https://www.wxf-xiangqi.org/images/wxf-rules/2018_World_Xiangqi_Rules_Chinese_2018.pdf) and the [English manual](https://www.wxf-xiangqi.org/images/wxf-rules/2018_World_XiangQi_Rules_English2018.pdf). The user selected the Chinese wording where the editions differ: three returns to a position trigger a responsible player's must-vary warning; repeating the prohibited transition forfeits. Lawful repetition draws after four returns. The initial occurrence is not counted as a return.

The natural limit is 100 qualifying plies without capture. Pawn movement does not reset it. For each claimant, that player's checks after the first ten do not count toward their qualifying total. The automatic referee checks either player's eligible counter. Mate, stalemate loss and repetition forfeits take priority.

The independent adjudication implementation draws on Daniel Tan and Neftali Medina, [Complete Implementation of WXF Chinese Chess Rules](https://arxiv.org/abs/2412.17334), CC BY 4.0. Its published algorithm is checked against all 110 official examples, including crossfire and pinned-piece cases. No code from the author's unlicensed reference repository is distributed. Fixture provenance and manual page links are in `tests/fixtures/xiangqi/README.md`.

Passing these finite examples is regression evidence, not a proof for every possible position. Physical tournament discipline, arbiters and time penalties are outside the digital game. AI evaluation never determines a ruling.

## Computer opponent and isolation

The pinned `fairy-stockfish-nnue.wasm@1.1.12` distribution uses the Xiangqi variant, classical evaluation, one search thread and 16 MB hash. No NNUE network is downloaded. Levels use Skill 0/4/8/12/16 and 200/400/800/1500/2500 ms search budgets, shortened near time expiry; they are not professional ratings.

Only Xiangqi routes and its engine resources enable COOP/COEP. The published pthread build requires SharedArrayBuffer and SIMD even with one search thread. Unsupported browsers receive an explicit alternative to use local two players or online play. There is no silent fallback AI. Cancellation terminates the Worker; generation checks prevent stale moves.

Engine bytes, hashes, GPL license, authors, matching source archive and build instructions are self-hosted. See `src/vendor/fairy-stockfish/README.md`. The source identity and published bytes were verified; no independently reproducible WASM build is claimed.

## Online and privacy

Standard online human games use 5+3, 10+5 or 15+10, partitioned by time control and rules version. Server operations enforce membership, controller ownership, expected revision, legal moves, request identity and clocks. Only legal moves add increment. Realtime carries private revision notifications; clients then read authoritative state. Queues consume no room capacity. Go, Chess, Xiangqi, Pong and shared Whiteboard share the existing two-room limit.

Public statistics contain verified completed games, wins, losses, draws and wins/completed win rate. Win-rate sorting requires ten completed games. Private, computer, imported, interrupted and unopened games do not enter public statistics. Profile exposes only public statistics, not live positions or private move logs.

Private progress retains guest/account isolation and manual guest-copy behavior. FEN lacks historical repetition/check evidence; those counters restart on import, visibly explained in Help. ICCS records use a0–i9. Fairy-Stockfish internally uses a1–i10; the adapter explicitly converts both directions.

## Verification and release gate

Run `pnpm test:xiangqi` against the local preview. Real backend verification is opt-in: `WORKSHOP_LIVE_XIANGQI=1 pnpm test:xiangqi:live`, with disposable credentials supplied only on hidden stdin. The companion `WORKSHOP_LIVE_XIANGQI=1 pnpm test:xiangqi:matchmaking` checks the real random queue, private channel denial and a full disconnect window. Neither script installs a privileged endpoint. Test rooms must be confirmed unranked before Ready, then all fixture accounts and rooms must be removed.

The compatible production migration and Edge deployment precede frontend publication. Do not publish the full online feature until the real two-account match and mixed capacity test pass. Push only the existing GitHub branch; Vercel deploys automatically. See `docs/xiangqi-acceptance.md` for evidence and remaining gates.
