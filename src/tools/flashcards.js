import { $, status, downloadText, library, api } from "./common.js";
import * as store from "./flashcard-store.js";
import { validateDeck, shuffled } from "./flashcard-core.js";
import {
  uiMsg,
  uiJoin,
  uiFrom,
  uiError,
  uiText,
  uiConfirm,
} from "../site/ui.js";

let deck = null,
  cardId = null,
  timer = null,
  dirty = false,
  saving = false,
  editVersion = 0,
  scope = api.user?.id || "guest",
  review = [],
  position = 0,
  flipped = false,
  requested = new URLSearchParams(location.search).get("deck");
const owner = () => api.user?.id || "guest";
function element(tag, text, className) {
  const e = document.createElement(tag);
  uiText(e, text);
  if (className) e.className = className;
  return e;
}
function list() {
  const out = $("#deck-list");
  out.replaceChildren();
  for (const row of store.rows()) {
    const b = element(
      "button",
      row.data.name + " · " + row.data.cards.length + " cards",
      "saved-row text-link",
    );
    b.onclick = () => open(row.id);
    out.append(b);
  }
  uiText($("#deck-save-state"), uiFrom(store.saveState()));
  $("#deck-more").hidden = !store.hasMore();
}
function cards() {
  const out = $("#card-list");
  out.replaceChildren();
  if (!deck) return;
  for (const c of deck.data.cards) {
    const b = element(
      "button",
      (c.known ? "✓ " : "") + " " + c.front,
      "saved-row text-link",
    );
    b.onclick = async () => {
      await saveEdits();
      cardId = c.id;
      $("#card-front").value = c.front;
      $("#card-back").value = c.back;
    };
    out.append(b);
  }
  uiText(
    $("#study-progress"),
    uiJoin([
      deck.data.cards.filter((c) => c.known).length +
        " / " +
        deck.data.cards.length,
      uiMsg(" known"),
    ]),
  );
}
function resetReview() {
  review = [];
  position = 0;
  flipped = false;
  uiText($("#study-card"), uiMsg("Choose a deck and start reviewing."));
  $("#study-card").disabled = true;
  $("#study-again").disabled = $("#study-known").disabled = true;
}
async function open(id) {
  await saveEdits();
  const expected = owner(),
    row = await store.get(id);
  if (expected !== owner()) return;
  if (!row)
    return status(uiMsg("This deck is unavailable or was deleted."), true);
  deck = structuredClone(row);
  cardId = null;
  $("#deck-name").value = deck.data.name;
  $("#card-front").value = $("#card-back").value = "";
  dirty = false;
  resetReview();
  cards();
  list();
  status(
    uiMsg(
      "Deck opened. Changes save automatically; new cards use Add / update.",
    ),
  );
}
async function saveEdits() {
  clearTimeout(timer);
  if (!dirty || !deck) return;
  const expected = scope;
  if (owner() !== expected) return;
  const data = structuredClone(deck.data);
  data.name = $("#deck-name").value;
  if (cardId) {
    const c = data.cards.find((x) => x.id === cardId);
    if (c) {
      const front = $("#card-front").value,
        back = $("#card-back").value;
      if (c.front !== front || c.back !== back) {
        c.front = front;
        c.back = back;
        c.known = false;
      }
    }
  }
  const version = editVersion,
    id = deck.id;
  saving = true;
  try {
    const row = await store.put(validateDeck(data), id, expected);
    if (owner() !== expected || deck?.id !== id) return;
    deck = row;
    if (version === editVersion) dirty = false;
    cards();
    status(uiMsg("Deck saved on this device."));
  } catch (e) {
    status(uiError(e), true);
  } finally {
    saving = false;
  }
}
function changed() {
  editVersion++;
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(saveEdits, 500);
}
$("#deck-name").oninput = changed;
for (const id of ["card-front", "card-back"])
  $("#" + id).oninput = () => {
    if (cardId) changed();
  };
