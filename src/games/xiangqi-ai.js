// 本站 ICCS 是 a0–i9；固定版本 Fairy-Stockfish 的 UCI 是 a1–i10。
export function fairyMove(uci) {
  if (!/^[a-i][0-9][a-i][0-9]$/.test(uci || ""))
    throw Error("Invalid Xiangqi engine move.");
  return uci[0] + (Number(uci[1]) + 1) + uci[2] + (Number(uci[3]) + 1);
}
export function iccsMove(uci) {
  const match = /^([a-i])(10|[1-9])([a-i])(10|[1-9])$/.exec(uci || "");
  if (!match) throw Error("The Xiangqi engine returned an invalid move.");
  return match[1] + (Number(match[2]) - 1) + match[3] + (Number(match[4]) - 1);
}
export function createXiangqiAI(onProgress = () => {}) {
  let worker,
    closed = false;
  const waits = new Set();
  function fail(error) {
    for (const waiter of waits) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    waits.clear();
  }
  function waitFor(test, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const item = {
        test,
        resolve,
        reject,
        timer: setTimeout(() => {
          waits.delete(item);
          reject(
            Error(
              "The Xiangqi engine timed out. Retry or choose another mode.",
            ),
          );
        }, timeout),
      };
      waits.add(item);
    });
  }
  const ready = (async () => {
    if (
      !globalThis.crossOriginIsolated ||
      typeof SharedArrayBuffer !== "function" ||
      typeof WebAssembly !== "object"
    )
      throw Error(
        "This browser cannot run the Xiangqi engine here. Use local two players or online play.",
      );
    onProgress("Loading Fairy-Stockfish…");
    worker = new Worker("/vendor/fairy-stockfish/xiangqi-worker.js");
    worker.onmessage = ({ data }) => {
      for (const line of String(data).split("\n"))
        for (const item of [...waits])
          if (item.test(line)) {
            waits.delete(item);
            clearTimeout(item.timer);
            item.resolve(line);
          }
    };
    worker.onerror = () =>
      fail(
        Error("Fairy-Stockfish could not load. Retry or choose another mode."),
      );
    let waiting = waitFor((line) => line.trim() === "uciok");
    worker.postMessage("uci");
    await waiting;
    for (const command of [
      "setoption name UCI_Variant value xiangqi",
      "setoption name Use NNUE value false",
      "setoption name Threads value 1",
      "setoption name Hash value 16",
    ])
      worker.postMessage(command);
    waiting = waitFor((line) => line.trim() === "readyok");
    worker.postMessage("isready");
    await waiting;
    if (closed) throw Error("Search cancelled.");
    onProgress("Fairy-Stockfish ready");
  })();
  return {
    ready,
    async move(state, level, remaining = Infinity) {
      await ready;
      if (closed) throw Error("Search cancelled.");
      const index = Math.max(0, Math.min(4, Number(level) - 1));
      const budget = Math.max(
        50,
        Math.min([200, 400, 800, 1500, 2500][index], remaining / 12),
      );
      worker.postMessage(
        `setoption name Skill Level value ${[0, 4, 8, 12, 16][index]}`,
      );
      const moves = state.log
        .filter((a) => a.type === "move")
        .map((a) => fairyMove(a.uci));
      worker.postMessage(
        `position fen ${state.initialFen}${moves.length ? " moves " + moves.join(" ") : ""}`,
      );
      const waiting = waitFor(
        (line) => line.startsWith("bestmove "),
        budget + 10000,
      );
      worker.postMessage(`go movetime ${Math.round(budget)}`);
      const line = await waiting;
      return iccsMove(line.split(/\s+/)[1]);
    },
    close() {
      closed = true;
      worker?.terminate();
      fail(Error("Search cancelled."));
    },
  };
}
