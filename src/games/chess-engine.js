import { Chess, DEFAULT_POSITION, validateFen } from "../vendor/chess.js";

export const CHESS_VERSION = 1;
export const CHESS_CLOCKS = Object.freeze({
  "5+3": { main: 300000, increment: 3000 },
  "10+5": { main: 600000, increment: 5000 },
  "15+10": { main: 900000, increment: 10000 },
});
export const chessColor = (color) => (color === "w" ? 1 : -1);
export const colorName = (color) => (color === 1 ? "w" : "b");
export function chessSettings(input = {}) {
  const clock = input.clock ?? "none";
  if (clock !== "none" && !Object.hasOwn(CHESS_CLOCKS, clock))
    throw Error("Choose a supported chess time control.");
  return { rule: "fide", size: 8, clock };
}
export function checkedFen(fen) {
  if (typeof fen !== "string" || fen.length > 180 || !validateFen(fen).ok)
    throw Error("Invalid FEN position.");
  const c = new Chess(fen),
    board = c.board().flat().filter(Boolean);
  if (
    board.length > 32 ||
    ["w", "b"].some(
      (color) =>
        board.filter((p) => p.color === color && p.type === "p").length > 8,
    )
  )
    throw Error("Invalid FEN piece count.");
  // 匯入不宣稱證明歷史可達；至少拒絕雙王相鄰及剛走完的一方仍被將軍。
  const kings = board.filter((p) => p.type === "k");
  const [a, b] = kings.map((p) => [
    p.square.charCodeAt(0),
    Number(p.square[1]),
  ]);
  if (
    !a ||
    !b ||
    (Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1) ||
    c.isAttacked(kings.find((p) => p.color !== c.turn()).square, c.turn())
  )
    throw Error("Invalid FEN king position.");
  const fields = fen.split(/\s+/);
  for (const [right, color, rookSquare, kingSquare] of [
    ["K", "w", "h1", "e1"],
    ["Q", "w", "a1", "e1"],
    ["k", "b", "h8", "e8"],
    ["q", "b", "a8", "e8"],
  ])
    if (
      fields[2].includes(right) &&
      (c.get(rookSquare)?.type !== "r" ||
        c.get(rookSquare)?.color !== color ||
        c.get(kingSquare)?.type !== "k" ||
        c.get(kingSquare)?.color !== color)
    )
      throw Error("Invalid FEN castling rights.");
  if (fields[3] !== "-") {
    const square = fields[3][0] + (c.turn() === "w" ? "5" : "4"),
      pawn = c.get(square);
    if (c.get(fields[3]) || pawn?.type !== "p" || pawn.color === c.turn())
      throw Error("Invalid FEN en passant position.");
  }
  return c.fen();
}
export function positionKey(fen) {
  // chess.js 只輸出可合法吃過路兵的目標格；不把無效 EP 權利當成新局面。
  return new Chess(fen).fen().split(" ").slice(0, 4).join(" ");
}
function finish(s, winner, reason) {
  s.phase = "finished";
  s.result = { winner, reason };
  s.offer = null;
  return s;
}
function automaticEnding(s, c) {
  if (c.isCheckmate()) return finish(s, -s.turn, "checkmate");
  if (c.isStalemate()) return finish(s, 0, "stalemate");
  if (c.isInsufficientMaterial()) return finish(s, 0, "dead-material");
  if ((s.repetitions[positionKey(s.fen)] || 0) >= 5)
    return finish(s, 0, "fivefold");
  if (Number(s.fen.split(" ")[4]) >= 150) return finish(s, 0, "seventy-five");
  return s;
}
export function createChess(config = {}, initialFen = DEFAULT_POSITION) {
  const fen = checkedFen(initialFen),
    c = new Chess(fen);
  return automaticEnding(
    {
      game: "chess",
      version: CHESS_VERSION,
      config: chessSettings(config),
      initialFen: fen,
      fen,
      turn: chessColor(c.turn()),
      phase: "playing",
      log: [],
      repetitions: { [positionKey(fen)]: 1 },
      offer: null,
      unresolvedConfirmations: [],
      result: null,
      last: null,
    },
    c,
  );
}
export function chessMoves(state, square) {
  return new Chess(state.fen).moves({
    verbose: true,
    ...(square ? { square } : {}),
  });
}
export function claimsAvailable(state, intendedMove) {
  let fen = state.fen,
    repetitions = state.repetitions[positionKey(fen)] || 0;
  if (intendedMove) {
    const c = new Chess(fen),
      m = c.move(parseUci(intendedMove));
    if (!m) throw Error("Choose a legal intended move.");
    fen = c.fen();
    repetitions = (state.repetitions[positionKey(fen)] || 0) + 1;
  }
  return {
    repetition: repetitions >= 3,
    fifty: Number(fen.split(" ")[4]) >= 100,
  };
}
export function parseUci(uci) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci || ""))
    throw Error("Invalid chess move.");
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    ...(uci[4] ? { promotion: uci[4] } : {}),
  };
}
export function applyChess(input, action, actor = input.turn) {
  if (![1, -1].includes(actor) || !action || typeof action.type !== "string")
    throw Error("Invalid chess action.");
  if (input.phase === "finished" && input.result?.reason !== "unresolved")
    throw Error("This chess game has ended.");
  if (
    input.result?.reason === "unresolved" &&
    !["offer-draw", "accept-draw", "decline-draw"].includes(action.type)
  )
    throw Error("Unresolved positions only allow a mutual draw agreement.");
  if (input.log.length >= 4096)
    throw Error("Chess record limit reached. Export the PGN.");
  const s = structuredClone(input),
    c = new Chess(s.fen),
    entry = { type: action.type, actor };
  switch (action.type) {
    case "move": {
      if (actor !== s.turn) throw Error("Wait for your turn.");
      let m;
      try {
        m = c.move(parseUci(action.uci));
      } catch {
        throw Error("That move is not legal.");
      }
      if (!m) throw Error("That move is not legal.");
      s.fen = c.fen();
      s.turn = chessColor(c.turn());
      s.last = { from: m.from, to: m.to };
      s.reviewRequest = null;
      const key = positionKey(s.fen);
      s.repetitions[key] = (s.repetitions[key] || 0) + 1;
      if (s.offer && s.offer !== actor) s.offer = null;
      Object.assign(entry, {
        uci: m.lan,
        san: m.san,
        captured: m.captured || null,
        flags: m.flags,
      });
      automaticEnding(s, c);
      break;
    }
    case "claim-draw": {
      if (actor !== s.turn)
        throw Error("Only the player to move may claim a draw.");
      const available = claimsAvailable(s, action.uci);
      if (!available.repetition && !available.fifty)
        throw Error("The draw claim is not valid for this position.");
      if (action.uci) entry.uci = action.uci;
      finish(s, 0, available.repetition ? "threefold-claim" : "fifty-claim");
      break;
    }
    case "offer-draw":
      if (s.offer) throw Error("A draw offer is already pending.");
      s.offer = actor;
      break;
    case "accept-draw":
      if (s.offer !== -actor)
        throw Error("There is no opponent draw offer to accept.");
      finish(s, 0, "agreement");
      break;
    case "decline-draw":
      if (s.offer !== -actor)
        throw Error("There is no opponent draw offer to decline.");
      s.offer = null;
      break;
    case "resign":
      finish(s, -actor, "resignation");
      break;
    case "request-review":
      if (s.reviewRequest && s.reviewRequest !== actor)
        finish(s, null, "unresolved");
      else s.reviewRequest = actor;
      break;
    default:
      throw Error("Unknown chess action.");
  }
  s.log.push(entry);
  return s;
}
export function compactChess(s) {
  return {
    game: "chess",
    version: CHESS_VERSION,
    status: s.phase,
    config: s.config,
    initialFen: s.initialFen,
    log: s.log.map(({ type, actor, uci }) => ({
      type,
      actor,
      ...(uci ? { uci } : {}),
    })),
    result: s.result,
  };
}
export function replayChess(saved, count = saved.log.length) {
  let s = createChess(saved.config, saved.initialFen);
  for (const action of saved.log.slice(0, count))
    s = applyChess(s, action, action.actor);
  if (
    count === saved.log.length &&
    saved.result &&
    ["timeout", "unresolved", "disconnect", "interrupted"].includes(
      saved.result.reason,
    )
  ) {
    s.phase = "finished";
    s.result = structuredClone(saved.result);
  }
  return s;
}
export function validateChessSave(data) {
  if (
    data?.game !== "chess" ||
    data.state?.version !== CHESS_VERSION ||
    !["ai", "local"].includes(data.mode) ||
    !Number.isInteger(data.level) ||
    data.level < 1 ||
    data.level > 5 ||
    ![1, -1].includes(data.human) ||
    typeof data.name !== "string" ||
    !data.name.length ||
    data.name.length > 120 ||
    !Array.isArray(data.state.log) ||
    data.state.log.length > 4096 ||
    new TextEncoder().encode(JSON.stringify(data)).length > 256000
  )
    throw Error("Invalid chess save or size over 256 KB.");
  replayChess(data.state);
  return structuredClone(data);
}
export function exportChessPGN(s, names = {}) {
  const c = new Chess(s.initialFen);
  c.setHeader("Event", "KenSei Workshop");
  c.setHeader("White", names.white || "White");
  c.setHeader("Black", names.black || "Black");
  if (s.initialFen !== DEFAULT_POSITION) {
    c.setHeader("SetUp", "1");
    c.setHeader("FEN", s.initialFen);
  }
  for (const a of s.log) if (a.type === "move") c.move(parseUci(a.uci));
  const result =
    !s.result || s.result.winner === null
      ? "*"
      : s.result.winner === 0
        ? "1/2-1/2"
        : s.result.winner === 1
          ? "1-0"
          : "0-1";
  c.setHeader("Result", result);
  c.setHeader(
    "TimeControl",
    s.config.clock === "none"
      ? "-"
      : `${CHESS_CLOCKS[s.config.clock].main / 1000}+${CHESS_CLOCKS[s.config.clock].increment / 1000}`,
  );
  return c.pgn({ maxWidth: 80 });
}
export function importChessPGN(text, config = {}) {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).length > 256000 ||
    /[()]/.test(text.replace(/\{[^}]*\}/g, "")) ||
    (text.match(/\[Event\s/g) || []).length > 1
  )
    throw Error("Import one PGN main line, up to 256 KB, without variations.");
  const c = new Chess();
  c.loadPgn(text);
  const moves = c.history({ verbose: true });
  let s = createChess(config, c.getHeaders().FEN || DEFAULT_POSITION);
  for (const m of moves)
    s = applyChess(s, { type: "move", uci: m.lan }, s.turn);
  return s;
}
export function createChessClock(preset, now) {
  const spec = CHESS_CLOCKS[preset];
  return spec
    ? { preset, remaining: { 1: spec.main, "-1": spec.main }, anchor: now }
    : null;
}
export function chessClockView(clock, color, now, turn, running = true) {
  if (!clock) return { remaining: Infinity, expired: false };
  const remaining = Math.max(
    0,
    clock.remaining[color] -
      (running && turn === color ? Math.max(0, now - clock.anchor) : 0),
  );
  return { remaining, expired: remaining === 0 };
}
export function chargeChessClock(clock, color, now, move = false) {
  if (!clock) return null;
  const view = chessClockView(clock, color, now, color);
  if (view.expired) throw Error("The clock has expired.");
  return {
    ...structuredClone(clock),
    remaining: {
      ...clock.remaining,
      [color]:
        view.remaining + (move ? CHESS_CLOCKS[clock.preset].increment : 0),
    },
    anchor: now,
  };
}

export { Chess, DEFAULT_POSITION };