$("#deck-new").onclick = async () => {
  await saveEdits();
  try {
    const row = await store.put({ name: "Untitled deck", cards: [] });
    await open(row.id);
  } catch (e) {
    status(uiError(e), true);
  }
};
$("#card-save").onclick = async () => {
  if (!deck) return status(uiMsg("Create or open a deck first."), true);
  try {
    const data = structuredClone(deck.data),
      id = cardId || crypto.randomUUID(),
      old = data.cards.find((c) => c.id === id),
      front = $("#card-front").value,
      back = $("#card-back").value;
    data.name = $("#deck-name").value;
    data.cards = data.cards
      .filter((c) => c.id !== id)
      .concat({
        id,
        front,
        back,
        known: old?.front === front && old?.back === back ? old.known : false,
      });
    deck = await store.put(validateDeck(data), deck.id, scope);
    cardId = id;
    dirty = false;
    clearTimeout(timer);
    cards();
    status(uiMsg("Card saved."));
  } catch (e) {
    status(uiError(e), true);
  }
};
$("#card-new").onclick = async () => {
  await saveEdits();
  cardId = null;
  $("#card-front").value = $("#card-back").value = "";
  $("#card-front").focus();
};
$("#card-delete").onclick = async () => {
  if (!deck || !cardId) return;
  try {
    const data = {
      ...deck.data,
      cards: deck.data.cards.filter((c) => c.id !== cardId),
    };
    deck = await store.put(data, deck.id, scope);
    cardId = null;
    dirty = false;
    clearTimeout(timer);
    $("#card-front").value = $("#card-back").value = "";
    resetReview();
    cards();
  } catch (e) {
    status(uiError(e), true);
  }
};
$("#deck-delete").onclick = async () => {
  if (
    !deck ||
    !uiConfirm(uiMsg("Delete this deck and its private review progress?"))
  )
    return;
  clearTimeout(timer);
  try {
    await store.remove(deck.id);
    deck = null;
    dirty = false;
    $("#deck-name").value = $("#card-front").value = $("#card-back").value = "";
    $("#card-list").replaceChildren();
    resetReview();
    status(uiMsg("Deck deleted."));
  } catch (e) {
    status(uiError(e), true);
  }
};
$("#deck-reset").onclick = async () => {
  if (!deck || !uiConfirm(uiMsg("Reset mastery for every card in this deck?")))
    return;
  await saveEdits();
  try {
    deck = await store.put(
      {
        ...deck.data,
        cards: deck.data.cards.map((c) => ({ ...c, known: false })),
      },
      deck.id,
      scope,
    );
    cards();
    resetReview();
  } catch (e) {
    status(uiError(e), true);
  }
};
$("#deck-json").onclick = async () => {
  await saveEdits();
  if (deck)
    downloadText(
      JSON.stringify({ version: 1, deck: deck.data }, null, 2),
      "kensei-flashcards.json",
      "application/json",
    );
};
$("#deck-csv").onclick = async () => {
  await saveEdits();
  if (!deck) return;
  const Papa = await library("papaparse.js", "Papa");
  downloadText(
    Papa.unparse(
      {
        fields: ["front", "back"],
        data: deck.data.cards.map((c) => [c.front, c.back]),
      },
      { escapeFormulae: true },
    ),
    "kensei-flashcards.csv",
    "text/csv;charset=utf-8",
  );
  status(
    uiMsg(
      "CSV exported. Formula-like cells use a protective leading apostrophe; JSON preserves exact content and mastery.",
    ),
  );
};
$("#deck-import").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    if (file.size > 1000000) throw Error("Import files up to 1 MB.");
    const text = new TextDecoder("utf-8", { fatal: true })
      .decode(await file.arrayBuffer())
      .replace(/^\uFEFF/, "");
    let data;
    if (/\.json$/i.test(file.name)) {
      const parsed = JSON.parse(text);
      data = parsed.deck || parsed;
      data = {
        name: data.name,
        cards: data.cards.map((c) => ({
          ...c,
          id: crypto.randomUUID(),
          known: c.known === true,
        })),
      };
    } else {
      const Papa = await library("papaparse.js", "Papa"),
        parsed = Papa.parse(text, {
          header: true,
          skipEmptyLines: "greedy",
          dynamicTyping: false,
        });
      if (
        parsed.errors.some((e) => e.code !== "UndetectableDelimiter") ||
        parsed.meta.fields?.join(",") !== "front,back"
      )
        throw Error("CSV needs exactly front,back columns and valid rows.");
      data = {
        name:
          file.name.replace(/\.[^.]+$/, "").slice(0, 100) || "Imported deck",
        cards: parsed.data.map((c) => ({
          id: crypto.randomUUID(),
          front: c.front,
          back: c.back,
          known: false,
        })),
      };
    }
    validateDeck(data);
    const row = await store.put(data);
    await open(row.id);
    status(uiMsg("Imported as a new private deck."));
  } catch (e) {
    status(
      e instanceof TypeError
        ? uiMsg("Use a valid UTF-8 card deck with front and back text.")
        : uiError(e),
      true,
    );
  }
};
function showReview() {
  const c = deck?.data.cards.find((c) => c.id === review[position]);
  if (!c) {
    resetReview();
    uiText($("#study-progress"), uiMsg("Review complete. Mastery is saved."));
    cards();
    return;
  }
  $("#study-card").disabled = false;
  uiText(
    $("#study-card"),
    flipped
      ? uiJoin([uiMsg("Back "), c.back])
      : uiJoin([uiMsg("Front "), c.front]),
  );
  $("#study-again").disabled = $("#study-known").disabled = !flipped;
  uiText(
    $("#study-progress"),
    uiJoin([
      uiMsg("Card "),
      position + 1,
      " / ",
      review.length,
      " · ",
      deck.data.cards.filter((c) => c.known).length,
      uiMsg(" known"),
    ]),
  );
}
$("#study-start").onclick = async () => {
  await saveEdits();
  if (!deck) return;
  const ids = deck.data.cards
    .filter((c) => !$("#study-unknown").checked || !c.known)
    .map((c) => c.id);
  review = $("#study-shuffle").checked ? shuffled(ids) : ids;
  position = 0;
  flipped = false;
  showReview();
};
$("#study-card").onclick = () => {
  flipped = !flipped;
  showReview();
};
for (const [id, known] of [
  ["study-again", false],
  ["study-known", true],
])
  $("#" + id).onclick = async () => {
    if (!deck || !flipped) return;
    try {
      deck = await store.put(
        {
          ...deck.data,
          cards: deck.data.cards.map((c) =>
            c.id === review[position] ? { ...c, known } : c,
          ),
        },
        deck.id,
        scope,
      );
      position++;
      flipped = false;
      cards();
      showReview();
    } catch (e) {
      status(uiError(e), true);
    }
  };
