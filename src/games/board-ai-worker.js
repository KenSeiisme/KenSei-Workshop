import { chooseMove } from "./board-engine.js";

// 页面重开或离开时直接 terminate Worker，过期回复另由请求 id 过滤。
self.onmessage = ({ data }) => {
  const id = data?.id;
  try {
    self.postMessage({ id, event: chooseMove(data?.state) });
  } catch (error) {
    self.postMessage({
      id,
      error: error?.message || "The computer could not choose a move.",
    });
  }
};
