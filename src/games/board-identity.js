// 刷新沿用控制身份；新分頁若複製了 sessionStorage，先與舊文件協商去重。
export async function boardClientId() {
  const key = "kensei-board-tab-v1",
    documentId = crypto.randomUUID();
  let client;
  try {
    client = sessionStorage.getItem(key);
  } catch {}
  if (!/^[\da-f-]{36}$/i.test(client || "")) client = crypto.randomUUID();
  let bus,
    collision = false;
  try {
    bus = new BroadcastChannel("kensei-board-tab-presence-v1");
    bus.onmessage = ({ data }) => {
      if (data.client !== client || data.document === documentId) return;
      if (data.type === "probe")
        bus.postMessage({
          type: "occupied",
          client,
          document: documentId,
          to: data.document,
        });
      if (data.type === "occupied" && data.to === documentId) collision = true;
    };
    bus.postMessage({ type: "probe", client, document: documentId });
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (collision) client = crypto.randomUUID();
    window.addEventListener("pagehide", () => bus.close(), { once: true });
  } catch {}
  try {
    sessionStorage.setItem(key, client);
  } catch {}
  return client;
}
