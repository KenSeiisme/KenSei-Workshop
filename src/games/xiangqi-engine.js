import {
  XIANGQI_START,
  XiangqiPosition,
  checkedXiangqiFen,
  sideNumber,
  squareIndex,
} from "./xiangqi-position.js";
import {
  positionFrame,
  appendFrame,
  adjudicateRepetition,
} from "./xiangqi-repetition.js";
export { XiangqiPosition, XIANGQI_START, squareIndex };
export {
  FISCHER_CLOCKS as XIANGQI_CLOCKS,
  createFischerClock as createXiangqiClock,
  chargeFischerClock as chargeXiangqiClock,
  fischerClockView as xiangqiClockView,
} from "./fischer-clock.js";
import { FISCHER_CLOCKS } from "./fischer-clock.js";
export const XIANGQI_VERSION = 1;
export function xiangqiSettings(input = {}) {
  const clock = input.clock ?? "none";
  if (
    (input.rule !== undefined && input.rule !== "wxf2018") ||
    (input.size !== undefined && input.size !== 9) ||
    (input.width !== undefined && input.width !== 9) ||
    (input.height !== undefined && input.height !== 10)
  )
    throw Error("Use WXF 2018 on the standard 9 × 10 board.");
  if (clock !== "none" && !Object.hasOwn(FISCHER_CLOCKS, clock))
    throw Error("Choose a supported Xiangqi time control.");
  return { rule: "wxf2018", size: 9, width: 9, height: 10, clock };
}
const finish = (state, winner, reason) =>
  Object.assign(state, {
    phase: "finished",
    result: { winner, reason },
    offer: null,
    warning: null,
  });
function boardEnding(state, position, checkNatural = true) {
  const moves = position.moves();
  if (!moves.length)
    return finish(
      state,
      -state.turn,
      position.inCheck() ? "checkmate" : "stalemate-loss",
    );
  if (
    !position.pieces.some(
      (piece) => piece && ["r", "n", "c", "p"].includes(piece.type),
    )
  )
    return finish(state, 0, "no-attacking-material");
  if (
    checkNatural &&
    [1, -1].some(
      (side) =>
        state.naturalPlies - Math.max(0, state.checks[side] - 10) >= 100,
    )
  )
    return finish(state, 0, "natural-limit");
  return state;
}
export function createXiangqi(config = {}, initialFen = XIANGQI_START) {
  const fen = checkedXiangqiFen(initialFen),
    position = new XiangqiPosition(fen);
  return boardEnding(
    {
      game: "xiangqi",
      version: XIANGQI_VERSION,
      config: xiangqiSettings(config),
      initialFen: fen,
      fen,
      pieces: position.pieces,
      turn: sideNumber(position.turn()),
      phase: "playing",
      log: [],
      frames: [positionFrame(position)],
      naturalPlies: 0,
      checks: { 1: 0, "-1": 0 },
      offer: null,
      warning: null,
      result: null,
      last: null,
    },
    position,
    false,
  );
}
export function xiangqiMoves(state, square) {
  return new XiangqiPosition(state.fen, state.pieces).moves({ square });
}
export function applyXiangqi(input, action, actor = input.turn) {
  if (![1, -1].includes(actor) || !action || typeof action.type !== "string")
    throw Error("Invalid Xiangqi action.");
  if (input.phase !== "playing") throw Error("This Xiangqi game has ended.");
  if (input.log.length >= 4096)
    throw Error("Xiangqi record limit reached. Export the record.");
  const state = {
      ...input,
      log: input.log.slice(),
      checks: { ...input.checks },
    },
    entry = { type: action.type, actor };
  switch (action.type) {
    case "move": {
      if (actor !== input.turn) throw Error("Wait for your turn.");
      const position = new XiangqiPosition(input.fen, input.pieces),
        move = position.move(action.uci);
      Object.assign(entry, move);
      Object.assign(state, {
        fen: position.fen(),
        pieces: position.pieces,
        turn: sideNumber(position.turn()),
        last: { from: move.from, to: move.to },
      });
      if (move.captured) {
        state.naturalPlies = 0;
        state.checks = { 1: 0, "-1": 0 };
        state.frames = [positionFrame(position)];
        state.warning = null;
      } else {
        state.naturalPlies++;
        if (position.inCheck()) state.checks[actor]++;
        state.frames = appendFrame(input.frames, position, move, actor);
      }
      if (state.offer && state.offer !== actor) state.offer = null;
      boardEnding(state, position, false);
      if (state.phase === "playing" && !move.captured) {
        const decision = adjudicateRepetition(state.frames, state.warning);
        state.warning = decision.warning || null;
        if (decision.result)
          finish(state, decision.result.winner, decision.result.reason);
      }
      if (state.phase === "playing") boardEnding(state, position);
      if (state.result?.reason === "checkmate")
        entry.san = entry.san.replace(/\+$/, "") + "#";
      break;
    }
    case "offer-draw":
      if (state.offer) throw Error("A draw offer is already pending.");
      state.offer = actor;
      break;
    case "accept-draw":
      if (state.offer !== -actor)
        throw Error("There is no opponent draw offer to accept.");
      finish(state, 0, "agreement");
      break;
    case "decline-draw":
      if (state.offer !== -actor)
        throw Error("There is no opponent draw offer to decline.");
      state.offer = null;
      break;
    case "resign":
      finish(state, -actor, "resignation");
      break;
    default:
      throw Error("Unknown Xiangqi action.");
  }
  state.log.push(entry);
  return state;
}
export function compactXiangqi(state) {
  return {
    game: "xiangqi",
    version: XIANGQI_VERSION,
    status: state.phase,
    config: state.config,
    initialFen: state.initialFen,
    log: state.log.map(({ type, actor, uci }) => ({
      type,
      actor,
      ...(uci ? { uci } : {}),
    })),
    result: state.result,
  };
}
export function replayXiangqi(saved, count = saved?.log?.length) {
  if (
    saved?.game !== "xiangqi" ||
    saved.version !== XIANGQI_VERSION ||
    !Array.isArray(saved.log) ||
    saved.log.length > 4096 ||
    !Number.isInteger(count) ||
    count < 0 ||
    count > saved.log.length
  )
    throw Error("Invalid Xiangqi record.");
  let state = createXiangqi(saved.config, saved.initialFen);
  for (const action of saved.log.slice(0, count))
    state = applyXiangqi(state, action, action.actor);
  if (
    count === saved.log.length &&
    saved.result &&
    ["timeout", "disconnect", "interrupted", "imported"].includes(
      saved.result.reason,
    )
  ) {
    if (
      ![1, -1, 0, null].includes(saved.result.winner) ||
      state.phase === "finished" ||
      (saved.result.reason === "interrupted"
        ? saved.result.winner !== null
        : saved.result.reason !== "imported" && saved.result.winner === 0)
    )
      throw Error("Invalid Xiangqi result.");
    finish(state, saved.result.winner, saved.result.reason);
  }
  return state;
}
export function validateXiangqiSave(data) {
  if (
    data?.game !== "xiangqi" ||
    data.state?.version !== XIANGQI_VERSION ||
    !["ai", "local"].includes(data.mode) ||
    !Number.isInteger(data.level) ||
    data.level < 1 ||
    data.level > 5 ||
    ![1, -1].includes(data.human) ||
    typeof data.name !== "string" ||
    !data.name.trim().length ||
    data.name.length > 120 ||
    new TextEncoder().encode(JSON.stringify(data)).length > 256000
  )
    throw Error("Invalid Xiangqi save or size over 256 KB.");
  const state = replayXiangqi(data.state);
  if (
    data.clock &&
    (data.clock.preset !== state.config.clock ||
      !Number.isFinite(data.clock.anchor) ||
      [1, -1].some(
        (color) =>
          !Number.isFinite(data.clock.remaining?.[color]) ||
          data.clock.remaining[color] < 0 ||
          data.clock.remaining[color] > 86400000,
      ))
  )
    throw Error("Invalid saved Xiangqi clock.");
  return structuredClone(data);
}
const resultCode = (state) =>
  !state.result || state.result.winner === null
    ? "*"
    : state.result.winner === 0
      ? "1/2-1/2"
      : state.result.winner === 1
        ? "1-0"
        : "0-1";
