// 每次重開／暫停終止 Worker；舊 bestmove 無法進入下一局。
export function createChessAI(onProgress = () => {}) {
  let worker,
    rejectPending,
    closed = false;
  const waiters = new Set();
  function waitFor(test, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const item = {
        test,
        resolve,
        reject,
        timer: setTimeout(() => {
          waiters.delete(item);
          reject(
            Error("Chess engine timed out. Retry or choose local two players."),
          );
        }, timeout),
      };
      waiters.add(item);
    });
  }
  const ready = (async () => {
    onProgress("Loading Stockfish…");
    worker = new Worker("/vendor/stockfish/stockfish-19-lite-single.js");
    worker.onmessage = ({ data }) => {
      for (const line of String(data).split("\n"))
        for (const item of [...waiters])
          if (item.test(line)) {
            waiters.delete(item);
            clearTimeout(item.timer);
            item.resolve(line);
          }
    };
    worker.onerror = () => {
      for (const item of waiters) {
        clearTimeout(item.timer);
        item.reject(
          Error("Stockfish could not load. Retry or choose local two players."),
        );
      }
      waiters.clear();
    };
    let waiting = waitFor((line) => line.trim() === "uciok");
    worker.postMessage("uci");
    await waiting;
    worker.postMessage("setoption name Hash value 16");
    worker.postMessage("setoption name Threads value 1");
    waiting = waitFor((line) => line.trim() === "readyok");
    worker.postMessage("isready");
    await waiting;
    if (closed) throw Error("Search cancelled.");
    onProgress("Stockfish ready");
  })();
  return {
    ready,
    async move(state, level, remaining = Infinity) {
      await ready;
      if (closed) throw Error("Search cancelled.");
      const budget = Math.max(
        50,
        Math.min([200, 350, 600, 1000, 1500][level - 1] || 350, remaining / 12),
      );
      worker.postMessage(
        `setoption name Skill Level value ${[0, 4, 8, 12, 16][level - 1] || 0}`,
      );
      const moves = state.log
        .filter((a) => a.type === "move")
        .map((a) => a.uci)
        .join(" ");
      worker.postMessage(
        `position fen ${state.initialFen}${moves ? ` moves ${moves}` : ""}`,
      );
      const waiting = waitFor(
        (line) => line.startsWith("bestmove "),
        budget + 10000,
      );
      worker.postMessage(`go movetime ${Math.round(budget)}`);
      return (await waiting).split(/\s+/)[1];
    },
    close() {
      closed = true;
      worker?.terminate();
      for (const item of waiters) {
        clearTimeout(item.timer);
        item.reject(Error("Search cancelled."));
      }
      waiters.clear();
      rejectPending?.();
    },
  };
}
