import { api } from "/tool-scripts/common.js";
export async function sessionCall(action, body) {
  if (!api.user || !api.client?.functions)
    throw Error("Sign in to start a Public game.");
  const owner = api.user.id;
  const { data, error } = await api.client.functions.invoke(
    `games-session/${action}`,
    { body },
  );
  if (api.user?.id !== owner) throw Error("Account changed. Reopen this game.");
  let detail = data?.error;
  if (error?.context?.json) {
    try {
      detail = (await error.context.json())?.error || detail;
    } catch {}
  }
  if (error || detail)
    throw Error(
      detail ||
        "Public service could not complete this request. Check your connection and retry.",
    );
  return data;
}
let database;
async function db() {
  return (database ||= new Promise((resolve, reject) => {
    const r = indexedDB.open("kensei-game-submissions-v1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("pending");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () =>
      reject(
        Error(
          "Could not preserve this Public result locally. Keep this page open to retry.",
        ),
      );
  }));
}
export async function pendingResult(game, value, remove = false) {
  if (!api.user) return null;
  const owner = api.user.id,
    database = await db(),
    key = `${owner}:${game}`;
  return new Promise((resolve, reject) => {
    const tx = database.transaction(
        "pending",
        value || remove ? "readwrite" : "readonly",
      ),
      store = tx.objectStore("pending");
    const r = remove
      ? store.delete(key)
      : value
        ? store.put(value, key)
        : store.get(key);
    tx.oncomplete = () => resolve(api.user?.id === owner ? r.result : null);
    tx.onabort = tx.onerror = () =>
      reject(
        Error("Public result storage failed. Keep this page open to retry."),
      );
  });
}
