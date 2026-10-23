# Original Sudoku and Nonogram banks

The version-1 bank contains 180 original puzzles: 30 Sudoku puzzles in each of Easy, Normal and Hard, plus 30 Nonograms each at 5×5, 10×10 and 15×15. No third-party puzzle data or copied solver implementation is used.

Run `node scripts/generate-puzzles.mjs` from the repository root to regenerate the deterministic bank, then `node tests/unit/puzzle-games.mjs` to independently recheck every puzzle. Generation uses a fixed xorshift seed. Runtime code only selects a published puzzle using the session seed; it does not generate or solve puzzles in the browser or Edge request.

## Sudoku verification and honest difficulty labels

A randomized minimum-candidate search creates complete grids. Clues are removed only when a separate exhaustive solver finds exactly one solution (stopping after two solutions to reject ambiguity).

Difficulty is a reproducible threshold rather than a guarantee of human solving time:

- **Easy** is solvable with naked singles alone.
- **Normal** needs at least one hidden single and is solvable with naked and hidden singles.
- **Hard** cannot be completed by that singles solver. It may require pairs, other advanced deductions or search; the generator does not claim to distinguish those techniques or provide a standard published difficulty rating.

All solutions are exhaustively uniqueness-checked again in the unit suite. Wrong editable digits are permitted during play for conflict feedback; given digits are immutable. Completion requires the exact verified solution.

## Nonogram verification

Original random binary patterns generate row and column run clues. The verifier enumerates legal line patterns, repeatedly propagates row/column intersections and branches on the most constrained unresolved row. Candidates with multiple solutions, no solution or an exhausted search budget are discarded. The committed bank has exactly one solution for every puzzle. The three mode labels describe board size, not a formal technique difficulty ranking.

Filled cells must exactly match the verified pattern to win. Cross marks are optional and remain useful player annotations: a solution does not require marking every empty square.

## Pure module contract

`src/games/puzzle-engine.js` exports `CONFIG`, `create(game, difficulty, seed)`, `apply(state, event)`, `validate(state)`, `metrics(state)` and `solution(state)`. The module imports only the fixed bank and does not access browser APIs, clocks or network.

- Common state: `game`, `difficulty`, `version: 1`, `seed`, `rng`, `puzzleId`, flat numeric `board`, `score: 0`, `moves`, and `status` (`playing` or `won`). The mode keys for both games are `easy`, `normal`, `hard`.
- Sudoku adds immutable `givens` (81 digits, zero for editable cells) and `notes` (81 independent arrays of unique digits). Events are `{type: 'digit', index, value: 0..9, t}`. Notes are local private/save state and do not change the ranked event log. Entering a digit clears that cell's notes. Digit zero erases an editable cell.
- Nonogram adds `size`, `rows` and `cols` clues. Cell values are `0` unknown, `1` filled and `2` crossed. Events are `{type: 'cell', index, value: 0|1|2, t}`.
- `apply` returns false for invalid/no-op edits or edits after completion; valid edits mutate the board and increment moves. It does not inspect timestamps, because the shared replay/session layer validates event timing.
- `validate` rejects changed puzzle identity, givens, clues, malformed annotations or forged completion. It returns the same state after successful validation. It is a save-integrity check; public results still require authoritative event replay.
- `solution` returns a fresh flat digit or binary array for Private hints and tests. Puzzle solutions are shipped publicly, so ranked verification is for casual play and does not promise to prevent automated solvers.

The bank and its seed-to-puzzle mapping are rule-versioned assets. Do not replace a published version-1 bank in place when future sessions, saves or scores could refer to it; a changed bank needs a new rule version and an explicit compatibility path.
