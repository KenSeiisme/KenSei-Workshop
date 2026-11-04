# Fairy-Stockfish WASM 1.1.12 for Xiangqi

This directory distributes the unmodified engine files from the pinned
`fairy-stockfish-nnue.wasm@1.1.12` npm package, plus the small project-authored
`xiangqi-worker.js` UCI adapter. The engine is by Fabian Fichter and the
Fairy-Stockfish/Stockfish contributors. See the complete
[GPL version 3 license](../licenses/fairy-stockfish-GPL-3.0.txt) and
[author notices](../licenses/fairy-stockfish-AUTHORS.txt).

The original `stockfish.js`, `stockfish.wasm`, `stockfish.worker.js`, `uci.js`,
and package metadata retain their published bytes. Original URLs, file sizes,
and SHA-256 checksums are listed in [manifest.json](manifest.json). Run
`node scripts/vendor-xiangqi.mjs` from the checkout to verify every distributed
upstream asset and restore a missing or changed asset from its pinned download.
Valid local assets require no network request.

## Corresponding source and build instructions

The matching source is available on this same server:

- [Full source archive](../sources/fairy-stockfish-1.1.12-source.tar.gz)
- [Upstream commit b2e693ef1e111233ce3fb40685921708b3276ed6](https://github.com/fairy-stockfish/fairy-stockfish.wasm/tree/b2e693ef1e111233ce3fb40685921708b3276ed6)
- [Pinned npm release](https://www.npmjs.com/package/fairy-stockfish-nnue.wasm/v/1.1.12)

The commit is the npm registry's `gitHead` for version 1.1.12. Its public
package metadata matches the npm package, and the running engine identifies
itself as commit `b2e693ef`, Emscripten `2.0.26`, large-board (`LB`) build.
The archive is the complete, unfiltered upstream commit archive, including
C++ engine sources, variants, Emscripten preamble and pthread postamble,
Makefiles, test programs, CI, Docker configuration, and license notices.

The upstream publication workflow uses `embedded_nnue=no` and Emscripten
`2.0.26`. No neural network is embedded in this package, and this application
does not download a network. Its runtime explicitly selects classical
evaluation with `setoption name Use NNUE value false`.

To build the same flavor, extract the archive, install and activate Emscripten
SDK 2.0.26, GNU make, and Node.js, then run from the source root:

```sh
make -C src emscripten_build ARCH=wasm embedded_nnue=no wasm_simd=yes \
  EM_COMMIT=b2e693ef EM_UPSTREAM= EM_EMSCRIPTEN=2.0.26
```

The explicit `EM_*` variables preserve version metadata when building an
archive without a `.git` directory. `largeboards=yes` is the source default;
Xiangqi requires it. The build writes `stockfish.js`, `stockfish.wasm`, and
`stockfish.worker.js` to `src/emscripten/public/`, copying author/license files
and adding the supplied pthread postamble. `uci.js` and package metadata are
already in that directory. The source's `src/emscripten/README.md`, Makefile,
`docker-compose.yml`, and `.github/workflows/ci.yml` document the upstream
build and tests. The Docker configuration pins `emscripten/emsdk:2.0.26` and
Node.js `16.5.0-buster`. We verify published bytes and source identity; we have
not independently rebuilt the package or claimed a byte-for-byte rebuild.

## Browser use

Keep the files adjacent and serve `.wasm` as `application/wasm`. The published
`stockfish.js` exposes the asynchronous `Stockfish()` factory; it does not
listen to browser Worker messages on its own. `stockfish.worker.js` is the
engine's internal pthread worker. Start the supplied classic UCI adapter:

```js
const engine = new Worker('/vendor/fairy-stockfish/xiangqi-worker.js');
engine.onerror = (event) => console.error(event.message);
engine.onmessage = ({ data: line }) => console.log(line);
engine.postMessage('uci');
// Wait for uciok, then defensively set options before isready.
engine.postMessage('setoption name UCI_Variant value xiangqi');
engine.postMessage('setoption name Use NNUE value false');
engine.postMessage('setoption name Threads value 1');
engine.postMessage('setoption name Hash value 16');
engine.postMessage('setoption name Skill Level value 0');
engine.postMessage('isready');
// Wait for readyok before starting a search.
engine.postMessage('position startpos');
engine.postMessage('go movetime 300');
// Receive bestmove, then validate the move with the application rules.
// engine.postMessage('stop'); engine.terminate(); when the game changes.
```

The adapter queues commands during initialization and supplies Xiangqi,
classical evaluation, one engine search thread, and a 16 MiB hash table. It
forwards UCI lines unchanged and performs no move or FEN conversion. The
upstream `uci` command resets the variant to chess, so the adapter reapplies
its settings before forwarding each `uciok`; consumers should still set their
desired options after the handshake. The
factory receives explicit same-origin `locateFile` and `mainScriptUrlOrBlob`
paths so its WASM and internal worker load locally. No runtime asset comes
from a CDN or external server.

The WASM uses SIMD and shared WebAssembly memory with pthreads even when the
UCI `Threads` option is 1. It initially allocates 128 MiB shared linear memory
and permits growth to 2 GiB; application and browser memory are additional.
The document and relevant responses must permit cross-origin isolation,
typically with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`. The document and adapter worker
must report `crossOriginIsolated === true`, and `SharedArrayBuffer` must be
available. Check support before loading; other game modes must remain usable
when the engine cannot start.

## Xiangqi protocol details

- `UCI_Variant` includes `xiangqi`. The standard starting FEN is
  `rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1`.
- This build's UCI move coordinates use files `a`–`i` and ranks `1`–`10`:
  `b3e3`, `a10a9`. An application using ICCS ranks `0`–`9` must add 1 to each
  rank before sending a move and subtract 1 after receiving it. Parse the
  complete rank, including `10`; do not assume four-character moves. FEN is
  unchanged. This adapter performs no conversion.
- `Skill Level` accepts integers from `-20` to `20` (default `20`). Negative
  values are weaker settings. The engine also exposes `UCI_LimitStrength` and
  `UCI_Elo` from `500` to `2850`; these numbers are not a calibrated Xiangqi
  rating and must not be presented as one.
- `Use NNUE` advertises upstream default `true` in the `uci` option list even
  after the adapter disables it. Search output confirms
  `info string classical evaluation enabled`.
- On a game restart, terminate the old top-level worker and ignore responses
  from an obsolete game generation. `stop` alone can still produce a pending
  `bestmove`. Load the engine only for local AI play.
