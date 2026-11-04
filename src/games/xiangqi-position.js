// 象棋座標使用 ICCS：紅方底線為 0，黑方底線為 9。
export const XIANGQI_START =
  "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
export const squareIndex = (square) =>
  /^[a-i][0-9]$/.test(square || "")
    ? (9 - Number(square[1])) * 9 + square.charCodeAt(0) - 97
    : -1;
export const squareName = (index) =>
  String.fromCharCode(97 + (index % 9)) + (9 - Math.floor(index / 9));
export const sideNumber = (color) => (color === "w" ? 1 : -1);
export const sideCode = (color) => (color === 1 ? "w" : "b");
const palace = (x, y, color) =>
  x >= 3 && x <= 5 && (color === "w" ? y >= 0 && y <= 2 : y >= 7 && y <= 9);
const point = (index) => [index % 9, 9 - Math.floor(index / 9)];
const at = (x, y) =>
  x >= 0 && x < 9 && y >= 0 && y < 10 ? (9 - y) * 9 + x : -1;
export class XiangqiPosition {
  constructor(fen = XIANGQI_START, pieces = null) {
    if (typeof fen !== "string" || fen.length > 220)
      throw Error("Invalid Xiangqi FEN.");
    const fields = fen.trim().split(/\s+/),
      ranks = fields[0].split("/");
    if (ranks.length !== 10 || !["w", "b"].includes(fields[1]))
      throw Error("Invalid Xiangqi FEN.");
    this.pieces = [];
    for (const rank of ranks) {
      let width = 0;
      for (const ch of rank) {
        if (/^[1-9]$/.test(ch)) {
          for (let n = 0; n < Number(ch); n++) this.pieces.push(null);
          width += Number(ch);
        } else {
          let type = ch.toLowerCase();
          if (type === "h") type = "n";
          if (type === "e") type = "b";
          if (!"rnbakcp".includes(type))
            throw Error("Invalid Xiangqi FEN piece.");
          const color = ch === ch.toUpperCase() ? "w" : "b";
          this.pieces.push({
            type,
            color,
            id: `${color}${type}:${this.pieces.length}`,
          });
          width++;
        }
      }
      if (width !== 9) throw Error("Xiangqi FEN requires nine files per rank.");
    }
    if ((fields[2] && fields[2] !== "-") || (fields[3] && fields[3] !== "-"))
      throw Error("Xiangqi has no castling or en passant rights.");
    this.color = fields[1];
    this.halfmove = Number(fields[4] || 0);
    this.fullmove = Number(fields[5] || 1);
    if (
      !Number.isSafeInteger(this.halfmove) ||
      this.halfmove < 0 ||
      !Number.isSafeInteger(this.fullmove) ||
      this.fullmove < 1
    )
      throw Error("Invalid Xiangqi FEN counters.");
    if (pieces) {
      if (
        !Array.isArray(pieces) ||
        pieces.length !== 90 ||
        pieces.some(
          (p, i) =>
            !!p !== !!this.pieces[i] ||
            (p &&
              (p.color !== this.pieces[i].color ||
                p.type !== this.pieces[i].type ||
                typeof p.id !== "string")),
        )
      )
        throw Error("Invalid Xiangqi piece identity.");
      this.pieces = pieces.map((p) => (p ? { ...p } : null));
    }
  }
  clone() {
    const result = Object.create(XiangqiPosition.prototype);
    Object.assign(result, this, {
      pieces: this.pieces.map((p) => (p ? { ...p } : null)),
    });
    return result;
  }
  turn() {
    return this.color;
  }
  get(square) {
    return this.pieces[squareIndex(square)] || null;
  }
  board() {
    return Array.from({ length: 10 }, (_, row) =>
      this.pieces.slice(row * 9, row * 9 + 9),
    );
  }
  fen() {
    const ranks = [];
    for (let row = 0; row < 10; row++) {
      let rank = "",
        empty = 0;
      for (let file = 0; file < 9; file++) {
        const piece = this.pieces[row * 9 + file];
        if (!piece) empty++;
        else {
          if (empty) rank += empty;
          empty = 0;
          rank += piece.color === "w" ? piece.type.toUpperCase() : piece.type;
        }
      }
      if (empty) rank += empty;
      ranks.push(rank);
    }
    return `${ranks.join("/")} ${this.color} - - ${this.halfmove} ${this.fullmove}`;
  }
  key() {
    return this.fen().split(" ").slice(0, 2).join(" ");
  }
  king(color) {
    return this.pieces.findIndex((p) => p?.type === "k" && p.color === color);
  }
  attacks(from, to, capture = true) {
    if (from < 0 || to < 0 || from === to) return false;
    const piece = this.pieces[from];
    if (!piece) return false;
    const [x, y] = point(from),
      [u, v] = point(to),
      dx = u - x,
      dy = v - y;
    const ax = Math.abs(dx),
      ay = Math.abs(dy),
      direction = piece.color === "w" ? 1 : -1;
    switch (piece.type) {
      case "k":
        if (
          x === u &&
          this.pieces[to]?.type === "k" &&
          this.pieces[to]?.color !== piece.color
        ) {
          for (let row = y + Math.sign(dy); row !== v; row += Math.sign(dy))
            if (this.pieces[at(x, row)]) return false;
          return true;
        }
        return ax + ay === 1 && palace(u, v, piece.color);
      case "a":
        return ax === 1 && ay === 1 && palace(u, v, piece.color);
      case "b":
        return (
          ax === 2 &&
          ay === 2 &&
          (piece.color === "w" ? v <= 4 : v >= 5) &&
          !this.pieces[at(x + dx / 2, y + dy / 2)]
        );
      case "n":
        return (
          ax * ay === 2 &&
          !this.pieces[
            at(
              x + (ax === 2 ? Math.sign(dx) : 0),
              y + (ay === 2 ? Math.sign(dy) : 0),
            )
          ]
        );
      case "p":
        return (
          (dx === 0 && dy === direction) ||
          (dy === 0 && ax === 1 && (piece.color === "w" ? y >= 5 : y <= 4))
        );
      case "r":
      case "c": {
        if (dx !== 0 && dy !== 0) return false;
        let count = 0;
        for (
          let u = x + Math.sign(dx), v = y + Math.sign(dy);
          u !== x + dx || v !== y + dy;
          u += Math.sign(dx), v += Math.sign(dy)
        )
          if (this.pieces[at(u, v)]) count++;
        return count === (piece.type === "c" && capture ? 1 : 0);
      }
      default:
        return false;
    }
  }
  attacked(index, byColor) {
    return this.pieces.some(
      (p, from) => p?.color === byColor && this.attacks(from, index, true),
    );
  }
  inCheck(color = this.color) {
    const king = this.king(color);
    return king < 0 || this.attacked(king, color === "w" ? "b" : "w");
  }
  pseudo(from) {
    const piece = this.pieces[from];
    if (!piece) return [];
    const result = [],
      [x, y] = point(from);
    const add = (u, v) => {
      const index = at(u, v);
      if (
        index >= 0 &&
        this.pieces[index]?.color !== piece.color &&
        this.pieces[index]?.type !== "k" &&
        this.attacks(from, index, !!this.pieces[index])
      )
        result.push(index);
    };
    if (piece.type === "r" || piece.type === "c") {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        let screen = false;
        for (let u = x + dx, v = y + dy; at(u, v) >= 0; u += dx, v += dy) {
          const index = at(u, v),
            target = this.pieces[index];
          if (!screen) {
            if (!target) result.push(index);
            else if (piece.type === "r") {
              if (target.color !== piece.color && target.type !== "k")
                result.push(index);
              break;
            } else screen = true;
          } else if (target) {
            if (target.color !== piece.color && target.type !== "k")
              result.push(index);
            break;
          }
        }
      }
    } else {
      const offsets = {
        k: [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ],
        a: [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ],
        b: [
          [2, 2],
          [2, -2],
          [-2, 2],
          [-2, -2],
        ],
        n: [
          [1, 2],
          [-1, 2],
          [1, -2],
          [-1, -2],
          [2, 1],
          [-2, 1],
          [2, -1],
          [-2, -1],
        ],
        p: [
          [0, piece.color === "w" ? 1 : -1],
          [1, 0],
          [-1, 0],
        ],
      };
      for (const [dx, dy] of offsets[piece.type] || []) add(x + dx, y + dy);
    }
    return result;
  }
  after(from, to) {
    const next = this.clone(),
      piece = next.pieces[from],
      captured = next.pieces[to];
    if (!piece) throw Error("Select a Xiangqi piece.");
    next.pieces[from] = null;
    next.pieces[to] = piece;
    next.color = piece.color === "w" ? "b" : "w";
    next.halfmove = captured ? 0 : this.halfmove + 1;
    next.fullmove = this.fullmove + (piece.color === "b" ? 1 : 0);
    return next;
  }
  legal(from, to) {
    const piece = this.pieces[from],
      target = this.pieces[to];
    return (
      !!piece &&
      target?.color !== piece.color &&
      target?.type !== "k" &&
      this.attacks(from, to, !!target) &&
      !this.after(from, to).inCheck(piece.color)
    );
  }
  moves({ square, verbose = true, color = this.color } = {}) {
    const result = [];
    for (let from = 0; from < 90; from++) {
      const piece = this.pieces[from];
      if (
        !piece ||
        piece.color !== color ||
        (square && from !== squareIndex(square))
      )
        continue;
      for (const to of this.pseudo(from))
        if (!this.after(from, to).inCheck(color)) {
          const move = {
            from: squareName(from),
            to: squareName(to),
            captured: this.pieces[to]?.type || null,
            piece: piece.type,
            id: piece.id,
            capturedId: this.pieces[to]?.id || null,
          };
          move.uci = move.from + move.to;
          move.san = move.uci;
          result.push(verbose ? move : move.uci);
        }
    }
    return result;
  }
  move(uci) {
    if (!/^[a-i][0-9][a-i][0-9]$/.test(uci || ""))
      throw Error("Invalid Xiangqi move.");
    const from = squareIndex(uci.slice(0, 2)),
      to = squareIndex(uci.slice(2));
    if (this.pieces[from]?.color !== this.color || !this.legal(from, to))
      throw Error("That move is not legal.");
    const piece = this.pieces[from],
      captured = this.pieces[to];
    Object.assign(this, this.after(from, to));
    return {
      from: uci.slice(0, 2),
      to: uci.slice(2),
      uci,
      san: uci + (this.inCheck() ? "+" : ""),
      piece: piece.type,
      id: piece.id,
      captured: captured?.type || null,
      capturedId: captured?.id || null,
      flags: captured ? "c" : "n",
    };
  }
}

