# Chess: rules, Stockfish and online matches

Chess is game fourteen. The tool catalog remains at twenty-eight. The page is available at `/games/chess/` and `/zh-hant/games/chess/`; it uses the existing board-first shell and board-game audio family.

## Architecture and defaults

The pure `chess-engine.js` adapter uses the pinned BSD-2-Clause chess.js 1.4.0. It handles moves, claims, offers, automatic endings, compact private saves and PGN. It deliberately does not use chess.js `isGameOver()` for claimable draws. Repetition keys include side to move, castling and legally usable en-passant rights.

Local two-player and computer games default to unlimited time. The computer defaults to Level 2 with the human playing White. Online games support 5+3, 10+5 and 15+10, defaulting to 10+5. Only an accepted move adds increment. Invalid moves/claims, duplicate receipts and draw offers cannot create extra time. Online clocks continue in the background.

Stockfish.js 19.0.1 Lite runs in a classic, single-threaded Worker. Five skill/time budgets are bounded at 200/350/600/1000/1500ms before remaining-clock adjustment; these levels are not ratings. Search cancellation terminates the Worker, and each reply belongs to a generation. Browser rules validate its returned UCI move. No engine runs on the server, and online games never expose an analysis engine.

## Draws and adjudication limits

- Threefold repetition and fifty moves require a valid current-position or intended-move claim.
- Fivefold repetition and seventy-five moves end automatically. Checkmate on the final move takes precedence.
- Draw proposals never pause clocks. An opponent move declines an outstanding offer; only the opponent can accept it.
- Basic proven dead-material cases end automatically. A mutual unresolved-position request is tied to the current position; moving clears prior consent.
- FEN imports validate basic kings, piece counts, castling and en-passant consistency, not complete historical reachability. FEN has no prior repetition history. PGN accepts one main line up to 256KB; imports are always private.

**Timeout adjudication is deliberately conservative.** `chess-adjudication.js` needs a replayable cooperative mating witness to award a timeout win. It checks that witness against this game's repetition/halfmove history and all automatic endings. A complete reachable-state exhaustion or proven material case can establish impossibility; incomplete search cannot. The normal runtime search has node/time budgets. As a result, **ordinary middlegames as well as rare fortresses can remain Unresolved**. This is not a certified complete FIDE dead-position solver or a tournament referee.

An unresolved game releases room capacity without inserting a final settlement or statistics. Members retain the position/PGN and can later agree to a draw. An interrupted game likewise never creates a public winner. Disconnect forfeits are a separate site policy.

## Online compatibility and privacy

`board-match` still defaults requests without `game` to Go. Its service-only database dispatcher verifies the requested game against stored matches, takes the shared room lock before cross-game checks, and preserves the old Go interface. Chess has separate state and Fischer clocks. Existing private tables, requests, members, broadcasts and the 15-second Cron are reused. Go, Chess, Pong and shared Whiteboard have a combined two-active-room limit.

Members alone can read a match. Commands carry UUID receipts and expected revisions; service-side rules derive the next board. Database commit checks membership/control/revision/deadline again. A client cannot supply a trustworthy winner, FEN, clock or score. Realtime sends revision notices; clients fetch the authoritative state. A second tab is read-only until explicit takeover.

Standard human online matches contribute wins/losses/draws by time control and rules version. `get_chess_leaderboard()` is separate from the unchanged Go leaderboard RPC. Public Profile adds `chess_stats`; `board_game_stats` stays Go-only. Private, imported, computer, interrupted and unresolved results do not enter that leaderboard. The nine solo score boards and thirty achievements are unaffected.

## Dependencies and verification

`node scripts/vendor-chess.mjs` verifies/downloads exact dependency bytes from the committed hash manifest. Engine assets, license, authors, matching source archive, network and build instructions are hosted under `/vendor/`; no runtime request goes to a dependency CDN. The production Python-only build ships the source archive too.

Run `node scripts/test.mjs chess` with the local preview available. The tests cover deterministic rules/perft, Edge authority, PGlite transitions and real-browser interactions. `scripts/verify-chess-online.cjs` is explicitly enabled and reads disposable fixture credentials through stdin; it must never write credentials to files or change authentication providers. Real checks use unranked fixtures and cleanup their rooms/accounts afterward. Browser viewport emulation is not a physical Android check.

References: [FIDE](https://handbook.fide.com/chapter/e012023), [chess.js](https://jhlywa.github.io/chess.js/), [Stockfish.js](https://github.com/nmrugg/stockfish.js/tree/v19.0.1).
