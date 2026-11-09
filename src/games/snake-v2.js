const SIZE = 20;
const CELLS = SIZE * SIZE;
export const SNAKE_TICK_LIMIT = 432000;

function neighbors(cell) {
  const x = cell % SIZE;
  return [
    cell >= SIZE ? cell - SIZE : -1,
    x < SIZE - 1 ? cell + 1 : -1,
    cell < CELLS - SIZE ? cell + SIZE : -1,
    x > 0 ? cell - 1 : -1,
  ];
}

function connected(head, walls) {
  const seen = new Set([head]);
  const queue = [head];
  for (let i = 0; i < queue.length; i++) {
    for (const cell of neighbors(queue[i])) {
      if (cell >= 0 && !walls.has(cell) && !seen.has(cell)) {
        seen.add(cell);
        queue.push(cell);
      }
    }
  }
  return seen.size === CELLS - walls.size;
}

function emptyCells(s) {
  const blocked = new Set([...s.body, ...s.obstacles, s.food, s.boost]);
  return Array.from({ length: CELLS }, (_, i) => i).filter(
    (i) => !blocked.has(i),
  );
}

export function initSnake(s) {
  Object.assign(s, {
    obstacles: [],
    boost: -1,
    boostUntil: 0,
    nextStep: 6,
    eaten: 0,
  });
}

export function snakeStep(s, random) {
  if (s.pending !== null) {
    s.dir = s.pending;
    s.pending = null;
  }
  const next = neighbors(s.body[0])[s.dir];
  const eating = next === s.food;
  if (
    next < 0 ||
    s.obstacles.includes(next) ||
    s.body.slice(0, eating ? undefined : -1).includes(next)
  ) {
    s.status = "lost";
    return;
  }
  s.body.unshift(next);
  if (next === s.boost) {
    s.boost = -1;
    s.boostUntil = s.ticks + 300;
  }
  if (eating) {
    s.score += 10;
    s.eaten++;
    s.food = -1;
    if (s.eaten % 5 === 0 && s.obstacles.length < 20) {
      const forward = neighbors(next)[s.dir];
      const candidates = emptyCells(s).filter((cell) => cell !== forward);
      while (candidates.length > 1) {
        const cell = candidates.splice(random(s, candidates.length), 1)[0];
        if (connected(next, new Set([...s.obstacles, cell]))) {
          s.obstacles.push(cell);
          break;
        }
      }
    }
    const available = emptyCells(s);
    if (available.length)
      s.food = available.splice(random(s, available.length), 1)[0];
    if (s.eaten % 3 === 0 && available.length)
      s.boost = available[random(s, available.length)];
    if (s.food < 0 && s.boost >= 0) {
      s.food = s.boost;
      s.boost = -1;
    }
    if (s.food < 0) s.status = "won";
  } else {
    s.body.pop();
  }
  s.nextStep = s.ticks + (s.boostUntil > s.ticks ? 4 : 6);
}

export function validateSnakeV2(s) {
  if (!Array.isArray(s.obstacles)) throw Error("Invalid Snake v2 obstacles.");
  const occupied = [
    ...s.body,
    ...s.obstacles,
    ...[s.food, s.boost].filter((i) => i >= 0),
  ];
  if (
    s.difficulty !== "normal" ||
    s.obstacles.length > 20 ||
    occupied.some((i) => !Number.isInteger(i) || i < 0 || i >= CELLS) ||
    new Set(occupied).size !== occupied.length ||
    !Number.isInteger(s.boost) ||
    s.boost < -1 ||
    !Number.isInteger(s.boostUntil) ||
    s.boostUntil < 0 ||
    s.boostUntil > s.ticks + 300 ||
    !Number.isInteger(s.nextStep) ||
    s.nextStep < s.ticks ||
    s.nextStep > s.ticks + 6 ||
    s.ticks > SNAKE_TICK_LIMIT ||
    s.eaten !== s.body.length - 4 ||
    s.score !== s.eaten * 10
  )
    throw Error("Invalid Snake v2 state.");
}
