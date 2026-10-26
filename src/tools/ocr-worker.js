importScripts("/vendor/tesseract/tesseract.min.js");
let currentRequest = null;
let engine = null,
  lang = "";
self.onmessage = async ({ data: { file, languages, requestId } }) => {
  currentRequest = requestId;
  const error = (message) => postMessage({ requestId, error: String(message) });
  try {
    const next = languages.join("+");
    if (!engine || lang !== next) {
      if (engine) await engine.terminate();
      engine = await Tesseract.createWorker(languages, 1, {
        workerPath: location.origin + "/vendor/tesseract/worker.min.js",
        corePath: location.origin + "/vendor/tesseract/core",
        langPath: location.origin + "/vendor/tesseract/lang",
        workerBlobURL: false,
        logger: (progress) =>
          postMessage({ requestId: currentRequest, progress }),
        errorHandler: error,
      });
      lang = next;
    }
    const { data } = await engine.recognize(
      file,
      {},
      { text: true, blocks: true },
    );
    postMessage({
      requestId,
      text: data.text,
      confidence: data.confidence,
      blocks: data.blocks,
    });
  } catch (e) {
    error(e.message || e);
    if (engine) await engine.terminate().catch(() => {});
    engine = null;
    lang = "";
  }
};
