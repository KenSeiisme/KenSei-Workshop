import { randomIndex } from "./daily-core.js";
export function passphrase(words, count, random = randomIndex) {
  if (![6, 7, 8].includes(count) || words.length !== 7776)
    throw Error("Choose six to eight words from the fixed EFF list.");
  return Array.from({ length: count }, () => words[random(words.length)]).join(
    "-",
  );
}
