// SPDX-License-Identifier: GPL-3.0-or-later
// KenSei Workshop adapter; upstream engine files remain unmodified.
"use strict";

if (!self.crossOriginIsolated || typeof SharedArrayBuffer === "undefined") {
  throw Error("Fairy-Stockfish requires cross-origin isolation and shared memory.");
}

const engineDirectory = new URL(".", self.location.href),
  engineScript = new URL("stockfish.js", engineDirectory).href,
  pendingCommands = [];
let engine = null;

function configure(instance) {
  for (const command of [
    "setoption name UCI_Variant value xiangqi",
    "setoption name Use NNUE value false",
    "setoption name Threads value 1",
    "setoption name Hash value 16",
  ]) {
    instance.postMessage(command);
  }
}

// 初始化期間先保留 UCI 指令，避免第一個 uci 在 WASM 就緒前遺失。
self.onmessage = ({ data }) => {
  if (typeof data !== "string") return;
  if (engine) engine.postMessage(data);
  else pendingCommands.push(data);
};

importScripts(engineScript);
Stockfish({
  locateFile: (name) => new URL(name, engineDirectory).href,
  // pthread 需要載入真正的模組工廠，而不是這個 UCI 包裝 Worker。
  mainScriptUrlOrBlob: engineScript,
})
  .then((instance) => {
    instance.addMessageListener((line) => {
      // 上游 uci 會重設棋種；先恢復象棋設定，再通知呼叫端握手完成。
      if (line === "uciok") configure(instance);
      self.postMessage(line);
    });
    configure(instance);
    engine = instance;
    for (const command of pendingCommands.splice(0)) {
      engine.postMessage(command);
    }
  })
  .catch((error) => {
    // 以 Worker 的 error 事件回報載入失敗，讓呼叫端顯示可重試狀態。
    setTimeout(() => {
      throw error;
    }, 0);
  });
