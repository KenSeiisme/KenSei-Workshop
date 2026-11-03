# Stockfish 19.0.1 Lite single-threaded

This directory distributes the unmodified `stockfish-19-lite-single.js` and
`stockfish-19-lite-single.wasm` from the pinned `stockfish@19.0.1` npm release.
The JavaScript and WebAssembly are licensed under GPL version 3. The engine is
by the Stockfish contributors; the browser port is maintained by Nathan Rugg
and Chess.com. See the complete [license](../licenses/stockfish-GPL-3.0.txt) and
[authors](../licenses/stockfish-AUTHORS.txt).

The engine has not been modified. Asset paths, original download URLs and
SHA-256 checksums are listed in [manifest.json](manifest.json).

## Corresponding source

The exact tagged source is available on this same server:

- [Stockfish.js v19.0.1 source archive](../sources/stockfish-js-19.0.1-source.tar.gz)
- [Embedded Lite evaluation network, nn-61e7af4bb97d.nnue](../sources/nn-61e7af4bb97d.nnue)
- [Upstream tag](https://github.com/nmrugg/stockfish.js/tree/v19.0.1), commit
  `0d5dd7944f88c817c07a26bc4fb1905d5f9c46d6`

The source archive includes the engine C++, Emscripten glue, Makefiles, build
script, author notices and upstream build documentation. To build this flavor,
extract the source on a system that supports symbolic links, place the supplied
network in `stockfish.js-19.0.1/src/nn-61e7af4bb97d.nnue`, install Emscripten
6.0.9 and the pinned development dependency (`terser` 5.51.2), then run:

```sh
node build.js --single-threaded --lite --no-split -f
```

The upstream README and `node build.js --help` document the toolchain and
additional options. Building requires Node.js, make and the Emscripten SDK;
these development tools are not required by visitors. The network is by Chris
Bao (sscg13), identified by its SHA-256 prefix and preserved here as the exact
input embedded in the distributed Lite binary.

## Browser use

Keep both engine files adjacent, with their original names, and serve `.wasm`
as `application/wasm`. A classic Worker speaks line-based UCI:

```js
const engine = new Worker('/vendor/stockfish/stockfish-19-lite-single.js');
engine.onmessage = ({ data }) => console.log(data);
engine.postMessage('uci');
// Wait for uciok, set options, then wait for readyok after isready.
engine.postMessage('isready');
engine.postMessage('position startpos moves e2e4');
engine.postMessage('go movetime 300');
// Receive bestmove, validate it with the chess rules before applying it.
// engine.postMessage('stop'); engine.terminate(); when the generation changes.
```

This single-threaded flavor needs neither SharedArrayBuffer nor cross-origin
isolation headers. The engine must be loaded only for local AI, never for an
ongoing online human match. A failed engine download must not block other game
modes. Reusing a Worker after `stop` still requires application-level generation
checks; terminating the old Worker guarantees that an old `bestmove` cannot
reach a new game.