export function exportXiangqiText(state, names = {}) {
  const tags = {
    Game: "Xiangqi",
    Site: "KenSei Workshop",
    Rules: "WXF2018-Kensei-v1",
    Coordinates: "ICCS a0-i9",
    Red: names.red || names.white || "Red",
    Black: names.black || "Black",
    FEN: state.initialFen,
    TimeControl: state.config.clock,
    Result: resultCode(state),
  };
  const moves = state.log
    .filter((a) => a.type === "move")
    .map(
      (a, i) => `${i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ""}${a.uci}`,
    );
  return (
    Object.entries(tags)
      .map(([key, value]) => `[${key} ${JSON.stringify(value)}]`)
      .join("\n") +
    "\n\n" +
    moves.join(" ") +
    " " +
    resultCode(state) +
    "\n"
  );
}
export function exportXiangqiJSON(state, names = {}) {
  return JSON.stringify(
    {
      format: "kensei-xiangqi",
      ...compactXiangqi(state),
      players: {
        red: names.red || names.white || "Red",
        black: names.black || "Black",
      },
    },
    null,
    2,
  );
}
export function importXiangqiRecord(text, config = {}) {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).length > 256000
  )
    throw Error("Import one Xiangqi record up to 256 KB.");
  const value = text.trim();
  if (value.startsWith("{")) {
    const saved = JSON.parse(value);
    return replayXiangqi(saved.state || saved);
  }
  if (!value.startsWith("[")) return createXiangqi(config, value);
  const tags = {};
  for (const match of value.matchAll(/^\[(\w+)\s+("(?:[^"\\]|\\.)*")\]\s*$/gm))
    tags[match[1]] = JSON.parse(match[2]);
  if (tags.Game !== "Xiangqi" || tags.Coordinates !== "ICCS a0-i9")
    throw Error("Use an ICCS a0-i9 Xiangqi text record.");
  let state = createXiangqi(config, tags.FEN || XIANGQI_START);
  const body = value
    .replace(/^\[.*\]\s*$/gm, "")
    .replace(/\b\d+\./g, " ")
    .trim();
  for (const token of body.split(/\s+/)) {
    if (["*", "1-0", "0-1", "1/2-1/2"].includes(token)) continue;
    if (!/^[a-i][0-9][a-i][0-9]$/.test(token))
      throw Error("Invalid ICCS move in record.");
    state = applyXiangqi(state, { type: "move", uci: token });
  }
  if (
    state.phase === "playing" &&
    ["1-0", "0-1", "1/2-1/2"].includes(tags.Result)
  )
    finish(
      state,
      tags.Result === "1-0" ? 1 : tags.Result === "0-1" ? -1 : 0,
      "imported",
    );
  return state;
}
export function xiangqiTimeouts(state) {
  return {
    1: { winner: -1, reason: "timeout" },
    "-1": { winner: 1, reason: "timeout" },
  };
}
