# Games and public profile visual update — 2026-10-22

The Games directory now has a native board collage, four game cards, and a separate saved-progress section. Each game uses its own soft accent, a ready illustration, score panels, a state label, and refreshed board and leaderboard styling. Public profiles group current personal bests into four game cards, retaining each difficulty, its units, details, date, and a game link. Typing scores remain available below.

Public game and typing counts describe qualifying current-version records only. They do not claim to measure all games played. Profiles with no scores have explicit empty states. Reload/retry replaces stable containers instead of appending duplicate game sections. Names and biographies remain plain text.

No game rules, save keys, database tables, RPCs, authentication behavior, or leaderboard eligibility changed. The profile stylesheet loads only on profile pages; game styles remain scoped to Games. The 28 tools and projects retain their existing layouts.

## Local verification

- Python build: 45 generated pages.
- Clean structure build: all 28 tool routes and required vendor assets; private source files excluded.
- Four existing Games suites: deterministic engines, Edge replay checks, database authorization/ranking, and browser play/save/sync tests passed.
- Two existing Profile suites: Google initialization, avatar ownership/editing, profile text safety, typing results, and browser layouts passed.
- New `tests/browser/game-visuals.cjs` passed at 320, 360, 768, and 1440px. It covers search/filter/anchor behavior, all four actual browser games, ready/playing/paused states, Expert minefield containment, matching card faces, reduced motion, populated/empty profiles, multiple difficulties, long Chinese names, and retry without duplicate cards. No uncaught browser errors or guest score/save uploads.
- Edge screenshots inspected for the directory, game boards, Snake canvas, and populated/empty profiles at desktop, tablet, and phone sizes.
- JavaScript syntax and Prettier checks passed.

Profile and populated leaderboard visual fixtures use synthetic people and results. Account/authorization regression uses isolated local PostgreSQL fixtures; no production account data is modified by these tests. Production verification uses anonymous reads and guest local play after GitHub/Vercel release.
