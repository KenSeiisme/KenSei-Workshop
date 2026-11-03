// 规则层不读取 DOM、网络、时钟或随机数；浏览器与 Edge 共用同一实现。
import GoBoard from "../vendor/sabaki-go.js";
export const GO_VERSION = 1;
export const GO_RULES = Object.freeze({
  chinese: {
    name: "Chinese",
    komi: 7.5,
    scoring: "area",
    ko: "positional",
    source:
      "Chinese Weiqi Rules 2002; published long-cycle no-result supplement",
  },
  japanese: {
    name: "Japanese 1989",
    komi: 6.5,
    scoring: "territory",
    ko: "simple",
    source:
      "Japanese Rules of Go 1989, with agreement / unresolved adjudication",
  },
  aga: {
    name: "AGA",
    komi: 7.5,
    scoring: "area",
    ko: "situational",
    source: "AGA 1991; 7.5-point tournament komi preset",
  },
});
export const CLOCKS = Object.freeze({
  9: { main: 300000, periods: 3, period: 20000 },
  13: { main: 600000, periods: 3, period: 30000 },
  19: { main: 1200000, periods: 5, period: 30000 },
});
const fail = (code) => {
  throw Error(code);
};
export function settings(input = {}) {
  const rule = input.rule ?? "chinese",
    size = Number(input.size ?? 9),
    handicap = Number(input.handicap ?? 0),
    komi = Number(input.komi ?? GO_RULES[rule]?.komi),
    clock = Number(input.clock ?? size);
  if (
    typeof rule !== "string" ||
    !Object.hasOwn(GO_RULES, rule) ||
    ![9, 13, 19].includes(size) ||
    !Number.isInteger(handicap) ||
    handicap < 0 ||
    handicap > 9 ||
    !Number.isFinite(komi) ||
    Math.abs(komi) > 100 ||
    komi * 2 !== Math.round(komi * 2) ||
    !CLOCKS[clock]
  )
    fail("Invalid Go settings.");
  return {
    version: GO_VERSION,
    rule,
    size,
    handicap,
    komi,
    clock,
    training: input.training === true,
  };
}
export function standard(input) {
  const c = settings(input);
  return !c.training && c.handicap === 0 && c.komi === GO_RULES[c.rule].komi;
}
export function handicapPoints(size, count) {
  if (count < 2) return [];
  const a = size === 9 ? 2 : 3,
    z = size - 1 - a,
    m = (size - 1) / 2;
  const corners = [
    [z, a],
    [a, z],
    [z, z],
    [a, a],
  ];
  if (count === 2) return corners.slice(0, 2);
  if (count === 3) return corners.slice(0, 3);
  let result = [...corners];
  if (count === 5) return [...result, [m, m]];
  if (count >= 6) result.push([a, m], [z, m]);
  if (count === 7) return [...result, [m, m]];
  if (count >= 8) result.push([m, a], [m, z]);
  if (count === 9) result.push([m, m]);
  return result;
}
// 每三个交点编码成一个字符，精确保留局面而非使用可能碰撞的短哈希。
export function positionKey(board, turn = 0) {
  let key = "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabc";
  for (let i = 0; i < board.length; i += 3)
    key +=
      alphabet[
        (board[i] + 1) * 9 +
          ((board[i + 1] ?? -1) + 1) * 3 +
          ((board[i + 2] ?? -1) + 1)
      ];
  return key + ":" + turn;
}
export function createGo(input = {}) {
  const config = settings(input),
    board = Array(config.size ** 2).fill(0);
  for (const [x, y] of handicapPoints(config.size, config.handicap))
    board[y * config.size + x] = 1;
  const turn = config.handicap >= 2 ? -1 : 1;
  return {
    game: "go",
    version: GO_VERSION,
    config,
    board,
    turn,
    captures: { 1: 0, "-1": 0 },
    passStones: { 1: 0, "-1": 0 },
    phase: "playing",
    passes: 0,
    ply: 0,
    last: null,
    lastColor: null,
    ko: null,
    history: [{ p: positionKey(board), s: positionKey(board, turn) }],
    log: [],
    proposal: { dead: [], seki: [], confirmations: [] },
    result: null,
    cycle: false,
  };
}
const native = (s) =>
  new GoBoard(
    Array.from({ length: s.config.size }, (_, y) =>
      s.board.slice(y * s.config.size, (y + 1) * s.config.size),
    ),
  );
