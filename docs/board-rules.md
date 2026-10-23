# Private board games

Connect Four and Reversi use rule version 1 and are always Private. Their save
state is shared by the browser and the existing save validator, but they never
start or finish public ranking sessions.

## State and input

`board-engine.js` exports `CONFIG`, `create`, `apply`, `validate`, `metrics`,
`legalMoves`, `reversiFlips`, and `chooseMove`. A board is a flat, row-major array
containing 0 (empty), 1 (first player), or 2 (second player). Connect Four is 7×6;
Reversi is 8×8. `turn` is the next player and `winner` is null while playing, 1/2
for a win, or 0 for a draw. `counts` reports both players' pieces. Terminal states
use `won` or `draw`; the interface interprets the winner relative to the selected
human side. `score` is 0 for Connect Four and the leading piece count for Reversi.

Connect Four accepts `{ type: "drop", column }`; Reversi accepts
`{ type: "disc", index }`. An optional elapsed `t` is only interface metadata.
Illegal input returns false without changing state. Reversi skips an opponent
with no legal move automatically; `lastSkipped` identifies that player and
`passCount` is 1 for a skipped turn or 2 when neither side can move.

AI modes are `ai-easy`, `ai-normal`, and `ai-hard`; `local` is two players on the
same device. The interface stores `humanSide` with the private record (default
1); choosing the second side does not change the initial position or rules.
Undo snapshots belong to the interface: local mode restores one move; computer
mode restores the previous human decision point, including any forced pass.

## Computer search

`board-ai-worker.js` receives `{ id, state }` and responds with `{ id, event }` or
`{ id, error }`. It returns a legal event without applying it. The page rejects
stale ids and terminates the worker on restart, pause, hidden page, or navigation.

Easy selects a seeded legal move, preferring an immediate win. Normal and Hard
use deterministic iterative-deepening alpha-beta search. Connect Four uses
center control and four-cell line opportunities; Reversi uses corners, mobility,
positional safety, and late-game piece counts. Normal/Hard budgets are 2,400/
24,000 Connect Four nodes and 1,400/14,000 Reversi nodes. Hard searches deeper and
uses the last completed iteration if the node budget is exhausted. All search
runs in a dedicated worker; no frame or wall-clock timing changes its choice.

The implementations and evaluations are original native JavaScript and introduce
no third-party dependencies or licenses.
