// 外层 worker 负责生命周期，取消时连同 OCR 子 worker 一起终止。
importScripts("/vendor/tesseract/tesseract.min.js");
self.onmessage = async ({ data: { file, languages } }) => {
  let engine;
  const error = (message) => self.postMessage({ error: String(message) });
  try {
    engine = await Tesseract.createWorker(languages, 1, {
      workerPath: self.location.origin + "/vendor/tesseract/worker.min.js",
      corePath: self.location.origin + "/vendor/tesseract/core",
      langPath: self.location.origin + "/vendor/tesseract/lang",
      workerBlobURL: false,
      logger: (progress) => self.postMessage({ progress }),
      errorHandler: error,
    });
    const { data } = await engine.recognize(file);
    self.postMessage({ text: data.text });
  } catch (e) {
    error(e.message || e);
  } finally {
    if (engine) await engine.terminate();
  }
};