export function checkedXiangqiFen(fen) {
  const position = new XiangqiPosition(fen),
    limits = { k: 1, a: 2, b: 2, n: 2, r: 2, c: 2, p: 5 };
  for (const color of ["w", "b"]) {
    for (const [type, max] of Object.entries(limits)) {
      const count = position.pieces.filter(
        (p) => p?.color === color && p.type === type,
      ).length;
      if (count > max || (type === "k" && count !== 1))
        throw Error("Invalid Xiangqi FEN piece count.");
    }
    const [x, y] = point(position.king(color));
    if (!palace(x, y, color))
      throw Error("The general must remain inside its palace.");
    for (let index = 0; index < 90; index++) {
      const p = position.pieces[index];
      if (p?.color !== color) continue;
      const [u, v] = point(index);
      if (
        p.type === "a" &&
        (!palace(u, v, color) ||
          ![
            [3, 0],
            [5, 0],
            [4, 1],
            [3, 2],
            [5, 2],
          ].some(([a, b]) => a === u && (color === "w" ? b : 9 - b) === v))
      )
        throw Error("Invalid advisor position.");
      if (
        p.type === "b" &&
        ![
          [2, 0],
          [6, 0],
          [0, 2],
          [4, 2],
          [8, 2],
          [2, 4],
          [6, 4],
        ].some(([a, b]) => a === u && (color === "w" ? b : 9 - b) === v)
      )
        throw Error("Invalid elephant position.");
      if (
        p.type === "p" &&
        (color === "w" ? v < 3 || (v < 5 && u % 2) : v > 6 || (v > 4 && u % 2))
      )
        throw Error("Invalid soldier position.");
    }
  }
  const previous = position.color === "w" ? "b" : "w";
  if (position.inCheck(previous))
    throw Error("The side that just moved cannot remain in check.");
  return position.fen();
}
