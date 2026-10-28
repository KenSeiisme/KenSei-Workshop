import { library } from "./common.js";

// 主執行緒只管理生命週期，辨識仍在本站的 Tesseract Worker 執行。
// 不再從另一個 Worker 建立子 Worker，避免 Firefox 在連續取消時崩潰。
export class OCRClient {
  constructor() {
    this.onmessage = null;
    this.onerror = null;
    this.disposed = false;
    this.engine = null;
    this.child = null;
    this.language = "";
  }
  emit(data) {
    if (!this.disposed) this.onmessage?.({ data });
  }
  postMessage(message) {
    this.recognize(message).catch((error) =>
      this.emit({
        requestId: message.requestId,
        error: String(error?.message || error),
      }),
    );
  }
  async recognize({ file, languages, requestId }) {
    const tesseract = await library("tesseract/tesseract.min.js", "Tesseract");
    if (this.disposed) return;
    this.requestId = requestId;
    const next = languages.join("+");
    if (!this.engine || this.language !== next) {
      await this.engine?.terminate();
      this.engine = null;
      if (this.disposed) return;
      const client = this,
        NativeWorker = window.Worker;
      let pending;
      // 固定版本的 createWorker 同步建立執行緒，再非同步載入模型。
      // 在同一個 JS 步驟內取得其擁有權，初始化尚未完成也能立即取消。
      try {
        window.Worker = class extends NativeWorker {
          constructor(...args) {
            super(...args);
            client.child = this;
          }
        };
        pending = tesseract.createWorker(languages, 1, {
          workerPath: location.origin + "/vendor/tesseract/worker.min.js",
          corePath: location.origin + "/vendor/tesseract/core",
          langPath: location.origin + "/vendor/tesseract/lang",
          workerBlobURL: false,
          logger: (progress) =>
            client.emit({ requestId: client.requestId, progress }),
          errorHandler: (error) =>
            client.emit({ requestId, error: String(error) }),
        });
      } finally {
        window.Worker = NativeWorker;
      }
      this.engine = await pending;
      if (this.disposed) {
        await this.engine.terminate();
        this.engine = null;
        return;
      }
      this.language = next;
    }
    const { data } = await this.engine.recognize(
      file,
      {},
      { text: true, blocks: true },
    );
    this.emit({
      requestId,
      text: data.text,
      confidence: data.confidence,
      blocks: data.blocks,
    });
  }
  terminate() {
    this.disposed = true;
    this.child?.terminate();
    this.child = null;
    this.engine = null;
    this.onmessage = this.onerror = null;
  }
}