$("#deck-more").onclick = () => store.load();
$("#deck-retry").onclick = async () => {
  try {
    await store.flush();
    await store.load(true);
    if (deck) await open(deck.id);
  } catch (e) {
    status(uiError(e), true);
  }
};
store.subscribe(list);
async function initialize() {
  const next = owner();
  if (scope !== next) {
    clearTimeout(timer);
    scope = next;
    deck = null;
    dirty = false;
    cardId = null;
    $("#deck-name").value = $("#card-front").value = $("#card-back").value = "";
    $("#card-list").replaceChildren();
    resetReview();
  }
  try {
    await store.ready();
    list();
    await store.flush();
    await store.load(true);
    if (requested && owner() === next) {
      const id = requested;
      requested = null;
      await open(id);
    }
  } catch (e) {
    status(uiError(e), true);
    uiText($("#deck-save-state"), uiError(e));
  }
}
window.addEventListener("workspace-ready", initialize);
window.addEventListener("flashcard-conflict", (e) => {
  if (deck?.id === e.detail.from) {
    deck.id = e.detail.to;
    status(
      uiMsg(
        "Another device changed this deck. Your work was kept in a conflict copy.",
      ),
    );
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) saveEdits();
  else if (deck && !dirty) open(deck.id);
});
window.addEventListener("beforeunload", (e) => {
  if (
    dirty ||
    saving ||
    (!cardId && ($("#card-front").value || $("#card-back").value))
  ) {
    e.preventDefault();
    e.returnValue = "";
  }
});
initialize();
