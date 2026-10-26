import { randomIndex, shuffle } from "./sprint-core.js";

// 只保存首句标识，不保留打字输入；游客和账号使用独立记录。
const recentMemory = new Map();
let bankPromise;
export function composePassage(bank, language, recent = []) {
  const sentences = bank.languages?.[language];
  if (!Array.isArray(sentences) || sentences.length < 120)
    throw new Error("The passage library is unavailable. Please retry.");
  const candidates = sentences.filter((x) => !recent.includes(x.id));
  const first = candidates[randomIndex(candidates.length)];
  const ordered = [
    first,
    ...shuffle(sentences.filter((x) => x.id !== first.id)),
  ];
  const selected = [];
  const separator = language === "en" ? " " : "";
  let text = "";
  for (const item of ordered) {
    if (!item.id || typeof item.text !== "string")
      throw new Error("Invalid passage library.");
    selected.push(item.id);
    text += (text ? separator : "") + item.text;
    if (text.length >= (language === "en" ? 3000 : 1800)) break;
  }
  if (text.length > (language === "en" ? 4500 : 2500))
    throw new Error("Invalid passage length.");
  return {
    text,
    duration: 60,
    sentenceIds: selected,
    sourceRevision: bank.revision,
  };
}
export async function practicePassage(language, owner) {
  bankPromise ||= fetch("/assets/typing-sentences.json")
    .then((response) => {
      if (!response.ok)
        throw new Error("The passage library is unavailable. Please retry.");
      return response.json();
    })
    .catch((error) => {
      bankPromise = null;
      throw error;
    });
  const key =
    "kensei-workshop:typing:first-sentences:v1:" + owner + ":" + language;
  let recent = recentMemory.get(key) || [];
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(saved)) recent = saved.slice(0, 10);
  } catch {}
  const result = composePassage(await bankPromise, language, recent);
  const next = [result.sentenceIds[0], ...recent].slice(0, 10);
  recentMemory.set(key, next);
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {}
  return result;
}
