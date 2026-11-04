import {
  XiangqiPosition,
  squareIndex,
  sideNumber,
} from "./xiangqi-position.js";

// 獨立實作；算法依據 Tan/Medina (2024), CC BY 4.0，見 docs/xiangqi.md。
// 「有根」是規則概念，不使用 AI 的局面分數。
const rank = { k: 0, p: 1, a: 2, b: 2, n: 4, c: 4, r: 5 };
function crossfirePartners(position, attacker, victim) {
  if (
    position.pieces[attacker]?.type !== "r" ||
    position.pieces[victim]?.type !== "c"
  )
    return [];
  const side = position.pieces[attacker].color,
    captured = position.after(attacker, victim),
    result = [];
  for (let from = 0; from < 90; from++)
    if (
      captured.pieces[from]?.type === "c" &&
      captured.pieces[from].color !== side &&
      captured.legal(from, victim)
    ) {
      const response = captured.after(from, victim);
      for (let other = 0; other < 90; other++)
        if (
          response.pieces[other]?.type === "r" &&
          response.pieces[other].color === side &&
          response.legal(other, victim)
        )
          result.push(response.pieces[other].id);
    }
  return result;
}
export function protectedTarget(position, attacker, victim) {
  const target = position.pieces[victim];
  if (!target) return false;
  const captured = position.after(attacker, victim);
  for (let from = 0; from < 90; from++) {
    const defender = captured.pieces[from];
    if (!defender || defender.color !== target.color) continue;
    // 回吃須真的合法；雙車／雙炮的交叉牽制另按 WXF 的雙捉關係處理。
    if (
      captured.legal(from, victim) &&
      !(
        defender.type === "c" &&
        crossfirePartners(position, attacker, victim).length
      )
    )
      return true;
  }
  return false;
}
export function captureThreat(position, from, to) {
  const attacker = position.pieces[from],
    victim = position.pieces[to];
  if (
    !attacker ||
    !victim ||
    attacker.color === victim.color ||
    ["k", "p"].includes(attacker.type) ||
    victim.type === "k"
  )
    return false;
  const victimRank = 9 - Math.floor(to / 9);
  if (
    victim.type === "p" &&
    (victim.color === "w" ? victimRank <= 4 : victimRank >= 5)
  )
    return false;
  if (!position.legal(from, to)) return false;
  if (attacker.type === victim.type && position.legal(to, from)) return false;
  return (
    rank[victim.type] > rank[attacker.type] ||
    !protectedTarget(position, from, to)
  );
}
export function threats(position, attackerColor) {
  const result = [];
  for (let from = 0; from < 90; from++) {
    const attacker = position.pieces[from];
    if (
      !attacker ||
      attacker.color !== attackerColor ||
      ["k", "p"].includes(attacker.type)
    )
      continue;
    for (const to of position.pseudo(from))
      if (position.pieces[to] && captureThreat(position, from, to))
        result.push([attacker.id, position.pieces[to].id]);
  }
  return result;
}
export function answeredChases(beforeReply, afterReply, pairs) {
  const ids = new Map(
      afterReply.pieces.flatMap((piece, index) =>
        piece ? [[piece.id, index]] : [],
      ),
    ),
    victims = new Set();
  for (const [attacker, victim] of pairs) {
    const from = ids.get(attacker),
      to = ids.get(victim);
    if (to === undefined) continue;
    // 留在原地仍可被同一子吃掉，是送子／閒著，不是假定對方「解捉」。
    if (from === undefined || !captureThreat(afterReply, from, to))
      victims.add(victim);
    else {
      const beforeIds = new Map(
        beforeReply.pieces.flatMap((p, i) => (p ? [[p.id, i]] : [])),
      );
      const crossed =
        crossfirePartners(
          beforeReply,
          beforeIds.get(attacker),
          beforeIds.get(victim),
        ).length || crossfirePartners(afterReply, from, to).length;
      if (
        crossed &&
        afterReply.pieces.some(
          (p, i) =>
            p?.type === "c" &&
            p.color !== afterReply.pieces[from].color &&
            captureThreat(afterReply, i, from),
        )
      )
        victims.add(victim);
    }
  }
  return [...victims];
}
export function positionFrame(
  position,
  move = null,
  actor = null,
  beforeMove = null,
) {
  const check = !!move && position.inCheck();
  let pairs = move && !check ? threats(position, actor === 1 ? "w" : "b") : [];
  if (beforeMove) {
    const ids = new Map(
      beforeMove.pieces.flatMap((p, index) => (p ? [[p.id, index]] : [])),
    );
    // 對方自行送到既有攻擊線，不能算未移動攻子的責任（官方例107）。
    const currentIds = new Map(
      position.pieces.flatMap((p, index) => (p ? [[p.id, index]] : [])),
    );
    pairs = pairs.filter(
      ([attacker, victim]) =>
        attacker === move.id ||
        !captureThreat(beforeMove, ids.get(attacker), ids.get(victim)) ||
        [
          ...crossfirePartners(beforeMove, ids.get(attacker), ids.get(victim)),
          ...crossfirePartners(
            position,
            currentIds.get(attacker),
            currentIds.get(victim),
          ),
        ].includes(move.id),
    );
  }
  return {
    fen: position.fen(),
    key: position.key(),
    pieces: position.pieces,
    move,
    actor,
    check,
    threats: pairs,
    chases: [],
  };
}
export function appendFrame(history, position, move, actor) {
  const frames = history.slice();
  const beforeMove = frames.length
    ? new XiangqiPosition(frames.at(-1).fen, frames.at(-1).pieces)
    : null;
  if (frames.length && frames.at(-1).move) {
    const previous = frames.at(-1),
      before = new XiangqiPosition(previous.fen, previous.pieces);
    frames[frames.length - 1] = {
      ...previous,
      chases: answeredChases(before, position, previous.threats),
    };
  }
  frames.push(positionFrame(position, move, actor, beforeMove));
  return frames;
}
function intersect(a, b) {
  return new Set([...a].filter((value) => b.includes(value)));
}
function defensivePinnedRook(loop, color, common, pursued) {
  const attackers = new Set();
  for (const frame of loop.filter((entry) => entry.actor === color)) {
    const position = new XiangqiPosition(frame.fen, frame.pieces),
      ids = new Map(position.pieces.flatMap((p, i) => (p ? [[p.id, i]] : [])));
    for (const [attacker, victim] of frame.threats)
      if (common.includes(victim) && frame.chases.includes(victim)) {
        attackers.add(attacker);
        for (const id of crossfirePartners(
          position,
          ids.get(attacker),
          ids.get(victim),
        ))
          attackers.add(id);
      }
  }
  if (attackers.size !== 1) return false;
  const id = [...attackers][0];
  if (!pursued.includes(id)) return false;
  return loop.some((frame) => {
    const position = new XiangqiPosition(frame.fen, frame.pieces),
      from = position.pieces.findIndex((p) => p?.id === id);
    if (from < 0 || position.pieces[from].type !== "r") return false;
    const own = position.pieces[from].color,
      without = position.clone();
    without.pieces[from] = null;
    for (let victim = 0; victim < 90; victim++)
      if (common.includes(position.pieces[victim]?.id)) {
        if (
          position.pieces[victim].type === "n" &&
          without.attacks(victim, without.king(own), true)
        )
          return true;
        if (position.pieces[victim].type === "c") {
          const a = (victim % 9) - (from % 9),
            b = Math.floor(victim / 9) - Math.floor(from / 9);
          for (let other = 0; other < 90; other++)
            if (
              other !== victim &&
              position.pieces[other]?.type === "c" &&
              position.pieces[other].color !== own
            ) {
              const c = (other % 9) - (from % 9),
                d = Math.floor(other / 9) - Math.floor(from / 9);
              if (
                (a === 0 && c === 0 && b * d < 0) ||
                (b === 0 && d === 0 && a * c < 0)
              )
                return true;
            }
        }
      }
    return false;
  });
}
// 分離「循環責任」與數位裁判的警告／判負時機；官方判例測試此函數。
export function judgeCycle(frames, start = null) {
  const end = frames.length - 1;
  if (end < 2) return null;
  if (start === null) {
    for (let i = end - 1; i >= 0; i--)
      if (frames[i].key === frames[end].key) {
        start = i;
        break;
      }
  }
  if (start === null || start >= end || frames[start].key !== frames[end].key)
    return null;
  const loop = frames.slice(start + 1),
    firstMove = loop[0]?.move;
  if (!firstMove) return null;
  // 已封閉循環最後一步的應著取自相同局面的下一步，不猜測新的著法。
  let last = loop.at(-1);
  if (!last.check) {
    const closed = new XiangqiPosition(last.fen, last.pieces);
    try {
      const reply = closed.clone();
      reply.move(firstMove.uci);
      last = { ...last, chases: answeredChases(closed, reply, last.threats) };
    } catch {
      return null;
    }
    loop[loop.length - 1] = last;
  }
  const levels = {},
    chased = {};
  for (const color of [1, -1]) {
    const own = loop.filter((entry) => entry.actor === color);
    if (!own.length) return null;
    let common = new Set(own[0].chases);
    for (const entry of own.slice(1)) common = intersect(common, entry.chases);
    levels[color] = own.every((entry) => entry.check)
      ? 2
      : own.every((entry) => !entry.check && entry.chases.length) && common.size
        ? 1
        : 0;
    chased[color] = [...common];
  }
  // 受持續捉拿的被牽制車，其被動反捉不能替對方免責；真正雙方多子互捉除外。
  if (levels[1] === 1 && levels[-1] === 1) {
    const redPassive = defensivePinnedRook(loop, 1, chased[1], chased[-1]);
    const blackPassive = defensivePinnedRook(loop, -1, chased[-1], chased[1]);
    if (redPassive) levels[1] = 0;
    if (blackPassive) levels[-1] = 0;
  }
  const offender =
    levels[1] === levels[-1] ? 0 : levels[1] > levels[-1] ? 1 : -1;
  return {
    offender,
    levels,
    chased,
    reason: offender
      ? levels[offender] === 2
        ? "perpetual-check"
        : "perpetual-chase"
      : "lawful-repetition",
    start,
    end,
  };
}
export function adjudicateRepetition(frames, warning = null) {
  const current = frames.at(-1),
    previous = frames.at(-2);
  if (warning && current?.actor === warning.offender) {
    const transition = `${previous.key}|${current.move.uci}|${current.key}`;
    if (warning.transitions.includes(transition))
      return {
        result: { winner: -warning.offender, reason: warning.reason },
        warning: null,
      };
    warning = null;
  }
  const occurrences = frames.flatMap((entry, i) =>
    entry.key === current.key ? [i] : [],
  );
  // 本站採中文原文：同局面返回三次（共四次出現）後先警告。
  if (occurrences.length < 4) return { warning };
  const start = occurrences.at(-4),
    verdict = judgeCycle(frames, start);
  if (!verdict) return { warning };
  if (!verdict.offender)
    return {
      warning: null,
      ...(occurrences.length >= 5
        ? { result: { winner: 0, reason: "lawful-repetition" } }
        : {}),
    };
  if (warning?.offender === verdict.offender) return { warning };
  const transitions = frames
    .slice(start + 1)
    .flatMap((entry, offset) =>
      entry.actor === verdict.offender
        ? [`${frames[start + offset].key}|${entry.move.uci}|${entry.key}`]
        : [],
    );
  return {
    warning: {
      offender: verdict.offender,
      reason: verdict.reason,
      transitions: [...new Set(transitions)],
    },
  };
}

export function repetitionSequence(fen, moves) {
  const position = new XiangqiPosition(fen);
  let frames = [positionFrame(position)];
  for (const uci of moves) {
    const actor = sideNumber(position.turn()),
      move = position.move(uci);
    frames = appendFrame(frames, position, move, actor);
  }
  return frames;
}
