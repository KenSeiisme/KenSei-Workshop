onmessage = async ({ data }) => {
  try {
    const results = [];
    for (let i = 0; i < data.files.length; i++) {
      const f = data.files[i];
      postMessage({ type: "progress", index: i + 1, total: data.files.length });
      const bytes = await f.arrayBuffer(),
        hash = async (algorithm) =>
          [...new Uint8Array(await crypto.subtle.digest(algorithm, bytes))]
            .map((n) => n.toString(16).padStart(2, "0"))
            .join("");
      results.push({
        name: f.name,
        size: f.size,
        sha256: await hash("SHA-256"),
        ...(data.algorithm === "SHA-512"
          ? { sha512: await hash("SHA-512") }
          : {}),
      });
    }
    postMessage({ type: "complete", results });
  } catch (e) {
    postMessage({
      type: "error",
      error:
        "Could not read or hash this file. Retry with a smaller selection.",
    });
  }
};
