export function validateDeck(data) {
  if (
    !data ||
    typeof data.name !== "string" ||
    !data.name.trim() ||
    data.name.trim().length > 100 ||
    !Array.isArray(data.cards) ||
    data.cards.length > 200
  )
    throw Error("Use a deck name (1–100 characters) and up to 200 cards.");
  const cards = data.cards.map((c) => {
    if (
      !c ||
      !/^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(
        c.id,
      ) ||
      typeof c.front !== "string" ||
      typeof c.back !== "string" ||
      !c.front.trim() ||
      !c.back.trim() ||
      [...c.front].length > 1000 ||
      [...c.back].length > 1000 ||
      typeof c.known !== "boolean"
    )
      throw Error(
        "Each card needs front and back text, up to 1,000 characters per side.",
      );
    return { id: c.id, front: c.front, back: c.back, known: c.known };
  });
  if (new Set(cards.map((c) => c.id)).size !== cards.length)
    throw Error("Card IDs must be unique.");
  const result = { version: 1, name: data.name.trim(), cards };
  if (
    new TextEncoder().encode(JSON.stringify(result)).length +
      8 * cards.length +
      4 >
    1000000
  )
    throw Error("This deck exceeds 1 MB.");
  return result;
}
export function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const span = i + 1,
      limit = Math.floor(4294967296 / span) * span;
    let n;
    do {
      n = crypto.getRandomValues(new Uint32Array(1))[0];
    } while (n >= limit);
    const j = n % span;
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
