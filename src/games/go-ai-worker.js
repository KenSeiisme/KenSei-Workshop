import { chooseGoMove } from "./go-ai.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      id: data.id,
      action: chooseGoMove(data.state, data.level, data.seed),
    });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