export function groupAt(s, index) {
  if (!Number.isInteger(index) || !s.board[index]) return [];
  const n = s.config.size;
  return native(s)
    .getChain([index % n, Math.floor(index / n)])
    .map(([x, y]) => y * n + x)
    .sort((a, b) => a - b);
}
export function liberties(s, index) {
  const n = s.config.size;
  return native(s)
    .getLiberties([index % n, Math.floor(index / n)])
    .map(([x, y]) => y * n + x);
}
export function tryMove(s, index, { allowRepetition = false } = {}) {
  const n = s.config.size;
  if (s.phase !== "playing") fail("The board is not accepting moves.");
  if (!Number.isInteger(index) || index < 0 || index >= n * n)
    fail("Choose an intersection on the board.");
  if (s.board[index]) fail("That intersection is occupied.");
  if (s.ko === index) fail("Immediate ko recapture is not legal.");
  let next;
  try {
    next = native(s).makeMove(s.turn, [index % n, Math.floor(index / n)], {
      preventOverwrite: true,
      preventSuicide: true,
      preventKo: true,
    });
  } catch {
    fail(
      "Suicide is not legal. Capture the surrounding stones or choose another point.",
    );
  }
  const board = next.signMap.flat(),
    p = positionKey(board),
    situational = positionKey(board, -s.turn),
    captured = next.getCaptures(s.turn);
  if (
    !allowRepetition &&
    s.config.rule === "chinese" &&
    s.history.some((h) => h.p === p)
  )
    fail("Positional superko: this board position has already occurred.");
  if (
    !allowRepetition &&
    s.config.rule === "aga" &&
    s.history.some((h) => h.s === situational)
  )
    fail(
      "Situational superko: this board and player-to-move have already occurred.",
    );
  const lost = s.board.flatMap((v, i) =>
    v === -s.turn && board[i] === 0 ? [i] : [],
  );
  const ko =
    captured === 1 &&
    next.getChain([index % n, Math.floor(index / n)]).length === 1 &&
    next.getLiberties([index % n, Math.floor(index / n)]).length === 1
      ? lost[0]
      : null;
  return { board, p, s: situational, captured, ko };
}
export function legalMoves(s) {
  const result = [];
  if (s.phase !== "playing") return result;
  for (let i = 0; i < s.board.length; i++)
    if (!s.board[i]) {
      try {
        tryMove(s, i);
        result.push(i);
      } catch {}
    }
  return result;
}
function groups(s, values) {
  if (
    !Array.isArray(values) ||
    values.length > s.board.length ||
    values.some(
      (i) =>
        !Number.isInteger(i) || i < 0 || i >= s.board.length || !s.board[i],
    )
  )
    fail("Select existing stone groups.");
  return [...new Set(values.flatMap((i) => groupAt(s, i)))].sort(
    (a, b) => a - b,
  );
}
export function scoreGo(s, proposal = s.proposal) {
  const dead = new Set(groups(s, proposal.dead)),
    seki = new Set(groups(s, proposal.seki));
  if ([...dead].some((i) => seki.has(i)))
    fail("A group cannot be both dead and in seki.");
  const board = s.board.map((v, i) => (dead.has(i) ? 0 : v)),
    n = s.config.size,
    visited = new Set(),
    territory = { 1: 0, "-1": 0 },
    stones = { 1: 0, "-1": 0 },
    removed = { 1: 0, "-1": 0 };
  let neutral = 0;
  for (let i = 0; i < board.length; i++) {
    if (s.board[i] && dead.has(i)) removed[-s.board[i]]++;
    if (board[i]) {
      stones[board[i]]++;
      continue;
    }
    if (visited.has(i)) continue;
    const region = [i],
      border = new Set();
    let touchesSeki = false;
    visited.add(i);
    for (let k = 0; k < region.length; k++) {
      const at = region[k],
        x = at % n,
        y = Math.floor(at / n);
      for (const j of [
        x > 0 ? at - 1 : -1,
        x + 1 < n ? at + 1 : -1,
        y > 0 ? at - n : -1,
        y + 1 < n ? at + n : -1,
      ].filter((j) => j >= 0)) {
        if (board[j]) {
          border.add(board[j]);
          if (seki.has(j)) touchesSeki = true;
        } else if (!visited.has(j)) {
          visited.add(j);
          region.push(j);
        }
      }
    }
    if (border.size === 1 && !(s.config.rule === "japanese" && touchesSeki))
      territory[[...border][0]] += region.length;
    else neutral += region.length;
  }
  const area = GO_RULES[s.config.rule].scoring === "area",
    handicapCompensation =
      s.config.rule === "aga" ? Math.max(0, s.config.handicap - 1) : 0;
  const prisoners = {
    1: s.captures[1] + removed[1] + s.passStones[1],
    "-1": s.captures[-1] + removed[-1] + s.passStones[-1],
  };
  const black = territory[1] + (area ? stones[1] : prisoners[1]),
    white =
      territory[-1] +
      (area ? stones[-1] + handicapCompensation : prisoners[-1]) +
      s.config.komi;
  return {
    method: area ? "area" : "territory",
    black,
    white,
    margin: Math.abs(black - white),
    winner: black === white ? 0 : black > white ? 1 : -1,
    territory,
    stones,
    prisoners,
    neutral,
    komi: s.config.komi,
    handicapCompensation,
  };
}
export function applyGo(source, action, actor = source.turn) {
  const s = structuredClone(source);
  if (![1, -1].includes(actor) || !action || typeof action.type !== "string")
    fail("Invalid Go action.");
  if (s.phase === "finished") fail("This game has already ended.");
  const type = action.type;
  const fields = ["move", "claim-cycle"].includes(type)
    ? ["type", "index", "actor"]
    : type === "mark"
      ? ["type", "dead", "seki", "actor"]
      : ["type", "actor"];
  if (Object.keys(action).some((k) => !fields.includes(k)))
    fail("Invalid Go action.");
  if (["move", "pass"].includes(type)) {
    if (s.phase !== "playing" || actor !== s.turn) fail("Wait for your turn.");
    if (s.log.length >= 8192)
      fail(
        "The move record is full. Export the record; this game requires adjudication.",
      );
    if (type === "move") {
      const m = tryMove(s, action.index);
      s.board = m.board;
      s.ko = m.ko;
      s.captures[actor] += m.captured;
      s.last = action.index;
      s.passes = 0;
      if (
        s.config.rule === "japanese" &&
        s.history.filter((h) => h.p === m.p && !h.pass).length >= 2
      )
        s.cycle = true;
      s.history.push({ p: m.p, s: m.s, captured: m.captured });
    } else {
      s.ko = null;
      s.last = null;
      s.passes++;
      if (s.config.rule === "aga") s.passStones[-actor]++;
      s.history.push({
        p: positionKey(s.board),
        s: positionKey(s.board, -actor),
        pass: true,
      });
    }
    s.lastColor = actor;
    s.turn = -actor;
    s.ply++;
    if (s.passes >= 2) {
      // AGA 要求白方最后停着；第三次停着也交一子，不伪造玩家操作。
      if (!(s.config.rule === "aga" && actor === 1)) s.phase = "scoring";
    }
    s.proposal = { dead: [], seki: [], confirmations: [] };
  } else if (type === "peek") {
    if (!s.config.training) fail("Invalid Go action.");
    s.peeks ||= { 1: 0, "-1": 0 };
    s.peeks[actor]++;
  } else if (type === "resign") {
    s.phase = "finished";
    s.result = { winner: -actor, reason: "resignation" };
  } else if (type === "mark") {
    if (s.phase !== "scoring" && s.phase !== "disputed")
      fail("Mark stones after both players pass.");
    s.proposal = {
      dead: groups(s, action.dead || []),
      seki: groups(s, action.seki || []),
      confirmations: [],
    };
    scoreGo(s);
    s.phase = "scoring";
  } else if (type === "confirm") {
    if (s.phase !== "scoring")
      fail("Resolve the scoring dispute before confirming.");
    if (!s.proposal.confirmations.includes(actor))
      s.proposal.confirmations.push(actor);
    if (s.proposal.confirmations.length === 2) {
      s.result = { ...scoreGo(s), reason: "agreement" };
      s.phase = "finished";
    }
  } else if (type === "dispute") {
    if (s.phase !== "scoring") fail("There is no scoring proposal to dispute.");
    s.phase = "disputed";
    s.proposal.confirmations = [];
  } else if (type === "resume") {
    if (!["scoring", "disputed"].includes(s.phase))
      fail("The game has not stopped for scoring.");
    // 日本第9条：请求续弈者的对手先行；中国死棋主张方先行。
    s.turn =
      s.config.rule === "japanese"
        ? -actor
        : s.config.rule === "chinese"
          ? actor
          : -s.lastColor;
    s.phase = "playing";
    s.passes = 0;
    s.ko = null;
    s.proposal = { dead: [], seki: [], confirmations: [] };
  } else if (type === "claim-cycle") {
    if (
      s.config.rule !== "chinese" ||
      actor !== s.turn ||
      s.phase !== "playing"
    )
      fail("No recorded repeating cycle is available for this agreement.");
    const m = tryMove(s, action.index, { allowRepetition: true });
    const at = s.history.findLastIndex((h) => h.p === m.p);
    const cycle = at < 0 ? [] : s.history.slice(at + 1);
    if (
      cycle.length < 5 ||
      cycle.some((h) => h.pass || !h.captured) ||
      !m.captured
    )
      fail("No recorded repeating cycle is available for this agreement.");
    s.cycle = true;
    s.phase = "disputed";
    s.proposal.confirmations = [];
  } else if (type === "no-result") {
    if (!s.cycle || s.config.rule === "aga")
      fail("No recorded repeating cycle is available for this agreement.");
    s.phase = "disputed";
    s.voidConfirmations ||= [];
    if (!s.voidConfirmations.includes(actor)) s.voidConfirmations.push(actor);
    if (s.voidConfirmations.length === 2) {
      s.phase = "finished";
      s.result = { winner: null, reason: "no-result" };
    }
  } else if (type === "both-lose") {
    if (s.config.rule !== "japanese" || s.phase !== "disputed")
      fail("Resolve the scoring dispute before confirming.");
    s.bothLoseConfirmations ||= [];
    if (!s.bothLoseConfirmations.includes(actor))
      s.bothLoseConfirmations.push(actor);
    if (s.bothLoseConfirmations.length === 2) {
      s.phase = "finished";
      s.result = { winner: null, reason: "both-lose" };
    }
  } else fail("Unknown Go action.");
  s.log.push({ ...action, actor });
  return s;
}
// 日本第7条2項の確認用仮想盤。実戦の石・提子・ログを変更しない。
export function createJapaneseConfirmation(source, turn = 1) {
  if (
    source.config.rule !== "japanese" ||
    !["scoring", "disputed"].includes(source.phase)
  )
    fail("The game has not stopped for scoring.");
  return {
    ...structuredClone(source),
    phase: "playing",
    turn,
    ko: null,
    blockedKo: { 1: [], "-1": [] },
    captures: { 1: 0, "-1": 0 },
    passes: 0,
    log: [],
    history: [],
    confirmationOnly: true,
  };
}
export function applyJapaneseConfirmation(source, action) {
  if (!source.confirmationOnly) fail("Invalid Go action.");
  const s = structuredClone(source),
    actor = s.turn;
  if (action.type === "pass-ko") {
    if (
      !Number.isInteger(action.index) ||
      !s.blockedKo[actor].includes(action.index)
    )
      fail("No recorded repeating cycle is available for this agreement.");
    s.blockedKo[actor] = s.blockedKo[actor].filter((i) => i !== action.index);
    s.turn = -actor;
    s.ko = null;
    return s;
  }
  if (action.type !== "move" || s.blockedKo[actor].includes(action.index))
    fail("Immediate ko recapture is not legal.");
  const move = tryMove(s, action.index);
  s.board = move.board;
  s.captures[actor] += move.captured;
  if (move.ko !== null && !s.blockedKo[-actor].includes(move.ko))
    s.blockedKo[-actor].push(move.ko);
  s.turn = -actor;
  s.ko = null;
  return s;
}
export function replayGo(config, log) {
  if (!Array.isArray(log) || log.length > 8192) fail("Invalid Go move record.");
  return log.reduce((s, a) => applyGo(s, a, a.actor), createGo(config));
}
export function compactGo(s) {
  return {
    game: "go",
    version: GO_VERSION,
    difficulty: `${s.config.rule}-${s.config.size}`,
    status: s.phase === "finished" ? "won" : "playing",
    config: s.config,
    log: s.log,
  };
}
export function validateGoSave(data) {
  if (new TextEncoder().encode(JSON.stringify(data)).length > 240000)
    fail("Go save is too large. Download SGF before leaving.");
  if (
    data?.game !== "go" ||
    typeof data.name !== "string" ||
    data.name.length < 1 ||
    data.name.length > 120 ||
    !data.state?.config ||
    !Array.isArray(data.state.log)
  )
    fail("Invalid Go save.");
  const state = replayGo(data.state.config, data.state.log);
  const mode = data.mode === "local" ? "local" : "ai",
    level = [1, 2, 3].includes(data.level) ? data.level : 1;
  const practiceClock = Object.fromEntries(
    [1, -1].map((color) => [
      color,
      Number.isFinite(data.practice_clock?.[color]) &&
      data.practice_clock[color] >= 0
        ? data.practice_clock[color]
        : 0,
    ]),
  );
  return {
    game: "go",
    difficulty: `${state.config.rule}-${state.config.size}`,
    name: data.name,
    state: compactGo(state),
    mode,
    level,
    human: data.human === -1 ? -1 : 1,
    elapsed: practiceClock[1] + practiceClock[-1],
    practice_clock: practiceClock,
    best: null,
    peeks: Math.max(0, Number(data.peeks) || 0),
  };
}
const sgfEscape = (v) => String(v).replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
export function exportSGF(s, names = {}) {
  const point = (i) =>
    String.fromCharCode(
      97 + (i % s.config.size),
      97 + Math.floor(i / s.config.size),
    );
  const result = !s.result
    ? "?"
    : s.result.winner === null
      ? "Void"
      : s.result.winner === 0
        ? "0"
        : `${s.result.winner === 1 ? "B" : "W"}+${s.result.reason === "agreement" ? s.result.margin : s.result.reason === "resignation" ? "R" : s.result.reason === "timeout" ? "T" : "F"}`;
  let out = `(;GM[1]FF[4]CA[UTF-8]AP[KenSei Workshop:Go-v1]SZ[${s.config.size}]RU[${GO_RULES[s.config.rule].name}]KM[${s.config.komi}]HA[${s.config.handicap}]PB[${sgfEscape(names.black || "Black")}]PW[${sgfEscape(names.white || "White")}]RE[${result}]`;
  const points = handicapPoints(s.config.size, s.config.handicap);
  if (points.length)
    out +=
      "AB" +
      points.map(([x, y]) => `[${point(y * s.config.size + x)}]`).join("") +
      "PL[W]";
  else if (s.config.handicap === 1)
    out += "PL[B]C[No-komi first-player handicap]";
  for (const a of s.log) {
    if (a.type === "move" || a.type === "pass")
      out += `;${a.actor === 1 ? "B" : "W"}[${a.type === "pass" ? "" : point(a.index)}]`;
    else out += `;C[${sgfEscape(a.type)}]`;
  }
  return out + ")";
}
